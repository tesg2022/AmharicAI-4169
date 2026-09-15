import { PLAN_ORDER, type PlanId } from "../content/plans";
import { billingConfigured, liveGrants } from "./resolve";
import { disableSubscription, PaystackError } from "../billing/paystack";
import { manageableSubscriptions, setSubscriptionStatus } from "../billing/store";

/**
 * Cancels paid subscriptions a customer has outgrown.
 *
 * No payment provider does this on its own, and the failure it prevents is
 * expensive in the only direction that matters: a Basic subscriber who buys
 * Premium lifetime ends up holding an active R89/month subscription *and* the
 * R2 599 purchase, and goes on paying monthly forever for something they have
 * already bought outright. Charging somebody for what they have superseded is
 * not an edge case to note in a comment and leave running.
 *
 * Two rules, and nothing else:
 *   - a subscription on a strictly lower tier than the best live grant is
 *     superseded (Basic monthly under a Premium anything)
 *   - a subscription on the *same* tier as a lifetime purchase of that tier is
 *     superseded (Premium monthly under Premium lifetime) — the whole point of
 *     buying lifetime is to stop paying
 *
 * Paystack's disable endpoint is end-of-cycle by construction, which is
 * exactly what is wanted here: the subscription moves to `non-renewing`,
 * stays live until the payment date already paid for, and is not charged
 * again. Per Paystack's own documentation it then emits `subscription.not_renew`
 * now and `subscription.disable` on that date. Nothing is refunded and no time
 * is taken back, because `non-renewing` still entitles in `liveGrants`.
 *
 * Every failure here is logged and swallowed. This runs after a payment has
 * already succeeded, and a failed cleanup must never turn a completed purchase
 * into an error on the customer's screen — the next call reconciles it.
 */

export interface SupersededSubscription {
  /** The billing option that was cancelled, e.g. "basic_monthly". */
  option_id: string;
  /** The Paystack subscription code, for tracing a cancellation in support. */
  subscription_code: string;
  /** The tier it granted. */
  plan: PlanId;
  /** False when Paystack refused the cancellation; it is retried next time. */
  cancelled: boolean;
  /** Why it was refused, when it was. */
  error?: string;
}

export async function reconcileSubscriptions(userId: string): Promise<SupersededSubscription[]> {
  if (!billingConfigured()) return [];

  const grants = await liveGrants(userId);
  // Nothing can be superseded by nothing, and one grant cannot outrank itself.
  if (grants.length < 2) return [];

  const rank = (p: PlanId) => PLAN_ORDER.indexOf(p);
  const bestRank = Math.max(...grants.map((g) => rank(g.plan)));
  const lifetimeTiers = new Set(grants.filter((g) => g.term === "lifetime").map((g) => g.plan));

  const doomed = grants.filter(
    (g) =>
      g.recurring &&
      // Already stopping at period end. Disabling it again is a pointless
      // write and Paystack rejects a disable on a non-renewing subscription.
      !g.cancel_pending &&
      g.subscription_code !== null &&
      (rank(g.plan) < bestRank || lifetimeTiers.has(g.plan)),
  );

  if (doomed.length === 0) return [];

  /**
   * The email token is needed to disable, and it is deliberately not carried
   * on `LiveGrant` — that shape is read by the website and the app, and a
   * credential that can cancel a subscription has no business being
   * serialised towards a browser. It is read here, server-side, instead.
   */
  const rows = await manageableSubscriptions(userId);
  const tokenFor = new Map(
    rows.filter((r) => r.subscriptionCode).map((r) => [r.subscriptionCode!, r.emailToken]),
  );

  const results: SupersededSubscription[] = [];

  for (const sub of doomed) {
    const code = sub.subscription_code!;
    const token = tokenFor.get(code) ?? null;

    if (!token) {
      // Without the token this subscription cannot be cancelled through the
      // API at all, which is a state a human has to fix in the dashboard. It
      // is reported rather than retried silently forever.
      const error =
        "no email token stored for this subscription, so it cannot be cancelled from the app";
      console.error(`[paystack] cannot cancel superseded ${code} for ${userId}: ${error}`);
      results.push({
        option_id: sub.option_id,
        subscription_code: code,
        plan: sub.plan,
        cancelled: false,
        error,
      });
      continue;
    }

    try {
      await disableSubscription({ code, token });
      // Written locally at once rather than waiting for `subscription.not_renew`
      // to arrive: the customer is looking at the screen now, and the webhook
      // carries the same status a moment later, so the write is idempotent.
      await setSubscriptionStatus(code, "non-renewing");
      console.info(`[paystack] cancelled superseded subscription ${code} for ${userId}`);
      results.push({
        option_id: sub.option_id,
        subscription_code: code,
        plan: sub.plan,
        cancelled: true,
      });
    } catch (error) {
      const message = error instanceof PaystackError ? error.message : String(error);
      console.error(`[paystack] could not cancel superseded ${code}:`, error);
      results.push({
        option_id: sub.option_id,
        subscription_code: code,
        plan: sub.plan,
        cancelled: false,
        error: message,
      });
    }
  }

  return results;
}
