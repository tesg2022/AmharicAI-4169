/**
 * The Paystack HTTP client. Nothing else in the codebase talks to Paystack.
 *
 * Why hand-rolled rather than an SDK: Paystack publishes no official Node
 * SDK, and the community ones wrap seven endpoints we need in a dependency we
 * would have to audit for a secret-key-handling library. The API is a dozen
 * REST calls with a bearer token; this file is that, typed, with the two
 * things that actually bite documented at the point they bite.
 *
 * The two that bite:
 *
 *   1. AMOUNTS ARE IN THE CURRENCY'S SUBUNIT. R89.00 is 8900, not 89. This is
 *      the exact inverse of the convention the old Autumn config used (whole
 *      dollars), and getting it backwards once already created a live product
 *      at 100x its intended price. So no caller anywhere passes a raw number:
 *      everything goes through `toSubunit()`, and every amount read back from
 *      Paystack goes through `fromSubunit()`.
 *
 *   2. WEBHOOK SIGNATURES ARE COMPUTED OVER THE RAW BODY. Parse the JSON
 *      first and re-serialise it and the HMAC will not match, because key
 *      order and whitespace are part of what was signed. `verifySignature()`
 *      therefore takes a string, never an object.
 */

const API = "https://api.paystack.co";

/** Every Paystack response is this envelope. `status` is the success boolean. */
interface PaystackEnvelope<T> {
  status: boolean;
  message: string;
  data?: T;
  meta?: { next?: string | null; total?: number };
}

export class PaystackError extends Error {
  constructor(
    message: string,
    readonly httpStatus: number,
    readonly endpoint: string,
    /** Paystack's own machine-readable code, when it sent one. */
    readonly code: string | null = null,
  ) {
    super(message);
    this.name = "PaystackError";
  }

  /**
   * True when this deployment's egress IP is not on the account's API
   * allowlist. Worth its own predicate because the message reads like an
   * auth failure and sends people to rotate a perfectly good key: the fix is
   * in Dashboard → Settings → API Keys & Webhooks, not in the environment.
   */
  get isIpBlocked(): boolean {
    return /ip address is not allowed/i.test(this.message);
  }

  /** True when the key itself is wrong or missing, as opposed to IP-blocked. */
  get isAuthFailure(): boolean {
    return this.httpStatus === 401 && !this.isIpBlocked;
  }
}

export function paystackSecretKey(): string | null {
  const key = process.env["PAYSTACK_SECRET_KEY"]?.trim();
  return key ? key : null;
}

/**
 * True when the configured key is a test-mode key.
 *
 * Used to put an unmissable banner on the billing screen: a deployment
 * running a `sk_test_` key takes no real money, and a "payment succeeded" on
 * a test key must never be mistaken for revenue.
 */
export function isTestMode(): boolean {
  return paystackSecretKey()?.startsWith("sk_test_") ?? true;
}

/**
 * Currencies whose subunit is 1/100 of the major unit.
 *
 * ZAR is the only one this deployment can use — a South African Paystack
 * account is settled in ZAR and cannot be given a USD price list, confirmed
 * against Paystack's own currency support matrix. The map exists anyway
 * because the zero-decimal case is real elsewhere (Paystack's own docs note
 * amounts are "in the subunit of the supported currency", and not every
 * supported currency has hundredths), and a future Kenyan or Nigerian entity
 * must not inherit a hardcoded multiplication.
 */
const SUBUNIT_FACTOR: Record<string, number> = {
  ZAR: 100,
  NGN: 100,
  GHS: 100,
  KES: 100,
  USD: 100,
  XOF: 1,
};

export type Currency = keyof typeof SUBUNIT_FACTOR;

/** The currency this deployment charges in. ZAR for the South African entity. */
export const CURRENCY: Currency = (process.env["PAYSTACK_CURRENCY"]?.trim() ||
  "ZAR") as Currency;

function factor(currency: string): number {
  const f = SUBUNIT_FACTOR[currency.toUpperCase()];
  if (!f) {
    throw new Error(
      `No subunit factor known for currency "${currency}". Add it to SUBUNIT_FACTOR ` +
        `in paystack.ts rather than guessing — passing a major-unit amount to ` +
        `Paystack undercharges by 100x and passing a subunit amount overcharges by 100x.`,
    );
  }
  return f;
}

/**
 * Major unit → subunit, for sending to Paystack. 89 ZAR → 8900.
 *
 * Rounded, not truncated: 8.995 * 100 in float is 899.4999999999999, and
 * `Math.trunc` would silently charge a cent less on prices that end in half a
 * cent. Fractional subunits do not exist, so the rounding is not a loss.
 */
export function toSubunit(major: number, currency: string = CURRENCY): number {
  if (!Number.isFinite(major) || major < 0) {
    throw new Error(`Refusing to convert a non-finite or negative amount: ${major}`);
  }
  return Math.round(major * factor(currency));
}

/** Subunit → major unit, for reading Paystack back. 8900 → 89. */
export function fromSubunit(subunit: number, currency: string = CURRENCY): number {
  return subunit / factor(currency);
}

/** "R89.00", "R1 399.00" — what the customer is actually charged. */
export function formatMajor(major: number, currency: string = CURRENCY): string {
  return new Intl.NumberFormat("en-ZA", {
    style: "currency",
    currency,
    minimumFractionDigits: Number.isInteger(major) ? 0 : 2,
  }).format(major);
}

async function request<T>(
  method: "GET" | "POST" | "PUT",
  path: string,
  body?: unknown,
): Promise<T> {
  const key = paystackSecretKey();
  if (!key) {
    throw new PaystackError(
      "No PAYSTACK_SECRET_KEY is set in this deployment, so no payment can be taken.",
      0,
      path,
      "no_key",
    );
  }

  let response: Response;
  try {
    response = await fetch(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      // A checkout click is a person waiting. Paystack's p99 is well under
      // this; anything slower is a failed call that should say so rather than
      // hold the request open until the platform's own timeout kills it.
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    throw new PaystackError(
      `Could not reach Paystack (${(error as Error).message}).`,
      0,
      path,
      "unreachable",
    );
  }

  const text = await response.text();
  let envelope: PaystackEnvelope<T>;
  try {
    envelope = JSON.parse(text) as PaystackEnvelope<T>;
  } catch {
    throw new PaystackError(
      `Paystack returned a non-JSON response (HTTP ${response.status}).`,
      response.status,
      path,
      "bad_response",
    );
  }

  // `status: false` with HTTP 200 is a real Paystack response shape, so the
  // envelope is authoritative and the HTTP code alone is not.
  if (!response.ok || envelope.status !== true) {
    throw new PaystackError(
      envelope.message || `Paystack refused ${method} ${path}.`,
      response.status,
      path,
      (envelope as { code?: string }).code ?? null,
    );
  }

  return envelope.data as T;
}

/* ----------------------------------------------------------------- customers */

export interface PaystackCustomer {
  id: number;
  customer_code: string;
  email: string;
}

/**
 * Paystack keys customers by email, and `POST /customer` on an existing email
 * returns that existing customer rather than erroring — so this is
 * idempotent and needs no "does it exist" read first.
 */
export async function createCustomer(input: {
  email: string;
  first_name?: string | undefined;
  metadata?: Record<string, unknown> | undefined;
}): Promise<PaystackCustomer> {
  return request<PaystackCustomer>("POST", "/customer", input);
}

/* --------------------------------------------------------------------- plans */

export type PaystackInterval =
  | "hourly"
  | "daily"
  | "weekly"
  | "monthly"
  | "quarterly"
  | "biannually"
  | "annually";

export interface PaystackPlan {
  id: number;
  name: string;
  plan_code: string;
  /** In the currency's subunit. Always read through `fromSubunit`. */
  amount: number;
  interval: PaystackInterval;
  currency: string;
}

export async function createPlan(input: {
  name: string;
  /** Major unit — this function converts. Pass 89, not 8900. */
  amountMajor: number;
  interval: PaystackInterval;
  currency?: string;
  description?: string;
}): Promise<PaystackPlan> {
  return request<PaystackPlan>("POST", "/plan", {
    name: input.name,
    amount: toSubunit(input.amountMajor, input.currency ?? CURRENCY),
    interval: input.interval,
    currency: input.currency ?? CURRENCY,
    ...(input.description ? { description: input.description } : {}),
  });
}

export async function listPlans(): Promise<PaystackPlan[]> {
  return request<PaystackPlan[]>("GET", "/plan?perPage=100");
}

export async function fetchPlan(codeOrId: string): Promise<PaystackPlan> {
  return request<PaystackPlan>("GET", `/plan/${encodeURIComponent(codeOrId)}`);
}

/* -------------------------------------------------------------- transactions */

export interface InitializedTransaction {
  authorization_url: string;
  access_code: string;
  reference: string;
}

/**
 * Opens a checkout page.
 *
 * Two shapes, one endpoint. Everything sold here uses the first:
 *
 *   - pass `plan` and the customer is charged the plan's amount now and
 *     auto-subscribed, renewing on the plan's interval. `amount` is ignored.
 *   - pass `amount` with no plan and it is a single charge that renews
 *     nothing. Nothing in this app takes that shape any more — billing is
 *     subscription-only — and `fulfilReference` refuses to grant access for a
 *     charge that carries no plan, so a transaction opened this way would
 *     take money and entitle nobody.
 */
export async function initializeTransaction(input: {
  email: string;
  /** Major unit. Ignored by Paystack when `plan` is set, which it always is. */
  amountMajor: number;
  plan?: string | undefined;
  currency?: string | undefined;
  reference?: string | undefined;
  callback_url?: string | undefined;
  metadata?: Record<string, unknown> | undefined;
}): Promise<InitializedTransaction> {
  const currency = input.currency ?? CURRENCY;
  return request<InitializedTransaction>("POST", "/transaction/initialize", {
    email: input.email,
    amount: String(toSubunit(input.amountMajor, currency)),
    currency,
    ...(input.plan ? { plan: input.plan } : {}),
    ...(input.reference ? { reference: input.reference } : {}),
    ...(input.callback_url ? { callback_url: input.callback_url } : {}),
    ...(input.metadata ? { metadata: input.metadata } : {}),
  });
}

export interface VerifiedTransaction {
  id: number;
  status: "success" | "failed" | "abandoned" | "reversed" | "pending";
  reference: string;
  amount: number;
  currency: string;
  paid_at: string | null;
  channel: string | null;
  customer: { id: number; customer_code: string; email: string };
  plan?: string | { plan_code?: string } | null;
  plan_object?: { plan_code?: string; name?: string } | null;
  authorization?: { authorization_code?: string; reusable?: boolean } | null;
  metadata?: Record<string, unknown> | string | null;
}

/**
 * The truth about one payment, asked of Paystack directly.
 *
 * This is what fulfilment runs on, for both the redirect return and the
 * webhook. A webhook body is signed but still only a claim about the past;
 * re-verifying by reference costs one call and means a forged or replayed
 * event cannot grant a plan on its own.
 */
export async function verifyTransaction(
  reference: string,
): Promise<VerifiedTransaction> {
  return request<VerifiedTransaction>(
    "GET",
    `/transaction/verify/${encodeURIComponent(reference)}`,
  );
}

/* -------------------------------------------------------------- subscriptions */

export type PaystackSubscriptionStatus =
  /** Live and renewing. */
  | "active"
  /** Live, but will not renew — a cancellation that runs to period end. */
  | "non-renewing"
  /** Live, and the last charge FAILED. Paystack retries on the next cycle. */
  | "attention"
  /** Ran its course. No further charges. */
  | "completed"
  /** Stopped. */
  | "cancelled";

export interface PaystackSubscription {
  id: number;
  subscription_code: string;
  /** Required alongside the code to disable a subscription. */
  email_token: string;
  status: PaystackSubscriptionStatus;
  next_payment_date: string | null;
  amount: number;
  plan?: { plan_code?: string; name?: string; interval?: string } | null;
  customer?: { customer_code?: string; email?: string } | null;
}

export async function fetchSubscription(
  codeOrId: string,
): Promise<PaystackSubscription> {
  return request<PaystackSubscription>(
    "GET",
    `/subscription/${encodeURIComponent(codeOrId)}`,
  );
}

/**
 * The subscriptions belonging to one Paystack customer.
 *
 * This is what closes the hole in the redirect-return path. When a customer
 * pays for a plan, the transaction verifies as successful immediately but
 * carries no subscription code — Paystack creates the subscription
 * separately and announces it in the `subscription.create` webhook. Waiting
 * for that webhook before granting anything would mean a customer who has
 * just paid watches a Free account until a webhook we do not control turns
 * up, and never gets access at all if it is lost.
 *
 * So fulfilment looks the subscription up here instead, and the webhook
 * becomes the thing that keeps it current rather than the thing that creates
 * it.
 *
 * `customer` is Paystack's numeric customer id, not the `CUS_` code — the
 * endpoint quietly returns everything if given the wrong one, which would
 * attach another customer's subscription to this user, so the caller must
 * pass the id from the verified transaction.
 */
export async function listSubscriptions(input: {
  customerId: number;
}): Promise<PaystackSubscription[]> {
  return request<PaystackSubscription[]>(
    "GET",
    `/subscription?customer=${input.customerId}&perPage=50`,
  );
}

/**
 * Cancels a subscription at the end of the period already paid for.
 *
 * Paystack calls this "disable" and it needs BOTH the subscription code and
 * the `email_token` issued with it — which is why both are persisted locally
 * the moment a subscription appears. Without the token there is no way to
 * cancel from the server at all, and the customer is left with Paystack's
 * emailed management link as their only route out. That is the reason this
 * integration keeps its own subscription table rather than re-reading state
 * from the API on demand.
 */
export async function disableSubscription(input: {
  code: string;
  token: string;
}): Promise<unknown> {
  return request<unknown>("POST", "/subscription/disable", input);
}

/** Undoes a not-yet-effective cancellation, putting it back on renewal. */
export async function enableSubscription(input: {
  code: string;
  token: string;
}): Promise<unknown> {
  return request<unknown>("POST", "/subscription/enable", input);
}

/**
 * A Paystack-hosted page where the customer updates the card on a
 * subscription. This is the closest thing Paystack has to Stripe's customer
 * portal: it manages one subscription's payment method and nothing else — no
 * invoice history, no cancellation, no plan switching. The app therefore
 * cannot delegate billing management to it the way the Autumn build tried to,
 * and owns cancel/resume itself.
 */
export async function subscriptionManagementLink(
  code: string,
): Promise<{ link: string }> {
  return request<{ link: string }>(
    "GET",
    `/subscription/${encodeURIComponent(code)}/manage/link`,
  );
}

/* ------------------------------------------------------------------ webhooks */

/**
 * Is this webhook body really from Paystack?
 *
 * HMAC-SHA512 of the RAW body under the secret key, hex, compared to the
 * `x-paystack-signature` header. `raw` must be the exact bytes received —
 * a parsed-and-reserialised object will not match.
 *
 * Compared in constant time. A plain `===` on a hex digest leaks, through
 * timing, how many leading characters of a guess were right, which is enough
 * to forge a signature given enough attempts against an endpoint that by
 * design accepts unauthenticated traffic.
 */
export async function verifySignature(
  raw: string,
  signature: string | null | undefined,
): Promise<boolean> {
  const key = paystackSecretKey();
  if (!key || !signature) return false;

  const { createHmac, timingSafeEqual } = await import("node:crypto");
  const expected = createHmac("sha512", key).update(raw, "utf8").digest("hex");

  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature.trim(), "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Paystack's own egress addresses, published for optional firewalling.
 *
 * Deliberately NOT enforced in the handler. The signature check is the real
 * control — it proves the payload was written by someone holding the secret
 * key — whereas an IP list breaks silently the day Paystack adds a node, and
 * is worthless behind a proxy that rewrites the source address anyway. Kept
 * here because it belongs in the deployment's firewall, where it is a second
 * layer rather than the only one.
 */
export const PAYSTACK_WEBHOOK_IPS = [
  "52.31.139.75",
  "52.49.173.169",
  "52.214.14.220",
] as const;
