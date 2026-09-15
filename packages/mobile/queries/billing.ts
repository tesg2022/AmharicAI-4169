import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { orpc } from "@/lib/api";

/**
 * The pricing surface on mobile.
 *
 * Deliberately the same procedures the website calls, for the same reason:
 * `billing.catalogue` is the only place a price is read from, so a price
 * cannot be corrected on the website and left stale in the app. The older
 * mobile screens read `catalog.me`'s monthly-only figure, which knows nothing
 * about annual or lifetime terms — including for Lifetime, which has no
 * monthly figure.
 *
 * Prices arrive already formatted, in South African rand, with an approximate
 * dollar figure alongside. The app never formats money itself: Paystack
 * charges ZAR, and a screen that quietly printed a dollar sign in front of a
 * rand amount would misstate the price by roughly a factor of eighteen.
 *
 * `billing.preflight` is asked immediately before `billing.checkout`. It
 * grants nothing; it says whether opening checkout for this option makes
 * sense, so an unconfigured deployment, a signed-out tap or an option already
 * held is explained here rather than on a payment page that fails.
 */
export function useCatalogue() {
  return useQuery({
    ...orpc.billing.catalogue.queryOptions({ input: {} }),
    // Short, not zero: a completed checkout has to show up quickly, but the
    // price list itself changes about once a year.
    staleTime: 15_000,
  });
}

export function usePreflight() {
  return useMutation(orpc.billing.preflight.mutationOptions());
}

/**
 * Opens a Paystack checkout, server-side.
 *
 * The server creates the transaction and hands back an `authorization_url`;
 * the app's only job is to open it. Nothing about the payment is decided here
 * — no amount, no plan code, no customer id — because the app is the one part
 * of this system a determined user can rewrite.
 */
export function useCheckout() {
  return useMutation(orpc.billing.checkout.mutationOptions());
}

/**
 * Cancels whatever the account has outgrown, and says what it stopped.
 *
 * A lifetime purchase can land on top of a live monthly subscription of the
 * same tier, and Paystack will happily keep charging both — it has no concept
 * of one product superseding another — so the server closes the loser.
 * Called when a billing screen opens rather than from a checkout callback,
 * because checkout on a phone happens in a browser this app does not control:
 * the only reliable moment to ask is when the learner is back. Grants
 * nothing, safe to repeat.
 */
export function useReconcile() {
  return useMutation(orpc.billing.reconcile.mutationOptions());
}

/**
 * Did the payment actually happen?
 *
 * Asked of the server on the way back from the payment browser, with the
 * reference the server itself issued. The app cannot know the answer: the
 * browser it opened is outside its process, the redirect it may see is
 * whatever the customer's browser was told to send, and a "success" page can
 * be loaded by hand. So this is the only thing that turns a payment into a
 * plan, and it re-verifies against Paystack before it says yes.
 */
export function useVerifyPayment() {
  return useMutation(orpc.billing.verify.mutationOptions());
}

/**
 * Everything whose answer depends on the plan. Called after checkout returns,
 * because the new entitlement lives on the server and no client-side optimism
 * is allowed to pretend it arrived.
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
