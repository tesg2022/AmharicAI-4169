import { Hono } from "hono";
import { anyProviderConfigured, liveGrants } from "../../billing/grants";
import { billingStatus } from "../../billing/config";
import {
  BILLING_OPTIONS,
  PLANS,
  entitlements,
  formatApproxUsd,
  formatZar,
  quotasFor,
  tutorAllowanceLabel,
} from "../../content/plans";
import { METERS } from "../../database/schema";
import { resolvePlan } from "../../entitlements/resolve";
import { peek } from "../../entitlements/usage";
import { ok } from "../http";
import { guard } from "../middleware";

/**
 * `/v1/subscriptions` — what the caller is entitled to, and what it cost.
 *
 * Read-only, on purpose. Taking money is a redirect-and-return dance with
 * Paystack or PayPal: a hosted page the customer has to see, a callback URL, a
 * webhook that is the actual source of truth. None of that survives being
 * reduced to a JSON POST, and an endpoint that pretended otherwise would be a
 * way to create half-finished payments. Checkout, cancel and resume stay on the
 * oRPC procedures the first-party clients drive, where the redirect has a
 * browser to land in.
 *
 * What this surface is for is the other half: an integration that needs to know
 * whether an account may use a paid feature before it calls one, and a support
 * or admin view that needs to say why a learner's access looks the way it does.
 *
 * The plan is always resolved server-side from grants — never read from the key
 * or a header — so these routes report entitlement rather than confer it.
 */

export const subscriptionRoutes = new Hono();

/**
 * The caller's entitlement, holdings and any payment warning.
 *
 * `plan_is_verified` is the field an integration should branch on rather than
 * `plan` alone: an unverified plan is a default, and treating it as a purchase
 * is how a free account gets handed paid features.
 */
subscriptionRoutes.get("/", async (c) => {
  const caller = guard(c, { identity: "user", scope: "subscriptions:read" });
  const userId = caller.userId!;

  const [resolved, grants] = await Promise.all([
    resolvePlan({ userId }),
    liveGrants(userId),
  ]);

  return ok(c, {
    plan: resolved.plan,
    plan_is_verified: resolved.plan_is_verified,
    plan_source: resolved.plan_source,
    expires_at: resolved.expires_at,
    /**
     * A failed renewal. Access continues to `expires_at` because that period
     * was paid for, so this is a warning to surface, not a demotion to act on.
     */
    payment_notice: resolved.payment_notice,
    /** An access-code grant that has run out and was not replaced. */
    expired_notice: resolved.expired_notice,
    has_subscription: grants.some((g) => g.recurring),
    /**
     * One entry per live purchase or subscription. `provider` is included for
     * support and for the cancel path to know which API owns it — feature
     * gating must not branch on it, since a PayPal Premium subscriber and a
     * Paystack one are the same kind of Premium subscriber.
     */
    holdings: grants.map((g) => ({
      provider: g.provider,
      option_id: g.option_id,
      plan: g.plan,
      term: g.term,
      until: g.until === null ? null : new Date(g.until).toISOString(),
      recurring: g.recurring,
      cancel_pending: g.cancel_pending,
      payment_failed: g.payment_failed,
      provider_status: g.status,
    })),
    quotas: quotasFor(resolved.plan),
    /**
     * Per-feature state for this plan — granted, usable, and why not when it
     * is not. Only the feature list, not the whole catalogue: a client asking
     * "what may this account do" does not need the price list in the same
     * response, and `GET /v1/subscriptions/plans` is there when it does.
     */
    features: entitlements(resolved.plan, {
      source: resolved.plan_source,
      verified: resolved.plan_is_verified,
    }).features,
  });
});

/**
 * The plan catalogue. Anonymous callers are allowed — this is a price list, and
 * an API that will not show prices until you have an account is no use to
 * anyone building a pricing page.
 */
subscriptionRoutes.get("/plans", (c) => {
  const caller = guard(c, { scope: "subscriptions:read" });
  const status = billingStatus();

  return ok(c, {
    current_plan: caller.plan,
    current_plan_is_verified: caller.planVerified,
    currency: status.currency,
    /**
     * Stated plainly rather than implied: when this is false, this deployment
     * has no payment provider configured and nothing here can be bought.
     */
    checkout_available: status.configured && anyProviderConfigured(),
    plans: PLANS.map((p) => ({
      id: p.id,
      name_en: p.name_en,
      name_am: p.name_am,
      price_zar_month: p.price_zar_month,
      price_label: formatZar(p.price_zar_month),
      price_approx_usd_label: formatApproxUsd(p.price_zar_month),
      max_units: p.max_units,
      quotas: p.quotas,
      tutor_allowance_label: tutorAllowanceLabel(p.id),
      tagline_en: p.tagline_en,
      tagline_am: p.tagline_am,
    })),
    /** Purchasable terms — monthly, annual, lifetime — keyed by option id. */
    billing_options: BILLING_OPTIONS.map((o) => ({
      id: o.id,
      plan: o.plan,
      term: o.term,
      price_zar: o.price_zar,
      price_label: formatZar(o.price_zar),
      price_approx_usd_label: formatApproxUsd(o.price_zar),
    })),
    /**
     * Where a purchase actually happens. Spelled out so an integrator does not
     * spend an afternoon looking for a checkout endpoint that does not exist.
     */
    checkout: {
      supported_here: false,
      reason:
        "Checkout is a hosted redirect flow and runs through the app, not this API. Send the customer to the app's pricing page.",
    },
  });
});

/**
 * Every meter at once, without spending any of it.
 *
 * One call rather than one per feature, because the question a client actually
 * has before it starts a session is "what can this account still do today",
 * and three round trips to answer it is three chances to answer it half-way.
 */
subscriptionRoutes.get("/usage", async (c) => {
  const caller = guard(c, { identity: "user", scope: "subscriptions:read" });
  const meters = await Promise.all(
    METERS.map((meter) => peek(caller.subject, caller.plan, meter)),
  );
  return ok(c, { plan: caller.plan, meters });
});
