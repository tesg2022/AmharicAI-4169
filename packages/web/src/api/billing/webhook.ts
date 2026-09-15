import { fulfilReference } from "./fulfil";
import {
  fetchSubscription,
  verifySignature,
  type PaystackSubscriptionStatus,
} from "./paystack";
import {
  claimEvent,
  markEventFailed,
  pendingCheckoutForSubscription,
  setSubscriptionStatus,
  subscriptionByCode,
} from "./store";
import type { PaystackStatus } from "../database/schema";

/**
 * Paystack's webhook endpoint.
 *
 * Registered as a plain Hono route rather than an oRPC procedure, because the
 * signature is an HMAC over the RAW request bytes: anything that parses the
 * body first — and oRPC parses the body first — destroys the thing being
 * verified. Same reason the Better Auth handler and the audio route sit
 * alongside the router instead of inside it.
 *
 * Three rules hold everywhere below.
 *
 * 1. A SIGNATURE PROVES AUTHORSHIP, NOT TRUTH. Every handler re-reads the
 *    object it was told about from Paystack's API (`verifyTransaction`,
 *    `fetchSubscription`) and writes from that answer. The body is used for
 *    one thing only: which object to go and ask about. A replayed event, or a
 *    body edited by someone who somehow holds the key, therefore cannot
 *    invent a status, a date or a payment.
 * 2. PROCESSING IS IDEMPOTENT. The body hash is claimed before any work, and
 *    a second delivery of the same bytes is a 200 no-op. This matters most for
 *    `charge.success`, which arrives here and on the customer's redirect
 *    within the same second.
 * 3. A SUCCESSFUL HANDLER RETURNS 200, A BROKEN ONE RETURNS 500. Answering
 *    200 unconditionally — a common webhook shortcut — means a Paystack
 *    outage mid-handler silently drops a renewal forever, because Paystack
 *    only retries deliveries it did not get a 200 for. Customer-caused
 *    outcomes (an abandoned checkout, a declined card) are not failures and
 *    do answer 200; only our own inability to process is a 500.
 */

/** The events that change something here. Anything else is acknowledged and dropped. */
const HANDLED = [
  "charge.success",
  "subscription.create",
  "subscription.not_renew",
  "subscription.disable",
  "invoice.create",
  "invoice.update",
  "invoice.payment_failed",
] as const;

interface WebhookBody {
  event?: string;
  data?: {
    reference?: string;
    status?: string;
    subscription_code?: string;
    email_token?: string;
    plan?: { plan_code?: string } | string | null;
    customer?: { customer_code?: string; email?: string } | null;
    /** invoice.* events nest both. */
    subscription?: { subscription_code?: string; status?: string } | null;
    transaction?: { reference?: string; status?: string } | null;
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

export async function paystackWebhook(c: WebhookRequest): Promise<Response> {
  // Raw bytes, before anything touches them. `c.req.text()` is the only read
  // of the body in this whole path.
  const raw = await c.req.text();
  const signature = c.req.header("x-paystack-signature");

  if (!(await verifySignature(raw, signature))) {
    /**
     * Also the answer when no secret key is configured, deliberately. An
     * unconfigured server that accepted unsigned webhooks would be a way to
     * grant plans for free.
     */
    return c.json({ error: "bad_signature" }, 401);
  }

  let body: WebhookBody;
  try {
    body = JSON.parse(raw) as WebhookBody;
  } catch {
    // Signed but unparseable. Retrying cannot help, so acknowledge it.
    console.error("[paystack] webhook body was signed but not JSON");
    return c.json({ ok: true, ignored: "unparseable" }, 200);
  }

  const event = body.event ?? "";
  const data = body.data ?? {};

  if (!HANDLED.includes(event as (typeof HANDLED)[number])) {
    // `subscription.expiring_cards`, `transfer.*`, `customeridentification.*`
    // and everything else Paystack may add. Acknowledged so it is not retried.
    return c.json({ ok: true, ignored: event || "no_event" }, 200);
  }

  const id = await bodyHash(raw);
  const reference = referenceOf(data);

  if (!(await claimEvent(id, event, reference))) {
    return c.json({ ok: true, duplicate: true }, 200);
  }

  try {
    const outcome = await dispatch(event, data);
    return c.json({ ok: true, event, outcome }, 200);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Recorded against the claim, which also releases it for Paystack's retry.
    await markEventFailed(id, message).catch(() => undefined);
    console.error(`[paystack] webhook ${event} failed:`, error);
    return c.json({ error: "handler_failed" }, 500);
  }
}

/** SHA-256 of the raw body, hex — the idempotency key the events table expects. */
async function bodyHash(raw: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function subscriptionCodeOf(data: NonNullable<WebhookBody["data"]>): string | null {
  return data.subscription_code ?? data.subscription?.subscription_code ?? null;
}

function referenceOf(data: NonNullable<WebhookBody["data"]>): string | null {
  return data.reference ?? data.transaction?.reference ?? subscriptionCodeOf(data);
}

function planCodeOf(data: NonNullable<WebhookBody["data"]>): string | null {
  if (typeof data.plan === "string") return data.plan || null;
  return data.plan?.plan_code ?? null;
}

async function dispatch(
  event: string,
  data: NonNullable<WebhookBody["data"]>,
): Promise<string> {
  switch (event) {
    case "charge.success":
      return chargeSucceeded(data);

    case "subscription.create":
      return subscriptionCreated(data);

    /**
     * Renewal events. All three are handled the same way — re-read the
     * subscription from Paystack and store what it says — because the
     * difference between them is only *why* the status changed, and the
     * status itself is the thing this app acts on.
     *
     *   invoice.create         a renewal charge has been attempted
     *   invoice.update         its final outcome is known
     *   invoice.payment_failed the card was declined (status becomes
     *                          `attention`, access continues to `until`)
     */
    case "invoice.create":
    case "invoice.update":
    case "invoice.payment_failed":
    /**
     * Cancellation, in its two halves. Paystack sends `not_renew` the moment
     * a subscription is cancelled (status → `non-renewing`, access continues)
     * and `disable` on what would have been the next payment date (status →
     * `cancelled`/`completed`, access ends). Both are a status sync.
     */
    case "subscription.not_renew":
    case "subscription.disable":
      return syncSubscription(subscriptionCodeOf(data));

    default:
      return "ignored";
  }
}

/**
 * A charge went through.
 *
 * Two very different things arrive under this one event name, and treating
 * them alike is how a renewal ends up unattributed:
 *
 *   - a checkout this app started, whose reference is in `paystack_checkouts`.
 *     Fulfilment owns it, exactly as it does on the redirect return, and the
 *     two racing each other is fine because fulfilment upserts.
 *   - a renewal Paystack raised by itself years later. It has no checkout row
 *     and no metadata, so fulfilment could not attribute it — and does not
 *     have to: the matching `invoice.*` event carries the subscription code,
 *     and that is where a renewal is applied.
 */
async function chargeSucceeded(data: NonNullable<WebhookBody["data"]>): Promise<string> {
  const reference = data.reference;
  if (!reference) return "no_reference";

  const result = await fulfilReference(reference);

  switch (result.kind) {
    case "granted":
      return `granted:${result.optionId}`;
    case "pending":
      // The subscription is not readable yet; `subscription.create` will
      // finish it. Not a failure, so this must not 500 into a retry loop.
      return "pending_subscription";
    case "not_paid":
      return `not_paid:${result.status}`;
    case "unknown_reference":
      /**
       * Either a renewal (handled by `invoice.*`, so this is expected and
       * harmless) or a genuinely orphaned payment. `fulfilReference` has
       * already logged the loud version for the second case, and answering
       * 200 is right for both: a retry would reach the same conclusion.
       */
      return "unattributed";
  }
}

/**
 * Paystack created the subscription behind a plan checkout.
 *
 * The event carries no transaction reference, and nothing is granted here
 * without verifying one — so the checkout that started it is found first and
 * fulfilment re-runs against that reference. The second run is the one that
 * succeeds: by now the subscription is readable, which is exactly what the
 * first run (from the redirect or from `charge.success`) was missing.
 *
 * When there is no pending checkout the grant already exists, and this is a
 * redelivery or an out-of-order event — so it degrades to a status sync
 * rather than doing nothing.
 */
async function subscriptionCreated(
  data: NonNullable<WebhookBody["data"]>,
): Promise<string> {
  const code = subscriptionCodeOf(data);
  const customerCode = data.customer?.customer_code ?? null;

  if (customerCode) {
    const reference = await pendingCheckoutForSubscription({
      customerCode,
      planCode: planCodeOf(data),
    });
    if (reference) {
      const result = await fulfilReference(reference);
      if (result.kind === "granted") return `granted:${result.optionId}`;
      return `fulfil:${result.kind}`;
    }
  }

  return syncSubscription(code);
}

/**
 * Writes a subscription's current state, as Paystack reports it.
 *
 * The webhook's own `status` field is ignored on purpose. Events can arrive
 * out of order — `invoice.create` for the next cycle after a `not_renew`, a
 * redelivery from an hour ago — and applying a stale body would resurrect a
 * cancelled subscription. One extra API call buys ordering independence.
 */
async function syncSubscription(code: string | null): Promise<string> {
  if (!code) return "no_subscription_code";

  const local = await subscriptionByCode(code);
  if (!local) {
    /**
     * A subscription that never produced a grant here. Almost always a
     * subscription created directly in the Paystack dashboard, or one
     * belonging to a different environment pointed at the same endpoint.
     * Nothing to update, and inventing a grant for it would mean granting a
     * plan to a user we cannot identify.
     */
    console.warn(`[paystack] webhook for unknown subscription ${code}; ignored.`);
    return "unknown_subscription";
  }

  const live = await fetchSubscription(code);
  const status = live.status as PaystackStatus;
  const until = live.next_payment_date ? new Date(live.next_payment_date) : null;

  /**
   * `until` is only written when Paystack gives a date, and never cleared.
   *
   * A disabled subscription comes back with `next_payment_date: null`, and
   * null in that column means "never expires" — it is how lifetime access is
   * stored. Writing it here would hand a cancelled subscriber permanent
   * access, so the paid-period end they already have is left standing and
   * the status alone ends the entitlement.
   */
  await setSubscriptionStatus(code, status, until ?? undefined);

  if (status === "attention") {
    console.warn(
      `[paystack] subscription ${code} is in "attention": the last renewal ` +
        `charge failed. Access continues until ${local.until?.toISOString() ?? "?"}.`,
    );
  }

  return `status:${status}`;
}

/** Exported for the webhook status procedure and tests. */
export const HANDLED_EVENTS: readonly string[] = HANDLED;
export type { PaystackSubscriptionStatus };
