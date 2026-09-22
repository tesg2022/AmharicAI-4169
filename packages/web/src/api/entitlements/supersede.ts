import { PLAN_ORDER, type PlanId } from "../content/plans";
import { anyProviderConfigured, liveGrants } from "./resolve";
import { disableSubscription, PaystackError } from "../billing/paystack";
import { manageableSubscriptions, setSubscriptionStatus } from "../billing/store";
import { cancelSubscription, PaypalError } from "../billing/paypal";
import { setPaypalStatus } from "../billing/paypal-store";
import type { GrantProvider, LiveGrant } from "../billing/store";

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
 * Both rules are provider-blind, and now that there are two providers that is
 * the whole reason this file reads `liveGrants` rather than either provider's
 * tables. The case it exists for is now MORE likely, not less: showing a
 * Paystack and a PayPal button side by side means somebody who bought Basic
 * with a card in March can buy Premium through PayPal in June without ever
 * touching the first subscription. Cross-provider supersession is the normal
 * case here, not an exotic one.
 *
 * What is NOT provider-blind is the cancelling, because the two providers stop
 * a subscription in genuinely different ways — see `cancelOne` below.
 *
 * Every failure here is logged and swallowed. This runs after a payment has
 * already succeeded, and a failed cleanup must never turn a completed purchase
 * into an error on the customer's screen — the next call reconciles it.
 */

export interface SupersededSubscription {
  /** The billing option that was cancelled, e.g. "basic_monthly". */
  option_id: string;
  /** Which provider was asked to stop it, for tracing in support. */
  provider: GrantProvider;
  /** Paystack's subscription code or PayPal's subscription id. */
  subscription_code: string;
  /** The tier it granted. */
  plan: PlanId;
  /** False when the provider refused the cancellation; it is retried next time. */
  cancelled: boolean;
  /** Why it was refused, when it was. */
  error?: string;
}

export async function reconcileSubscriptions(userId: string): Promise<SupersededSubscription[]> {
  if (!anyProviderConfigured()) return [];

  const grants = await liveGrants(userId);
  // Nothing can be superseded by nothing, and one grant cannot outrank itself.
  if (grants.length < 2) return [];

  const rank = (p: PlanId) => PLAN_ORDER.indexOf(p);
  const bestRank = Math.max(...grants.map((g) => rank(g.plan)));
  const lifetimeTiers = new Set(grants.filter((g) => g.term === "lifetime").map((g) => g.plan));

  const doomed = grants.filter(
    (g) =>
      g.recurring &&
      /**
       * Already stopping at period end, whichever provider it is with.
       * Cancelling again is a pointless write, and both providers reject it:
       * Paystack refuses a disable on a `non-renewing` subscription, and
       * PayPal refuses a cancel on an already-`CANCELLED` one.
       */
      !g.cancel_pending &&
      g.subscription_code !== null &&
      (rank(g.plan) < bestRank || lifetimeTiers.has(g.plan)),
  );

  if (doomed.length === 0) return [];

  /**
   * The Paystack email token is needed to disable, and it is deliberately not
   * carried on `LiveGrant` — that shape is read by the website and the app,
   * and a credential that can cancel a subscription has no business being
   * serialised towards a browser. It is read here, server-side, instead.
   *
   * Only fetched when a Paystack grant is actually doomed: PayPal needs no
   * such credential, so a PayPal-only supersession should not cost a query
   * against the Paystack tables.
   */
  const tokenFor = doomed.some((g) => g.provider === "paystack")
    ? await paystackTokens(userId)
    : new Map<string, string | null>();

  const results: SupersededSubscription[] = [];

  for (const sub of doomed) {
    results.push(await cancelOne(userId, sub, tokenFor));
  }

  return results;
}

async function paystackTokens(userId: string): Promise<Map<string, string | null>> {
  const rows = await manageableSubscriptions(userId);
  return new Map(
    rows.filter((r) => r.subscriptionCode).map((r) => [r.subscriptionCode!, r.emailToken]),
  );
}

/**
 * Stops one superseded subscription, the way its own provider stops things.
 *
 * The two mechanics are opposite, and the customer must not be able to tell:
 *
 *   Paystack: `disable` is end-of-cycle by construction. The subscription
 *             moves to `non-renewing`, stays live to the payment date already
 *             paid for, and is not charged again.
 *   PayPal:   `cancel` is immediate and has no end-of-cycle option at all.
 *             The subscription is `CANCELLED` at once, even with months paid
 *             for — so the paid period has to be preserved on this side, by
 *             leaving the stored `until` exactly as it is and letting
 *             `CANCELLED` go on entitling until that date passes. That is why
 *             `PAYPAL_ENTITLING_STATUSES` includes `CANCELLED`, and why
 *             `setPaypalStatus` is called without a date here.
 *
 * Either way: nothing is refunded, no time is taken back, and the customer
 * keeps what they paid for until it runs out.
 */
async function cancelOne(
  userId: string,
  sub: LiveGrant,
  tokenFor: Map<string, string | null>,
): Promise<SupersededSubscription> {
  const code = sub.subscription_code!;
  const base = {
    option_id: sub.option_id,
    provider: sub.provider,
    subscription_code: code,
    plan: sub.plan,
  };

  if (sub.provider === "paypal") {
    try {
      await cancelSubscription({
        subscriptionId: code,
        // Shown to the customer in PayPal's own emails and account history,
        // so it has to read as an explanation rather than an error code.
        reason: `Superseded by a higher plan on AmharicAI`,
      });
      /**
       * Written locally at once rather than waiting for
       * `BILLING.SUBSCRIPTION.CANCELLED` to arrive. No date is passed, so the
       * paid period the customer is owed stays exactly where it was — see the
       * note above. The webhook carries the same status a moment later, and
       * the write is idempotent.
       */
      await setPaypalStatus(code, "CANCELLED");
      console.info(`[paypal] cancelled superseded subscription ${code} for ${userId}`);
      return { ...base, cancelled: true };
    } catch (error) {
      const message = error instanceof PaypalError ? error.message : String(error);
      console.error(`[paypal] could not cancel superseded ${code}:`, error);
      return { ...base, cancelled: false, error: message };
    }
  }

  const token = tokenFor.get(code) ?? null;

  if (!token) {
    // Without the token this subscription cannot be cancelled through the
    // API at all, which is a state a human has to fix in the dashboard. It
    // is reported rather than retried silently forever.
    const error =
      "no email token stored for this subscription, so it cannot be cancelled from the app";
    console.error(`[paystack] cannot cancel superseded ${code} for ${userId}: ${error}`);
    return { ...base, cancelled: false, error };
  }

  try {
    await disableSubscription({ code, token });
    // Written locally at once rather than waiting for `subscription.not_renew`
    // to arrive: the customer is looking at the screen now, and the webhook
    // carries the same status a moment later, so the write is idempotent.
    await setSubscriptionStatus(code, "non-renewing");
    console.info(`[paystack] cancelled superseded subscription ${code} for ${userId}`);
    return { ...base, cancelled: true };
  } catch (error) {
    const message = error instanceof PaystackError ? error.message : String(error);
    console.error(`[paystack] could not cancel superseded ${code}:`, error);
    return { ...base, cancelled: false, error: message };
  }
}
