import { z } from "zod";
import { ORPCError } from "@orpc/server";
import { authed, withUser } from "../middleware/auth";
import {
  billingStatus,
  liveGrants,
  paypalBillingStatus,
  paypalConfigured,
  resolvePlan,
} from "../entitlements/resolve";
import { paypalPaymentsFor } from "../billing/paypal-store";
import { reconcileSubscriptions } from "../entitlements/supersede";
import {
  PAYSTACK_CLOSED_MESSAGE,
  checkoutCallbackUrl,
  newReference,
  optionBuyable,
  paystackOpenToNewSales,
  planCodeFor,
} from "../billing/config";
import {
  CURRENCY,
  PaystackError,
  disableSubscription,
  enableSubscription,
  formatMajor,
  fromSubunit,
  initializeTransaction,
  isTestMode,
  subscriptionManagementLink,
  toSubunit,
} from "../billing/paystack";
import { isSandbox } from "../billing/paypal";
import { fulfilReference } from "../billing/fulfil";
import {
  ensureCustomer,
  manageableSubscriptions,
  paymentsFor,
  recordCheckout,
  setSubscriptionStatus,
  subscriptionByCode,
  type LiveGrant,
} from "../billing/store";
import {
  BILLING_OPTIONS,
  DISPLAY_CURRENCY,
  FREE_PLAN,
  PLANS,
  billingOptionById,
  billingOptionsFor,
  entryPrice,
  formatZar,
  isRetiredOption,
  tutorAllowanceLabel,
  type BillingOption,
  type PlanId,
} from "../content/plans";

/**
 * One receipt row, whichever provider raised it.
 *
 * Declared as the union of the two view builders rather than hand-written, so
 * adding a field to one and forgetting the other is a type error here instead
 * of a missing column in the client.
 */
type InvoiceView = ReturnType<typeof invoiceView> | ReturnType<typeof paypalInvoiceView>;

/**
 * The pricing surface and the whole server side of checkout.
 *
 * This changed shape completely when billing moved from Autumn to Paystack,
 * and the change is the point. Autumn's flow was client-side: `attach()` in
 * the browser talked to Autumn through a Better Auth plugin, so the server
 * had no say in what was being bought and no record that a purchase had even
 * been attempted — which is why an abandoned checkout and a checkout that was
 * never started looked identical, and why a paid customer could resolve to
 * Free with nothing in any log to explain it.
 *
 * Paystack's flow is server-initiated, and everything hangs off that:
 *
 *   1. `checkout` writes the attempt down locally FIRST, with the user, the
 *      option and the amount, then asks Paystack for a payment page.
 *   2. The customer pays and Paystack returns them to /billing/callback with
 *      the reference we chose.
 *   3. `verify` re-asks Paystack what happened to that reference and grants
 *      only on a verified success — never on the redirect having occurred.
 *   4. The webhook does the same thing independently, so a customer who
 *      closes the tab before the redirect still gets what they paid for.
 *
 * There is still no procedure that grants a plan without a payment. That hole
 * is what the rest of the entitlement code exists to close.
 */

/**
 * The customer-facing price: rand, and only rand.
 *
 * One number per option, and it is the number Paystack charges. A dollar
 * price list was tried here and is parked on the `usd-paypal-pricing` branch;
 * so was an indicative "≈$X" beside the rand figure, and both are gone for
 * the same reason. A second figure for the same plan is a figure some
 * customer reads as the price, and this account can only ever take rand.
 *
 * `sellable` is per-option rather than a single deployment-wide flag, so a
 * missing plan code for the annual option cannot take the monthly one off
 * sale with it.
 */
function optionView(o: BillingOption) {
  return {
    id: o.id,
    plan: o.plan,
    term: o.term,
    /** The charged amount, in rand, for one whole term. */
    price_zar: o.price_zar,
    /** What the customer is actually charged. This is the price. */
    price_label: formatZar(o.price_zar),
    label_en: o.label_en,
    label_am: o.label_am,
    note_en: o.note_en ?? null,
    /**
     * Whether THIS option can be bought in this deployment: the price list
     * knows about it, Paystack has a plan code for it, and checkout is open.
     */
    sellable: optionBuyable(o),
  };
}

function planView(plan: (typeof PLANS)[number]) {
  const entry = entryPrice(plan.id);
  return {
    ...plan,
    tutor_allowance_label: tutorAllowanceLabel(plan.id),
    /** "from R89" — the cheapest way into the tier, in the charged currency. */
    entry_price_zar: entry?.price_zar ?? 0,
    entry_price_label: formatZar(entry?.price_zar ?? 0),
    billing_options: billingOptionsFor(plan.id).map(optionView),
  };
}

export const billing = {
  /**
   * Everything a pricing page needs in one call, for anyone — signed in or
   * not. Anonymous callers get the catalogue with `current_plan: "free"`.
   */
  catalogue: withUser.handler(async ({ context }) => {
    const status = billingStatus();
    const resolved = await resolvePlan({ userId: context.user?.id ?? null });

    /**
     * Which options they are actually paying for, not just which tier they
     * are on. Without this the pricing card cannot tell "you already bought
     * this" from "you are on this tier by another route", and a Premium
     * monthly subscriber is shown "your current plan" over the annual
     * option too — locked out of the upgrade they came to make.
     */
    const held = context.user ? await liveGrants(context.user.id) : [];
    const heldOptionIds = held.filter((g) => !g.cancel_pending).map((g) => g.option_id);

    return {
      current_plan: resolved.plan,
      current_plan_is_verified: resolved.plan_is_verified,
      plan_source: resolved.plan_source,
      expires_at: resolved.expires_at,
      /** A failed renewal, so the pricing page can say so too. */
      payment_notice: resolved.payment_notice,
      /** Billing option ids the caller is currently paying for or owns. */
      held_option_ids: heldOptionIds,
      signed_in: Boolean(context.user),
      free: planView(FREE_PLAN),
      plans: PLANS.map(planView),
      billing_options: BILLING_OPTIONS.map(optionView),
      /**
       * The currency every price above is quoted in, which is also the
       * currency Paystack charges. One field, because there is one currency:
       * the price list and the provider agree by construction.
       */
      currency: DISPLAY_CURRENCY,
      /**
       * Stated plainly rather than hidden: when this is false the buttons
       * should explain that checkout is unavailable in this deployment, not
       * silently do nothing when tapped.
       */
      checkout_available: status.configured && paystackOpenToNewSales(),
      billing_status: status,
    };
  }),

  /**
   * Called immediately before `checkout`.
   *
   * It grants nothing and charges nothing. It answers whether opening checkout
   * for this option makes sense right now, so the failure — an unconfigured
   * deployment, an unknown id, a plan the caller already pays for — is
   * explained here rather than on a payment page they have already committed
   * to.
   */
  preflight: withUser
    .input(z.object({ option_id: z.string().min(1) }))
    .handler(async ({ context, input }) => {
      const option = billingOptionById(input.option_id);
      if (!option) {
        /**
         * A withdrawn id gets its own message. `premium_lifetime` is gone from
         * the price list but the string still reaches here — from a pricing tab
         * left open since before it was withdrawn, from an old mobile build,
         * from someone replaying the call by hand — and "unknown billing
         * option" reads as a bug on our side to a person who is looking
         * straight at the plan on their screen.
         */
        throw new ORPCError("BAD_REQUEST", {
          message: isRetiredOption(input.option_id)
            ? "That plan is no longer sold, so it cannot be bought and nothing has been " +
              "charged. The monthly and annual subscriptions are the current plans."
            : `Unknown billing option "${input.option_id}".`,
        });
      }

      const status = billingStatus();
      const view = optionView(option);

      /**
       * Checked before everything else, because it is not a fault and the
       * other refusals all read as one. `paystackOpenToNewSales()` is true in
       * this deployment — checkout is open — but the gate stays in the path
       * rather than being deleted, so that closing sales again is one boolean
       * and not a re-plumbing of every refusal message.
       */
      if (!paystackOpenToNewSales()) {
        return {
          ok: false as const,
          reason: "checkout_closed" as const,
          message: PAYSTACK_CLOSED_MESSAGE,
          option: view,
        };
      }

      if (!status.key_present) {
        return {
          ok: false as const,
          reason: "billing_unconfigured" as const,
          message: status.blockers[0] ?? "Checkout is not available in this deployment yet.",
          option: view,
        };
      }

      /**
       * Does this option exist where the money is?
       *
       * The id came from BILLING_OPTIONS, which proves only that this
       * repository knows about it. A recurring option also needs a Paystack
       * plan created on the account this deployment's key points at, and the
       * two drift silently: a plan code valid in test mode does not exist in
       * live mode. Under Autumn the equivalent failure landed *after* the
       * customer had decided to pay, as "Product premium_monthly not found".
       *
       * Checked from configuration rather than by calling Paystack, so a slow
       * or unreachable API cannot refuse a purchase that would have worked.
       */
      if (!optionBuyable(option)) {
        const tier = PLANS.find((p) => p.id === option.plan)?.name_en ?? option.plan;
        console.error(
          `[billing] "${option.id}" is on the pricing page but has no Paystack plan code ` +
            `configured. Run \`bun packages/web/scripts/paystack-setup.ts\`.`,
        );
        return {
          ok: false as const,
          reason: "plan_unavailable" as const,
          message:
            `${tier} ${option.label_en} cannot be bought right now: this deployment has ` +
            `no Paystack plan configured for it. That is a configuration problem on our ` +
            `side, not with your account, and nothing has been charged. The other plans ` +
            `are unaffected.`,
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
      const grants = await liveGrants(context.user.id);

      // Only this exact option is refused — not the whole tier.
      //
      // Refusing on tier alone blocked the upgrade most worth making: a
      // Premium monthly subscriber could not move to annual, because the
      // server told them they were "already subscribed to Premium". Paying
      // monthly is not the same purchase as paying for a year.
      //
      // Someone already on this tier via an access code may still subscribe;
      // that is their call, and the grant simply stops mattering.
      const identical = grants.find((g) => g.option_id === option.id && !g.cancel_pending);
      if (identical) {
        return {
          ok: false as const,
          reason: "already_subscribed" as const,
          message: `You are already subscribed to ${option.label_en}.`,
          option: view,
        };
      }

      return {
        ok: true as const,
        reason: "ready" as const,
        message: null,
        option: view,
        current_plan: resolved.plan as PlanId,
        replaces_access_code: resolved.plan_source === "access_code",
      };
    }),

  /**
   * Opens a Paystack payment page for one option and hands back its URL.
   *
   * Signed-in only, and not merely for tidiness: the reference written here is
   * what ties the payment to an account, and a payment that cannot be
   * attributed is money taken for access nobody receives.
   *
   * The local checkout row is written BEFORE Paystack is called. If Paystack
   * then fails, there is a `pending` row explaining what was attempted; if the
   * customer walks away from the payment page, that row is what makes it an
   * abandoned checkout rather than nothing at all.
   */
  checkout: authed
    .input(z.object({ option_id: z.string().min(1) }))
    .handler(async ({ context, input }) => {
      const option = billingOptionById(input.option_id);
      if (!option) {
        /**
         * A withdrawn id gets its own message. `premium_lifetime` is gone from
         * the price list but the string still reaches here — from a pricing tab
         * left open since before it was withdrawn, from an old mobile build,
         * from someone replaying the call by hand — and "unknown billing
         * option" reads as a bug on our side to a person who is looking
         * straight at the plan on their screen.
         */
        throw new ORPCError("BAD_REQUEST", {
          message: isRetiredOption(input.option_id)
            ? "That plan is no longer sold, so it cannot be bought and nothing has been " +
              "charged. The monthly and annual subscriptions are the current plans."
            : `Unknown billing option "${input.option_id}".`,
        });
      }

      /**
       * The gate on opening checkout at all, kept ahead of every other check
       * for the same reason it exists: if sales are ever closed again, the
       * refusal has to happen before any row is written and before Paystack
       * is called, so nothing is charged and nothing is left half-done. It is
       * open in this deployment, so this passes.
       */
      if (!paystackOpenToNewSales()) {
        throw new ORPCError("SERVICE_UNAVAILABLE", { message: PAYSTACK_CLOSED_MESSAGE });
      }

      if (!optionBuyable(option)) {
        throw new ORPCError("SERVICE_UNAVAILABLE", {
          message:
            `${option.label_en} cannot be bought right now: this deployment has no ` +
            `Paystack plan configured for it. Nothing has been charged.`,
        });
      }

      const callbackUrl = checkoutCallbackUrl();
      if (!callbackUrl) {
        // Refused rather than opened. A checkout with nowhere to return to
        // takes the money and then strands the customer on a dead page, and
        // there is no way to tell them from here that it worked.
        throw new ORPCError("SERVICE_UNAVAILABLE", {
          message:
            "Checkout is misconfigured in this deployment (no WEBSITE_URL), so it has " +
            "not been opened. Nothing has been charged.",
        });
      }

      // Every option sold is a subscription, so every checkout carries a plan
      // code. `optionBuyable` above has already refused the option if this
      // deployment has no code configured for it.
      const planCode = planCodeFor(option.id);

      /**
       * The amount to charge: the option's own rand price, which is the same
       * figure the price page rendered and the same figure `fulfil.ts` checks
       * the completed payment against. There is no conversion step and no
       * second currency to pick the wrong one of.
       */
      const amountZar = option.price_zar;
      const reference = newReference(context.user.id, option.id);

      try {
        await ensureCustomer({
          id: context.user.id,
          email: context.user.email,
          name: context.user.name,
        });

        await recordCheckout({
          reference,
          userId: context.user.id,
          optionId: option.id,
          plan: option.plan,
          term: option.term,
          amountSubunit: toSubunit(amountZar),
          currency: CURRENCY,
          planCode,
        });

        const initialized = await initializeTransaction({
          email: context.user.email,
          amountMajor: amountZar,
          // Always present: attaching the plan is what makes Paystack treat
          // the charge as a subscription and renew it, rather than taking one
          // payment and stopping.
          plan: planCode ?? undefined,
          currency: CURRENCY,
          reference,
          callback_url: callbackUrl,
          /**
           * Carried so a renewal transaction — which has no local checkout row,
           * because nobody clicked anything — can still be attributed. Paystack
           * copies a subscription's original metadata onto its renewals.
           */
          metadata: {
            app_user_id: context.user.id,
            option_id: option.id,
            plan: option.plan,
            term: option.term,
          },
        });

        return {
          /** Send the browser here. */
          authorization_url: initialized.authorization_url,
          reference: initialized.reference,
          option: optionView(option),
          /** What they will be charged, to show on the way out. */
          amount_label: formatZar(amountZar),
          /** Always true — every plan sold renews. */
          recurring: true,
        };
      } catch (error) {
        if (error instanceof PaystackError && error.isIpBlocked) {
          // Named explicitly because the message Paystack returns ("Your IP
          // address is not allowed to make this call") is about OUR server,
          // not the customer, and reads as an accusation if passed through.
          console.error("[paystack] checkout refused: server IP not allowlisted", error);
          throw new ORPCError("SERVICE_UNAVAILABLE", {
            message:
              "Checkout could not be opened because of a payment-gateway configuration " +
              "problem on our side. Nothing has been charged. Please try again shortly.",
          });
        }
        console.error("[paystack] checkout initialization failed:", error);
        throw new ORPCError("SERVICE_UNAVAILABLE", {
          message:
            "Checkout could not be opened just now. Nothing has been charged — please " +
            "try again in a moment.",
        });
      }
    }),

  /**
   * Verifies one reference and grants what it paid for. The return leg.
   *
   * Called by /billing/callback with whatever Paystack put in the query
   * string. It verifies against Paystack rather than trusting the redirect:
   * the URL is fully under the customer's control, so a hand-typed reference
   * must not be able to grant anything.
   *
   * Idempotent, and deliberately duplicated by the webhook. Either path alone
   * completes a purchase — the redirect covers the customer who waits, the
   * webhook covers the one who closes the tab.
   */
  verify: authed
    .input(z.object({ reference: z.string().min(1).max(200) }))
    .handler(async ({ context, input }) => {
      try {
        const result = await fulfilReference(input.reference);

        // Reconcile on the way out, so an upgrader's superseded subscription
        // is cancelled the moment their purchase lands rather than on the next
        // page they happen to open.
        if (result.kind === "granted") {
          await reconcileSubscriptions(context.user.id);
        }

        const resolved = await resolvePlan({ userId: context.user.id });
        return { result, current_plan: resolved.plan, expires_at: resolved.expires_at };
      } catch (error) {
        console.error(`[paystack] verification of ${input.reference} failed:`, error);
        // Never reported as "your payment failed" — it is not known to have.
        throw new ORPCError("SERVICE_UNAVAILABLE", {
          message:
            "We could not confirm this payment with the payment gateway just now. If you " +
            "were charged, your access will appear automatically within a few minutes — " +
            "the payment is not lost.",
        });
      }
    }),

  /**
   * Cancels subscriptions the caller has outgrown, and reports what it did.
   *
   * Nobody is going to be charged R89 a month for Basic while they are also
   * paying for Premium, so the client calls this whenever the subscription
   * page opens: that covers the same-tab purchase and the return leg of a
   * redirect checkout without needing a callback to have fired.
   *
   * It is idempotent and grants nothing — the worst a repeat call can do is
   * confirm a cancellation that already happened.
   */
  reconcile: withUser.handler(async ({ context }) => {
    if (!context.user) return { superseded: [] };
    const superseded = await reconcileSubscriptions(context.user.id);
    return {
      // The label comes from the catalogue, so the screen can name what it
      // stopped ("Basic — R89 / month") instead of printing an id at someone.
      superseded: superseded.map((s) => {
        const option = billingOptionById(s.option_id);
        const name = PLANS.find((p) => p.id === s.plan)?.name_en ?? s.plan;
        return {
          ...s,
          label_en: option ? `${name} ${option.label_en}` : s.option_id,
        };
      }),
    };
  }),

  /**
   * The billing account: what the caller is paying for, and their receipts.
   *
   * Read from local tables, not from Paystack. Two reasons, and the second is
   * the one that matters: Paystack has no invoice-history endpoint that maps
   * onto a customer's receipts the way Stripe's does, and reading entitlement
   * from a third party on every page load is what made an API blip look like
   * a cancelled subscription under the old build.
   *
   * `reachable` is kept in the response shape for the clients that read it,
   * and is now always true when signed in: the data is ours, so there is
   * nothing to be unreachable.
   */
  account: withUser.handler(async ({ context }) => {
    const status = billingStatus();
    const empty = {
      signed_in: Boolean(context.user),
      reachable: false,
      /** True when there is a live recurring subscription to manage. */
      has_subscription: false,
      holdings: [] as ReturnType<typeof holdingView>[],
      invoices: [] as InvoiceView[],
      billing_status: status,
    };

    if (!context.user) return empty;

    // Both providers, read in parallel. `liveGrants` already merges the two
    // subscription tables; the receipts have to be merged here, in the one
    // route that shows them, for the same reason: one customer, one history.
    const [grants, payments, paypalPayments] = await Promise.all([
      liveGrants(context.user.id),
      paymentsFor(context.user.id),
      paypalConfigured() ? paypalPaymentsFor(context.user.id) : Promise.resolve([]),
    ]);

    /**
     * Successful charges only. A failed attempt is not a receipt, and listing
     * one next to real payments makes a customer think they were charged
     * twice. Each provider names success differently — Paystack "success",
     * PayPal "COMPLETED" — so the filter is per provider rather than shared.
     *
     * Refunds and reversals are kept: money that came back is part of the
     * history a customer is owed a view of, and `status` carries which it is.
     *
     * Rows raised on test credentials are dropped once the same provider is
     * running on live ones. They took no money, so on a live deployment they
     * are not receipts at all — they are leftovers from the cutover, and a
     * customer cannot reconcile them against a bank statement that has
     * nothing on it. They are hidden rather than relabelled, and the stored
     * row keeps its `testMode` flag either way: the amounts must never be
     * counted as revenue, and rewriting the flag to make the list read
     * cleanly would do exactly that.
     *
     * The test is per provider, not global. Paystack can be live while PayPal
     * is still on sandbox credentials or the reverse, and each provider's own
     * rows are judged by its own mode. On a test deployment nothing is hidden
     * — that is where test payments are the only payments, and a preview with
     * an empty receipts list would hide the very thing being tested.
     */
    const hidePaystackTestRows = !isTestMode();
    const hidePaypalSandboxRows = !isSandbox();

    const invoices: InvoiceView[] = [
      ...payments
        .filter((p) => p.status === "success")
        .filter((p) => !(hidePaystackTestRows && p.testMode))
        .map(invoiceView),
      ...paypalPayments
        .filter((p) => p.status !== "failed")
        .filter((p) => !(hidePaypalSandboxRows && p.sandbox))
        .map(paypalInvoiceView),
    ].sort((a, b) => b.created_at.localeCompare(a.created_at));

    return {
      signed_in: true,
      reachable: true,
      has_subscription: grants.some((g) => g.recurring),
      holdings: grants.map(holdingView),
      invoices,
      billing_status: status,
      /**
       * Whether PayPal is configured at all, so the account page can decide
       * whether a PayPal-held subscription is manageable here or only a
       * historical record.
       */
      paypal_status: paypalBillingStatus(),
    };
  }),

  /**
   * Stops a subscription renewing, at the end of the period already paid for.
   *
   * Paystack's disable endpoint is end-of-cycle by construction: the
   * subscription goes to `non-renewing`, stays live until the payment date,
   * and is not charged again. Nothing is refunded and no paid-for time is
   * taken back, which is why `non-renewing` still entitles.
   *
   * This exists as a server route because Paystack has no hosted portal that
   * can cancel — the management link it does offer changes the card and
   * nothing else. The Autumn build delegated this to `openCustomerPortal()`;
   * there is no equivalent to delegate to, so the app owns it.
   */
  cancel: authed
    .input(z.object({ subscription_code: z.string().min(1) }))
    .handler(async ({ context, input }) => {
      const row = await subscriptionByCode(input.subscription_code);

      // Ownership is checked against our own table and never taken from the
      // request. A subscription code is not a secret — it appears in Paystack's
      // emails — so without this anyone could cancel anyone's subscription.
      if (!row || row.userId !== context.user.id) {
        throw new ORPCError("NOT_FOUND", {
          message: "No such subscription on this account.",
        });
      }
      if (!row.emailToken) {
        throw new ORPCError("SERVICE_UNAVAILABLE", {
          message:
            "This subscription cannot be cancelled automatically. Email support and it " +
            "will be stopped by hand — you will not be charged again.",
        });
      }
      if (row.status === "non-renewing") {
        // Already done. Reported as success, because from the customer's side
        // it is: the thing they asked for is true.
        return { cancelled: true, already: true, until: row.until?.toISOString() ?? null };
      }

      try {
        await disableSubscription({ code: row.subscriptionCode!, token: row.emailToken });
      } catch (error) {
        console.error(`[paystack] cancel failed for ${input.subscription_code}:`, error);
        throw new ORPCError("SERVICE_UNAVAILABLE", {
          message:
            "The payment gateway did not accept the cancellation just now. Nothing has " +
            "changed — please try again in a moment.",
        });
      }

      // Written locally at once, rather than waiting for the
      // `subscription.not_renew` webhook: the customer is looking at the
      // screen now and needs to see it took effect. The webhook writes the
      // same status a moment later and the write is idempotent.
      await setSubscriptionStatus(row.subscriptionCode!, "non-renewing");

      return {
        cancelled: true,
        already: false,
        /** Access runs to here. Not a renewal date any more. */
        until: row.until?.toISOString() ?? null,
      };
    }),

  /** Puts a not-yet-effective cancellation back on renewal. */
  resume: authed
    .input(z.object({ subscription_code: z.string().min(1) }))
    .handler(async ({ context, input }) => {
      const row = await subscriptionByCode(input.subscription_code);
      if (!row || row.userId !== context.user.id) {
        throw new ORPCError("NOT_FOUND", {
          message: "No such subscription on this account.",
        });
      }
      if (!row.emailToken) {
        throw new ORPCError("SERVICE_UNAVAILABLE", {
          message:
            "This subscription cannot be resumed automatically. Email support and it " +
            "will be restored by hand.",
        });
      }
      if (row.status === "active") {
        return { resumed: true, already: true };
      }
      if (row.status === "cancelled" || row.status === "completed") {
        // Past the point of no return: Paystack cannot re-enable a
        // subscription whose cycle has already closed, and pretending
        // otherwise would leave them thinking they still had access.
        throw new ORPCError("BAD_REQUEST", {
          message:
            "This subscription has already ended and cannot be resumed. Subscribing " +
            "again starts a fresh one.",
        });
      }

      try {
        await enableSubscription({ code: row.subscriptionCode!, token: row.emailToken });
      } catch (error) {
        console.error(`[paystack] resume failed for ${input.subscription_code}:`, error);
        throw new ORPCError("SERVICE_UNAVAILABLE", {
          message:
            "The payment gateway did not accept that just now. Nothing has changed — " +
            "please try again in a moment.",
        });
      }

      await setSubscriptionStatus(row.subscriptionCode!, "active");
      return { resumed: true, already: false };
    }),

  /**
   * A Paystack-hosted page for changing the card on one subscription.
   *
   * Explicitly NOT a billing portal, and must not be labelled as one in the
   * UI. It updates a payment method and does nothing else: no invoices, no
   * cancellation, no plan changes. The old "Open billing portal" button
   * promised all three.
   */
  cardUpdateLink: authed
    .input(z.object({ subscription_code: z.string().min(1) }))
    .handler(async ({ context, input }) => {
      const row = await subscriptionByCode(input.subscription_code);
      if (!row || row.userId !== context.user.id) {
        throw new ORPCError("NOT_FOUND", {
          message: "No such subscription on this account.",
        });
      }
      try {
        const { link } = await subscriptionManagementLink(row.subscriptionCode!);
        return { link };
      } catch (error) {
        console.error(`[paystack] card link failed for ${input.subscription_code}:`, error);
        throw new ORPCError("SERVICE_UNAVAILABLE", {
          message: "That link could not be generated just now. Please try again shortly.",
        });
      }
    }),

  /** Subscriptions this caller can cancel or resume, for the billing screen. */
  manageable: authed.handler(async ({ context }) => {
    const rows = await manageableSubscriptions(context.user.id);
    return rows
      .filter((r) => r.subscriptionCode)
      .map((r) => {
        const option = billingOptionById(r.optionId);
        const tier = PLANS.find((p) => p.id === r.plan)?.name_en ?? r.plan;
        return {
          subscription_code: r.subscriptionCode!,
          option_id: r.optionId,
          label_en: option ? `${tier} — ${option.label_en}` : tier,
          status: r.status,
          cancel_pending: r.status === "non-renewing",
          payment_failed: r.status === "attention",
          until: r.until?.toISOString() ?? null,
          // No email token, ever. It can cancel the subscription, and the
          // browser has no use for it.
          can_manage: Boolean(r.emailToken),
        };
      });
  }),

  /** The deployment's billing health on its own, for the admin screen. */
  status: withUser.handler(async () => billingStatus()),
};

/** One thing the customer is paying for, named the way the price list names it. */
function holdingView(grant: LiveGrant) {
  const option = billingOptionById(grant.option_id);
  const tier = PLANS.find((p) => p.id === grant.plan)?.name_en ?? grant.plan;
  /**
   * The price this holding is billed at, in the currency it is billed in —
   * one currency, so this is simply the option's rand price. Null only when
   * the holding names an option the price list no longer has, which is a
   * state to show honestly as unknown rather than to guess at.
   */
  const priceLabel = option ? formatZar(option.price_zar) : null;
  return {
    option_id: grant.option_id,
    /**
     * Which provider holds this subscription, and therefore which cancel
     * procedure can end it: `billing.cancel` takes a Paystack subscription
     * code, `billingPaypal.cancel` takes a PayPal subscription id, and
     * neither recognises the other's identifier. The UI must branch on this.
     */
    provider: grant.provider,
    subscription_code: grant.subscription_code,
    plan: grant.plan,
    term: grant.term,
    /**
     * "Premium — R179 / month". Built from `priceLabel` rather than printed
     * from `option.label_en`, so the term suffix is derived once and the
     * amount shown is always the amount charged.
     */
    label_en: option
      ? `${tier} — ${
          priceLabel
            ? `${priceLabel} / ${option.term === "annual" ? "year" : "month"}`
            : option.label_en
        }`
      : tier,
    price_label: priceLabel,
    recurring: grant.recurring,
    cancel_pending: grant.cancel_pending,
    /**
     * The last renewal charge failed and Paystack will retry on the next
     * payment date. Access continues until then. The UI has to say this —
     * it is the only warning the customer gets before they lose access.
     */
    payment_failed: grant.payment_failed,
    status: grant.status,
    /**
     * The next renewal for a live subscription, and the last day of access for
     * one that is cancelling. The UI must read `cancel_pending` to know which
     * of the two this date means.
     */
    until: grant.until ? new Date(grant.until).toISOString() : null,
  };
}

/** One receipt, from our own payments table. */
function invoiceView(payment: {
  reference: string;
  optionId: string | null;
  amountSubunit: number;
  currency: string;
  status: string;
  paidAt: Date | null;
  createdAt: Date;
  testMode: boolean;
}) {
  const option = billingOptionById(payment.optionId);
  const tier = option ? PLANS.find((p) => p.id === option.plan)?.name_en : null;
  return {
    id: payment.reference,
    provider: "paystack" as const,
    status: payment.status,
    /**
     * Formatted from subunits, which is what Paystack stores and what this
     * table therefore holds. Rendering a subunit amount as a major one is how
     * R179 gets printed as R1.79, so the conversion lives in one helper
     * rather than at each call site.
     */
    total_label: formatMajor(
      fromSubunit(payment.amountSubunit, payment.currency),
      payment.currency,
    ),
    created_at: (payment.paidAt ?? payment.createdAt).toISOString(),
    /**
     * What it paid for — the tier and the term, not the price. The amount is
     * already on the row in `total_label`, and printing the list price beside
     * it invites the two to disagree the first time a price changes.
     */
    label_en: option && tier ? `${tier} (${option.term})` : (payment.optionId ?? "Payment"),
    /**
     * Shown on the row. A test-mode payment took no money, and a receipt that
     * does not say so is one a customer will try to reconcile against a bank
     * statement that has nothing on it.
     */
    test_mode: payment.testMode,
    /** Paystack issues no hosted receipt page, so there is nothing to link to. */
    url: null as string | null,
  };
}

/**
 * One PayPal receipt, in the same shape as a Paystack one.
 *
 * Same shape on purpose: the account page shows the customer a single history,
 * because it is a single history — one person, one subscription record, paid
 * through whichever provider suited them. A client that had to render two
 * differently-shaped receipt lists would drift into showing two sections, and
 * a customer who once paid by card and later by PayPal would have to work out
 * which of two tables their charge is in.
 *
 * The amounts come from different places, which is why the formatting is not
 * shared: Paystack states subunits (17900 cents) and PayPal states major units
 * as a decimal string ("11.99").
 */
function paypalInvoiceView(payment: {
  id: string;
  optionId: string | null;
  amountUsd: string;
  currency: string;
  status: string;
  paidAt: Date | null;
  createdAt: Date;
  sandbox: boolean;
}) {
  const option = billingOptionById(payment.optionId);
  const tier = option ? PLANS.find((p) => p.id === option.plan)?.name_en : null;
  const amount = Number(payment.amountUsd);
  return {
    /** PayPal's sale id — the reference a customer can quote to PayPal. */
    id: payment.id,
    provider: "paypal" as const,
    status: payment.status,
    total_label: Number.isFinite(amount)
      ? formatMajor(amount, payment.currency)
      : `${payment.amountUsd} ${payment.currency}`,
    created_at: (payment.paidAt ?? payment.createdAt).toISOString(),
    label_en: option && tier ? `${tier} (${option.term})` : (payment.optionId ?? "Payment"),
    /** Sandbox credentials took no money, exactly as Paystack test mode did. */
    test_mode: payment.sandbox,
    /**
     * PayPal does host a receipt per transaction, but only inside the payer's
     * own logged-in account and not at a URL we can construct, so there is
     * still nothing to link to.
     */
    url: null as string | null,
  };
}
