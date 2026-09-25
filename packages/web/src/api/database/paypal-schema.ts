import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * PayPal billing state, mirrored locally. The second provider, alongside
 * Paystack — not a replacement for it.
 *
 * These tables are a deliberate MIRROR of `billing-schema.ts` rather than a
 * generalisation of it. The alternative was one provider-keyed billing schema,
 * and it was rejected for a specific reason: migrating the live Paystack
 * tables to carry a `provider` column means a destructive migration over rows
 * that represent money people have already paid, to buy tidiness in a file
 * nobody reads. Two mirrors that meet at one merge point (`billing/grants.ts`)
 * cost some duplicated column definitions and risk nothing already sold.
 *
 * The split by customer, which is the whole point of having both:
 *
 *   - Paystack takes cards and local South African methods, in ZAR
 *   - PayPal takes PayPal balances and international customers, in USD
 *
 * Both write rows that feed ONE entitlement answer. A user with a PayPal
 * subscription and a user with a Paystack subscription are the same kind of
 * Premium subscriber to every feature gate in the app, and neither
 * `resolve.ts` nor any UI asks which provider paid unless it is about to send
 * the customer back to that provider.
 *
 * Where PayPal genuinely differs from Paystack, the difference is recorded
 * here rather than flattened away:
 *
 *   - PayPal CANCELS IMMEDIATELY. Paystack's disable runs to the end of the
 *     paid period. So a cancelled PayPal subscription still has to entitle the
 *     holder until the period they paid for runs out, which is why `until`
 *     keeps its value on cancellation and why `CANCELLED` with a future
 *     `until` is this schema's version of Paystack's `non-renewing`.
 *   - PayPal has a REAL EVENT ID on every webhook, so idempotency keys on it
 *     rather than on a hash of the body.
 *   - PayPal verifies webhooks by an OUTBOUND API CALL, not a local HMAC, so
 *     there is a webhook id in the environment and no shared secret here.
 */

const now = sql`(unixepoch())`;

/**
 * PayPal's subscription states, kept verbatim in PayPal's own spelling
 * (uppercase) so a row can be compared to an API response without a
 * translation table in between.
 *
 * Deliberately NOT mapped onto Paystack's five statuses at the storage layer.
 * The two vocabularies are close enough to invite it and different enough that
 * it would lose information: Paystack's `non-renewing` and PayPal's
 * `CANCELLED`-with-time-remaining describe the same customer situation through
 * opposite provider mechanics, and a stored row that claimed `non-renewing`
 * would be describing a subscription PayPal considers finished. The merge into
 * one shared vocabulary happens on read, in `billing/grants.ts`, where the
 * mapping is visible and reversible.
 */
export const PAYPAL_STATUSES = [
  /** Created, but the customer has not approved it yet. Entitles nothing. */
  "APPROVAL_PENDING",
  /** Approved by the customer, not yet activated by PayPal. Entitles nothing. */
  "APPROVED",
  /** Live and renewing. */
  "ACTIVE",
  /**
   * Live, but billing is paused and PayPal is retrying. This is the closest
   * thing to Paystack's `attention`: the period already paid for stands, and
   * the failure is the next charge.
   */
  "SUSPENDED",
  /** Stopped. Access runs to `until`, because PayPal cancels immediately. */
  "CANCELLED",
  /** Ran to completion — a fixed-cycle plan that finished. */
  "EXPIRED",
] as const;
export type PaypalStatus = (typeof PAYPAL_STATUSES)[number];

/**
 * Statuses that still entitle the holder, subject to `until` not having passed.
 *
 * `CANCELLED` is in this list, which is the single most important difference
 * from the Paystack schema, and it is not an oversight.
 *
 * PayPal's cancel takes effect at once — there is no "will not renew" state to
 * sit in — so the moment a customer cancels, PayPal reports `CANCELLED` even
 * though they have paid through to a date that may be weeks away. Excluding it
 * would mean a customer who cancels an annual subscription in month two loses
 * the ten months they already paid for, which is theft with a status code in
 * front of it. The `until` filter in the entitling query is what actually ends
 * access, exactly as it does for Paystack.
 *
 * `EXPIRED` is excluded: a completed plan has no remaining paid period by
 * definition, and `until` would be in the past anyway.
 */
export const PAYPAL_ENTITLING_STATUSES: readonly PaypalStatus[] = [
  "ACTIVE",
  // Paid up, retrying the NEXT charge. Access ends when `until` does.
  "SUSPENDED",
  // Paid up, will not renew. See the note above — this is not "stopped now".
  "CANCELLED",
];

/**
 * One PayPal payer per app user.
 *
 * Thinner than `paystack_customers`, because PayPal has no customer object to
 * create: there is no "create payer" call, and a subscription is tied to
 * whichever PayPal account approves it. So this table is a RECORD of who
 * approved, written after the fact from the subscription's subscriber block,
 * not a cache of something created beforehand.
 *
 * It exists for the same reason Paystack's does — resolving a webhook back to
 * an app user — plus one PayPal-specific reason: the payer id is the only
 * stable identifier of the PayPal account behind a subscription, and a
 * customer who pays from a different PayPal account than the email on their
 * AmharicAI login is entirely normal.
 */
export const paypalCustomers = sqliteTable(
  "paypal_customers",
  {
    userId: text("user_id").primaryKey(),
    /** PayPal's payer id for the account that approved, e.g. "8XY...". */
    payerId: text("payer_id").notNull(),
    /** The PayPal account's own email, lowercased. Often not the login email. */
    email: text("email"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(now),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(now),
  },
  (t) => [index("idx_paypal_customer_payer").on(t.payerId)],
);

/**
 * Every PayPal checkout this app has started, and what became of it.
 *
 * Keyed on OUR reference rather than PayPal's subscription id, to match the
 * Paystack table and for a harder reason: the row has to exist before the
 * customer leaves the site, and at that moment the subscription id is the one
 * thing we do have — PayPal issues it at creation, unlike Paystack, which
 * creates the subscription after the charge. Both are therefore stored, and
 * `subscriptionId` is what the return path and the webhooks look up by.
 */
export const paypalCheckouts = sqliteTable(
  "paypal_checkouts",
  {
    /** Our own reference, passed to PayPal as `custom_id`. */
    reference: text("reference").primaryKey(),
    userId: text("user_id").notNull(),
    /** The BILLING_OPTIONS id, e.g. "premium_annual". */
    optionId: text("option_id").notNull(),
    /** Resolved tier, copied so a later price-list edit cannot rewrite history. */
    plan: text("plan").notNull(),
    term: text("term").notNull(),
    /**
     * PayPal's subscription id, known at creation time — before approval.
     *
     * Nullable only for the instant between writing the row and PayPal
     * answering. A row that keeps a null here is a subscription PayPal never
     * accepted, which is a real failure worth being able to see.
     */
    subscriptionId: text("subscription_id"),
    /** PayPal's billing plan id this was bought against, e.g. "P-1AB...". */
    planId: text("plan_id").notNull(),
    /** Major units. USD has no zero-decimal problem, so dollars, not cents. */
    amountUsd: text("amount_usd").notNull(),
    currency: text("currency").notNull().default("USD"),
    status: text("status")
      .$type<"pending" | "success" | "failed" | "abandoned">()
      .notNull()
      .default("pending"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(now),
    settledAt: integer("settled_at", { mode: "timestamp" }),
  },
  (t) => [
    index("idx_paypal_checkout_user").on(t.userId, t.createdAt),
    index("idx_paypal_checkout_status").on(t.status),
    uniqueIndex("uq_paypal_checkout_subscription")
      .on(t.subscriptionId)
      .where(sql`${t.subscriptionId} is not null`),
  ],
);

/**
 * A paid PayPal entitlement.
 *
 * Every row here is recurring: billing is subscription-only on both providers.
 * The table carries `recurring` and a nullable `until` to stay the same shape
 * as the Paystack table, which is what lets one merged read serve both — but
 * neither is a way to express permanent access. The entitling read requires an
 * `until` in the future, so a null there grants nothing rather than meaning
 * forever.
 */
export const paypalSubscriptions = sqliteTable(
  "paypal_subscriptions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    /** The BILLING_OPTIONS id this was bought as. */
    optionId: text("option_id").notNull(),
    plan: text("plan").notNull(),
    term: text("term").notNull(),
    recurring: integer("recurring", { mode: "boolean" }).notNull(),
    /**
     * PayPal's subscription id, e.g. "I-BW452GLLEP1G".
     *
     * Everything needed to cancel, suspend or re-activate. Unlike Paystack
     * there is no second per-subscription token to capture — the app's own
     * OAuth credentials authorise the call — so a PayPal subscription can
     * always be cancelled from the server, and the "capture the token on
     * sight or lose cancellation forever" hazard does not exist here.
     */
    subscriptionId: text("subscription_id"),
    /** PayPal's billing plan id. Null would mean a one-off (not yet sold). */
    planId: text("plan_id"),
    status: text("status").$type<PaypalStatus>().notNull(),
    /**
     * End of the period already paid for, ms since epoch.
     *
     * Taken from PayPal's `billing_info.next_billing_time` while the
     * subscription is live, and DELIBERATELY LEFT ALONE on cancellation: at
     * that moment PayPal stops reporting a next billing time, and clearing
     * this column would either end access instantly (wrong — the period is
     * paid for) or, being null, grant it forever (much worse).
     */
    until: integer("until", { mode: "timestamp_ms" }),
    /** Major units, as a string, so a price is never a float in the ledger. */
    amountUsd: text("amount_usd").notNull(),
    currency: text("currency").notNull().default("USD"),
    /** The checkout reference that created this. Ties a grant to a receipt. */
    reference: text("reference"),
    /** True when taken against PayPal SANDBOX credentials. Never revenue. */
    sandbox: integer("sandbox", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(now),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(now),
  },
  (t) => [
    index("idx_paypal_sub_user").on(t.userId, t.status),
    // One row per PayPal subscription, so a replayed activation updates the
    // grant instead of granting a second one. Partial on NOT NULL for the same
    // reasons as the Paystack table: a future one-off purchase has no
    // subscription id, and SQLite treats every NULL as distinct anyway.
    uniqueIndex("uq_paypal_sub_id")
      .on(t.subscriptionId)
      .where(sql`${t.subscriptionId} is not null`),
    uniqueIndex("uq_paypal_sub_reference")
      .on(t.reference)
      .where(sql`${t.reference} is not null`),
  ],
);

/**
 * Receipts, as PayPal reports them.
 *
 * `PAYMENT.SALE.COMPLETED` carries the amount actually taken, which is not
 * always the plan price — PayPal applies any setup fee, discount or tax at
 * charge time — so the receipt records what left the customer's account
 * rather than what the price list says it should have been.
 */
export const paypalPayments = sqliteTable(
  "paypal_payments",
  {
    /** PayPal's sale/capture id. */
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    optionId: text("option_id"),
    /** The subscription this charge was raised against, when it was one. */
    subscriptionId: text("subscription_id"),
    /** Major units, as PayPal stated them. */
    amountUsd: text("amount_usd").notNull(),
    currency: text("currency").notNull().default("USD"),
    status: text("status").notNull(),
    paidAt: integer("paid_at", { mode: "timestamp_ms" }),
    /** True on sandbox credentials, so test payments never read as revenue. */
    sandbox: integer("sandbox", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(now),
  },
  (t) => [
    index("idx_paypal_payment_user").on(t.userId, t.paidAt),
    index("idx_paypal_payment_sub").on(t.subscriptionId),
  ],
);

/**
 * Webhook events already processed, so processing one twice is a no-op.
 *
 * Keyed on PayPal's own event id, which is a genuine per-delivery identifier —
 * the thing Paystack does not have, and the reason its events table has to
 * hash the body instead. PayPal retries a delivery it did not get a 2xx for,
 * with the same id, for up to three days.
 */
export const paypalEvents = sqliteTable(
  "paypal_events",
  {
    /** PayPal's `id` from the event envelope, e.g. "WH-6TR...". */
    id: text("id").primaryKey(),
    eventType: text("event_type").notNull(),
    /** The subscription or sale this concerned, when it had one. */
    resourceId: text("resource_id"),
    receivedAt: integer("received_at", { mode: "timestamp" }).notNull().default(now),
    /** Null when handled cleanly; the error text when it was not. */
    error: text("error"),
  },
  (t) => [index("idx_paypal_event_type").on(t.eventType, t.receivedAt)],
);
