import { BILLING_OPTIONS, type BillingOption } from "../content/plans";
import {
  PAYPAL_CURRENCY,
  isSandbox,
  paypalCredentialsPresent,
  paypalEnv,
  paypalProductId,
  paypalWebhookId,
} from "./paypal";

/**
 * What this deployment needs before it can take a PayPal payment, and how to
 * say so when it cannot.
 *
 * Mirrors `config.ts` for Paystack, and for the same hard-won reason: a
 * credential being present is necessary and nowhere near sufficient. A PayPal
 * client id with no plans created against the account it belongs to produces a
 * checkout that fails with `INVALID_RESOURCE_ID` after the customer has
 * already decided to pay. So readiness is per-option here too, and the UI is
 * allowed to offer PayPal on exactly the options whose plan id is configured.
 *
 * One PayPal-specific blocker that Paystack does not have: the webhook id.
 * Without it, signatures cannot be verified, so every renewal, failure and
 * cancellation is rejected at the door — the subscription would activate and
 * then never update again. That is worth refusing checkout over, because a
 * subscription this app cannot keep current is worse than one it never sold.
 */

/**
 * Recurring options map to a PayPal billing plan id, supplied per deployment.
 *
 * In the environment rather than this repository because plan ids are
 * account- and environment-specific: a `P-xxxx` created in sandbox does not
 * exist in live, so the same build has to run against either without a code
 * change. `scripts/paypal-setup.ts` creates the plans and prints the exact
 * lines to paste.
 *
 * `premium_lifetime` is absent and must stay absent. A lifetime purchase is a
 * single payment, and PayPal's Subscriptions API — the only PayPal API this
 * integration speaks — cannot express one; it would need the Orders API. A
 * plan id here would sell a recurring subscription to something advertised as
 * one payment, which is the worse of the two possible bugs.
 */
const PLAN_ID_ENV: Record<string, string> = {
  basic_monthly: "PAYPAL_PLAN_BASIC_MONTHLY",
  premium_monthly: "PAYPAL_PLAN_PREMIUM_MONTHLY",
  premium_annual: "PAYPAL_PLAN_PREMIUM_ANNUAL",
};

/** The PayPal plan id for a recurring option, or null if not configured. */
export function paypalPlanIdFor(optionId: string): string | null {
  const envName = PLAN_ID_ENV[optionId];
  if (!envName) return null;
  const id = process.env[envName]?.trim();
  return id ? id : null;
}

/** The option a PayPal plan id belongs to, for attributing a webhook. */
export function optionIdForPaypalPlan(planId: string): string | null {
  for (const optionId of Object.keys(PLAN_ID_ENV)) {
    if (paypalPlanIdFor(optionId) === planId) return optionId;
  }
  return null;
}

/**
 * Can this exact option be bought through PayPal right now?
 *
 * Three conditions, all of them load-bearing:
 *
 *   - a USD price, which is also the flag that says "sold on PayPal at all"
 *   - credentials, or there is no API to call
 *   - a plan id, or the subscription cannot be created
 *
 * The webhook id is checked at the deployment level rather than per option:
 * it is not per-plan, and its absence blocks everything equally.
 */
export function paypalOptionSellable(option: BillingOption): boolean {
  if (option.price_usd === undefined) return false;
  if (!paypalCredentialsPresent()) return false;
  if (!paypalWebhookId()) return false;
  return paypalPlanIdFor(option.id) !== null;
}

/** Every option PayPal can currently sell. */
export function paypalSellableOptions(): BillingOption[] {
  return BILLING_OPTIONS.filter(paypalOptionSellable);
}

export interface PaypalBillingStatus {
  /** True when at least one option could actually be paid for with PayPal. */
  configured: boolean;
  provider: "paypal";
  credentials_present: boolean;
  webhook_configured: boolean;
  /** True on sandbox credentials: approvals take no real money. */
  sandbox: boolean;
  environment: "sandbox" | "live";
  currency: string;
  /** Option ids that can be bought through PayPal in this deployment. */
  sellable_option_ids: string[];
  /** Everything still missing, in the deployment operator's own terms. */
  blockers: string[];
}

export function paypalBillingStatus(): PaypalBillingStatus {
  const credentials = paypalCredentialsPresent();
  const webhook = Boolean(paypalWebhookId());
  const blockers: string[] = [];

  if (!credentials) {
    blockers.push(
      "No PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET is set in this deployment, so PayPal " +
        "checkout cannot be opened. Paystack is unaffected, and everything already paid " +
        "for keeps working.",
    );
  }

  if (credentials && !webhook) {
    blockers.push(
      "No PAYPAL_WEBHOOK_ID is set, so PayPal webhooks cannot be verified and are " +
        "rejected. Without them a PayPal subscription would activate and then never " +
        "update again — renewals, failed payments and cancellations would all be " +
        "invisible. PayPal checkout stays closed until this is set.",
    );
  }

  if (credentials && !paypalProductId()) {
    blockers.push(
      "No PAYPAL_PRODUCT_ID is set. Nothing breaks at checkout — the plan ids are what " +
        "checkout uses — but `scripts/paypal-setup.ts` needs it to create or match plans.",
    );
  }

  if (credentials && webhook) {
    for (const [optionId, envName] of Object.entries(PLAN_ID_ENV)) {
      if (paypalPlanIdFor(optionId)) continue;
      blockers.push(
        `${optionId} cannot be sold through PayPal: no ${envName} is set. Run ` +
          `\`bun run packages/web/scripts/paypal-setup.ts\` to create the plan on ` +
          `PayPal and print the id to set.`,
      );
    }
  }

  if (!process.env["WEBSITE_URL"]?.trim()) {
    blockers.push(
      "No WEBSITE_URL is set, so PayPal has nowhere to return the customer to after " +
        "they approve. The subscription would be created and then land on a dead page.",
    );
  }

  const sellable = paypalSellableOptions();

  return {
    configured: credentials && webhook && sellable.length > 0,
    provider: "paypal",
    credentials_present: credentials,
    webhook_configured: webhook,
    sandbox: isSandbox(),
    environment: paypalEnv(),
    currency: PAYPAL_CURRENCY,
    sellable_option_ids: sellable.map((o) => o.id),
    blockers,
  };
}

/** Convenience for callers that only need the yes/no. */
export function paypalConfigured(): boolean {
  return paypalBillingStatus().configured;
}

/**
 * Where PayPal returns the customer after they approve.
 *
 * Its own page, separate from Paystack's `/billing/callback`, because what
 * comes back is different in kind: PayPal appends
 * `?subscription_id=I-xxxx&ba_token=..&token=..`, not a transaction reference,
 * and the subscription it names may still be a second away from active. The
 * Paystack callback verifies a payment; this one polls a subscription. One
 * page doing both would have to guess which flow it was in from the query
 * string.
 */
export function paypalReturnUrl(): string | undefined {
  const base = process.env["WEBSITE_URL"]?.trim();
  return base ? `${base.replace(/\/$/, "")}/billing/callback/paypal` : undefined;
}

/**
 * Where PayPal sends a customer who backs out on PayPal's own page.
 *
 * Back to the subscription screen with a marker, so it can say "nothing was
 * charged" rather than leaving them on a page that looks like a failure.
 */
export function paypalCancelUrl(): string | undefined {
  const base = process.env["WEBSITE_URL"]?.trim();
  return base ? `${base.replace(/\/$/, "")}/subscription?paypal=cancelled` : undefined;
}

/** The brand name shown on PayPal's approval page. */
export function paypalBrandName(): string {
  return "AmharicAI";
}

/**
 * The reference for one PayPal checkout attempt.
 *
 * Ours, not PayPal's, and passed through as `custom_id` so it survives the
 * round trip and comes back on every webhook about the subscription. Prefixed
 * `pp-` so a PayPal reference is never mistaken for a Paystack one in a log,
 * a dashboard or a support conversation — the two live in different tables and
 * a reference that could belong to either is a debugging trap.
 *
 * PayPal allows 127 characters for `custom_id`; this stays well inside it.
 */
export function newPaypalReference(userId: string, optionId: string): string {
  const random = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  const shortUser = userId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 8);
  return `pp-${optionId}-${shortUser}-${random}`;
}
