import { and, desc, eq, gt, isNull, lte } from "drizzle-orm";
import { db } from "../database";
import { accessCodeRedemptions } from "../database/schema";
import type { PlanSource } from "../database/schema";
import { PLAN_ORDER, planFromInput, type PlanId } from "../content/plans";

/**
 * The single place that answers "what plan is this person actually on".
 *
 * Precedence, highest first:
 *   1. a paid subscription        (Autumn — not configured in this build)
 *   2. an unexpired access-code grant
 *   3. the client preview switch  (anonymous callers only)
 *   4. Free
 *
 * Rules 1 and 2 are the only verified entitlements. Rule 3 exists so the
 * website and the app can still be explored without an account, but it is
 * refused for signed-in users: once somebody has an identity, letting a query
 * parameter upgrade them would make the whole login pointless.
 */

export interface ResolvedPlan {
  plan: PlanId;
  plan_source: PlanSource;
  plan_is_verified: boolean;
  /** When a verified grant lapses, ISO 8601. null for Free and previews. */
  expires_at: string | null;
  /**
   * Set when the user's most recent access-code grant has run out and nothing
   * replaced it. The UI shows this instead of silently demoting them.
   */
  expired_notice: { kind: "access_code"; plan: PlanId; expired_at: string } | null;
}

export const FREE_RESULT: ResolvedPlan = {
  plan: "free",
  plan_source: "default_free",
  plan_is_verified: false,
  expires_at: null,
  expired_notice: null,
};

export interface BillingStatus {
  /** True only when a payment could actually be taken and recorded. */
  configured: boolean;
  provider: "autumn";
  key_present: boolean;
  /** Everything still missing, in the deployment's own terms. */
  blockers: string[];
}

/**
 * Managed billing runs on Autumn, and Autumn is the authority for paid plans.
 *
 * A provisioned `AUTUMN_SECRET_KEY` alone does NOT mean this app can sell
 * anything: the integration also needs `autumn.config.ts` with the plans, the
 * `autumn()` Better Auth plugin, and the config pushed to Autumn. None of that
 * exists in this build, so reporting "configured" off the key's presence would
 * be a lie that leads straight to a checkout button that cannot charge.
 *
 * `integrationWired` is a constant on purpose. It flips in the same commit
 * that adds the dependency and the config — not before.
 */
const integrationWired = false;

export function billingStatus(): BillingStatus {
  const keyPresent = Boolean(process.env["AUTUMN_SECRET_KEY"]?.trim());
  const blockers: string[] = [];
  if (!keyPresent) {
    blockers.push("No AUTUMN_SECRET_KEY is set in this deployment.");
  }
  if (!integrationWired) {
    blockers.push(
      "The Autumn billing integration is not wired in this build: autumn-js is not installed, there is no autumn.config.ts defining the plans, and the autumn() auth plugin is not enabled. A key on its own cannot take a payment.",
    );
  }
  return {
    configured: keyPresent && integrationWired,
    provider: "autumn",
    key_present: keyPresent,
    blockers,
  };
}

/** Convenience for callers that only need the yes/no. */
export function billingConfigured(): boolean {
  return billingStatus().configured;
}

/**
 * Paid-subscription lookup slot.
 *
 * Deliberately empty rather than stubbed with a fake result: Autumn is the
 * authority for paid plans, no key is configured in this build, and inventing
 * a subscription here is exactly the "fake /payment-success that grants
 * Premium" anti-pattern. When the key lands this reads Autumn's customer.
 */
async function activeSubscription(_userId: string): Promise<null> {
  return null;
}

/** The highest-ranked plan among a user's live code grants. */
function best(plans: PlanId[]): PlanId {
  return plans.reduce<PlanId>(
    (acc, p) => (PLAN_ORDER.indexOf(p) > PLAN_ORDER.indexOf(acc) ? p : acc),
    "free",
  );
}

export async function resolvePlan(opts: {
  userId: string | null;
  /** The preview switch. Honoured for anonymous callers only. */
  previewPlan?: string | undefined;
}): Promise<ResolvedPlan> {
  const { userId, previewPlan } = opts;

  if (!userId) {
    if (previewPlan === undefined) return FREE_RESULT;
    const plan = planFromInput(previewPlan);
    if (plan === "free") return FREE_RESULT;
    return {
      plan,
      plan_source: "preview_cookie",
      plan_is_verified: false,
      expires_at: null,
      expired_notice: null,
    };
  }

  const subscription = await activeSubscription(userId);
  if (subscription) {
    // Unreachable until Autumn is configured; kept so wiring it is a one-liner.
    return FREE_RESULT;
  }

  const nowMs = new Date();
  const live = await db
    .select()
    .from(accessCodeRedemptions)
    .where(
      and(
        eq(accessCodeRedemptions.userId, userId),
        gt(accessCodeRedemptions.grantsUntil, nowMs),
        isNull(accessCodeRedemptions.revokedAt),
      ),
    );

  if (live.length > 0) {
    const plan = best(live.map((r) => r.grantedPlan as PlanId));
    const until = live
      .map((r) => r.grantsUntil.getTime())
      .reduce((a, b) => Math.max(a, b), 0);
    return {
      plan,
      plan_source: "access_code",
      plan_is_verified: true,
      expires_at: new Date(until).toISOString(),
      expired_notice: null,
    };
  }

  // No live grant. If one recently lapsed, say so rather than quietly
  // dropping the user to Free and letting them think the app broke.
  const [lapsed] = await db
    .select()
    .from(accessCodeRedemptions)
    .where(
      and(
        eq(accessCodeRedemptions.userId, userId),
        lte(accessCodeRedemptions.grantsUntil, nowMs),
        isNull(accessCodeRedemptions.revokedAt),
      ),
    )
    .orderBy(desc(accessCodeRedemptions.grantsUntil))
    .limit(1);

  if (lapsed) {
    return {
      ...FREE_RESULT,
      expired_notice: {
        kind: "access_code",
        plan: lapsed.grantedPlan as PlanId,
        expired_at: lapsed.grantsUntil.toISOString(),
      },
    };
  }

  return FREE_RESULT;
}
