import { useMutation, useQuery } from "@tanstack/react-query";
import { orpc } from "../lib/api";

/**
 * The client side of PayPal checkout. A sibling of `queries/billing.ts`, which
 * stays exactly as it is and keeps serving Paystack.
 *
 * Two providers are offered side by side rather than one being chosen for the
 * customer: Paystack takes cards and South African payment methods, PayPal
 * takes PayPal balances and international payments, and only the person paying
 * knows which of those they actually have. Both land on the same account, so
 * whichever they press, the plan that comes back is the same plan.
 *
 * Every hook here is separate from its Paystack counterpart on purpose. A
 * shared "provider" parameter would put the two flows in one code path, and
 * they do not behave alike: PayPal creates the subscription before it is paid
 * for, hands back an approval URL instead of a transaction reference, and its
 * cancellation is immediate and irreversible. Merging them would mean the UI
 * having to re-discover which it was talking to at every branch.
 */

/**
 * What PayPal can sell, and at what USD price.
 *
 * Read alongside `useCatalogue`, not instead of it. Its `sellable` flag is per
 * option, which is what keeps Premium lifetime (Paystack-only, because it
 * needs PayPal's Orders API rather than Subscriptions) from taking the other
 * options off sale with it — and what stops a PayPal button being drawn on
 * something pressing it could not buy.
 *
 * Never gated on being signed in: a visitor comparing prices should see that
 * PayPal is an option before being asked to make an account.
 */
export function usePaypalCatalogue() {
  return useQuery({
    ...orpc.billingPaypal.catalogue.queryOptions({ input: {} }),
    // Same short window as the Paystack catalogue: prices change about once a
    // year, but an option going on or off sale should show up promptly.
    staleTime: 15_000,
  });
}

/**
 * Asked immediately before `checkout`. Charges nothing and grants nothing.
 *
 * It checks the MERGED entitlements across both providers, which is the point:
 * someone already paying for Premium monthly through Paystack must be told so
 * before PayPal charges them for the identical thing a second time.
 */
export function usePaypalPreflight() {
  return useMutation(orpc.billingPaypal.preflight.mutationOptions());
}

/**
 * Creates a real PayPal subscription and returns the approval URL to send the
 * browser to.
 *
 * Nothing has been charged when this resolves. Unlike Paystack — where the
 * subscription only exists once a payment succeeds — a PayPal subscription is
 * created first, in `APPROVAL_PENDING`, and approving it on PayPal's page is
 * what raises the first charge. So a customer who abandons the approval page
 * leaves a real, unpaid subscription behind, and nothing may be granted for it.
 *
 * The redirect is the caller's job, so the button can stay busy until the
 * browser actually leaves.
 */
export function usePaypalCheckout() {
  return useMutation(orpc.billingPaypal.checkout.mutationOptions());
}

/**
 * Confirms one subscription id and grants what it paid for. The return leg,
 * called by /billing/callback/paypal.
 *
 * The id in the redirect is not evidence of anything — the server re-reads the
 * subscription from PayPal and attributes it through our own checkout row
 * before granting. Safe to call twice: the webhook is racing this for the same
 * subscription and usually wins.
 */
export function useVerifyPaypalSubscription() {
  return useMutation(orpc.billingPaypal.verify.mutationOptions());
}

/** PayPal subscriptions this account can cancel. */
export function usePaypalManageable(enabled: boolean) {
  return useQuery({
    ...orpc.billingPaypal.manageable.queryOptions({ input: {} }),
    enabled,
    // A cancellation has to be visible on the next render, not in 15 seconds.
    staleTime: 0,
  });
}

/**
 * Cancels a PayPal subscription immediately at PayPal, and keeps the period
 * already paid for on our side.
 *
 * The difference from `useCancelSubscription` is not cosmetic and the UI must
 * not describe the two the same way. Paystack's disable is end-of-cycle, so
 * "stops renewing" is the whole story. PayPal has no end-of-cycle option: the
 * subscription is cancelled the moment this returns, cannot be resumed, and
 * the remaining paid time is honoured by this app rather than by PayPal. Hence
 * there is no resume hook here — there is nothing on PayPal's side to resume.
 */
export function useCancelPaypalSubscription() {
  return useMutation(orpc.billingPaypal.cancel.mutationOptions());
}
