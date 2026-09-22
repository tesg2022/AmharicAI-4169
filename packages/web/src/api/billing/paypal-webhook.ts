import { fulfilPaypalSubscription } from "./paypal-fulfil";
import { verifyWebhook, webhookHeaders } from "./paypal";
import {
  claimPaypalEvent,
  markPaypalEventFailed,
  paypalSubscriptionById,
  recordPaypalPayment,
} from "./paypal-store";

/**
 * PayPal's webhook endpoint.
 *
 * Registered as a plain Hono route rather than an oRPC procedure, for the same
 * reason the Paystack one is: this is a signed transmission and the handler
 * has to control how the body is read. oRPC would parse it first.
 *
 * The three rules from the Paystack handler hold here unchanged, because they
 * were never Paystack-specific:
 *
 * 1. A SIGNATURE PROVES AUTHORSHIP, NOT TRUTH. Every handler below re-reads
 *    the subscription from PayPal's API and writes from that answer. The body
 *    decides WHICH object to go and ask about, and nothing else. PayPal
 *    retries for three days and does not guarantee order, so an `ACTIVATED`
 *    body genuinely can arrive after the customer has cancelled — acting on
 *    the body's own status would resurrect a dead subscription.
 * 2. PROCESSING IS IDEMPOTENT. The event id is claimed before any work, so a
 *    redelivery is a 200 no-op. This matters most for
 *    `BILLING.SUBSCRIPTION.ACTIVATED`, which races the customer's return from
 *    PayPal's approval page.
 * 3. A SUCCESSFUL HANDLER RETURNS 200, A BROKEN ONE RETURNS 500. Answering
 *    200 unconditionally would mean an outage mid-handler drops a renewal
 *    forever, since PayPal only retries what it did not get a 2xx for.
 *    Customer-caused outcomes — an approval abandoned, a card declined — are
 *    not failures and do answer 200.
 *
 * One rule is new, and it is PayPal's doing. Verification is a NETWORK CALL to
 * PayPal rather than a local HMAC, so it has a third outcome: "I could not
 * find out". That case must answer 500 and not 401. Treating it as a bad
 * signature would mean a PayPal wobble during verification permanently
 * discards a genuine event, because a 401 tells PayPal to stop trying.
 */

/** The events that change something here. Anything else is acknowledged and dropped. */
const HANDLED = [
  "BILLING.SUBSCRIPTION.ACTIVATED",
  "BILLING.SUBSCRIPTION.UPDATED",
  "BILLING.SUBSCRIPTION.CANCELLED",
  "BILLING.SUBSCRIPTION.SUSPENDED",
  "BILLING.SUBSCRIPTION.EXPIRED",
  "BILLING.SUBSCRIPTION.PAYMENT.FAILED",
  "PAYMENT.SALE.COMPLETED",
  "PAYMENT.SALE.REFUNDED",
  "PAYMENT.SALE.REVERSED",
] as const;

interface WebhookBody {
  id?: string;
  event_type?: string;
  resource_type?: string;
  resource?: {
    /** A subscription id on BILLING.*, a sale id on PAYMENT.SALE.*. */
    id?: string;
    status?: string;
    plan_id?: string;
    custom_id?: string;
    /** PAYMENT.SALE.* carries the subscription here, under its old name. */
    billing_agreement_id?: string;
    /** PAYMENT.SALE.* round-trips `custom_id` under this name. */
    custom?: string;
    state?: string;
    amount?: { total?: string; currency?: string } | null;
    create_time?: string;
    /** Refunds point back at the sale they reverse. */
    sale_id?: string;
  } | null;
}

/** Minimal shape of what a Hono handler is handed, so this file imports no framework. */
interface WebhookRequest {
  req: {
    text(): Promise<string>;
    header(name: string): string | undefined;
  };
  json(body: unknown, status?: 200 | 400 | 401 | 500): Response;
}

export async function paypalWebhook(c: WebhookRequest): Promise<Response> {
  const raw = await c.req.text();

  /**
   * Parsed before verification, which is the opposite of the Paystack handler
   * and is forced by PayPal's design: their verify endpoint takes the event as
   * a JSON object, not as bytes. The signature covers the transmission
   * headers plus the body, so re-serialising is harmless here — whereas doing
   * it on the Paystack side would break the HMAC.
   *
   * Nothing is trusted from this parse until verification says so. It is used
   * for one thing first: getting the object to PayPal to be checked.
   */
  let body: WebhookBody;
  try {
    body = JSON.parse(raw) as WebhookBody;
  } catch {
    // A genuine PayPal delivery is always JSON. Unparseable means either not
    // PayPal or hopelessly mangled, and a retry cannot fix either.
    console.error("[paypal] webhook body was not JSON; rejected.");
    return c.json({ error: "unparseable" }, 400);
  }

  const verification = await verifyWebhook({
    headers: webhookHeaders((name) => c.req.header(name)),
    event: body,
  });

  if (verification === "invalid") {
    return c.json({ error: "bad_signature" }, 401);
  }
  if (verification === "unverifiable") {
    /**
     * We are the broken one, so PayPal must be told to come back. 500 keeps
     * the event in their retry queue for up to three days, which is far
     * longer than any credential refresh or outage on our side.
     */
    return c.json({ error: "verification_unavailable" }, 500);
  }

  const event = body.event_type ?? "";
  const resource = body.resource ?? {};

  if (!HANDLED.includes(event as (typeof HANDLED)[number])) {
    // `BILLING.SUBSCRIPTION.RE-ACTIVATED`, `CATALOG.PRODUCT.*`,
    // `BILLING.PLAN.*`, disputes, and whatever PayPal adds next.
    return c.json({ ok: true, ignored: event || "no_event" }, 200);
  }

  /**
   * PayPal's own event id is the idempotency key — a real per-delivery
   * identifier, so unlike the Paystack handler there is no body to hash. An
   * event without one is not a delivery this app can de-duplicate, and
   * processing it could double-apply; rejecting is safer than guessing.
   */
  const id = body.id;
  if (!id) {
    console.error(`[paypal] verified webhook ${event} carried no event id; rejected.`);
    return c.json({ error: "no_event_id" }, 400);
  }

  if (!(await claimPaypalEvent(id, event, subscriptionIdOf(resource)))) {
    return c.json({ ok: true, duplicate: true }, 200);
  }

  try {
    const outcome = await dispatch(event, resource);
    return c.json({ ok: true, event, outcome }, 200);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Recorded against the claim, which also releases it for PayPal's retry.
    await markPaypalEventFailed(id, message).catch(() => undefined);
    console.error(`[paypal] webhook ${event} failed:`, error);
    return c.json({ error: "handler_failed" }, 500);
  }
}

type Resource = NonNullable<WebhookBody["resource"]>;

/**
 * The subscription an event is about.
 *
 * Two different field names for one thing, because PayPal's subscription
 * events and its payment events come from different generations of their API:
 * `BILLING.SUBSCRIPTION.*` puts the subscription in `resource.id`, while
 * `PAYMENT.SALE.*` puts it in `resource.billing_agreement_id` — a name left
 * over from Billing Agreements, which Subscriptions replaced.
 */
function subscriptionIdOf(resource: Resource): string | null {
  if (resource.billing_agreement_id) return resource.billing_agreement_id;
  // Only BILLING.* events have a subscription in `id`; a sale id starts with
  // nothing recognisable, so this is guarded by the caller's event type.
  return resource.id ?? null;
}

async function dispatch(event: string, resource: Resource): Promise<string> {
  switch (event) {
    /**
     * Every subscription lifecycle event is handled identically: re-read the
     * subscription from PayPal and store what it says.
     *
     * That is not laziness, it is the point. The difference between these
     * events is only WHY the status changed, and the status itself is the only
     * thing this app acts on — so one path that always ends at PayPal's
     * current answer is immune to the ordering PayPal does not promise.
     *
     *   ACTIVATED       first charge succeeded; the grant starts here
     *   UPDATED         plan or quantity changed on PayPal's side
     *   CANCELLED       cancelled — immediately, but paid through to `until`
     *   SUSPENDED       renewal charge failed; PayPal is retrying
     *   EXPIRED         ran its course; grants nothing
     *   PAYMENT.FAILED  a specific charge was declined
     */
    case "BILLING.SUBSCRIPTION.ACTIVATED":
    case "BILLING.SUBSCRIPTION.UPDATED":
    case "BILLING.SUBSCRIPTION.CANCELLED":
    case "BILLING.SUBSCRIPTION.SUSPENDED":
    case "BILLING.SUBSCRIPTION.EXPIRED":
    case "BILLING.SUBSCRIPTION.PAYMENT.FAILED":
      return syncSubscription(resource.id ?? null);

    /**
     * A charge settled. Both the first one and every renewal years later
     * arrive as this.
     *
     * The subscription is synced FIRST and the receipt written second, and the
     * order is deliberate: the receipt needs to know which app user and which
     * option the money was for, and the grant row is where that lives. On a
     * renewal the grant already exists and the sync just moves `until`
     * forward; on a first charge racing the `ACTIVATED` event, the sync is
     * what creates the row this receipt then attaches to.
     */
    case "PAYMENT.SALE.COMPLETED":
      return saleCompleted(resource);

    /**
     * Money given back. The receipt's status is corrected so the customer's
     * billing history does not keep showing a payment that was returned.
     *
     * Entitlement is deliberately NOT revoked here. A refund does not
     * necessarily end a subscription — a goodwill refund of one month on a
     * continuing annual plan is the common case — and PayPal sends a
     * `CANCELLED` event when the subscription itself is actually stopped. That
     * event is what ends access, and it has its own handler above.
     */
    case "PAYMENT.SALE.REFUNDED":
    case "PAYMENT.SALE.REVERSED":
      return saleReversed(event, resource);

    default:
      return "ignored";
  }
}

/**
 * Writes a subscription's current state, as PayPal reports it.
 *
 * Runs the same fulfilment path as the customer's return from approval, which
 * is what keeps a first charge correct whichever of the two arrives first, and
 * what makes a renewal's new billing date land without any separate renewal
 * code.
 */
async function syncSubscription(subscriptionId: string | null): Promise<string> {
  if (!subscriptionId) return "no_subscription_id";

  const result = await fulfilPaypalSubscription(subscriptionId);

  switch (result.kind) {
    case "granted":
      return `granted:${result.optionId}:${result.status}`;
    case "pending":
      // Still `APPROVAL_PENDING`/`APPROVED` — the customer has not finished on
      // PayPal's page. Not a failure; a retry would say the same.
      return "pending_approval";
    case "not_paid":
      return `not_paid:${result.status}`;
    case "unknown_subscription":
      /**
       * Almost always a subscription created directly in the PayPal dashboard,
       * or one from a different environment pointed at this endpoint — a
       * sandbox and a live webhook can easily share a tunnel URL during
       * testing. `fulfilPaypalSubscription` has already logged the loud
       * version if money was involved, and 200 is right either way: a retry
       * would reach the same conclusion.
       */
      return "unattributed";
  }
}

async function saleCompleted(resource: Resource): Promise<string> {
  const subscriptionId = resource.billing_agreement_id ?? null;
  const saleId = resource.id;

  if (!subscriptionId) {
    /**
     * A sale with no subscription behind it. Nothing in this app sells that
     * way today — one-off PayPal purchases would need the Orders API, which is
     * not built — so this is either a dashboard-raised payment or another
     * integration's traffic.
     */
    return "no_subscription";
  }

  const synced = await syncSubscription(subscriptionId);

  if (!saleId) return `${synced}:no_sale_id`;

  /**
   * The receipt is attached to whatever the grant now says. If the
   * subscription could not be attributed there is no user to file it under,
   * and a receipt with a guessed owner is worse than none — it would show up
   * in somebody else's billing history.
   */
  const grant = await paypalSubscriptionById(subscriptionId);
  if (!grant) return `${synced}:receipt_skipped`;

  await recordPaypalPayment({
    id: saleId,
    userId: grant.userId,
    optionId: grant.optionId,
    subscriptionId,
    amountUsd: resource.amount?.total ?? grant.amountUsd,
    currency: resource.amount?.currency ?? "USD",
    status: resource.state ?? "completed",
    paidAt: resource.create_time ? new Date(resource.create_time) : new Date(),
  });

  return `${synced}:receipted`;
}

async function saleReversed(event: string, resource: Resource): Promise<string> {
  /**
   * A refund is its own object, and `resource.id` is the REFUND's id — the
   * payment being corrected is in `sale_id`. Writing against `resource.id`
   * here would insert a second, phantom receipt instead of correcting the
   * original.
   */
  const saleId = resource.sale_id ?? null;
  if (!saleId) return "no_sale_id";

  const subscriptionId = resource.billing_agreement_id ?? null;
  const grant = subscriptionId ? await paypalSubscriptionById(subscriptionId) : null;
  if (!grant) {
    console.warn(
      `[paypal] ${event} for sale ${saleId} could not be matched to a grant; ` +
        `the receipt has been left as it was.`,
    );
    return "unattributed";
  }

  const status = event === "PAYMENT.SALE.REFUNDED" ? "refunded" : "reversed";

  /**
   * An upsert on the sale id, so this corrects the existing receipt rather
   * than adding one. The amount is the original sale's, not the refund's: a
   * partial refund must not rewrite history to say the customer was only ever
   * charged the refunded part.
   */
  await recordPaypalPayment({
    id: saleId,
    userId: grant.userId,
    optionId: grant.optionId,
    subscriptionId,
    amountUsd: grant.amountUsd,
    currency: "USD",
    status,
    paidAt: null,
  });

  console.warn(
    `[paypal] sale ${saleId} on subscription ${subscriptionId} was ${status}. ` +
      `Access is unchanged and ends at ${grant.until?.toISOString() ?? "its stored date"} ` +
      `unless PayPal also cancels the subscription.`,
  );

  return status;
}

/** Exported for the webhook status procedure and tests. */
export const PAYPAL_HANDLED_EVENTS: readonly string[] = HANDLED;
