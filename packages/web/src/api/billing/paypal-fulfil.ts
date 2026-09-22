import { billingOptionById, type PlanId } from "../content/plans";
import { optionIdForPaypalPlan } from "./paypal-config";
import { fetchSubscription, PAYPAL_CURRENCY, type PaypalSubscription } from "./paypal";
import {
  paypalCheckoutByReference,
  paypalCheckoutBySubscriptionId,
  paypalSubscriptionById,
  recordPayer,
  settlePaypalCheckout,
  setPaypalStatus,
  upsertPaypalGrant,
} from "./paypal-store";
import type { PaypalStatus } from "../database/schema";

/**
 * Turning an approved PayPal subscription into an entitlement. The only place
 * that does, for PayPal.
 *
 * Same rule as the Paystack side, and it survives the change of provider
 * intact: NOTHING IS GRANTED FROM A WEBHOOK BODY OR A REDIRECT QUERY STRING.
 * Everything here runs off `fetchSubscription`, read from PayPal by id at the
 * moment of fulfilment. A signed webhook proves who sent it, not that it is
 * current — PayPal retries for days and delivers out of order, so an
 * `ACTIVATED` body can easily arrive after the customer has already
 * cancelled. Re-reading costs one call and makes ordering irrelevant.
 *
 * What differs from Paystack is the ORDER OF EVENTS, and it changes the shape
 * of this file:
 *
 *   Paystack: charge the card, then create the subscription. Fulfilment
 *             starts from a transaction reference and has to go hunting for
 *             the subscription that the charge produced.
 *   PayPal:   create the subscription (unpaid, `APPROVAL_PENDING`), send the
 *             customer to approve it, and the approval raises the first
 *             charge. Fulfilment starts from a subscription id that has
 *             existed since before the customer left.
 *
 * So attribution here is a lookup rather than a guess — and the risk moves.
 * The Paystack risk was granting nothing to somebody who paid. The PayPal risk
 * is granting something to somebody who has NOT paid, because a subscription
 * id exists from the start and `APPROVAL_PENDING` looks like an object worth
 * acting on. It is not. Only `ACTIVE` (and the after-the-fact states
 * `SUSPENDED`/`CANCELLED`, which can only be reached from `ACTIVE`) means
 * money has moved.
 */

export type PaypalFulfilResult =
  | { kind: "granted"; optionId: string; plan: PlanId; status: PaypalStatus }
  | { kind: "pending"; message: string }
  | { kind: "not_paid"; status: string; message: string }
  | { kind: "unknown_subscription"; message: string };

/** PayPal's subscription statuses are already this app's stored vocabulary. */
function storedStatus(subscription: PaypalSubscription): PaypalStatus {
  return subscription.status as PaypalStatus;
}

/**
 * When the paid period runs out.
 *
 * `next_billing_time` is PayPal's own answer while the subscription is live,
 * and it is the only date that reflects the cycle the customer actually paid
 * for. Null is normal rather than exceptional — PayPal stops publishing it the
 * moment a subscription is cancelled or expired — and null here means "leave
 * the stored date alone", never "no expiry". `upsertPaypalGrant` and
 * `setPaypalStatus` both enforce that; this function only has to avoid
 * inventing a date it does not have.
 */
function paidUntil(subscription: PaypalSubscription): Date | null {
  const next = subscription.billing_info?.next_billing_time;
  if (!next) return null;
  const date = new Date(next);
  return Number.isNaN(date.getTime()) ? null : date;
}

function lastPaidAmount(subscription: PaypalSubscription): {
  amountUsd: string;
  currency: string;
} | null {
  const payment = subscription.billing_info?.last_payment;
  const value = payment?.amount?.value;
  if (!value) return null;
  return { amountUsd: value, currency: payment?.amount?.currency_code ?? PAYPAL_CURRENCY };
}

/**
 * Who this subscription belongs to, and what they bought.
 *
 * Three sources, in descending order of how much they can be trusted:
 *
 *   1. the local checkout row found by subscription id — written by this app
 *      before PayPal was ever called, so it cannot have been tampered with;
 *   2. the local checkout row found by `custom_id`, which is the reference
 *      this app generated and PayPal round-tripped. Covers the narrow window
 *      where the subscription was created but `attachSubscriptionId` did not
 *      land — a crash or a lost database write between two calls;
 *   3. an existing grant row for the same subscription, which is what makes
 *      renewals years later attributable. By then there may be no checkout row
 *      worth keeping, but the grant carries the user and the option.
 *
 * The plan id is a last resort for the OPTION only, never for the user: it
 * says what was bought, and nothing about who bought it. A payer id is
 * deliberately not used for attribution either — two app accounts can share
 * one PayPal wallet (a parent paying for a child's learning is the obvious
 * case), so matching on payer would hand the grant to whichever account
 * happened to be recorded last.
 */
async function attribute(subscription: PaypalSubscription): Promise<{
  userId: string;
  optionId: string;
  plan: PlanId;
  term: string;
  reference: string | null;
} | null> {
  const bySubscription = await paypalCheckoutBySubscriptionId(subscription.id);
  const byReference = bySubscription
    ? null
    : subscription.custom_id
      ? await paypalCheckoutByReference(subscription.custom_id)
      : null;
  const checkout = bySubscription ?? byReference;

  if (checkout) {
    return {
      userId: checkout.userId,
      optionId: checkout.optionId,
      plan: checkout.plan as PlanId,
      term: checkout.term,
      reference: checkout.reference,
    };
  }

  const existing = await paypalSubscriptionById(subscription.id);
  if (existing) {
    return {
      userId: existing.userId,
      optionId: existing.optionId,
      plan: existing.plan as PlanId,
      term: existing.term,
      reference: existing.reference,
    };
  }

  return null;
}

/**
 * Reads a subscription from PayPal and grants what it has paid for.
 *
 * Returns rather than throws for every outcome a customer can cause — an
 * approval they walked away from, a card their bank declined, a subscription
 * id pasted into the URL by hand. Only a PayPal outage throws, because that is
 * the one case where the question was never answered and the caller needs to
 * retry rather than to conclude anything.
 *
 * Safe to call repeatedly with the same id, which is not a nicety: in the
 * normal case the customer's return from PayPal and the `ACTIVATED` webhook
 * both run this within a second or two of each other, and PayPal will redeliver
 * that webhook for days if it does not get a 200.
 */
export async function fulfilPaypalSubscription(
  subscriptionId: string,
): Promise<PaypalFulfilResult> {
  const subscription = await fetchSubscription(subscriptionId);
  const status = storedStatus(subscription);

  const attribution = await attribute(subscription);

  if (!attribution) {
    /**
     * A subscription we cannot attribute. How loud this deserves to be depends
     * entirely on whether money has moved: an unattributable
     * `APPROVAL_PENDING` is a stale link somebody re-opened and costs nobody
     * anything, while an unattributable `ACTIVE` means a customer is being
     * charged for something no account can see.
     */
    if (status === "ACTIVE" || status === "SUSPENDED") {
      const optionGuess = optionIdForPaypalPlan(subscription.plan_id);
      console.error(
        `[paypal] PAID BUT UNATTRIBUTABLE: subscription ${subscription.id} is ` +
          `${status} on plan ${subscription.plan_id} ` +
          `(option ${optionGuess ?? "unknown"}, custom_id ${subscription.custom_id ?? "none"}) ` +
          `with no checkout row and no grant row. Nothing has been granted. ` +
          `Refund or grant by hand.`,
      );
      return {
        kind: "unknown_subscription",
        message:
          "That subscription is active on PayPal but we could not match it to an account. " +
          "Nothing has been lost — contact support and it will be sorted out by hand.",
      };
    }
    return {
      kind: "unknown_subscription",
      message: "We could not find that subscription. Nothing has been charged.",
    };
  }

  const { userId, optionId, reference } = attribution;
  const option = billingOptionById(optionId);
  if (!option) {
    console.error(
      `[paypal] subscription ${subscription.id} is for option "${optionId}", which is ` +
        `no longer in BILLING_OPTIONS. Granting from the stored row instead.`,
    );
  }
  const plan = (option?.plan ?? attribution.plan) as PlanId;
  const term = option?.term ?? attribution.term;

  /**
   * The payer is recorded from the subscription rather than at checkout,
   * because PayPal has no create-customer call and the payer id does not exist
   * until the customer has picked which of their accounts to pay from. Only
   * recorded once there is a real payer to record: `APPROVAL_PENDING` carries
   * whatever email the checkout suggested and no payer id at all.
   */
  const payerId = subscription.subscriber?.payer_id;
  if (payerId) {
    await recordPayer({
      userId,
      payerId,
      email: subscription.subscriber?.email_address ?? null,
    });
  }

  /**
   * Nothing has been charged yet.
   *
   * `APPROVAL_PENDING` is a subscription waiting for the customer on PayPal's
   * page. `APPROVED` is the half-second between them approving it and PayPal
   * activating it. Neither is money, and granting on either would mean a free
   * subscription to anyone who opens a checkout link and closes the tab.
   *
   * The checkout row is deliberately NOT settled as abandoned here. The
   * customer may still be on PayPal's page, and PayPal's own `EXPIRED` event —
   * or nothing at all — is what eventually closes it off. Marking it abandoned
   * from a return-path poll would race the approval.
   */
  if (status === "APPROVAL_PENDING" || status === "APPROVED") {
    return {
      kind: "pending",
      message:
        status === "APPROVED"
          ? "PayPal has your approval and is setting the subscription up — refresh in a moment."
          : "That subscription has not been approved on PayPal yet, and nothing has been charged.",
    };
  }

  /**
   * `EXPIRED` means the subscription ran its course or was never approved in
   * time. It grants nothing — it is not in `PAYPAL_ENTITLING_STATUSES` — but
   * the status is still written down, because an existing grant row sitting at
   * `ACTIVE` forever would keep claiming a subscription PayPal has finished
   * with.
   */
  if (status === "EXPIRED") {
    const existing = await paypalSubscriptionById(subscription.id);
    if (existing) await setPaypalStatus(subscription.id, status);
    if (reference) await settlePaypalCheckout(reference, "abandoned");
    return {
      kind: "not_paid",
      status,
      message: "That subscription has expired on PayPal and is no longer charging.",
    };
  }

  /**
   * `ACTIVE`, `SUSPENDED` and `CANCELLED` all reach the same write, and that
   * is the point.
   *
   * All three can only be arrived at from an activation, which means the first
   * charge succeeded and the customer has a paid period. `SUSPENDED` is a
   * failed renewal PayPal is retrying; `CANCELLED` is cancelled but paid up
   * until the stored date. Both keep their entitlement to `until` — the
   * translation into this app's `payment_failed` / `cancel_pending` happens in
   * `paypalLiveGrants`, and the only thing that ends access is the date passing.
   *
   * Writing all three through the upsert rather than branching also means a
   * webhook arriving before any grant row exists still creates one. Out-of-
   * order delivery is normal, and a `SUSPENDED` event that arrived before
   * `ACTIVATED` must not be dropped for want of a row to update.
   */
  const paid = lastPaidAmount(subscription);
  await upsertPaypalGrant({
    userId,
    optionId,
    plan,
    term,
    subscriptionId: subscription.id,
    planId: subscription.plan_id ?? null,
    status,
    until: paidUntil(subscription),
    amountUsd: paid?.amountUsd ?? String(option?.price_usd ?? ""),
    currency: paid?.currency ?? PAYPAL_CURRENCY,
    reference,
  });

  if (reference) {
    await settlePaypalCheckout(reference, "success");
  }

  return { kind: "granted", optionId, plan, status };
}
