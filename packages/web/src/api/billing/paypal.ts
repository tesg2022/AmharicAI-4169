/**
 * The PayPal HTTP client. Nothing else in the codebase talks to PayPal.
 *
 * Hand-rolled for the same reason `paystack.ts` is: the parts of PayPal this
 * app needs are a dozen REST calls, and `@paypal/paypal-server-sdk` would pull
 * a large dependency into the path that handles the client secret in order to
 * wrap them. The API is documented and stable; this file is that subset,
 * typed, with the things that actually bite documented where they bite.
 *
 * What bites on PayPal, all of it different from what bites on Paystack:
 *
 *   1. AMOUNTS ARE DECIMAL STRINGS IN MAJOR UNITS. "11.99", not 1199 and not
 *      11.99. The exact inverse of Paystack's subunit integers, which is why
 *      no number is ever passed straight through: `money()` formats, and
 *      nothing in this file accepts a bare amount.
 *   2. AUTH IS A BEARER TOKEN YOU HAVE TO GO AND GET. Client id and secret
 *      are exchanged for an access token that expires (typically ~9 hours),
 *      so the token is cached in-process with an early expiry margin. A call
 *      that sends the client secret directly as a bearer token fails with a
 *      401 that reads exactly like bad credentials.
 *   3. WEBHOOK VERIFICATION IS AN OUTBOUND API CALL. There is no local HMAC:
 *      PayPal signs with a certificate chain and publishes a
 *      `verify-webhook-signature` endpoint that returns SUCCESS or FAILURE.
 *      So verifying a webhook costs a round trip, needs the webhook id from
 *      the environment, and — unlike Paystack — can fail because PayPal is
 *      down rather than because the payload was forged. The handler has to
 *      tell those two apart.
 *   4. SANDBOX AND LIVE ARE DIFFERENT HOSTS AND DIFFERENT CREDENTIAL SETS.
 *      Plans created in sandbox do not exist in live. `PAYPAL_ENV` picks the
 *      host, and it defaults to sandbox so an unconfigured deployment cannot
 *      accidentally take real money.
 *   5. CREATE CALLS ARE NOT IDEMPOTENT BY DEFAULT. A retried "create plan"
 *      makes a second plan. `PayPal-Request-Id` is how that is avoided, and
 *      every create in this file takes one.
 */

const SANDBOX_API = "https://api-m.sandbox.paypal.com";
const LIVE_API = "https://api-m.paypal.com";

export class PaypalError extends Error {
  constructor(
    message: string,
    readonly httpStatus: number,
    readonly endpoint: string,
    /** PayPal's own `name` field, e.g. "RESOURCE_NOT_FOUND", when it sent one. */
    readonly code: string | null = null,
    /** PayPal's `debug_id`. The only thing their support will act on. */
    readonly debugId: string | null = null,
  ) {
    super(message);
    this.name = "PaypalError";
  }

  /** True when the client id/secret pair is wrong, missing, or for the other env. */
  get isAuthFailure(): boolean {
    return this.httpStatus === 401 || this.code === "invalid_client";
  }

  /**
   * True when PayPal could not be reached or answered a 5xx.
   *
   * Worth its own predicate because the webhook path must treat "PayPal is
   * down" differently from "this signature is invalid" — one is a 500 and a
   * retry, the other is a 401 and a permanent rejection.
   */
  get isTransport(): boolean {
    return this.httpStatus === 0 || this.httpStatus >= 500;
  }

  /** True when the plan or subscription named does not exist on this account. */
  get isNotFound(): boolean {
    return this.httpStatus === 404 || this.code === "RESOURCE_NOT_FOUND";
  }
}

/* --------------------------------------------------------------- environment */

export type PaypalEnv = "sandbox" | "live";

/**
 * Which PayPal environment this deployment talks to.
 *
 * Defaults to sandbox, deliberately and permanently. The failure mode of
 * defaulting to live — a misconfigured deployment charging real cards — is not
 * recoverable by an operator noticing quickly, whereas the failure mode of
 * defaulting to sandbox is a support ticket saying payments do not work.
 */
export function paypalEnv(): PaypalEnv {
  return process.env["PAYPAL_ENV"]?.trim().toLowerCase() === "live" ? "live" : "sandbox";
}

/** True when running against sandbox credentials: no real money moves. */
export function isSandbox(): boolean {
  return paypalEnv() === "sandbox";
}

function apiBase(): string {
  return isSandbox() ? SANDBOX_API : LIVE_API;
}

export function paypalClientId(): string | null {
  const id = process.env["PAYPAL_CLIENT_ID"]?.trim();
  return id ? id : null;
}

function paypalClientSecret(): string | null {
  const secret = process.env["PAYPAL_CLIENT_SECRET"]?.trim();
  return secret ? secret : null;
}

/** True when both halves of the credential pair are present. */
export function paypalCredentialsPresent(): boolean {
  return Boolean(paypalClientId() && paypalClientSecret());
}

/** The webhook id PayPal issued for this deployment's endpoint. */
export function paypalWebhookId(): string | null {
  const id = process.env["PAYPAL_WEBHOOK_ID"]?.trim();
  return id ? id : null;
}

/** The catalog product every billing plan hangs off. */
export function paypalProductId(): string | null {
  const id = process.env["PAYPAL_PRODUCT_ID"]?.trim();
  return id ? id : null;
}

/** The currency PayPal charges in. USD, and not configurable by accident. */
export const PAYPAL_CURRENCY = "USD";

/**
 * A money amount in the shape PayPal's API wants: a decimal string.
 *
 * Two decimals always. PayPal rejects "12" for USD with
 * `DECIMAL_PRECISION` — the currency has hundredths, so the field must show
 * them — and it rejects "11.990" for the same reason in the other direction.
 */
export function money(major: number): string {
  if (!Number.isFinite(major) || major < 0) {
    throw new Error(`Refusing to format a non-finite or negative amount: ${major}`);
  }
  return major.toFixed(2);
}

/* ---------------------------------------------------------------- auth token */

interface CachedToken {
  token: string;
  /** ms since epoch. Already includes the safety margin. */
  expiresAt: number;
  /** Which credentials it was minted for, so a config change invalidates it. */
  fingerprint: string;
}

let cached: CachedToken | null = null;

/**
 * An OAuth2 access token, cached until shortly before it expires.
 *
 * Cached in module scope rather than fetched per call, because every PayPal
 * request needs one and minting a token per request would double the latency
 * of a checkout and burn through PayPal's rate limit on the token endpoint
 * during any traffic spike.
 *
 * The 60-second margin is the point of the cache being interesting: a token
 * that expires between being read here and arriving at PayPal produces a 401
 * on a call that was correct, which in the checkout path is a customer seeing
 * a failure for no reason. The margin makes that window impossible rather
 * than unlikely.
 *
 * The fingerprint covers the case that bit during setup: switching
 * `PAYPAL_ENV` from sandbox to live without restarting would otherwise keep
 * using the sandbox token against the live host, which fails as an auth error
 * and looks like bad live credentials.
 */
async function accessToken(): Promise<string> {
  const id = paypalClientId();
  const secret = paypalClientSecret();

  if (!id || !secret) {
    throw new PaypalError(
      "No PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET is set in this deployment, so no " +
        "PayPal payment can be taken.",
      0,
      "/v1/oauth2/token",
      "no_credentials",
    );
  }

  const fingerprint = `${paypalEnv()}:${id}`;
  if (cached && cached.fingerprint === fingerprint && cached.expiresAt > Date.now()) {
    return cached.token;
  }

  const basic = Buffer.from(`${id}:${secret}`).toString("base64");

  let response: Response;
  try {
    response = await fetch(`${apiBase()}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    throw new PaypalError(
      `Could not reach PayPal to authenticate (${(error as Error).message}).`,
      0,
      "/v1/oauth2/token",
      "unreachable",
    );
  }

  const text = await response.text();
  if (!response.ok) {
    let name: string | null = null;
    try {
      // The token endpoint answers in OAuth2's shape (`error`), unlike the rest
      // of the REST API, which answers in PayPal's own (`name`). Read either:
      // the cost is one `??` and it survives PayPal normalising the two.
      const body = JSON.parse(text) as { error?: string; name?: string };
      name = body.error ?? body.name ?? null;
    } catch {
      /* non-JSON error body; the status is the information */
    }
    throw new PaypalError(
      // 401 on this endpoint only ever means the credential pair was refused,
      // whatever it is called, and the pair being for the other environment is
      // the overwhelmingly likely cause.
      name === "invalid_client" || response.status === 401
        ? `PayPal rejected the client id and secret for the ${paypalEnv()} ` +
          `environment. Sandbox and live credentials are not interchangeable — ` +
          `check PAYPAL_ENV matches the credential pair.`
        : `PayPal refused the token request (HTTP ${response.status}).`,
      response.status,
      "/v1/oauth2/token",
      name,
    );
  }

  const body = JSON.parse(text) as { access_token: string; expires_in: number };
  cached = {
    token: body.access_token,
    expiresAt: Date.now() + Math.max(body.expires_in - 60, 30) * 1000,
    fingerprint,
  };
  return cached.token;
}

/** Drops the cached token. For tests and for the setup script's env switching. */
export function resetTokenCache(): void {
  cached = null;
}

/* ------------------------------------------------------------------ requests */

interface PaypalErrorBody {
  name?: string;
  message?: string;
  debug_id?: string;
  details?: { issue?: string; description?: string }[];
}

async function request<T>(
  method: "GET" | "POST" | "PATCH",
  path: string,
  options: { body?: unknown; requestId?: string } = {},
): Promise<T> {
  const token = await accessToken();

  let response: Response;
  try {
    response = await fetch(`${apiBase()}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        // Turns a retried create into a no-op that returns the first result,
        // instead of a second plan or a second subscription.
        ...(options.requestId ? { "PayPal-Request-Id": options.requestId } : {}),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    throw new PaypalError(
      `Could not reach PayPal (${(error as Error).message}).`,
      0,
      path,
      "unreachable",
    );
  }

  const text = await response.text();

  if (!response.ok) {
    let parsed: PaypalErrorBody = {};
    try {
      parsed = JSON.parse(text) as PaypalErrorBody;
    } catch {
      /* PayPal occasionally answers HTML from its edge on a 5xx */
    }
    // The `details[].issue` strings are the actionable part — "PLAN_ID
    // INVALID", "DECIMAL_PRECISION" — and PayPal's top-level message is
    // usually just "The requested action could not be performed".
    const issues = (parsed.details ?? [])
      .map((d) => d.issue ?? d.description)
      .filter(Boolean)
      .join("; ");
    throw new PaypalError(
      [parsed.message ?? `PayPal refused ${method} ${path}.`, issues]
        .filter(Boolean)
        .join(" — "),
      response.status,
      path,
      parsed.name ?? null,
      parsed.debug_id ?? null,
    );
  }

  // 204 on cancel/suspend/activate, which have no body.
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

/* ------------------------------------------------------------------ products */

export interface PaypalProduct {
  id: string;
  name: string;
}

/**
 * The catalog product billing plans hang off.
 *
 * PayPal requires one before any plan can exist, and it carries nothing this
 * app varies — one product ("AmharicAI subscription"), three plans against it.
 * Created once by `scripts/paypal-setup.ts` and then referenced by id from the
 * environment.
 */
export async function createProduct(input: {
  name: string;
  description?: string;
  requestId: string;
}): Promise<PaypalProduct> {
  return request<PaypalProduct>("POST", "/v1/catalogs/products", {
    body: {
      name: input.name,
      type: "SERVICE",
      category: "EDUCATIONAL_AND_TEXTBOOKS",
      ...(input.description ? { description: input.description } : {}),
    },
    requestId: input.requestId,
  });
}

export async function listProducts(): Promise<PaypalProduct[]> {
  const body = await request<{ products?: PaypalProduct[] }>(
    "GET",
    "/v1/catalogs/products?page_size=20",
  );
  return body.products ?? [];
}

/* --------------------------------------------------------------------- plans */

export type PaypalInterval = "DAY" | "WEEK" | "MONTH" | "YEAR";

export interface PaypalPlan {
  id: string;
  product_id?: string;
  name: string;
  status: "CREATED" | "INACTIVE" | "ACTIVE";
  billing_cycles?: {
    tenure_type?: string;
    frequency?: { interval_unit?: string; interval_count?: number };
    pricing_scheme?: { fixed_price?: { value?: string; currency_code?: string } };
  }[];
}

/**
 * Creates a billing plan: a price on an interval, against the product.
 *
 * `total_cycles: 0` on the regular cycle is what makes it renew forever. Any
 * other number is a fixed-term subscription that silently stops — which for a
 * monthly plan set to, say, 12 would mean a customer's access ending a year
 * later with no cancellation and no event anybody reads as one.
 *
 * `setup_fee` is omitted rather than set to zero, and `AUTO_BILL_OUTSTANDING`
 * is on so a recovered failed payment is collected with the next cycle instead
 * of being written off.
 */
export async function createPlan(input: {
  productId: string;
  name: string;
  description?: string;
  /** Major units. Pass 11.99, not 1199. */
  amountMajor: number;
  interval: PaypalInterval;
  requestId: string;
}): Promise<PaypalPlan> {
  return request<PaypalPlan>("POST", "/v1/billing/plans", {
    body: {
      product_id: input.productId,
      name: input.name,
      ...(input.description ? { description: input.description } : {}),
      status: "ACTIVE",
      billing_cycles: [
        {
          frequency: { interval_unit: input.interval, interval_count: 1 },
          tenure_type: "REGULAR",
          sequence: 1,
          // Forever. See the note above.
          total_cycles: 0,
          pricing_scheme: {
            fixed_price: {
              value: money(input.amountMajor),
              currency_code: PAYPAL_CURRENCY,
            },
          },
        },
      ],
      payment_preferences: {
        auto_bill_outstanding: true,
        setup_fee_failure_action: "CONTINUE",
        // PayPal suspends the subscription after this many consecutive
        // failures, which is the state the UI reports as "payment failed".
        payment_failure_threshold: 3,
      },
    },
    requestId: input.requestId,
  });
}

export async function listPlans(productId?: string): Promise<PaypalPlan[]> {
  const query = new URLSearchParams({ page_size: "20" });
  if (productId) query.set("product_id", productId);
  const body = await request<{ plans?: PaypalPlan[] }>(
    "GET",
    `/v1/billing/plans?${query.toString()}`,
  );
  return body.plans ?? [];
}

export async function fetchPlan(planId: string): Promise<PaypalPlan> {
  return request<PaypalPlan>("GET", `/v1/billing/plans/${encodeURIComponent(planId)}`);
}

/* -------------------------------------------------------------- subscriptions */

export type PaypalSubscriptionStatus =
  | "APPROVAL_PENDING"
  | "APPROVED"
  | "ACTIVE"
  | "SUSPENDED"
  | "CANCELLED"
  | "EXPIRED";

export interface PaypalSubscription {
  id: string;
  plan_id: string;
  status: PaypalSubscriptionStatus;
  /** Our reference, round-tripped. The link from a subscription to a checkout. */
  custom_id?: string | null;
  start_time?: string | null;
  subscriber?: {
    payer_id?: string;
    email_address?: string;
    name?: { given_name?: string; surname?: string };
  } | null;
  billing_info?: {
    next_billing_time?: string | null;
    last_payment?: {
      amount?: { value?: string; currency_code?: string };
      time?: string;
    } | null;
    /** How many consecutive charges have failed. Non-zero is trouble brewing. */
    failed_payments_count?: number;
    outstanding_balance?: { value?: string; currency_code?: string };
    cycle_executions?: { tenure_type?: string; cycles_completed?: number }[];
  } | null;
  links?: { href: string; rel: string; method?: string }[];
}

/**
 * Creates a subscription and returns it with the approval link to send the
 * customer to.
 *
 * The inverse of Paystack's flow, and the difference drives the whole PayPal
 * return path: PayPal creates the subscription FIRST, in
 * `APPROVAL_PENDING`, and the customer approving it is what activates it.
 * Paystack charges first and creates the subscription afterwards. So here
 * there is always a subscription id to store before the customer leaves — and
 * `APPROVAL_PENDING` must never be treated as paid, because at that point
 * nothing has been.
 *
 * `custom_id` carries our own checkout reference through the round trip, which
 * is what lets a webhook about this subscription be attributed to an app user
 * without trusting anything the browser sends back.
 */
export async function createSubscription(input: {
  planId: string;
  reference: string;
  email?: string | undefined;
  name?: string | undefined;
  returnUrl: string;
  cancelUrl: string;
  brandName?: string | undefined;
  requestId: string;
}): Promise<PaypalSubscription> {
  const [given, ...rest] = (input.name ?? "").trim().split(/\s+/);
  return request<PaypalSubscription>("POST", "/v1/billing/subscriptions", {
    body: {
      plan_id: input.planId,
      custom_id: input.reference,
      ...(input.email
        ? {
            subscriber: {
              email_address: input.email,
              ...(given
                ? { name: { given_name: given, surname: rest.join(" ") || given } }
                : {}),
            },
          }
        : {}),
      application_context: {
        ...(input.brandName ? { brand_name: input.brandName } : {}),
        // PayPal's own page handles the locale; forcing one would override a
        // customer's PayPal account preference for no gain.
        shipping_preference: "NO_SHIPPING",
        // The customer both approves AND authorises billing on PayPal's page,
        // so nothing has to be confirmed again on return. SUBSCRIBE_NOW is
        // what makes the approval final rather than a quote.
        user_action: "SUBSCRIBE_NOW",
        payment_method: {
          payer_selected: "PAYPAL",
          payee_preferred: "IMMEDIATE_PAYMENT_REQUIRED",
        },
        return_url: input.returnUrl,
        cancel_url: input.cancelUrl,
      },
    },
    requestId: input.requestId,
  });
}

/** The approval URL out of a created subscription's links. */
export function approvalUrl(subscription: PaypalSubscription): string | null {
  const link = subscription.links?.find((l) => l.rel === "approve");
  return link?.href ?? null;
}

/**
 * The truth about one subscription, asked of PayPal directly.
 *
 * This is what fulfilment runs on, for both the return path and every webhook.
 * A verified webhook body is still only a claim about a moment in the past;
 * re-reading the subscription costs one call and means a replayed or
 * out-of-order event cannot invent a status or a billing date.
 */
export async function fetchSubscription(
  subscriptionId: string,
): Promise<PaypalSubscription> {
  return request<PaypalSubscription>(
    "GET",
    `/v1/billing/subscriptions/${encodeURIComponent(subscriptionId)}`,
  );
}

/**
 * Cancels a subscription. IMMEDIATE, and there is no alternative.
 *
 * PayPal has no equivalent of Paystack's "disable at period end": the
 * subscription stops now, no further charges are raised, and the status
 * becomes `CANCELLED` straight away — even if the customer has paid through to
 * a date months out.
 *
 * So the app has to preserve the paid period itself. The caller keeps the
 * stored `until` exactly as it was and lets `CANCELLED` remain entitling until
 * that date passes, which is why `PAYPAL_ENTITLING_STATUSES` includes
 * `CANCELLED`. Without that, cancelling an annual subscription in month two
 * would destroy ten paid months.
 */
export async function cancelSubscription(input: {
  subscriptionId: string;
  reason: string;
}): Promise<void> {
  await request<void>(
    "POST",
    `/v1/billing/subscriptions/${encodeURIComponent(input.subscriptionId)}/cancel`,
    { body: { reason: input.reason.slice(0, 127) } },
  );
}

/**
 * Suspends billing without ending the subscription.
 *
 * Kept because it is the reversible half of cancellation and the only thing
 * PayPal offers that resembles a pause. NOT used for customer-facing
 * cancellation: a suspended subscription still belongs to the customer and
 * PayPal may resume it, which is not what somebody who clicked "cancel" asked
 * for.
 */
export async function suspendSubscription(input: {
  subscriptionId: string;
  reason: string;
}): Promise<void> {
  await request<void>(
    "POST",
    `/v1/billing/subscriptions/${encodeURIComponent(input.subscriptionId)}/suspend`,
    { body: { reason: input.reason.slice(0, 127) } },
  );
}

/**
 * Re-activates a SUSPENDED subscription.
 *
 * Only works from `SUSPENDED`. A `CANCELLED` subscription cannot be revived on
 * PayPal at all — which is why "resume" on a cancelled PayPal subscription has
 * to mean "buy a new one", and the UI must not offer it as a resume.
 */
export async function activateSubscription(input: {
  subscriptionId: string;
  reason: string;
}): Promise<void> {
  await request<void>(
    "POST",
    `/v1/billing/subscriptions/${encodeURIComponent(input.subscriptionId)}/activate`,
    { body: { reason: input.reason.slice(0, 127) } },
  );
}

/* ------------------------------------------------------------------ webhooks */

export interface PaypalWebhookHeaders {
  transmissionId: string | null;
  transmissionTime: string | null;
  transmissionSig: string | null;
  certUrl: string | null;
  authAlgo: string | null;
}

export type WebhookVerification = "valid" | "invalid" | "unverifiable";

/**
 * Is this webhook really from PayPal?
 *
 * Verified by asking PayPal, because there is nothing to check locally: the
 * signature is over a certificate chain PayPal hosts, and rolling that
 * verification by hand means fetching and caching their cert, checking its
 * chain to a root, and validating the signature — three places to be subtly
 * wrong in the one function whose job is to be certain.
 *
 * THE THREE-WAY RETURN IS THE POINT. A local HMAC can only say yes or no, but
 * this check is a network call, so "I could not find out" is a real answer and
 * collapsing it into "no" would be a bug with money attached: PayPal having a
 * bad five minutes would look exactly like a forged payload, the handler would
 * answer 401, and PayPal would stop retrying a delivery that was genuine —
 * losing a renewal or a cancellation permanently.
 *
 *   valid        → process it
 *   invalid      → 401, never retry, someone is poking the endpoint
 *   unverifiable → 500, so PayPal retries while we are the broken one
 *
 * `rawBody` must be the exact bytes received, and is passed through as a
 * pre-parsed object below only because PayPal's own endpoint requires the
 * event as JSON — the signature is over the transmission, not over the body
 * alone, so unlike Paystack a re-serialise here is harmless.
 */
export async function verifyWebhook(input: {
  headers: PaypalWebhookHeaders;
  /** The parsed event body, as PayPal sent it. */
  event: unknown;
}): Promise<WebhookVerification> {
  const webhookId = paypalWebhookId();
  const h = input.headers;

  if (!webhookId) {
    // Not "unverifiable": nothing will make this deployment able to verify
    // until an operator sets the id, so retrying is pointless and accepting
    // it would mean an endpoint that grants plans to anyone who can POST.
    console.error(
      "[paypal] no PAYPAL_WEBHOOK_ID is set, so webhooks cannot be verified and are " +
        "being rejected. Create the webhook in the PayPal dashboard and set its id.",
    );
    return "invalid";
  }

  if (
    !h.transmissionId ||
    !h.transmissionTime ||
    !h.transmissionSig ||
    !h.certUrl ||
    !h.authAlgo
  ) {
    // A genuine PayPal delivery always carries all five.
    return "invalid";
  }

  /**
   * The cert URL comes from the request, and is sent back to PayPal to be
   * checked — so it is attacker-controlled input that must not be trusted to
   * point anywhere. PayPal serves its certs from paypal.com only; anything
   * else is a forged transmission trying to get its own certificate
   * validated.
   */
  let certHost: string;
  try {
    certHost = new URL(h.certUrl).hostname;
  } catch {
    return "invalid";
  }
  if (!/(^|\.)paypal\.com$/i.test(certHost)) {
    console.warn(`[paypal] webhook cert url pointed at ${certHost}; rejected.`);
    return "invalid";
  }

  try {
    const body = await request<{ verification_status?: "SUCCESS" | "FAILURE" }>(
      "POST",
      "/v1/notifications/verify-webhook-signature",
      {
        body: {
          webhook_id: webhookId,
          transmission_id: h.transmissionId,
          transmission_time: h.transmissionTime,
          transmission_sig: h.transmissionSig,
          cert_url: h.certUrl,
          auth_algo: h.authAlgo,
          webhook_event: input.event,
        },
      },
    );
    return body.verification_status === "SUCCESS" ? "valid" : "invalid";
  } catch (error) {
    if (error instanceof PaypalError && error.isTransport) {
      console.error("[paypal] could not verify a webhook signature:", error.message);
      return "unverifiable";
    }
    // A 400 from the verify endpoint means the transmission itself was
    // malformed — that is a rejection, not an outage.
    console.warn(
      "[paypal] webhook signature verification refused:",
      error instanceof Error ? error.message : error,
    );
    return "invalid";
  }
}

/** Reads PayPal's five signature headers off a request. */
export function webhookHeaders(
  header: (name: string) => string | undefined,
): PaypalWebhookHeaders {
  return {
    transmissionId: header("paypal-transmission-id") ?? null,
    transmissionTime: header("paypal-transmission-time") ?? null,
    transmissionSig: header("paypal-transmission-sig") ?? null,
    certUrl: header("paypal-cert-url") ?? null,
    authAlgo: header("paypal-auth-algo") ?? null,
  };
}

/** A fresh `PayPal-Request-Id`. Deterministic ones are the caller's job. */
export function requestId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}
