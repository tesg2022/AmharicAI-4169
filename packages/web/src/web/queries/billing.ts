import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { orpc } from "../lib/api";

/**
 * The client side of billing, against Paystack.
 *
 * This file used to be mostly defensive plumbing around `autumn-js`: three
 * separate outcome parsers existed because Autumn's client resolved its
 * failures instead of throwing them, so a refused checkout came back as a
 * successful promise carrying an error object, over an HTTP 200, with a
 * TypeScript signature that promised otherwise. A failed purchase was a
 * button that did nothing.
 *
 * None of that is needed now. Checkout is an oRPC procedure on our own
 * server: a refusal is an ORPCError, react-query puts it in `error`, and the
 * screen can show the message the server wrote. So the parsers are gone
 * rather than ported — there is nothing left that lies about its result.
 *
 * The other change is who drives checkout. Autumn's `attach()` ran in the
 * browser and the server never knew a purchase had been attempted. Here the
 * browser asks the server to open a payment page, the server writes the
 * attempt down first, and the browser only carries out the redirect.
 */

/**
 * The price list, for anyone — signed in or not.
 *
 * The only place prices are read from on any surface, so a price cannot be
 * edited on one screen and go stale on another. Anonymous callers get
 * `current_plan: "free"` rather than an error.
 */
export function useCatalogue() {
  return useQuery({
    ...orpc.billing.catalogue.queryOptions({ input: {} }),
    // Short, not zero: a completed checkout or an admin grant must appear
    // quickly, but the price list itself changes about once a year.
    staleTime: 15_000,
  });
}

/**
 * Asked immediately before `checkout`. Grants nothing and charges nothing —
 * it answers whether opening a payment page for this option makes sense right
 * now, so an unconfigured deployment or an already-held plan is explained
 * before the customer is sent to Paystack rather than after.
 */
export function usePreflight() {
  return useMutation(orpc.billing.preflight.mutationOptions());
}

/**
 * Opens a Paystack payment page and returns its URL.
 *
 * The redirect is left to the caller rather than done here: the button that
 * started it needs to stay in its busy state until the browser actually
 * leaves, and a hook that navigates as a side effect makes that impossible to
 * get right.
 */
export function useCheckout() {
  return useMutation(orpc.billing.checkout.mutationOptions());
}

/**
 * Confirms one reference and grants what it paid for. The return leg, called
 * by /billing/callback.
 *
 * Safe to call twice — the server verifies against Paystack and fulfils
 * idempotently — which matters because the webhook is racing this for the
 * same payment and usually wins.
 */
export function useVerifyPayment() {
  return useMutation(orpc.billing.verify.mutationOptions());
}

/**
 * The billing account: live holdings, renewal dates and receipts.
 *
 * Read from our own tables now, so unlike the Autumn version this costs no
 * third-party call and cannot report "unreachable" for a signed-in user. Only
 * asked for when signed in — a visitor has no billing account to show.
 */
export function useBillingAccount(enabled: boolean) {
  return useQuery({
    ...orpc.billing.account.queryOptions({ input: {} }),
    enabled,
    // A cancellation must be visible on the next render, not in 15 seconds.
    staleTime: 0,
  });
}

/** Subscriptions this account can cancel or resume. */
export function useManageableSubscriptions(enabled: boolean) {
  return useQuery({
    ...orpc.billing.manageable.queryOptions({ input: {} }),
    enabled,
    staleTime: 0,
  });
}

/**
 * Cancels whatever the account has outgrown, and says what it stopped.
 *
 * Nobody should pay R89 a month for something they already bought outright,
 * and Paystack will happily keep charging both. Called when the subscription
 * page opens rather than from a checkout callback, because a redirect
 * checkout returns as a fresh page load and never reaches the code that
 * started it. Grants nothing; safe to repeat.
 */
export function useReconcile() {
  return useMutation(orpc.billing.reconcile.mutationOptions());
}

/**
 * Stops a subscription renewing at the end of the period already paid for.
 *
 * Paystack's disable is end-of-cycle by construction: the subscription goes
 * to `non-renewing`, keeps working until its payment date and is not charged
 * again. Nothing is refunded and no paid-for time is taken away, so the UI
 * must present this as "stops on <date>", never as "access ends now".
 */
export function useCancelSubscription() {
  return useMutation(orpc.billing.cancel.mutationOptions());
}

/** Puts a not-yet-effective cancellation back on renewal. */
export function useResumeSubscription() {
  return useMutation(orpc.billing.resume.mutationOptions());
}

/**
 * A Paystack-hosted page for changing the card on one subscription.
 *
 * NOT a billing portal, and must never be labelled as one. It changes a
 * payment method and does nothing else — no invoices, no cancellation, no
 * plan changes. Paystack has no hosted portal that does those things, which
 * is why cancel and resume are our own routes above.
 */
export function useCardUpdateLink() {
  return useMutation(orpc.billing.cardUpdateLink.mutationOptions());
}

/**
 * Everything whose answer depends on the plan. Called after a checkout
 * returns, because the new entitlement lives on the server and no client-side
 * optimism is allowed to pretend it arrived.
 */
export function useRefreshEntitlements() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: orpc.billing.key() });
    queryClient.invalidateQueries({ queryKey: orpc.access.key() });
    queryClient.invalidateQueries({ queryKey: orpc.catalog.key() });
    queryClient.invalidateQueries({ queryKey: orpc.content.key() });
    queryClient.invalidateQueries({ queryKey: orpc.account.key() });
  };
}
