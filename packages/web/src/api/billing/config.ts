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
 * `premium_lifetime` is absent on purpose and must stay absent. Every Paystack
 * Plan is recurring — the interval field has no "once" — so a lifetime
 * purchase is a plain transaction with an amount, handled by the one-off path.
 * Giving it a plan code would sell a subscription to something advertised as a
 * single payment.
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

/** True when this option is a recurring subscription rather than a one-off. */
export function isRecurring(option: BillingOption): boolean {
  return option.term !== "lifetime";
}

/**
 * Can this exact option be bought right now?
 *
 * A recurring option needs its plan code; a one-off needs only a key, because
 * its amount is sent with the transaction and there is nothing on Paystack's
 * side that has to exist first.
 */
export function optionSellable(option: BillingOption): boolean {
  if (!paystackSecretKey()) return false;
  return isRecurring(option) ? planCodeFor(option.id) !== null : true;
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
