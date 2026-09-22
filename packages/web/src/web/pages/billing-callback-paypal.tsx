import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { AlertCircle, CheckCircle2, Clock, Loader2 } from "lucide-react";
import { useSession } from "../hooks/use-session";
import { useReconcile, useRefreshEntitlements } from "../queries/billing";
import { useVerifyPaypalSubscription } from "../queries/billing-paypal";
import { Am, Card, TibebRule } from "../components/ui/kit";
import { useSeo } from "../hooks/use-seo";

/**
 * Where PayPal sends the customer after they approve a subscription.
 *
 * A separate page from `/billing/callback` rather than a branch inside it,
 * because the two redirects have nothing in common but their purpose. Paystack
 * comes back with `reference` — our own id for a payment that has already been
 * attempted. PayPal comes back with `subscription_id`, `ba_token` and `token`:
 * PayPal's ids for a subscription that exists whether or not any money has
 * moved. Reusing one page would have meant reading a Paystack reference out of
 * a PayPal URL and reporting "no reference" on every successful PayPal
 * purchase.
 *
 * What both pages share is the rule that matters: THE REDIRECT PROVES NOTHING.
 * Its query string is entirely under the customer's control, so nothing here
 * is read as a success. The subscription id is handed to the server, which
 * re-reads the subscription from PayPal and attributes it through our own
 * checkout row before anything is granted.
 *
 * And this is not the only way a purchase completes. `BILLING.SUBSCRIPTION.
 * ACTIVATED` fulfils the same subscription independently, which covers the
 * customer who closes the tab on PayPal's page. The two race, both are
 * idempotent, and whichever arrives second changes nothing.
 *
 * The PayPal-specific outcome is `pending`, and it is common rather than
 * exotic: PayPal frequently redirects while the subscription is still
 * `APPROVAL_PENDING` or `APPROVED`, a few seconds before it goes `ACTIVE`.
 * That is not a failure and must never be shown as one.
 */
export default function BillingCallbackPaypalPage() {
  useSeo({
    title: "Confirming your PayPal subscription",
    description: "Confirming your AmharicAI subscription with PayPal.",
    noIndex: true,
  });

  const [location] = useLocation();
  const { isSignedIn, isPending: sessionLoading } = useSession();
  const verify = useVerifyPaypalSubscription();
  const reconcile = useReconcile();
  const refreshEntitlements = useRefreshEntitlements();

  const [state, setState] = useState<
    | { kind: "working" }
    | { kind: "granted"; plan: string; expiresAt: string | null }
    | { kind: "pending"; message: string }
    | { kind: "failed"; message: string }
  >({ kind: "working" });

  /**
   * Read from the live URL rather than from wouter's path, which does not
   * carry the query string.
   *
   * `subscription_id` is what PayPal appends to the return URL for a
   * subscription approval. `ba_token` and `token` arrive with it and are
   * deliberately ignored: they identify the billing agreement and the approval
   * session, neither of which our server can look a subscription up by.
   */
  const subscriptionId =
    typeof window === "undefined"
      ? null
      : new URLSearchParams(window.location.search).get("subscription_id");

  const ran = useRef(false);
  const verifyMutate = verify.mutateAsync;
  const reconcileMutate = reconcile.mutateAsync;

  useEffect(() => {
    // Wait for the session: verify is a signed-in route, and firing it during
    // a session restore would report a real subscription as a failure.
    if (sessionLoading || ran.current) return;

    if (!subscriptionId) {
      ran.current = true;
      setState({
        kind: "failed",
        message:
          "This page was opened without a PayPal subscription id, so there is nothing to " +
          "confirm. If you have just approved a subscription on PayPal, your access will " +
          "appear on its own within a few minutes.",
      });
      return;
    }

    if (!isSignedIn) {
      ran.current = true;
      setState({
        kind: "pending",
        message:
          "You are signed out, so this subscription cannot be confirmed here. Sign in with " +
          "the account you subscribed on and your access will be waiting — PayPal pays it " +
          "onto that account, not onto this browser.",
      });
      return;
    }

    ran.current = true;
    void (async () => {
      try {
        const outcome = await verifyMutate({ subscription_id: subscriptionId });

        if (outcome.result.kind === "granted") {
          /**
           * Close any double billing straight away. This is the page where
           * that risk is highest: a customer who already pays through
           * Paystack and has just subscribed through PayPal is, for these few
           * seconds, holding two grants that charge separately.
           */
          try {
            await reconcileMutate({});
          } catch {
            // Never turn a completed purchase into an error. The subscription
            // page retries this on every visit.
          }
          refreshEntitlements();
          setState({
            kind: "granted",
            plan: outcome.current_plan,
            expiresAt: outcome.expires_at ?? null,
          });
          return;
        }

        if (outcome.result.kind === "pending") {
          setState({ kind: "pending", message: outcome.result.message });
          return;
        }

        /**
         * `not_paid` and `unknown_subscription`. Both carry a message written
         * server-side and neither is reported as a declined payment — that is
         * not something known from here, and PayPal's own email is the
         * authority on what it took.
         */
        setState({
          kind: "failed",
          message:
            "message" in outcome.result && typeof outcome.result.message === "string"
              ? outcome.result.message
              : "This subscription is not active, so nothing has been granted.",
        });
      } catch (error) {
        // A confirmation that could not be carried out is NOT a failed
        // payment. The webhook finishes the job either way.
        setState({
          kind: "pending",
          message:
            error instanceof Error && error.message
              ? error.message
              : "We could not confirm this subscription with PayPal just now. If you were " +
                "charged, your access will appear automatically within a few minutes.",
        });
      }
    })();
  }, [
    sessionLoading,
    isSignedIn,
    subscriptionId,
    location,
    verifyMutate,
    reconcileMutate,
    refreshEntitlements,
  ]);

  return (
    <div className="mx-auto max-w-xl space-y-6 py-10">
      <header className="space-y-3">
        <h1 className="font-display text-3xl font-bold">
          {state.kind === "granted" ? "Subscription confirmed" : "Your PayPal subscription"}
        </h1>
        <Am className="block text-lg text-primary">ክፍያ</Am>
        <TibebRule className="max-w-36" />
      </header>

      {state.kind === "working" ? (
        <Card>
          <p className="flex items-start gap-2 text-sm text-muted-foreground">
            <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-primary" />
            <span>
              Checking this subscription with PayPal. It is confirmed with them directly rather
              than taken from the page you were sent back to, so it takes a moment.
            </span>
          </p>
        </Card>
      ) : null}

      {state.kind === "granted" ? (
        <Card className="space-y-3">
          <p className="flex items-start gap-2 text-sm">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" />
            <span>
              <strong className="font-semibold">Thank you — PayPal has your subscription.</strong>{" "}
              This account is now on {state.plan}
              {state.expiresAt
                ? `, renewing on ${new Date(state.expiresAt).toLocaleDateString(undefined, {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                  })}.`
                : ", renewing automatically until you cancel."}
            </span>
          </p>
          <p className="text-xs text-muted-foreground">
            The receipt is on your plan page, and PayPal has emailed you their own confirmation.
            Every charge is billed in US dollars by PayPal.
          </p>
          <div className="flex flex-wrap gap-2">
            <Link
              to="/app"
              className="inline-flex items-center justify-center rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
            >
              Start learning
            </Link>
            <Link
              to="/subscription"
              className="inline-flex items-center justify-center rounded-full border border-border px-5 py-2.5 text-sm font-semibold transition hover:bg-muted"
            >
              See your plan
            </Link>
          </div>
        </Card>
      ) : null}

      {state.kind === "pending" ? (
        <Card className="space-y-3">
          <p className="flex items-start gap-2 text-sm text-warning">
            <Clock className="mt-0.5 size-4 shrink-0" />
            <span>{state.message}</span>
          </p>
          <p className="text-xs text-muted-foreground">
            {/* Said plainly because it is the normal case, not an edge one:
                PayPal often redirects a second or two before the subscription
                becomes active at their end. */}
            Nothing is lost either way. PayPal tells our server directly when the subscription
            activates, and your access then appears without you doing anything. Checking again
            takes a moment.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex items-center justify-center rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
            >
              Check again
            </button>
            <Link
              to={isSignedIn ? "/subscription" : "/sign-in"}
              className="inline-flex items-center justify-center rounded-full border border-border px-5 py-2.5 text-sm font-semibold transition hover:bg-muted"
            >
              {isSignedIn ? "See your plan" : "Sign in"}
            </Link>
          </div>
        </Card>
      ) : null}

      {state.kind === "failed" ? (
        <Card className="space-y-3">
          <p className="flex items-start gap-2 text-sm text-warning">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            <span>{state.message}</span>
          </p>
          <p className="text-xs text-muted-foreground">
            The card checkout is still available on the plans page if you would rather pay that
            way.
          </p>
          <div className="flex flex-wrap gap-2">
            <Link
              to="/subscription"
              className="inline-flex items-center justify-center rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
            >
              Back to plans
            </Link>
            <Link
              to="/contact"
              className="inline-flex items-center justify-center rounded-full border border-border px-5 py-2.5 text-sm font-semibold transition hover:bg-muted"
            >
              Contact us
            </Link>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
