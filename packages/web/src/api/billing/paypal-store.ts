import { and, desc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "../database";
import {
  PAYPAL_ENTITLING_STATUSES,
  paypalCheckouts,
  paypalCustomers,
  paypalEvents,
  paypalPayments,
  paypalSubscriptions,
  type PaypalStatus,
} from "../database/schema";
import { billingOptionById, type PlanId } from "../content/plans";
import type { LiveGrant } from "./store";
import { isSandbox } from "./paypal";

/**
 * Reads and writes of the local PayPal mirror.
 *
 * Mirrors `store.ts`, and every function here is safe to call twice with the
 * same input for the same reasons: PayPal retries any delivery it did not get
 * a 2xx for, for up to three days, and the customer's return from the approval
 * page races the `BILLING.SUBSCRIPTION.ACTIVATED` webhook by about a second.
 * Fulfilment therefore upserts on natural keys — the subscription id, the sale
 * id — rather than inserting and hoping.
 *
 * One difference from the Paystack store worth stating: there is no
 * `ensureCustomer` here. PayPal has no customer object to create before a
 * checkout — the payer is whoever approves on PayPal's page — so the payer is
 * RECORDED after the fact, from the subscription, by `recordPayer`.
 */

/**
 * Notes which PayPal account paid, after the fact.
 *
 * Written from a subscription's `subscriber` block on fulfilment. Its job is
 * attributing a later webhook: PayPal's subscription events carry the payer,
 * and a customer paying from a PayPal account whose email is nothing like
 * their AmharicAI login is entirely normal — so email is not a usable join
 * and the payer id is.
 *
 * Deliberately last-write-wins on `userId`. A user who re-subscribes from a
 * different PayPal account should have the current one recorded; the grant
 * rows keep the history.
 */
export async function recordPayer(input: {
  userId: string;
  payerId: string;
  email: string | null;
}): Promise<void> {
  await db
    .insert(paypalCustomers)
    .values({
      userId: input.userId,
      payerId: input.payerId,
      email: input.email?.trim().toLowerCase() ?? null,
    })
    .onConflictDoUpdate({
      target: paypalCustomers.userId,
      set: {
        payerId: input.payerId,
        email: input.email?.trim().toLowerCase() ?? null,
        updatedAt: new Date(),
      },
    });
}

/** The app user behind a PayPal payer id, if we have ever seen them. */
export async function userIdByPayerId(payerId: string): Promise<string | null> {
  const [row] = await db
    .select({ userId: paypalCustomers.userId })
    .from(paypalCustomers)
    .where(eq(paypalCustomers.payerId, payerId))
    .limit(1);
  return row?.userId ?? null;
}

/* ----------------------------------------------------------------- checkouts */

export async function recordPaypalCheckout(input: {
  reference: string;
  userId: string;
  optionId: string;
  plan: PlanId;
  term: string;
  planId: string;
  amountUsd: string;
  subscriptionId: string | null;
}): Promise<void> {
  await db
    .insert(paypalCheckouts)
    .values({ ...input, status: "pending" })
    .onConflictDoNothing();
}

/**
 * Attaches PayPal's subscription id to a checkout row.
 *
 * Separate from the insert because of the order things happen in: the row is
 * written before PayPal is called, so an outage on their side is visible as a
 * started checkout that never got a subscription — which is a different
 * failure from a customer who abandoned one, and the difference is only
 * legible if the row exists either way.
 */
export async function attachSubscriptionId(
  reference: string,
  subscriptionId: string,
): Promise<void> {
  await db
    .update(paypalCheckouts)
    .set({ subscriptionId })
    .where(eq(paypalCheckouts.reference, reference));
}

export async function settlePaypalCheckout(
  reference: string,
  status: "success" | "failed" | "abandoned",
): Promise<void> {
  await db
    .update(paypalCheckouts)
    .set({ status, settledAt: new Date() })
    .where(eq(paypalCheckouts.reference, reference));
}

export async function paypalCheckoutByReference(reference: string) {
  const [row] = await db
    .select()
    .from(paypalCheckouts)
    .where(eq(paypalCheckouts.reference, reference))
    .limit(1);
  return row ?? null;
}

/**
 * The checkout a subscription belongs to, by PayPal's subscription id.
 *
 * The primary attribution path, and much sturdier than the Paystack
 * equivalent: PayPal issues the subscription id at creation, before the
 * customer ever leaves, so this join always exists. Paystack's
 * `pendingCheckoutForSubscription` has to guess from customer + plan + "most
 * recent pending" because its subscription does not exist yet at that point.
 */
export async function paypalCheckoutBySubscriptionId(subscriptionId: string) {
  const [row] = await db
    .select()
    .from(paypalCheckouts)
    .where(eq(paypalCheckouts.subscriptionId, subscriptionId))
    .limit(1);
  return row ?? null;
}

/* ------------------------------------------------------------------ payments */

/**
 * Records a completed PayPal sale as a receipt.
 *
 * Keyed on PayPal's sale id, so a redelivered `PAYMENT.SALE.COMPLETED` updates
 * one row instead of adding a duplicate receipt to the customer's history.
 */
export async function recordPaypalPayment(input: {
  id: string;
  userId: string;
  optionId: string | null;
  subscriptionId: string | null;
  amountUsd: string;
  currency: string;
  status: string;
  paidAt: Date | null;
}): Promise<void> {
  await db
    .insert(paypalPayments)
    .values({ ...input, sandbox: isSandbox() })
    .onConflictDoUpdate({
      target: paypalPayments.id,
      /**
       * `paidAt` is only overwritten when a date is supplied, and never
       * cleared. A refund corrects this same row by sale id and has no paid
       * date of its own to offer — writing its null would erase when the
       * customer was actually charged, which is the one fact a receipt exists
       * to record, and would drop the row out of the date-ordered history.
       */
      set: {
        status: input.status,
        ...(input.paidAt ? { paidAt: input.paidAt } : {}),
      },
    });
}

export async function paypalPaymentsFor(userId: string) {
  return db
    .select()
    .from(paypalPayments)
    .where(eq(paypalPayments.userId, userId))
    .orderBy(desc(paypalPayments.paidAt));
}

/* -------------------------------------------------------------------- grants */

/**
 * Writes or updates the grant for a PayPal subscription.
 *
 * Keyed on PayPal's subscription id, so the activation webhook, a later
 * renewal carrying a new billing date, a suspension and a cancellation all
 * land on the same row instead of stacking four grants for one subscription.
 *
 * `until` is only overwritten when a date is supplied, and NEVER cleared. That
 * single rule is what makes PayPal's immediate cancellation survivable: at
 * cancellation PayPal stops reporting a next billing time, and writing that
 * null here would either be read as "lifetime, access forever" — the null
 * convention this column inherits from the Paystack table — or force access to
 * end at once, destroying a paid period the customer is owed.
 */
export async function upsertPaypalGrant(input: {
  userId: string;
  optionId: string;
  plan: PlanId;
  term: string;
  subscriptionId: string;
  planId: string | null;
  status: PaypalStatus;
  until: Date | null;
  amountUsd: string;
  currency: string;
  reference: string | null;
}): Promise<void> {
  await db
    .insert(paypalSubscriptions)
    .values({
      id: crypto.randomUUID(),
      recurring: true,
      sandbox: isSandbox(),
      ...input,
    })
    .onConflictDoUpdate({
      target: paypalSubscriptions.subscriptionId,
      /**
       * Repeats the unique index's own predicate, and must.
       *
       * `uq_paypal_sub_id` is a PARTIAL index (`where subscription_id is not
       * null`), and SQLite only matches an `on conflict` target to a partial
       * index when the clause carries the same predicate. Without this, the
       * FIRST grant write fails outright with "ON CONFLICT clause does not
       * match any PRIMARY KEY or UNIQUE constraint" — not the conflicting
       * second one. Learned on the Paystack side; the same trap is here.
       */
      targetWhere: sql`${paypalSubscriptions.subscriptionId} is not null`,
      set: {
        status: input.status,
        // See the note above: a date replaces a date, null leaves it standing.
        ...(input.until ? { until: input.until } : {}),
        updatedAt: new Date(),
      },
    });
}

/**
 * Marks a PayPal subscription's new status.
 *
 * `until` follows the same never-clear rule as the upsert: pass a date to
 * extend the paid period, pass nothing to leave it exactly where it was. There
 * is deliberately no way to set it to null through this function — a null
 * `until` on a PayPal row means lifetime, which PayPal does not sell.
 */
export async function setPaypalStatus(
  subscriptionId: string,
  status: PaypalStatus,
  until?: Date,
): Promise<void> {
  await db
    .update(paypalSubscriptions)
    .set({
      status,
      ...(until ? { until } : {}),
      updatedAt: new Date(),
    })
    .where(eq(paypalSubscriptions.subscriptionId, subscriptionId));
}

export async function paypalSubscriptionById(subscriptionId: string) {
  const [row] = await db
    .select()
    .from(paypalSubscriptions)
    .where(eq(paypalSubscriptions.subscriptionId, subscriptionId))
    .limit(1);
  return row ?? null;
}

/**
 * Everything this user currently holds ON PAYPAL that still entitles them.
 *
 * The other half of the answer. `billing/grants.ts` merges it with
 * `paystackLiveGrants`; nothing else should call this directly.
 *
 * The status filter includes `CANCELLED`, which looks wrong next to the
 * Paystack version and is not. PayPal cancels immediately and has no
 * "non-renewing" state, so a customer who cancels an annual subscription two
 * months in is `CANCELLED` with ten paid months left. The `until` comparison
 * below is what ends access, exactly as it does for Paystack — status says
 * whether it renews, `until` says when it stops.
 */
export async function paypalLiveGrants(userId: string): Promise<LiveGrant[]> {
  const nowMs = new Date();
  const rows = await db
    .select()
    .from(paypalSubscriptions)
    .where(
      and(
        eq(paypalSubscriptions.userId, userId),
        inArray(paypalSubscriptions.status, [...PAYPAL_ENTITLING_STATUSES]),
        /**
         * A null `until` is only ever a one-off lifetime purchase, which is
         * not sold on PayPal today — so in practice this arm matches nothing,
         * and it is written explicitly rather than left implicit because the
         * alternative reading of null is "access forever". The `recurring`
         * check is what says so out loud: a recurring row with no billing date
         * is a bug, not a lifetime grant, and it must not entitle anybody.
         */
        or(
          and(isNull(paypalSubscriptions.until), eq(paypalSubscriptions.recurring, false)),
          gt(paypalSubscriptions.until, nowMs),
        ),
      ),
    );

  return rows.map((row) => {
    const option = billingOptionById(row.optionId);
    return {
      provider: "paypal" as const,
      option_id: row.optionId,
      // The row's own copy is authoritative over the current price list, so
      // renaming or retiring an option cannot revoke a grant somebody paid
      // for. The option lookup is only for labels.
      plan: (option?.plan ?? row.plan) as PlanId,
      term: option?.term ?? row.term,
      until: row.until ? row.until.getTime() : null,
      recurring: row.recurring,
      /**
       * PayPal's `CANCELLED` while time remains IS this app's cancel_pending.
       *
       * The customer's situation is identical to a Paystack `non-renewing`
       * subscription — paid up, access until `until`, no further charges — and
       * that is what the UI needs to say. The provider mechanics underneath are
       * opposite, which is exactly why this translation happens here and not
       * in the UI.
       */
      cancel_pending: row.status === "CANCELLED",
      /**
       * `SUSPENDED` is PayPal's `attention`: the last charge failed and PayPal
       * is retrying. Access continues to `until`, and the customer has to be
       * told before it runs out.
       */
      payment_failed: row.status === "SUSPENDED",
      status: row.status,
      subscription_code: row.subscriptionId,
    };
  });
}

/**
 * PayPal subscriptions this user could cancel or resume, for the manage path.
 *
 * `CANCELLED` rows are excluded even though they may still be entitling,
 * because there is nothing left to manage: PayPal cannot revive a cancelled
 * subscription, so offering "resume" on one would be offering something the
 * API will refuse. The UI has to sell a new subscription instead, which is a
 * genuine product difference from Paystack and not something to paper over
 * with a button that fails.
 */
export async function manageablePaypalSubscriptions(userId: string) {
  return db
    .select()
    .from(paypalSubscriptions)
    .where(
      and(
        eq(paypalSubscriptions.userId, userId),
        eq(paypalSubscriptions.recurring, true),
        inArray(paypalSubscriptions.status, ["ACTIVE", "SUSPENDED"]),
      ),
    );
}

/* ------------------------------------------------------------ idempotency */

/**
 * Claims a webhook event, returning false if it was already handled.
 *
 * Keyed on PayPal's own event id, which is a real per-delivery identifier —
 * the thing Paystack lacks, and the reason its events table hashes the request
 * body instead. A retry of delivery `WH-xxx` carries the same id, so the
 * primary key arbitrates even when PayPal retries in parallel with its
 * original attempt.
 *
 * "Already handled" means handled SUCCESSFULLY. A row carrying an error was
 * claimed by an attempt that then failed, and PayPal's retry has to be let
 * through — otherwise one transient failure mid-handler turns every
 * redelivery into a silent no-op and the renewal it carried never lands.
 */
export async function claimPaypalEvent(
  id: string,
  eventType: string,
  resourceId: string | null,
): Promise<boolean> {
  const inserted = await db
    .insert(paypalEvents)
    .values({ id, eventType, resourceId })
    .onConflictDoUpdate({
      target: paypalEvents.id,
      set: { error: null, receivedAt: new Date() },
      // Only a failed row is re-claimable. A clean one stays untouched and
      // reports itself as a duplicate.
      setWhere: sql`${paypalEvents.error} is not null`,
    })
    .returning({ id: paypalEvents.id });
  return inserted.length > 0;
}

/** Attaches a failure to a claimed event, so a stuck webhook is visible. */
export async function markPaypalEventFailed(id: string, error: string): Promise<void> {
  await db
    .update(paypalEvents)
    .set({ error: error.slice(0, 500) })
    .where(eq(paypalEvents.id, id));
}

/** Recent PayPal webhook deliveries, for the admin screen. */
export async function recentPaypalEvents(limit = 20) {
  return db
    .select()
    .from(paypalEvents)
    .orderBy(desc(paypalEvents.receivedAt))
    .limit(limit);
}
