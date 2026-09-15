import { billingOptionById, type PlanId } from "../content/plans";
import { isRecurring } from "./config";
import {
  fetchSubscription,
  listSubscriptions,
  verifyTransaction,
  type PaystackSubscriptionStatus as ApiStatus,
  type PaystackSubscription,
  type VerifiedTransaction,
} from "./paystack";
import {
  checkoutByReference,
  recordPayment,
  settleCheckout,
  upsertOneOffGrant,
  upsertSubscriptionGrant,
} from "./store";
import type { PaystackStatus } from "../database/schema";

/**
 * Turning a payment into an entitlement. The only place that does.
 *
 * One rule, and it is the rule the whole billing rewrite exists to enforce:
 * NOTHING IS GRANTED WITHOUT A TRANSACTION VERIFIED AGAINST PAYSTACK BY
 * REFERENCE. Not from a webhook body — those are signed, but a signature
 * proves authorship, not that the event is current or that it has not already
 * been acted on. Not from a redirect query string, which is whatever the
 * customer's browser was asked to send. Not from the client, ever.
 *
 * Two callers, one path:
 *   - the customer returning from Paystack, so access appears immediately
 *   - the webhook, so renewals, failures and cancellations keep it current
 *
 * Both are idempotent, because in the normal case both run for the same
 * payment within a second of each other.
 */

export type FulfilResult =
  | { kind: "granted"; optionId: string; plan: PlanId; recurring: boolean }
  | { kind: "pending"; message: string }
  | { kind: "not_paid"; status: string; message: string }
  | { kind: "unknown_reference"; message: string };

/** Paystack's subscription statuses are already our stored vocabulary. */
function storedStatus(status: ApiStatus): PaystackStatus {
  return status as PaystackStatus;
}

/**
 * Reads the app's own identifiers back off a transaction.
 *
 * The local checkout row is the primary source — it was written before the
 * customer left, so it cannot have been tampered with in transit. Metadata is
 * the fallback for the one case the row cannot cover: a subscription renewal
 * years later, whose transaction was created by Paystack and never passed
 * through `recordCheckout` at all.
 */
function metadataOf(txn: VerifiedTransaction): Record<string, unknown> {
  const raw = txn.metadata;
  if (!raw) return {};
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return raw;
}

function planCodeOf(txn: VerifiedTransaction): string | null {
  if (typeof txn.plan === "string" && txn.plan) return txn.plan;
  if (txn.plan && typeof txn.plan === "object" && txn.plan.plan_code) {
    return txn.plan.plan_code;
  }
  return txn.plan_object?.plan_code ?? null;
}

/**
 * Verifies a reference and grants what it paid for.
 *
 * Returns rather than throws for every outcome a customer can cause — an
 * abandoned checkout, a declined card, a reference typed into the URL by
 * hand. Only a Paystack outage throws, because that is the one case where
 * retrying later is the right answer and the caller needs to know the
 * question was never answered.
 */
export async function fulfilReference(reference: string): Promise<FulfilResult> {
  const txn = await verifyTransaction(reference);

  if (txn.status !== "success") {
    // "abandoned" is the overwhelmingly common one: they opened the page and
    // closed it. It is not an error and must not be reported as one.
    await settleCheckout(
      reference,
      txn.status === "abandoned" || txn.status === "pending" ? "abandoned" : "failed",
    );
    return {
      kind: "not_paid",
      status: txn.status,
      message:
        txn.status === "abandoned" || txn.status === "pending"
          ? "That payment was not completed, and nothing was charged."
          : "That payment did not go through, and nothing was charged. Your bank may be able to say why.",
    };
  }

  const checkout = await checkoutByReference(reference);
  const metadata = metadataOf(txn);

  const userId =
    checkout?.userId ??
    (typeof metadata["app_user_id"] === "string" ? metadata["app_user_id"] : null);
  const optionId =
    checkout?.optionId ??
    (typeof metadata["option_id"] === "string" ? metadata["option_id"] : null);

  if (!userId || !optionId) {
    // A successful payment we cannot attribute. Loud, because it means
    // somebody is out of pocket with nothing to show for it, and it needs a
    // human rather than a retry.
    console.error(
      `[paystack] PAID BUT UNATTRIBUTABLE: reference ${reference} succeeded ` +
        `(${txn.currency} ${txn.amount} subunit) with no local checkout row and no ` +
        `usable metadata. Nothing has been granted. Refund or grant by hand.`,
    );
    return {
      kind: "unknown_reference",
      message:
        "That payment succeeded but we could not match it to an account. " +
        "Nothing has been lost — contact support with your reference and it will be sorted out by hand.",
    };
  }

  const option = billingOptionById(optionId);
  if (!option) {
    console.error(
      `[paystack] reference ${reference} paid for option "${optionId}", which is no ` +
        `longer in BILLING_OPTIONS. Granting from the stored checkout row instead.`,
    );
  }

  await recordPayment({
    reference: txn.reference,
    userId,
    optionId,
    amountSubunit: txn.amount,
    currency: txn.currency,
    status: txn.status,
    channel: txn.channel ?? null,
    paidAt: txn.paid_at ? new Date(txn.paid_at) : new Date(),
  });

  const plan = (option?.plan ?? checkout?.plan ?? "free") as PlanId;
  const term = option?.term ?? checkout?.term ?? "monthly";
  const recurring = option ? isRecurring(option) : term !== "lifetime";

  if (!recurring) {
    await upsertOneOffGrant({
      userId,
      optionId,
      plan,
      term,
      amountSubunit: txn.amount,
      currency: txn.currency,
      reference: txn.reference,
    });
    await settleCheckout(reference, "success");
    return { kind: "granted", optionId, plan, recurring: false };
  }

  /**
   * A plan transaction. Paystack has charged them and will create the
   * subscription itself; the transaction carries no subscription code, so it
   * is looked up by customer rather than waited for.
   */
  const subscription = await findSubscription(txn, planCodeOf(txn) ?? checkout?.planCode ?? null);

  if (!subscription) {
    /**
     * Paid, plan transaction, and no subscription visible yet. Rare but real:
     * subscription creation is a moment behind the charge.
     *
     * The payment is recorded and the checkout is left pending on purpose —
     * the `subscription.create` webhook will complete it, and a second visit
     * to the callback page will find it. What must NOT happen here is a grant
     * with no subscription code: it would be uncancellable, invisible to
     * every renewal event, and would sit on the account forever.
     */
    console.warn(
      `[paystack] ${reference} paid but its subscription is not readable yet; ` +
        `waiting for subscription.create.`,
    );
    return {
      kind: "pending",
      message:
        "Your payment went through. The subscription is still being set up on Paystack's " +
        "side — refresh in a moment and it will be here.",
    };
  }

  await upsertSubscriptionGrant({
    userId,
    optionId,
    plan,
    term,
    subscriptionCode: subscription.subscription_code,
    emailToken: subscription.email_token ?? null,
    planCode: planCodeOf(txn) ?? checkout?.planCode ?? null,
    status: storedStatus(subscription.status),
    until: subscription.next_payment_date ? new Date(subscription.next_payment_date) : null,
    amountSubunit: txn.amount,
    currency: txn.currency,
    reference: txn.reference,
  });

  await settleCheckout(reference, "success");
  return { kind: "granted", optionId, plan, recurring: true };
}

/**
 * The subscription a plan transaction just created.
 *
 * Matched on plan code and narrowed to the newest, because a customer can
 * legitimately hold several subscriptions and re-subscribing to a plan they
 * once cancelled must attach to the new one rather than resurrect the dead
 * row. A second fetch by code follows the list, because the list response
 * does not reliably carry `email_token` and without that token the
 * subscription can never be cancelled from here.
 */
async function findSubscription(
  txn: VerifiedTransaction,
  planCode: string | null,
): Promise<PaystackSubscription | null> {
  let candidates: PaystackSubscription[];
  try {
    candidates = await listSubscriptions({ customerId: txn.customer.id });
  } catch (error) {
    console.error("[paystack] could not list subscriptions during fulfilment:", error);
    return null;
  }

  const matching = candidates.filter(
    (s) => !planCode || s.plan?.plan_code === planCode,
  );
  // Highest Paystack id is the most recently created.
  const newest = matching.sort((a, b) => b.id - a.id)[0];
  if (!newest) return null;

  try {
    return await fetchSubscription(newest.subscription_code);
  } catch (error) {
    console.error(
      `[paystack] could not fetch subscription ${newest.subscription_code}:`,
      error,
    );
    // The list row is better than nothing for status and dates, but it may
    // lack the token — which upsert handles by never overwriting a stored one.
    return newest;
  }
}
