import { useMutation, useQuery } from "@tanstack/react-query";
import { orpc } from "@/lib/api";

/**
 * The PayPal half of the pricing surface, on mobile.
 *
 * A sibling of `queries/billing.ts` rather than an addition to it, matching
 * the website's split. The two providers charge different amounts in different
 * currencies through different APIs, and the only thing they share is the
 * entitlement they produce — which is read from `billing.*` either way. Fold
 * them into one file and the next person assumes one price.
 *
 * What differs from Paystack here, and shapes every hook below:
 *
 *   - The price is in US DOLLARS, already formatted by the server. Basic is
 *     US$5.99 a month, not a conversion of R89. A screen that prints the rand
 *     figure beside a PayPal button is quoting a price nobody is charged.
 *   - Lifetime is not sold. It has no `price_usd`, so it never comes back
 *     sellable and no PayPal button may appear on it.
 *   - The identifier is PayPal's `subscription_id`, not a reference this app
 *     issued. It exists before any money moves, and holding it is not a
 *     purchase — see `useVerifyPaypalSubscription`.
 */
export function usePaypalCatalogue() {
  return useQuery({
    ...orpc.billingPaypal.catalogue.queryOptions({ input: {} }),
    // Same reasoning as the Paystack catalogue: short enough that a finished
    // checkout shows up, long enough that a price list is not re-fetched on
    // every render.
    staleTime: 15_000,
  });
}

/**
 * Can this account buy this option through PayPal, right now?
 *
 * Asked immediately before `checkout`, and it grants nothing. It refuses what
 * cannot work — PayPal unconfigured, no plan id for the option, lifetime, a
 * plan already held — so the refusal is explained on this screen instead of on
 * PayPal's approval page.
 */
export function usePaypalPreflight() {
  return useMutation(orpc.billingPaypal.preflight.mutationOptions());
}

/**
 * Creates the subscription at PayPal, server-side, and hands back the URL the
 * customer approves it at.
 *
 * Worth being precise about, because it differs from Paystack in a way that
 * matters: by the time this resolves, a real subscription exists at PayPal in
 * `APPROVAL_PENDING`. Nothing has been charged and nothing is granted — but
 * an abandoned approval leaves that record behind, which is why fulfilment
 * requires reading `ACTIVE` back from PayPal rather than trusting the return.
 */
export function usePaypalCheckout() {
  return useMutation(orpc.billingPaypal.checkout.mutationOptions());
}

/**
 * Did the approval actually complete?
 *
 * Takes PayPal's subscription id and re-reads it from PayPal server-side. A
 * `pending` answer is the NORMAL case immediately after the redirect — PayPal
 * commonly still says `APPROVAL_PENDING` or `APPROVED` for a few seconds, and
 * the webhook lands shortly after — so `pending` must never be shown as a
 * failure. Only `ACTIVE` grants anything, and only the server can see it.
 */
export function useVerifyPaypalSubscription() {
  return useMutation(orpc.billingPaypal.verify.mutationOptions());
}

/**
 * The PayPal subscriptions on this account that can still be acted on.
 *
 * Every row comes back with `can_resume: false`, because PayPal cancellation
 * is immediate and irreversible. Any screen offering a resume button for one
 * of these is offering something that cannot happen.
 */
export function usePaypalManageable(enabled: boolean) {
  return useQuery({
    ...orpc.billingPaypal.manageable.queryOptions({ input: {} }),
    enabled,
  });
}

/** Cancels a PayPal subscription. Immediate, irreversible, no resume. */
export function useCancelPaypalSubscription() {
  return useMutation(orpc.billingPaypal.cancel.mutationOptions());
}
