import { useCallback, useEffect, useRef, useState } from "react";
import { openCheckout } from "@/lib/checkout";
import {
  useCheckout,
  usePreflight,
  useReconcile,
  useRefreshEntitlements,
  useVerifyPayment,
} from "@/queries/billing";
import { useSession } from "@/hooks/use-session";

/**
 * The purchase flow, in one place, for every screen that sells something.
 *
 * Pricing and Your-plan both offer the same options, so they run the same
 * sequence rather than two drifting copies of it:
 *
 *   preflight → billing.checkout → open the page → billing.verify → reconcile
 *
 * Each step exists because of a specific way this went wrong:
 *
 *   - preflight, because a refusal explained on the server ("you already own
 *     Premium for life") is worth more than a payment page that fails.
 *   - billing.checkout, because the server creates the transaction. The old
 *     flow had a billing SDK in the app calling the provider directly, which
 *     meant the client chose the plan it was charged for and every refusal
 *     came back as a *resolved* object that looked exactly like a success.
 *     Now a refusal is a thrown error, which is what a refusal is.
 *   - billing.verify, because closing the payment browser tells this app
 *     nothing at all. Paid, abandoned and back-gestured all look identical
 *     from here, so the reference goes to the server and Paystack is asked.
 *   - reconcile, because a lifetime purchase can land on top of a live monthly
 *     subscription for the same tier and Paystack will keep charging both.
 *   - refresh, because the entitlement lives on the server. Nothing here
 *     grants a plan locally, ever.
 */
export function useBuyPlan() {
  const { isSignedIn } = useSession();
  const preflight = usePreflight();
  const checkout = useCheckout();
  const verify = useVerifyPayment();
  const reconcile = useReconcile();
  const refreshEntitlements = useRefreshEntitlements();

  /** The option currently being taken to checkout, so only its button spins. */
  const [buying, setBuying] = useState<string | null>(null);
  const [error, setError] = useState<{ message: string; blockers: string[] } | null>(null);
  /** Subscriptions this visit stopped, so the screen can say so out loud. */
  const [stopped, setStopped] = useState<string[]>([]);

  const preflightMutate = preflight.mutateAsync;
  const checkoutMutate = checkout.mutateAsync;
  const verifyMutate = verify.mutateAsync;
  const reconcileMutate = reconcile.mutateAsync;

  /**
   * Ask the server to close anything outgrown, and report what it closed.
   * Swallows its own failures: a cleanup that fails must never break the
   * screen somebody has just paid on. The next visit tries again.
   */
  const reconcileNow = useCallback(async () => {
    try {
      const result = await reconcileMutate({});
      const cancelled = result.superseded.filter((s) => s.cancelled);
      if (cancelled.length === 0) return;
      setStopped(cancelled.map((s) => s.label_en));
      // The tier has not changed — the higher one was already live — but the
      // renewal date and the source shown beside it have.
      refreshEntitlements();
    } catch {
      // Deliberately silent.
    }
  }, [reconcileMutate, refreshEntitlements]);

  const buy = useCallback(
    async (optionId: string) => {
      setError(null);
      setBuying(optionId);
      try {
        const check = await preflightMutate({ option_id: optionId });
        if (!check.ok) {
          // The server's wording, verbatim. Rewording a refusal here is how a
          // screen ends up lying about why a payment did not happen.
          setError({ message: check.message, blockers: [] });
          return;
        }

        // The server issues the reference and the URL together. Both are kept:
        // the URL is where the customer goes, the reference is how this app
        // asks what happened when they come back.
        const opened = await checkoutMutate({ option_id: optionId });

        const result = await openCheckout(opened.authorization_url);
        // On web the tab is already gone; anything after this never runs, and
        // the return leg is the website's /billing/callback page.
        if (result === "left") return;

        /**
         * Back from the in-app browser, and its outcome is unknown by design —
         * Paystack's confirmation page has no way back into a native app, so
         * a learner who genuinely paid also leaves by closing the browser.
         *
         * So the reference is verified server-side. A `pending` or `not_paid`
         * answer is NOT surfaced as a failure here: the webhook may still be
         * a second behind, and telling someone their payment failed when it
         * did not is worse than telling them nothing. `refreshEntitlements`
         * shows the truth either way once the server has it.
         */
        try {
          await verifyMutate({ reference: opened.reference });
        } catch {
          // Verification itself was unreachable. The webhook still covers it.
        }

        refreshEntitlements();
        await reconcileNow();
      } catch (err) {
        const blockers = (err as { data?: { blockers?: string[] } }).data?.blockers;
        setError({
          message:
            err instanceof Error && err.message
              ? err.message
              : "Checkout could not be opened. Nothing was charged.",
          blockers: Array.isArray(blockers) ? blockers : [],
        });
      } finally {
        setBuying(null);
      }
    },
    [preflightMutate, checkoutMutate, verifyMutate, refreshEntitlements, reconcileNow],
  );

  /**
   * Close any double billing the moment a billing screen is open.
   *
   * Once per mount, and never for a signed-out visitor, who has nothing to
   * reconcile. On web this is also the return leg of a redirect checkout: the
   * screen that opened it is long gone and this is where the learner lands.
   */
  const reconciled = useRef(false);
  useEffect(() => {
    if (!isSignedIn || reconciled.current) return;
    reconciled.current = true;
    void reconcileNow();
  }, [isSignedIn, reconcileNow]);

  return {
    buy,
    buying,
    error,
    stopped,
    clearError: useCallback(() => setError(null), []),
  };
}
