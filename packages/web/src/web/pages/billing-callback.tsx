import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { AlertCircle, CheckCircle2, Clock, Loader2 } from "lucide-react";
import { useSession } from "../hooks/use-session";
import { useReconcile, useRefreshEntitlements, useVerifyPayment } from "../queries/billing";
import { Am, Card, TibebRule } from "../components/ui/kit";
import { useSeo } from "../hooks/use-seo";

/**
 * Where Paystack sends the customer after payment.
 *
 * The one rule this page exists to enforce: THE REDIRECT PROVES NOTHING. Its
 * URL is entirely under the customer's control — anyone can type
 * /billing/callback?reference=whatever — so this page never reads a success
 * out of the query string. It takes only the reference, hands it to the server,
 * and the server re-asks Paystack what actually happened to that reference
 * before anything is granted.
 *
 * It is also not the only way a payment completes. The webhook fulfils the
 * same reference independently, which is what covers the customer who closes
 * the tab on Paystack's page instead of waiting for the redirect. The two race
 * and both are idempotent; whichever arrives second changes nothing.
 *
 * Three outcomes, and the difference between the last two matters:
 *   - granted: paid and verified, access is live
 *   - pending: Paystack has the payment but has not settled it, so nothing is
 *     claimed either way and the page says to wait
 *   - failed / unverifiable: no access, and stated as "not completed" rather
 *     than "your card was declined", which is not something known from here
 */
export default function BillingCallbackPage() {
  useSeo({
    title: "Confirming your payment",
    description: "Confirming your AmharicAI payment.",
    noIndex: true,
  });

  const [location] = useLocation();
  const { isSignedIn, isPending: sessionLoading } = useSession();
  const verify = useVerifyPayment();
  const reconcile = useReconcile();
  const refreshEntitlements = useRefreshEntitlements();

  const [state, setState] = useState<
    | { kind: "working" }
    | { kind: "granted"; plan: string; recurring: boolean; expiresAt: string | null }
    | { kind: "pending"; message: string }
    | { kind: "failed"; message: string }
  >({ kind: "working" });

  /**
   * Read from the live URL rather than wouter's path, because the reference is
   * in the query string and wouter's location does not carry it.
   */
  const reference =
    typeof window === "undefined"
      ? null
      : (new URLSearchParams(window.location.search).get("reference") ??
        // Paystack has used both names across its checkout versions, so both
        // are accepted rather than silently failing on the other one.
        new URLSearchParams(window.location.search).get("trxref"));

  const ran = useRef(false);
  const verifyMutate = verify.mutateAsync;
  const reconcileMutate = reconcile.mutateAsync;

  useEffect(() => {
    // Wait for the session to load: verify is a signed-in route, and firing it
    // mid-restore would report a real payment as a failure.
    if (sessionLoading || ran.current) return;

    if (!reference) {
      ran.current = true;
      setState({
        kind: "failed",
        message:
          "This page was opened without a payment reference, so there is nothing to confirm. " +
          "If you have just paid, your access will appear on its own within a few minutes.",
      });
      return;
    }

    if (!isSignedIn) {
      ran.current = true;
      setState({
        kind: "pending",
        message:
          "You are signed out, so this payment cannot be confirmed here. Sign in with the " +
          "account you paid on and your access will be waiting — the payment is recorded " +
          "against it, not against this browser.",
      });
      return;
    }

    ran.current = true;
    void (async () => {
      try {
        const outcome = await verifyMutate({ reference });

        if (outcome.result.kind === "granted") {
          /**
           * Close any double billing straight away: someone upgrading to
           * annual while a monthly subscription is live must not be charged
           * for both, and this is the page they land on.
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
            recurring: outcome.result.recurring,
            expiresAt: outcome.expires_at ?? null,
          });
          return;
        }

        if (outcome.result.kind === "pending") {
          setState({ kind: "pending", message: outcome.result.message });
          return;
        }

        setState({
          kind: "failed",
          message:
            "message" in outcome.result && typeof outcome.result.message === "string"
              ? outcome.result.message
              : "This payment did not complete, so nothing has been granted and nothing " +
                "has been charged.",
        });
      } catch (error) {
        // A verification that could not be carried out is NOT a failed
        // payment, and must never be reported as one — the money may well
        // have been taken, and the webhook will finish the job.
        setState({
          kind: "pending",
          message:
            error instanceof Error && error.message
              ? error.message
              : "We could not confirm this payment just now. If you were charged, your " +
                "access will appear automatically within a few minutes.",
        });
      }
    })();
  }, [
    sessionLoading,
    isSignedIn,
    reference,
    location,
    verifyMutate,
    reconcileMutate,
    refreshEntitlements,
  ]);

  return (
    <div className="mx-auto max-w-xl space-y-6 py-10">
      <header className="space-y-3">
        <h1 className="font-display text-3xl font-bold">
          {state.kind === "granted" ? "Payment confirmed" : "Your payment"}
        </h1>
        <Am className="block text-lg text-primary">ክፍያ</Am>
        <TibebRule className="max-w-36" />
      </header>

      {state.kind === "working" ? (
        <Card>
          <p className="flex items-start gap-2 text-sm text-muted-foreground">
            <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-primary" />
            <span>
              Checking this payment with Paystack. This is confirmed with them directly rather
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
              <strong className="font-semibold">Thank you — your payment went through.</strong>{" "}
              This account is now on {state.plan}
              {state.recurring
                ? state.expiresAt
                  ? `, renewing on ${new Date(state.expiresAt).toLocaleDateString(undefined, {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                    })}.`
                  : ", renewing automatically until you cancel."
                : ". That was a single payment — nothing renews and nothing expires."}
            </span>
          </p>
          <p className="text-xs text-muted-foreground">
            The receipt is on your plan page, and Paystack has emailed you their own
            confirmation.
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
            Nothing is lost either way: if the payment succeeded, Paystack tells our server
            directly and your access appears without you doing anything. Reloading this page
            checks again.
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
