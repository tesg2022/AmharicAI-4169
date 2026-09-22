import { and, desc, eq, gt, isNull, lte } from "drizzle-orm";
import { db } from "../database";
import { accessCodeRedemptions } from "../database/schema";
import type { PlanSource } from "../database/schema";
import { PLAN_ORDER, planFromInput, type PlanId } from "../content/plans";
import type { LiveGrant } from "../billing/store";
import { anyProviderConfigured, liveGrants } from "../billing/grants";
import { billingConfigured, billingStatus, type BillingStatus } from "../billing/config";
import { paypalBillingStatus, paypalConfigured } from "../billing/paypal-config";

/**
 * The single place that answers "what plan is this person actually on".
 *
 * Precedence, highest first:
 *   1. a paid subscription        (the local Paystack mirror is the authority)
 *   2. an unexpired access-code grant
 *   3. the client preview switch  (anonymous callers only)
 *   4. Free
 *
 * Rules 1 and 2 are the only verified entitlements. Rule 3 exists so the
 * website and the app can still be explored without an account, but it is
 * refused for signed-in users: once somebody has an identity, letting a query
 * parameter upgrade them would make the whole login pointless.
 *
 * Rule 1 changed provider but not shape. Under Autumn this function called the
 * billing API on every authenticated request, which made Autumn's availability
 * our availability — a timeout demoted a paying learner to Free mid-lesson,
 * and the catch block that made that "safe" is exactly what hid it. Paystack
 * is now written into local tables by fulfilment and webhooks, and read from
 * there: entitlement survives a Paystack outage, and a slow API cannot
 * un-pay somebody.
 */

/**
 * Re-exported so callers keep one import site for "everything about what this
 * user is entitled to", even though the implementation now lives under
 * `billing/`. Deliberate: `routes/`, `mirror` and `supersede` all reached into
 * this module for `liveGrants`/`billingStatus` and none of them should have to
 * learn which provider file it moved to.
 */
export {
  liveGrants,
  anyProviderConfigured,
  billingConfigured,
  billingStatus,
  paypalConfigured,
  paypalBillingStatus,
};
export type { LiveGrant, BillingStatus };

export interface ResolvedPlan {
  plan: PlanId;
  plan_source: PlanSource;
  plan_is_verified: boolean;
  /** When a verified grant lapses, ISO 8601. null for Free, lifetime, previews. */
  expires_at: string | null;
  /**
   * Set when the user's most recent access-code grant has run out and nothing
   * replaced it. The UI shows this instead of silently demoting them.
   */
  expired_notice: { kind: "access_code"; plan: PlanId; expired_at: string } | null;
  /**
   * Set when a renewal charge failed and Paystack will retry on the next
   * billing date. Access continues to `expires_at` — the period was paid for —
   * so this is a warning and not a demotion.
   *
   * Carried on the resolved plan rather than left in the billing screen
   * because the one thing that must happen is the customer finding out, and
   * the billing screen is the page they have least reason to open. Autumn's
   * equivalent state was dropped on the floor entirely.
   */
  payment_notice: { kind: "renewal_failed"; plan: PlanId; retry_after: string | null } | null;
}

export const FREE_RESULT: ResolvedPlan = {
  plan: "free",
  plan_source: "default_free",
  plan_is_verified: false,
  expires_at: null,
  expired_notice: null,
  payment_notice: null,
};

/**
 * The paid-plan lookup. The local mirror is the authority — this reads it, and
 * believes nothing the client says.
 *
 * Maps an option id back to an entitlement tier via BILLING_OPTIONS inside
 * `liveGrants`, so `premium_annual` and `premium_lifetime` both resolve to
 * `premium` without this function knowing what a billing term is.
 */
/**
 * How far a grant holds access open, ms since epoch, or null for never.
 *
 * A lifetime grant is stored with a null `until`, but the term is checked too
 * so that a lifetime row written with a date on it cannot be turned into an
 * expiry — the purchase was for forever and no stray column decides otherwise.
 */
function coverageOf(grant: LiveGrant): number | null {
  return grant.term === "lifetime" ? null : grant.until;
}

async function activeSubscription(userId: string): Promise<{
  plan: PlanId;
  expires_at: string | null;
  payment_failed: boolean;
} | null> {
  const grants = await liveGrants(userId);
  if (grants.length === 0) return null;

  // Highest tier wins when several are live — never the lowest, which would
  // silently downgrade someone who upgraded mid-cycle or who holds a
  // lifetime Premium alongside a legacy Basic subscription.
  //
  // A subscription set to cancel at period end still counts until that date.
  // It has been paid for, and cutting access off the moment somebody upgrades
  // away from it would take back time they bought.
  let bestPlan: PlanId = "free";
  for (const grant of grants) {
    if (PLAN_ORDER.indexOf(grant.plan) > PLAN_ORDER.indexOf(bestPlan)) bestPlan = grant.plan;
  }
  if (bestPlan === "free") return null;

  // Tier alone does not settle the expiry date. Somebody can hold several
  // grants at the same tier — a lifetime Premium bought on top of a Premium
  // monthly, or an annual taken out mid-month — and the one that decides when
  // access ends is the one that reaches furthest, not whichever the database
  // happened to return first. Comparing only across tiers (the previous
  // behaviour) let a monthly grant set the expiry and then skipped the
  // lifetime row entirely as "not higher", so a lifetime buyer was told their
  // Premium expired in a month.
  //
  // `null` means never, so it wins outright over every date.
  let covering: LiveGrant | null = null;
  for (const grant of grants) {
    if (grant.plan !== bestPlan) continue;
    if (covering === null) {
      covering = grant;
      continue;
    }
    if (coverageOf(covering) === null) continue;
    const next = coverageOf(grant);
    if (next === null || next > (coverageOf(covering) as number)) covering = grant;
  }
  if (covering === null) return null;

  const until = coverageOf(covering);
  return {
    plan: bestPlan,
    expires_at: until === null ? null : new Date(until).toISOString(),
    // Read off the grant that is actually holding the access open. A failed
    // renewal on a superseded monthly is not a warning worth showing to
    // somebody whose lifetime purchase already covers them forever.
    payment_failed: covering.payment_failed,
  };
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
      payment_notice: null,
    };
  }

  // A paid subscription outranks everything else, including an access code:
  // somebody who has actually paid must never be resolved down to a code grant
  // that happens to be smaller, and must never be resolved down to Free.
  const subscription = await activeSubscription(userId);
  if (subscription) {
    return {
      plan: subscription.plan,
      plan_source: "subscription",
      plan_is_verified: true,
      expires_at: subscription.expires_at,
      expired_notice: null,
      payment_notice: subscription.payment_failed
        ? {
            kind: "renewal_failed",
            plan: subscription.plan,
            // The retry lands on the next billing date, which is the end of
            // the period already paid for.
            retry_after: subscription.expires_at,
          }
        : null,
    };
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
    const until = live.map((r) => r.grantsUntil.getTime()).reduce((a, b) => Math.max(a, b), 0);
    return {
      plan,
      plan_source: "access_code",
      plan_is_verified: true,
      expires_at: new Date(until).toISOString(),
      expired_notice: null,
      payment_notice: null,
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
