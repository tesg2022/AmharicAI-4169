import { z } from "zod";
import { ORPCError } from "@orpc/server";
import { authed, withUser } from "../middleware/auth";
import { liveGrants, resolvePlan } from "../entitlements/resolve";
import { reconcileSubscriptions } from "../entitlements/supersede";
import {
  newPaypalReference,
  paypalBillingStatus,
  paypalBrandName,
  paypalCancelUrl,
  paypalOptionSellable,
  paypalPlanIdFor,
  paypalReturnUrl,
} from "../billing/paypal-config";
import {
  approvalUrl,
  cancelSubscription,
  createSubscription,
  money,
  PaypalError,
} from "../billing/paypal";
import { fulfilPaypalSubscription } from "../billing/paypal-fulfil";
import {
  attachSubscriptionId,
  manageablePaypalSubscriptions,
  paypalSubscriptionById,
  recordPaypalCheckout,
  setPaypalStatus,
} from "../billing/paypal-store";
import { BILLING_OPTIONS, PLANS, billingOptionById, formatUsd } from "../content/plans";

/**
 * The PayPal half of checkout. A sibling of `routes/billing.ts`, not a
 * replacement for it.
 *
 * The split is deliberate and it is a business decision, not a technical one:
 * Paystack takes cards and South African payment methods, PayPal takes PayPal
 * balances and international payments, and a learner in Addis with a PayPal
 * wallet and a learner in Johannesburg with a card should each get the
 * checkout that works for them. Both sell the same options and both grant
 * against the same account, so from the entitlement side there is one
 * subscriber with one plan — see `billing/grants.ts`, which is where the two
 * stop being separate.
 *
 * Three things differ from the Paystack routes, and all three come from
 * PayPal's flow rather than from preference:
 *
 * 1. PRICES ARE IN USD, AND THEY ARE REAL PRICES. `price_usd` is not a
 *    conversion of `price_zar` — it is a separately chosen retail price. So
 *    the absence of `price_usd` on an option is what says "not sold on
 *    PayPal", which is how Premium lifetime stays Paystack-only without a
 *    special case anywhere.
 * 2. THE SUBSCRIPTION EXISTS BEFORE THE MONEY DOES. `checkout` creates a real
 *    subscription in `APPROVAL_PENDING` and sends the customer to approve it.
 *    Nothing has been charged at that point, and nothing is granted until
 *    fulfilment reads `ACTIVE` back from PayPal.
 * 3. THERE IS NO RESUME. PayPal cancellation is immediate and irreversible —
 *    a cancelled subscription cannot be revived, only replaced by a new one.
 *    The Paystack `resume` route has no counterpart here on purpose, and the
 *    UI must not offer one for a PayPal holding.
 */

/** The PayPal view of one option: the USD price and whether it is sellable. */
function paypalOptionView(optionId: string) {
  const option = billingOptionById(optionId);
  if (!option) return null;
  return {
    id: option.id,
    plan: option.plan,
    term: option.term,
    label_en: option.label_en,
    price_usd: option.price_usd ?? null,
    price_label: option.price_usd === undefined ? null : formatUsd(option.price_usd),
    sellable: paypalOptionSellable(option),
  };
}

export const billingPaypal = {
  /** The deployment's PayPal health, for the pricing page and the admin screen. */
  status: withUser.handler(async () => paypalBillingStatus()),

  /**
   * Which options PayPal can sell, and at what price.
   *
   * Read by the pricing page to decide whether to draw a PayPal button beside
   * the Paystack one. An option missing from here gets no PayPal button and
   * the Paystack button alone — never a button that fails when pressed.
   */
  catalogue: withUser.handler(async () => {
    const status = paypalBillingStatus();
    return {
      billing_status: status,
      options: BILLING_OPTIONS.map((o) => paypalOptionView(o.id)).filter(
        (o): o is NonNullable<typeof o> => o !== null,
      ),
    };
  }),

  /**
   * Can this caller buy this option through PayPal, right now?
   *
   * Same contract as the Paystack preflight — every refusal comes back as
   * `ok: false` with a reason a person can act on, rather than as an error —
   * and for the same reason: under the old build the "this cannot be bought"
   * discovery happened AFTER the customer had decided to pay.
   */
  preflight: withUser
    .input(z.object({ option_id: z.string().min(1) }))
    .handler(async ({ context, input }) => {
      const option = billingOptionById(input.option_id);
      if (!option) {
        throw new ORPCError("BAD_REQUEST", {
          message: `Unknown billing option "${input.option_id}".`,
        });
      }

      const status = paypalBillingStatus();
      const view = paypalOptionView(option.id)!;

      if (!status.credentials_present || !status.webhook_configured) {
        return {
          ok: false as const,
          reason: "paypal_unconfigured" as const,
          message:
            status.blockers[0] ??
            "PayPal is not available in this deployment yet. The card checkout still works.",
          option: view,
        };
      }

      /**
       * Not sold on PayPal at all — no USD price — which today means Premium
       * lifetime. A one-off purchase needs PayPal's Orders API rather than the
       * Subscriptions API, so it is a genuinely different integration and is
       * not built. The customer is pointed at the checkout that does sell it
       * rather than told "no".
       */
      if (option.price_usd === undefined) {
        return {
          ok: false as const,
          reason: "not_sold_on_paypal" as const,
          message: `${option.label_en} is only available through the card checkout.`,
          option: view,
        };
      }

      if (!paypalOptionSellable(option)) {
        const tier = PLANS.find((p) => p.id === option.plan)?.name_en ?? option.plan;
        console.error(
          `[paypal] "${option.id}" has a USD price but no PayPal plan id configured. ` +
            `Run \`bun run packages/web/scripts/paypal-setup.ts\`.`,
        );
        return {
          ok: false as const,
          reason: "plan_unavailable" as const,
          message:
            `${tier} ${option.label_en} cannot be bought through PayPal right now: this ` +
            `deployment has no PayPal plan configured for it. Nothing has been charged, ` +
            `and the card checkout is unaffected.`,
          option: view,
        };
      }

      if (!context.user) {
        return {
          ok: false as const,
          reason: "sign_in_required" as const,
          message:
            "Create an account or sign in first — a subscription has to belong to somebody.",
          option: view,
        };
      }

      const resolved = await resolvePlan({ userId: context.user.id });
      /**
       * Checked against the MERGED grants, across both providers. A customer
       * already subscribed to Premium monthly through Paystack must not be
       * sold the identical thing again on PayPal — they would be charged
       * twice for one tier, and the supersession rules would not save them
       * because neither grant outranks the other.
       */
      const grants = await liveGrants(context.user.id);

      const identical = grants.find((g) => g.option_id === option.id && !g.cancel_pending);
      if (identical) {
        return {
          ok: false as const,
          reason: "already_subscribed" as const,
          message:
            identical.provider === "paypal"
              ? `You are already subscribed to ${option.label_en} through PayPal.`
              : `You are already subscribed to ${option.label_en} through the card checkout.`,
          option: view,
        };
      }

      if (grants.some((g) => g.plan === option.plan && g.term === "lifetime")) {
        const name = PLANS.find((p) => p.id === option.plan)?.name_en ?? option.plan;
        return {
          ok: false as const,
          reason: "already_subscribed" as const,
          message: `You already own ${name} for life. Subscribing would cost you money for nothing.`,
          option: view,
        };
      }

      return {
        ok: true as const,
        reason: "ready" as const,
        message: null,
        option: view,
        current_plan: resolved.plan,
        replaces_access_code: resolved.plan_source === "access_code",
      };
    }),

  /**
   * Creates a PayPal subscription and hands back the approval URL.
   *
   * Nothing is charged here and nothing is granted. What comes back is a
   * subscription in `APPROVAL_PENDING` plus the PayPal page to send the
   * customer to; approving it there is what raises the first charge.
   *
   * The local checkout row is written BEFORE PayPal is called, exactly as on
   * the Paystack side — so a PayPal outage leaves a `pending` row explaining
   * what was attempted rather than no trace at all. The subscription id is
   * attached to that row immediately afterwards, and that id is the primary
   * way every later webhook finds its way back to this user.
   */
  checkout: authed
    .input(z.object({ option_id: z.string().min(1) }))
    .handler(async ({ context, input }) => {
      const option = billingOptionById(input.option_id);
      if (!option) {
        throw new ORPCError("BAD_REQUEST", {
          message: `Unknown billing option "${input.option_id}".`,
        });
      }

      if (option.price_usd === undefined) {
        throw new ORPCError("BAD_REQUEST", {
          message: `${option.label_en} is not sold through PayPal. Nothing has been charged.`,
        });
      }

      const planId = paypalPlanIdFor(option.id);
      if (!planId || !paypalOptionSellable(option)) {
        throw new ORPCError("SERVICE_UNAVAILABLE", {
          message:
            `${option.label_en} cannot be bought through PayPal right now: this ` +
            `deployment has no PayPal plan configured for it. Nothing has been charged.`,
        });
      }

      const returnUrl = paypalReturnUrl();
      const cancelUrl = paypalCancelUrl();
      if (!returnUrl || !cancelUrl) {
        // Refused rather than opened. A subscription with nowhere to return to
        // gets approved and then strands the customer on a dead page, with no
        // way to tell them from here that it worked.
        throw new ORPCError("SERVICE_UNAVAILABLE", {
          message:
            "PayPal checkout is misconfigured in this deployment (no WEBSITE_URL), so it " +
            "has not been opened. Nothing has been charged.",
        });
      }

      const reference = newPaypalReference(context.user.id, option.id);

      try {
        await recordPaypalCheckout({
          reference,
          userId: context.user.id,
          optionId: option.id,
          plan: option.plan,
          term: option.term,
          planId,
          amountUsd: money(option.price_usd),
          subscriptionId: null,
        });

        const subscription = await createSubscription({
          planId,
          reference,
          email: context.user.email,
          name: context.user.name ?? undefined,
          returnUrl,
          cancelUrl,
          brandName: paypalBrandName(),
          /**
           * Keyed on our reference, which is generated once per attempt. So a
           * retried request — a double-tapped button, a network retry — is
           * idempotent at PayPal's end too and cannot create two
           * subscriptions for one intent.
           */
          requestId: `sub-${reference}`,
        });

        const approval = approvalUrl(subscription);
        if (!approval) {
          // A subscription with no approval link cannot be paid for, and
          // leaving it pending at PayPal would let it sit in the customer's
          // account as a phantom. Reported rather than returned half-working.
          console.error(
            `[paypal] subscription ${subscription.id} was created with no approval link.`,
          );
          throw new ORPCError("SERVICE_UNAVAILABLE", {
            message:
              "PayPal did not return a checkout link. Nothing has been charged — please " +
              "try again in a moment.",
          });
        }

        await attachSubscriptionId(reference, subscription.id);

        return {
          /** Send the browser here. */
          approval_url: approval,
          subscription_id: subscription.id,
          reference,
          option: paypalOptionView(option.id)!,
          /** What they will be charged, to show on the way out. */
          amount_label: formatUsd(option.price_usd),
          recurring: true,
          sandbox: paypalBillingStatus().sandbox,
        };
      } catch (error) {
        if (error instanceof ORPCError) throw error;
        if (error instanceof PaypalError && error.isAuthFailure) {
          // Our credentials, not the customer's problem — and saying "your
          // payment failed" would be both wrong and alarming.
          console.error("[paypal] checkout refused: credentials rejected", error);
          throw new ORPCError("SERVICE_UNAVAILABLE", {
            message:
              "PayPal checkout could not be opened because of a configuration problem on " +
              "our side. Nothing has been charged. The card checkout still works.",
          });
        }
        console.error("[paypal] subscription creation failed:", error);
        throw new ORPCError("SERVICE_UNAVAILABLE", {
          message:
            "PayPal checkout could not be opened just now. Nothing has been charged — " +
            "please try again in a moment.",
        });
      }
    }),

  /**
   * Reads one subscription back from PayPal and grants what it paid for. The
   * return leg.
   *
   * Called by `/billing/callback/paypal` with the `subscription_id` PayPal put
   * in the query string. The id is not trusted: fulfilment re-reads the
   * subscription from PayPal and attributes it through our own checkout row,
   * so a hand-typed or borrowed id cannot grant anything to the caller.
   *
   * Idempotent, and deliberately duplicated by the webhook. Either path alone
   * completes a purchase — the redirect covers the customer who waits, the
   * webhook covers the one who closes the tab.
   */
  verify: authed
    .input(z.object({ subscription_id: z.string().min(1).max(200) }))
    .handler(async ({ context, input }) => {
      try {
        const result = await fulfilPaypalSubscription(input.subscription_id);

        /**
         * The grant is only reported to THIS caller if it landed on this
         * caller's account. Fulfilment attributes from our own tables, so an
         * id belonging to somebody else is fulfilled correctly for them and
         * must not be echoed back here as a purchase — that would tell a
         * stranger what somebody else bought.
         */
        if (result.kind === "granted") {
          const row = await paypalSubscriptionById(input.subscription_id);
          if (row && row.userId !== context.user.id) {
            throw new ORPCError("NOT_FOUND", {
              message: "No such subscription on this account.",
            });
          }
          // Reconcile on the way out, so an older, lower subscription — on
          // either provider — is cancelled the moment this one lands rather
          // than on the next page they happen to open.
          await reconcileSubscriptions(context.user.id);
        }

        const resolved = await resolvePlan({ userId: context.user.id });
        return { result, current_plan: resolved.plan, expires_at: resolved.expires_at };
      } catch (error) {
        if (error instanceof ORPCError) throw error;
        console.error(`[paypal] verification of ${input.subscription_id} failed:`, error);
        // Never reported as "your payment failed" — it is not known to have.
        throw new ORPCError("SERVICE_UNAVAILABLE", {
          message:
            "We could not confirm this subscription with PayPal just now. If you were " +
            "charged, your access will appear automatically within a few minutes — the " +
            "payment is not lost.",
        });
      }
    }),

  /**
   * Cancels a PayPal subscription, keeping the period already paid for.
   *
   * PayPal cancellation is IMMEDIATE and has no end-of-cycle option, which is
   * the opposite of Paystack's `disable`. Preserving the paid period is
   * therefore this app's job, not PayPal's: the stored `until` is left exactly
   * as it is, and `CANCELLED` goes on entitling until that date passes.
   * Someone who cancels an annual subscription in month two keeps the other
   * ten months.
   *
   * There is no resume counterpart. PayPal cannot revive a cancelled
   * subscription, so the honest thing is to say so at the point of
   * cancellation rather than to offer a button that fails.
   */
  cancel: authed
    .input(z.object({ subscription_id: z.string().min(1) }))
    .handler(async ({ context, input }) => {
      const row = await paypalSubscriptionById(input.subscription_id);

      // Ownership is checked against our own table and never taken from the
      // request. A PayPal subscription id appears in PayPal's own emails, so
      // without this anyone holding one could cancel somebody's subscription.
      if (!row || row.userId !== context.user.id) {
        throw new ORPCError("NOT_FOUND", {
          message: "No such subscription on this account.",
        });
      }

      if (row.status === "CANCELLED" || row.status === "EXPIRED") {
        // Already done. Reported as success, because from the customer's side
        // it is: the thing they asked for is true.
        return {
          cancelled: true,
          already: true,
          until: row.until?.toISOString() ?? null,
          resumable: false,
        };
      }

      try {
        await cancelSubscription({
          subscriptionId: input.subscription_id,
          // Appears in PayPal's own cancellation email to the customer.
          reason: "Cancelled by the subscriber on AmharicAI",
        });
      } catch (error) {
        console.error(`[paypal] cancel failed for ${input.subscription_id}:`, error);
        throw new ORPCError("SERVICE_UNAVAILABLE", {
          message:
            "PayPal did not accept the cancellation just now. Nothing has changed — " +
            "please try again in a moment.",
        });
      }

      /**
       * Written locally at once rather than waiting for the
       * `BILLING.SUBSCRIPTION.CANCELLED` webhook: the customer is looking at
       * the screen now and needs to see it took effect. No date is passed, so
       * the paid period they are owed stays exactly where it was.
       */
      await setPaypalStatus(input.subscription_id, "CANCELLED");

      return {
        cancelled: true,
        already: false,
        /** Access runs to here. Not a renewal date any more. */
        until: row.until?.toISOString() ?? null,
        /** Always false: PayPal has no way back from this. */
        resumable: false,
      };
    }),

  /** PayPal subscriptions this caller can cancel, for the billing screen. */
  manageable: authed.handler(async ({ context }) => {
    const rows = await manageablePaypalSubscriptions(context.user.id);
    return rows.map((r) => {
      const option = billingOptionById(r.optionId);
      const tier = PLANS.find((p) => p.id === r.plan)?.name_en ?? r.plan;
      return {
        provider: "paypal" as const,
        subscription_id: r.subscriptionId,
        option_id: r.optionId,
        label_en: option ? `${tier} — ${option.label_en}` : tier,
        status: r.status,
        cancel_pending: r.status === "CANCELLED",
        payment_failed: r.status === "SUSPENDED",
        until: r.until?.toISOString() ?? null,
        /** Cancellable through the app; nothing here is ever resumable. */
        can_manage: true,
        can_resume: false,
        sandbox: r.sandbox,
      };
    });
  }),
};
