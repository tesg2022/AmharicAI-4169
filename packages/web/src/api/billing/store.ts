import { and, desc, eq, inArray, isNull, or, gt, sql } from "drizzle-orm";
import { db } from "../database";
import {
  ENTITLING_STATUSES,
  paystackCheckouts,
  paystackCustomers,
  paystackEvents,
  paystackPayments,
  paystackSubscriptions,
  type PaypalStatus,
  type PaystackStatus,
} from "../database/schema";
import { billingOptionById, type PlanId } from "../content/plans";
import { createCustomer, isTestMode } from "./paystack";

/**
 * Reads and writes of the local billing mirror.
 *
 * Every function here is safe to call twice with the same input. That is not a
 * nicety: Paystack retries webhooks it did not get a 200 for, `charge.success`
 * arrives both as a webhook and as the customer's redirect return, and a
 * learner who double-taps Buy sends two identical requests. Fulfilment
 * therefore upserts on natural keys — the subscription code, the transaction
 * reference — rather than inserting and hoping.
 */

/** Which provider a grant was paid through. */
export type GrantProvider = "paystack" | "paypal";

/**
 * One live paid entitlement. Provider-agnostic on purpose — and now that there
 * are genuinely two providers, that is load-bearing rather than aspirational.
 *
 * Read by `resolve.ts`, by the website and by the app. Everything above the
 * merge in `billing/grants.ts` sees Paystack and PayPal grants in this one
 * shape, and the booleans below are the shared vocabulary they are translated
 * into: `cancel_pending` means "will stop at `until`" whether that is
 * Paystack's `non-renewing` or PayPal's immediate `CANCELLED` with time left
 * on the clock, and `payment_failed` means "the last renewal was declined"
 * whether that is Paystack's `attention` or PayPal's `SUSPENDED`.
 *
 * Only two fields exist for the benefit of callers that must know which
 * provider they are dealing with — `provider` and `status` — and they exist
 * because cancelling, resuming or updating a card means calling one specific
 * provider's API. Nothing that merely gates a feature should read either.
 */
export interface LiveGrant {
  /**
   * Who took the money. Needed by the cancel/resume path, which has to call
   * the right API, and by nothing else. Feature gating must not branch on it:
   * a PayPal Premium subscriber and a Paystack Premium subscriber are the same
   * kind of Premium subscriber.
   */
  provider: GrantProvider;
  /** The BILLING_OPTIONS id, e.g. "premium_lifetime". */
  option_id: string;
  plan: PlanId;
  /** "monthly" | "annual" | "lifetime". */
  term: string;
  /** When access runs out, ms since epoch. null means never (lifetime). */
  until: number | null;
  /** True for a subscription that renews, false for a one-off purchase. */
  recurring: boolean;
  /** True when it is already set to stop at the end of the paid period. */
  cancel_pending: boolean;
  /**
   * True when the last renewal charge FAILED. Access continues to `until` and
   * the provider retries — but the customer has to be told, which is the whole
   * reason this is carried up to the UI.
   */
  payment_failed: boolean;
  /**
   * The provider's own status string, in the provider's own spelling:
   * Paystack's lowercase `active`/`non-renewing`/`attention`, or PayPal's
   * uppercase `ACTIVE`/`SUSPENDED`/`CANCELLED`.
   *
   * Deliberately not normalised into one enum. The UI reads the booleans
   * above; this field is for support and for the admin screen, where the
   * answer to "what does the provider think is going on" has to be the
   * provider's own answer rather than this app's summary of it.
   */
  status: PaystackStatus | PaypalStatus;
  /**
   * The provider's handle for the subscription: Paystack's `SUB_xxxx` code or
   * PayPal's `I-xxxx` id. Null for a one-off purchase, which has neither.
   *
   * Paired with `provider` — the same string means nothing without knowing
   * which API to send it to.
   */
  subscription_code: string | null;
}

/**
 * The Paystack customer for an app user, created on first need.
 *
 * Not created at sign-up. The Autumn build mirrored every new account into the
 * billing provider on registration, which meant a provider outage during
 * sign-up was logged and swallowed — leaving accounts with no customer record
 * and a checkout that failed later for a reason nobody could see. Creating it
 * at checkout ties the failure to the action that needs it, where it can be
 * reported to the person waiting.
 */
export async function ensureCustomer(user: {
  id: string;
  email: string;
  name?: string | null;
}): Promise<string> {
  const email = user.email.trim().toLowerCase();

  const [existing] = await db
    .select()
    .from(paystackCustomers)
    .where(eq(paystackCustomers.userId, user.id))
    .limit(1);

  // Re-create if the address changed: Paystack keys customers by email, so a
  // stale mapping would attach the payment to their old identity.
  if (existing && existing.email === email) return existing.customerCode;

  const customer = await createCustomer({
    email,
    first_name: user.name?.trim() || undefined,
    // So a Paystack dashboard row can be traced back to an app account
    // without exporting anything personal into the metadata.
    metadata: { app_user_id: user.id },
  });

  await db
    .insert(paystackCustomers)
    .values({ userId: user.id, customerCode: customer.customer_code, email })
    .onConflictDoUpdate({
      target: paystackCustomers.userId,
      set: { customerCode: customer.customer_code, email },
    });

  return customer.customer_code;
}

export async function recordCheckout(input: {
  reference: string;
  userId: string;
  optionId: string;
  plan: PlanId;
  term: string;
  amountSubunit: number;
  currency: string;
  planCode: string | null;
}): Promise<void> {
  await db
    .insert(paystackCheckouts)
    .values({ ...input, status: "pending" })
    .onConflictDoNothing();
}

export async function settleCheckout(
  reference: string,
  status: "success" | "failed" | "abandoned",
): Promise<void> {
  await db
    .update(paystackCheckouts)
    .set({ status, settledAt: new Date() })
    .where(eq(paystackCheckouts.reference, reference));
}

export async function checkoutByReference(reference: string) {
  const [row] = await db
    .select()
    .from(paystackCheckouts)
    .where(eq(paystackCheckouts.reference, reference))
    .limit(1);
  return row ?? null;
}

/** The app user behind a Paystack customer code, if we have ever seen them. */
export async function userIdByCustomerCode(code: string): Promise<string | null> {
  const [row] = await db
    .select({ userId: paystackCustomers.userId })
    .from(paystackCustomers)
    .where(eq(paystackCustomers.customerCode, code))
    .limit(1);
  return row?.userId ?? null;
}

/**
 * The checkout a `subscription.create` webhook belongs to.
 *
 * Paystack's subscription events carry no transaction reference, and this app
 * grants nothing without verifying a reference — so the event has to be joined
 * back to the checkout that started it. Customer code plus plan code plus
 * "still pending" identifies it: a second subscription to the same plan cannot
 * be started without a second checkout row, and the newest pending one is the
 * one the customer just paid for.
 *
 * Returns null when there is nothing pending, which is the normal case for a
 * replayed event — the grant already exists and needs no reference.
 */
export async function pendingCheckoutForSubscription(input: {
  customerCode: string;
  planCode: string | null;
}): Promise<string | null> {
  const userId = await userIdByCustomerCode(input.customerCode);
  if (!userId) return null;

  const rows = await db
    .select({ reference: paystackCheckouts.reference })
    .from(paystackCheckouts)
    .where(
      and(
        eq(paystackCheckouts.userId, userId),
        eq(paystackCheckouts.status, "pending"),
        ...(input.planCode ? [eq(paystackCheckouts.planCode, input.planCode)] : []),
      ),
    )
    .orderBy(desc(paystackCheckouts.createdAt))
    .limit(1);

  return rows[0]?.reference ?? null;
}

/**
 * Records a successful charge as a receipt.
 *
 * Separate from the grant because they are not one-to-one: an annual
 * subscription produces one grant and a payment every year, and a failed
 * renewal produces neither.
 */
export async function recordPayment(input: {
  reference: string;
  userId: string;
  optionId: string | null;
  amountSubunit: number;
  currency: string;
  status: string;
  channel: string | null;
  paidAt: Date | null;
}): Promise<void> {
  await db
    .insert(paystackPayments)
    .values({ ...input, testMode: isTestMode() })
    .onConflictDoUpdate({
      target: paystackPayments.reference,
      set: { status: input.status, paidAt: input.paidAt, channel: input.channel },
    });
}

export async function paymentsFor(userId: string) {
  return db
    .select()
    .from(paystackPayments)
    .where(eq(paystackPayments.userId, userId))
    .orderBy(desc(paystackPayments.paidAt));
}

/**
 * Writes or updates the grant for a recurring subscription.
 *
 * Keyed on the Paystack subscription code, so the `subscription.create`
 * webhook, a later `invoice.update` carrying a new period end, and a
 * cancellation all land on the same row instead of stacking three grants for
 * one subscription.
 */
export async function upsertSubscriptionGrant(input: {
  userId: string;
  optionId: string;
  plan: PlanId;
  term: string;
  subscriptionCode: string;
  emailToken: string | null;
  planCode: string | null;
  status: PaystackStatus;
  until: Date | null;
  amountSubunit: number;
  currency: string;
  reference: string | null;
}): Promise<void> {
  await db
    .insert(paystackSubscriptions)
    .values({
      id: crypto.randomUUID(),
      recurring: true,
      ...input,
    })
    .onConflictDoUpdate({
      target: paystackSubscriptions.subscriptionCode,
      /**
       * Repeats the unique index's own predicate, and must.
       *
       * `uq_paystack_sub_code` is a PARTIAL index (`where subscription_code is
       * not null`), and SQLite only matches an `on conflict` target to a
       * partial index when the clause carries the same predicate. Without
       * this, every single grant write fails outright with "ON CONFLICT clause
       * does not match any PRIMARY KEY or UNIQUE constraint" — not on the
       * conflicting second write, on the first one.
       */
      targetWhere: sql`${paystackSubscriptions.subscriptionCode} is not null`,
      set: {
        status: input.status,
        until: input.until,
        // Never overwrite a stored token with null. The token comes with
        // `subscription.create` and not with every later event, and losing it
        // would make the subscription permanently uncancellable from here.
        ...(input.emailToken ? { emailToken: input.emailToken } : {}),
        updatedAt: new Date(),
      },
    });
}

/**
 * Writes the grant for a one-off purchase — lifetime, and only lifetime.
 *
 * Keyed on the transaction reference. A replayed `charge.success` for the same
 * reference is therefore a no-op rather than a second lifetime grant, which
 * matters because the redirect return and the webhook both fulfil the same
 * payment.
 */
export async function upsertOneOffGrant(input: {
  userId: string;
  optionId: string;
  plan: PlanId;
  term: string;
  amountSubunit: number;
  currency: string;
  reference: string;
}): Promise<void> {
  await db
    .insert(paystackSubscriptions)
    .values({
      id: crypto.randomUUID(),
      recurring: false,
      subscriptionCode: null,
      emailToken: null,
      planCode: null,
      status: "active",
      // Lifetime. A date here would be a lie with a deadline on it.
      until: null,
      ...input,
    })
    // No conflict target on purpose. `uq_paystack_sub_reference` is a partial
    // index, so a targeted clause would have to repeat its `where` predicate —
    // and drizzle's SQLite `onConflictDoNothing` emits `where` *after*
    // `do nothing`, which SQLite rejects as a syntax error. The untargeted form
    // covers every unique index on the table, which is what is wanted here: the
    // only collision this insert can hit is a replayed reference.
    .onConflictDoNothing();
}

/** Marks a subscription's new status, from a webhook or a cancel call. */
export async function setSubscriptionStatus(
  subscriptionCode: string,
  status: PaystackStatus,
  until?: Date | null,
): Promise<void> {
  await db
    .update(paystackSubscriptions)
    .set({
      status,
      ...(until === undefined ? {} : { until }),
      updatedAt: new Date(),
    })
    .where(eq(paystackSubscriptions.subscriptionCode, subscriptionCode));
}

export async function subscriptionByCode(code: string) {
  const [row] = await db
    .select()
    .from(paystackSubscriptions)
    .where(eq(paystackSubscriptions.subscriptionCode, code))
    .limit(1);
  return row ?? null;
}

/**
 * Everything this user currently holds ON PAYSTACK that still entitles them.
 *
 * Half of the answer, not the answer. `billing/grants.ts` merges this with the
 * PayPal side and exports the `liveGrants` that `resolve.ts` calls — nothing
 * outside that merge should call this function, or it will resolve a PayPal
 * subscriber to Free.
 *
 * A local indexed read, deliberately. Resolving entitlement through a call to
 * Paystack on every authenticated request would mean their availability is
 * ours — and a five-minute API blip would silently demote every paying
 * learner to Free mid-lesson.
 *
 * `completed` and `cancelled` rows are excluded by status. `attention` rows
 * are included: the period was paid for, the failure is the next charge, and
 * the expiry filter below already ends access when the paid time runs out.
 */
export async function paystackLiveGrants(userId: string): Promise<LiveGrant[]> {
  const nowMs = new Date();
  const rows = await db
    .select()
    .from(paystackSubscriptions)
    .where(
      and(
        eq(paystackSubscriptions.userId, userId),
        inArray(paystackSubscriptions.status, [...ENTITLING_STATUSES]),
        // Null `until` is lifetime and never expires; a date in the past is
        // a period that has run out and grants nothing, whatever its status
        // still says — a webhook we never received must not extend access.
        or(isNull(paystackSubscriptions.until), gt(paystackSubscriptions.until, nowMs)),
      ),
    );

  return rows.map((row) => {
    const option = billingOptionById(row.optionId);
    return {
      provider: "paystack" as const,
      option_id: row.optionId,
      // The row's own copy is authoritative over the current price list, so
      // renaming or retiring an option cannot revoke a grant somebody paid
      // for. The option lookup is only for labels.
      plan: (option?.plan ?? row.plan) as PlanId,
      term: option?.term ?? row.term,
      until: row.until ? row.until.getTime() : null,
      recurring: row.recurring,
      cancel_pending: row.status === "non-renewing",
      payment_failed: row.status === "attention",
      status: row.status,
      subscription_code: row.subscriptionCode,
    };
  });
}

/** Rows with their cancel credentials, for the cancel/resume path. */
export async function manageableSubscriptions(userId: string) {
  return db
    .select()
    .from(paystackSubscriptions)
    .where(
      and(
        eq(paystackSubscriptions.userId, userId),
        eq(paystackSubscriptions.recurring, true),
        inArray(paystackSubscriptions.status, ["active", "non-renewing", "attention"]),
      ),
    );
}

/* ------------------------------------------------------------ idempotency */

/**
 * Claims a webhook event, returning false if it was already handled.
 *
 * An insert, not a select-then-insert: two concurrent deliveries of the same
 * event would both pass a read check, and Paystack does retry in parallel
 * with its original attempt. The primary key does the arbitration.
 *
 * "Already handled" means handled *successfully*. A row carrying an error was
 * claimed by an attempt that then failed, and Paystack's retry of it has to be
 * allowed through — otherwise one transient failure (a Paystack timeout mid
 * handler) would turn every redelivery of that event into a silent no-op and
 * the renewal it carried would never land. Re-claiming clears the error so the
 * row means what it says: present and clean is done, present with an error is
 * in flight and last seen failing.
 */
export async function claimEvent(
  id: string,
  event: string,
  reference: string | null,
): Promise<boolean> {
  const inserted = await db
    .insert(paystackEvents)
    .values({ id, event, reference })
    .onConflictDoUpdate({
      target: paystackEvents.id,
      set: { error: null, receivedAt: new Date() },
      // Only a failed row is re-claimable. A clean one stays untouched and
      // reports itself as a duplicate.
      setWhere: sql`${paystackEvents.error} is not null`,
    })
    .returning({ id: paystackEvents.id });
  return inserted.length > 0;
}

/** Attaches a failure to a claimed event, so a stuck webhook is visible. */
export async function markEventFailed(id: string, error: string): Promise<void> {
  await db
    .update(paystackEvents)
    .set({ error: error.slice(0, 500) })
    .where(eq(paystackEvents.id, id));
}

/** Recent webhook deliveries, for the admin screen. */
export async function recentEvents(limit = 20) {
  return db
    .select()
    .from(paystackEvents)
    .orderBy(desc(paystackEvents.receivedAt))
    .limit(limit);
}
