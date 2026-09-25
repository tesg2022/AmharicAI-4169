import { BILLING_OPTIONS, type BillingOption } from "../content/plans";
import { CURRENCY, isTestMode, paystackSecretKey } from "./paystack";

/**
 * What this deployment needs before it can take a payment, and how to say so
 * when it cannot.
 *
 * The Autumn build turned checkout on when a secret key was present, and that
 * was the whole bug: the key was set (or looked set), the plans had never been
 * pushed to the account it pointed at, and every customer who clicked Buy was
 * sent to a checkout page that answered "Product premium_monthly not found"
 * after they had already decided to pay. A key is necessary and nowhere near
 * sufficient.
 *
 * So readiness here is per-option, and the pricing page is allowed to sell
 * exactly the options whose plan code is configured — no more.
 */

/**
 * Recurring options map to a Paystack plan code, supplied per deployment.
 *
 * Codes live in the environment rather than in this repository because they
 * are account-specific: a `PLN_xxxx` created in test mode does not exist in
 * live mode, so the same build must be able to run against either without a
 * code change. `scripts/paystack-setup.ts` creates the plans and prints the
 * exact lines to paste.
 *
 * Every option is here, because every option is a subscription. There is no
 * one-off purchase to leave out: the withdrawn `premium_lifetime` was the only
 * one, and a missing entry now means a deployment that forgot to set a plan
 * code rather than a product sold a different way.
 */
const PLAN_CODE_ENV: Record<string, string> = {
  basic_monthly: "PAYSTACK_PLAN_BASIC_MONTHLY",
  premium_monthly: "PAYSTACK_PLAN_PREMIUM_MONTHLY",
  premium_annual: "PAYSTACK_PLAN_PREMIUM_ANNUAL",
};

/** The Paystack plan code for a recurring option, or null if not configured. */
export function planCodeFor(optionId: string): string | null {
  const envName = PLAN_CODE_ENV[optionId];
  if (!envName) return null;
  const code = process.env[envName]?.trim();
  return code ? code : null;
}

/**
 * True when this option is a recurring subscription.
 *
 * Every option is, now that the one-off lifetime purchase is withdrawn. Kept
 * as a function rather than inlined as `true` because the fulfilment and
 * entitlement paths branch on it, and those branches are what would have to
 * be found again if a non-recurring product is ever sold.
 */
export function isRecurring(_option: BillingOption): boolean {
  return true;
}

/**
 * Can this exact option be bought right now?
 *
 * It needs a secret key to reach Paystack at all, and a plan code, because a
 * subscription is created against a Plan that has to already exist on the
 * account.
 */
export function optionSellable(option: BillingOption): boolean {
  if (!paystackSecretKey()) return false;
  return planCodeFor(option.id) !== null;
}

/**
 * PAYSTACK IS OPEN TO NEW SUBSCRIPTIONS. It is the only provider that sells.
 *
 * This was briefly false. A dollar price list was built against PayPal, and
 * while it stood Paystack had to be closed to new sales, because this
 * account cannot charge dollars — probed against the live account, not
 * inferred from documentation: a USD `transaction/initialize` comes back
 * `"Currency not supported by merchant"` while the identical ZAR call
 * succeeds — so a checkout opened from a dollar page would have shown $4.99
 * and charged R89.
 *
 * The price list is rand again, which removes the contradiction at its
 * source: the amount shown is the amount charged, in the currency charged,
 * by the one provider that can charge it. So this is open.
 *
 * It is kept as a function rather than inlined because it is the single
 * switch that decides whether the business is taking new money, and that is
 * worth being able to find, read and flip in one place.
 *
 * What the round trip through dollars deliberately did NOT do, and still has
 * not done: it never touched the currency, the key, or the plan codes, and
 * it never cancelled, suspended or re-priced anything. Every existing
 * subscriber has been renewing at the price they agreed to throughout.
 */
export function paystackOpenToNewSales(): boolean {
  return true;
}

/**
 * Why a Paystack checkout was refused, for a customer, in one sentence.
 *
 * Reachable again only if `paystackOpenToNewSales()` is flipped back to
 * false. It says nothing about which provider or currency replaces it,
 * because nothing does: the honest message for a closed till is that the
 * till is closed and no money moved.
 */
export const PAYSTACK_CLOSED_MESSAGE =
  "Checkout is not open to new subscriptions at the moment. Nothing has been " +
  "charged, and existing subscriptions are unaffected.";

/**
 * Can this option be bought through Paystack right now? The gate every new
 * sale must pass — configuration AND the account still being open to sales.
 */
export function optionBuyable(option: BillingOption): boolean {
  return paystackOpenToNewSales() && optionSellable(option);
}

export interface BillingStatus {
  /** True when at least one option could actually be paid for. */
  configured: boolean;
  provider: "paystack";
  key_present: boolean;
  /** True on an `sk_test_` key: payments are simulated and take no money. */
  test_mode: boolean;
  currency: string;
  /** Option ids that can be bought in this deployment. */
  sellable_option_ids: string[];
  /** Everything still missing, in the deployment operator's own terms. */
  blockers: string[];
}

export function billingStatus(): BillingStatus {
  const keyPresent = Boolean(paystackSecretKey());
  const blockers: string[] = [];

  if (!keyPresent) {
    blockers.push(
      "No PAYSTACK_SECRET_KEY is set in this deployment, so checkout cannot be opened. " +
        "Everything already paid for or granted by an access code keeps working.",
    );
  }

  const sellable = BILLING_OPTIONS.filter(optionSellable);

  if (keyPresent) {
    for (const [optionId, envName] of Object.entries(PLAN_CODE_ENV)) {
      if (planCodeFor(optionId)) continue;
      blockers.push(
        `${optionId} cannot be sold: no ${envName} is set. Run ` +
          `\`bun run packages/web/scripts/paystack-setup.ts\` to create the plan on ` +
          `Paystack and print the code to set.`,
      );
    }
  }

  if (!process.env["WEBSITE_URL"]?.trim()) {
    blockers.push(
      "No WEBSITE_URL is set, so Paystack has nowhere to send the customer back to " +
        "after paying. Checkout would complete and then land on a dead page.",
    );
  }

  return {
    configured: keyPresent && sellable.length > 0,
    provider: "paystack",
    key_present: keyPresent,
    test_mode: isTestMode(),
    currency: CURRENCY,
    sellable_option_ids: sellable.map((o) => o.id),
    blockers,
  };
}

/** Convenience for callers that only need the yes/no. */
export function billingConfigured(): boolean {
  return billingStatus().configured;
}

/**
 * Where Paystack returns the customer after payment.
 *
 * A real page, not an API route: it reads the `reference` out of the query
 * string and asks the server to verify it. Paystack appends `?trxref=..&
 * reference=..` to whatever is given here.
 */
export function checkoutCallbackUrl(): string | undefined {
  const base = process.env["WEBSITE_URL"]?.trim();
  return base ? `${base.replace(/\/$/, "")}/billing/callback` : undefined;
}

/**
 * The reference for one checkout attempt.
 *
 * Ours rather than Paystack's, so the payment can be tied to a user and an
 * option before the customer leaves the site — which is what makes an
 * abandoned checkout distinguishable from a checkout that was never started.
 * Prefixed so a reference is recognisable in Paystack's dashboard, and
 * carries the option id for the same reason.
 */
export function newReference(userId: string, optionId: string): string {
  const random = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  // Paystack accepts alphanumerics plus -.=, so the user id is hashed down to
  // something short and safe rather than embedded raw.
  const shortUser = userId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 8);
  return `amh-${optionId}-${shortUser}-${random}`;
}
