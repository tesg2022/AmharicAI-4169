import { and, eq, sql } from "drizzle-orm";
import { createHmac } from "node:crypto";
import { db } from "../database";
import { usageCounters, type Meter } from "../database/schema";
import { quotasFor, type PlanId } from "../content/plans";

/**
 * Server-side usage quotas.
 *
 * This is the AI cost control. Every metered call — a tutor turn, a synthesis,
 * a translation — passes through `consume()` before the provider is touched,
 * so the ceiling is enforced where the money is spent rather than in a client
 * that anyone can edit. The client's own counter, if it has one, is a display
 * of this number and never an authority over it.
 *
 * Two properties the naive version does not have:
 *
 *   1. The check and the increment are one atomic statement. Read-then-write
 *      lets N parallel requests all observe `count = limit - 1` and all pass.
 *      Here the increment is conditional in SQL, so exactly one of them wins.
 *   2. Anonymous callers are metered too, keyed by a salted hash of their
 *      address. Without this the free tier is bypassed by signing out.
 */

/** Monthly meters reset on a "YYYY-MM" boundary, daily ones on "YYYY-MM-DD". */
type Cadence = "monthly" | "daily";

const CADENCE: Record<Meter, Cadence> = {
  tutor_turn: "monthly",
  tts_synthesis: "daily",
  translate_request: "daily",
};

export function periodFor(meter: Meter, at: Date = new Date()): string {
  const iso = at.toISOString();
  return CADENCE[meter] === "monthly" ? iso.slice(0, 7) : iso.slice(0, 10);
}

/** When the current bucket rolls over, so the UI can say "resets on ...". */
export function resetsAt(meter: Meter, at: Date = new Date()): Date {
  const d = new Date(at);
  if (CADENCE[meter] === "monthly") {
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
  }
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1));
}

/**
 * The anonymous subject key.
 *
 * A raw IP is personal data under GDPR and we have no reason to store one, so
 * it is HMAC'd with a server secret before it ever reaches the database. The
 * result is stable enough to rate-limit against and useless to anyone reading
 * the table.
 */
export function anonSubject(address: string | null | undefined): string {
  const pepper =
    process.env["USAGE_PEPPER"] ?? process.env["BETTER_AUTH_SECRET"] ?? "amharicai-usage";
  return "anon:" + createHmac("sha256", pepper).update(address ?? "unknown").digest("hex").slice(0, 32);
}

/**
 * The limit for one meter under one plan.
 *
 * `null` means this plan does not meter that resource. It never means "skip
 * the check because we could not work out a number" — an unknown meter falls
 * through to the free-tier limit, so a typo fails closed and cheap rather than
 * open and expensive.
 */
export function limitFor(plan: PlanId, meter: Meter): number | null {
  const q = quotasFor(plan);
  switch (meter) {
    case "tutor_turn":
      return q.tutor_per_month;
    case "tts_synthesis":
      return q.tts_per_day;
    case "translate_request":
      // Not separately metered today: the per-request character cap in the
      // plan is the control, and translation has no provider key in this build.
      return null;
    default:
      return quotasFor("free").tutor_per_month;
  }
}

/**
 * Anonymous ceilings, independent of any plan.
 *
 * A signed-out visitor cannot be on a paid plan, so they get the free numbers
 * — but lower, because an anonymous subject is an address rather than a
 * person and one address can be a whole cafe. Generous enough to try the
 * tutor before signing up, small enough that scripting it is pointless.
 */
const ANON_LIMITS: Partial<Record<Meter, number>> = {
  tutor_turn: 3,
  tts_synthesis: 10,
};

export interface UsageState {
  meter: Meter;
  /** null = this plan does not meter it. */
  limit: number | null;
  used: number;
  /** null when there is no limit. */
  remaining: number | null;
  period: string;
  resets_at: string;
  /** Would the next call be allowed? */
  allowed: boolean;
  /** True when the ceiling is fair-use rather than the advertised product. */
  fair_use: boolean;
}

export interface Subject {
  /** Signed-in user id, or null for an anonymous caller. */
  userId: string | null;
  /** Client address, used only when `userId` is null. Hashed before storage. */
  address?: string | null;
}

function keyFor(subject: Subject): { key: string; kind: "user" | "anon" } {
  return subject.userId
    ? { key: subject.userId, kind: "user" }
    : { key: anonSubject(subject.address), kind: "anon" };
}

function effectiveLimit(subject: Subject, plan: PlanId, meter: Meter): number | null {
  if (!subject.userId) return ANON_LIMITS[meter] ?? 0;
  return limitFor(plan, meter);
}

/** Read a meter without spending any of it. */
export async function peek(
  subject: Subject,
  plan: PlanId,
  meter: Meter,
): Promise<UsageState> {
  const { key } = keyFor(subject);
  const period = periodFor(meter);
  const limit = effectiveLimit(subject, plan, meter);

  const [row] = await db
    .select({ count: usageCounters.count })
    .from(usageCounters)
    .where(
      and(
        eq(usageCounters.subject, key),
        eq(usageCounters.meter, meter),
        eq(usageCounters.period, period),
      ),
    )
    .limit(1);

  const used = row?.count ?? 0;
  return {
    meter,
    limit,
    used,
    remaining: limit === null ? null : Math.max(0, limit - used),
    period,
    resets_at: resetsAt(meter).toISOString(),
    allowed: limit === null || used < limit,
    fair_use: meter === "tutor_turn" && quotasFor(plan).tutor_is_fair_use,
  };
}

export interface ConsumeResult extends UsageState {
  /** True when this call was counted; false when it was refused. */
  consumed: boolean;
}

/**
 * Spend one unit of a meter, atomically.
 *
 * The two statements are both conditional and both idempotent under a race:
 * the insert is `ON CONFLICT DO NOTHING`, and the increment only fires while
 * `count < limit`. Whichever request arrives last sees zero rows changed and
 * is refused, so the ceiling holds under concurrency instead of leaking one
 * extra call per parallel request.
 */
export async function consume(
  subject: Subject,
  plan: PlanId,
  meter: Meter,
  amount = 1,
): Promise<ConsumeResult> {
  const { key, kind } = keyFor(subject);
  const period = periodFor(meter);
  const limit = effectiveLimit(subject, plan, meter);

  if (limit === null) {
    // Unmetered for this plan. Still counted, so usage is observable and a
    // later ceiling can be set from real numbers rather than guesswork.
    await bump(key, kind, meter, period, plan, amount, null);
    const after = await peek(subject, plan, meter);
    return { ...after, consumed: true };
  }

  await db
    .insert(usageCounters)
    .values({
      id: crypto.randomUUID(),
      subject: key,
      subjectKind: kind,
      meter,
      period,
      count: 0,
      planAtOpen: plan,
    })
    .onConflictDoNothing();

  const changed = await bump(key, kind, meter, period, plan, amount, limit);
  const after = await peek(subject, plan, meter);
  return { ...after, consumed: changed };
}

/**
 * Give back a unit that was spent on work that never happened.
 *
 * Quota is taken before the provider is called, because that is the only order
 * that actually caps spend under concurrency. The cost of that order is that a
 * provider failure — a 502 from the TTS vendor, a dropped connection — would
 * otherwise charge the learner for audio they never received. This puts it
 * back, floored at zero so a double refund can never mint allowance.
 */
export async function refund(
  subject: Subject,
  meter: Meter,
  amount = 1,
): Promise<void> {
  const { key } = keyFor(subject);
  const period = periodFor(meter);
  await db
    .update(usageCounters)
    .set({ count: sql`max(0, ${usageCounters.count} - ${amount})` })
    .where(
      and(
        eq(usageCounters.subject, key),
        eq(usageCounters.meter, meter),
        eq(usageCounters.period, period),
      ),
    );
}

/**
 * The conditional increment. Returns whether the row actually moved.
 *
 * libsql's driver does not report affected rows uniformly across statement
 * kinds, so the write uses RETURNING and the caller reads the row back — one
 * extra round trip in exchange for not having to trust a rowcount.
 */
async function bump(
  key: string,
  kind: "user" | "anon",
  meter: Meter,
  period: string,
  plan: PlanId,
  amount: number,
  limit: number | null,
): Promise<boolean> {
  if (limit === null) {
    await db
      .insert(usageCounters)
      .values({
        id: crypto.randomUUID(),
        subject: key,
        subjectKind: kind,
        meter,
        period,
        count: amount,
        planAtOpen: plan,
      })
      .onConflictDoUpdate({
        target: [usageCounters.subject, usageCounters.meter, usageCounters.period],
        set: { count: sql`${usageCounters.count} + ${amount}`, lastAt: new Date() },
      });
    return true;
  }

  const updated = await db
    .update(usageCounters)
    .set({ count: sql`${usageCounters.count} + ${amount}`, lastAt: new Date() })
    .where(
      and(
        eq(usageCounters.subject, key),
        eq(usageCounters.meter, meter),
        eq(usageCounters.period, period),
        sql`${usageCounters.count} + ${amount} <= ${limit}`,
      ),
    )
    .returning({ id: usageCounters.id });

  return updated.length > 0;
}

/**
 * The message a refused caller sees. Written here so the website, the app and
 * the API all refuse in the same words, and so the words say what to do next
 * rather than just "limit reached".
 */
export function refusalMessage(state: UsageState, plan: PlanId): string {
  const when = new Date(state.resets_at).toUTCString();
  if (state.limit === null) return "";
  if (state.fair_use) {
    return `You have reached the fair-use ceiling of ${state.limit.toLocaleString()} tutor questions this month. It resets on ${when}. If you genuinely need more, get in touch — this ceiling exists to stop runaway automation, not to stop you studying.`;
  }
  if (plan === "free") {
    return `The free plan includes ${state.limit} tutor questions a month and you have used them all. Your allowance resets on ${when}, or Basic at $4.99 a month raises it to 300.`;
  }
  return `You have used all ${state.limit.toLocaleString()} of this period's allowance. It resets on ${when}.`;
}
