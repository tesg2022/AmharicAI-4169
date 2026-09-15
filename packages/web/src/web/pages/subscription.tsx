import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import {
  AlertCircle,
  BadgeCheck,
  CheckCircle2,
  CircleSlash,
  Clock,
  CreditCard,
  Eye,
  KeyRound,
  Lock,
  ReceiptText,
  RotateCcw,
  Ticket,
  Wallet,
} from "lucide-react";
import { useSession } from "../hooks/use-session";
import { useAccess, useMyRedemptions, useRedeemCode } from "../queries/access";
import {
  useBillingAccount,
  useCancelSubscription,
  useCardUpdateLink,
  useCatalogue,
  useCheckout,
  usePreflight,
  useReconcile,
  useRefreshEntitlements,
  useResumeSubscription,
} from "../queries/billing";
import { Am, Card, Chip, Loading, TibebRule } from "../components/ui/kit";
import { useSeo } from "../hooks/use-seo";

/**
 * Account and subscription.
 *
 * Everything on this page comes from `access.me`, which resolves the plan
 * server-side from the session. Three things it must never blur:
 *
 *   - a feature row promises availability only when `usable` is true, never
 *     when `granted` is true — granted says the plan includes it, usable says
 *     it exists in this build
 *   - an unverified preview plan is labelled as a preview, not as a holding
 *   - the price list is read from `billing.catalogue`, never hard-coded here,
 *     so web and mobile cannot quote different prices
 *   - checkout is asked for permission before it is opened: `billing.preflight`
 *     answers whether this purchase makes sense, and its refusal is shown as
 *     written rather than dressed up as a generic error
 */

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function daysLeft(iso: string): number {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000));
}

const SOURCE_COPY: Record<string, { label: string; body: string }> = {
  subscription: {
    label: "Paid subscription",
    body: "Your plan comes from an active subscription.",
  },
  access_code: {
    label: "Access code",
    body: "Your plan comes from an administrator-issued access code.",
  },
  preview_cookie: {
    label: "Preview only",
    body: "This is an unverified preview, not a plan you hold. Sign in to have a real entitlement.",
  },
  default_free: { label: "Free", body: "You are on the Free plan." },
};

export default function SubscriptionPage() {
  useSeo({
    title: "Your plan",
    description: "Manage your AmharicAI plan.",
    noIndex: true,
  });

  const { isSignedIn, user } = useSession();
  const access = useAccess();
  const redemptions = useMyRedemptions(isSignedIn);
  const redeem = useRedeemCode();

  const catalogue = useCatalogue();
  const preflight = usePreflight();
  const checkout = useCheckout();
  const refreshEntitlements = useRefreshEntitlements();
  const account = useBillingAccount(isSignedIn);
  const cancelSubscription = useCancelSubscription();
  const resumeSubscription = useResumeSubscription();
  const cardUpdateLink = useCardUpdateLink();

  const [code, setCode] = useState("");
  const [redeemError, setRedeemError] = useState<string | null>(null);
  /** Which billing option is selected per plan — Premium has three terms. */
  const [chosenOption, setChosenOption] = useState<Record<string, string>>({});
  /** The option currently being taken to checkout, so only its button spins. */
  const [buying, setBuying] = useState<string | null>(null);
  const [checkoutError, setCheckoutError] = useState<{
    message: string;
    blockers: string[];
  } | null>(null);
  /** Subscriptions this visit stopped, so the page can say so out loud. */
  const [stopped, setStopped] = useState<string[]>([]);
  /** Billing-management state: the card link, and cancel / resume per plan. */
  const [cardBusy, setCardBusy] = useState<string | null>(null);
  const [managing, setManaging] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState<string | null>(null);
  const [manageError, setManageError] = useState<string | null>(null);
  const [manageNotice, setManageNotice] = useState<string | null>(null);

  const reconcile = useReconcile();
  const reconcileMutate = reconcile.mutateAsync;
  const reconciled = useRef(false);

  /**
   * Close any double billing the moment this page is open.
   *
   * A lifetime purchase does not cancel the monthly subscription underneath
   * it — Paystack will keep charging both quite happily — so the server is
   * asked to reconcile on arrival. Here rather than in the checkout handler
   * because a redirect checkout returns as a brand-new page load: the code
   * that opened it is long gone, and this is where both routes back from
   * Paystack land.
   *
   * Once per mount, and never for a signed-out visitor, who has nothing to
   * reconcile.
   */
  useEffect(() => {
    if (!isSignedIn || reconciled.current) return;
    reconciled.current = true;
    void (async () => {
      try {
        const result = await reconcileMutate({});
        const cancelled = result.superseded.filter((s) => s.cancelled);
        if (cancelled.length === 0) return;
        setStopped(cancelled.map((s) => s.label_en));
        // The plan itself has not changed — the higher tier was already live —
        // but the renewal date and the source shown alongside it have.
        refreshEntitlements();
      } catch {
        // A failed cleanup must never break the page somebody just paid on.
        // The next visit tries again.
      }
    })();
  }, [isSignedIn, reconcileMutate, refreshEntitlements]);

  if (access.isLoading) return <Loading label="Checking your plan…" />;

  const data = access.data;
  if (!data) {
    return (
      <div className="mx-auto max-w-xl py-10">
        <Card>
          <p className="flex items-start gap-2 text-sm text-destructive">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            <span>Could not read your plan. Reload the page and try again.</span>
          </p>
        </Card>
      </div>
    );
  }

  const currentPlan = data.plans.find((p) => p.id === data.plan) ?? data.plans[0]!;
  const source = SOURCE_COPY[data.plan_source] ?? SOURCE_COPY["default_free"]!;

  async function submitCode(event: React.FormEvent) {
    event.preventDefault();
    setRedeemError(null);
    const trimmed = code.trim();
    if (!/^\d{6}$/.test(trimmed)) {
      setRedeemError("An access code is six digits.");
      return;
    }
    try {
      await redeem.mutateAsync({ code: trimmed });
      setCode("");
    } catch (error) {
      // Server messages are the honest ones — including the lockout and the
      // deliberately generic "not valid". Never rewrite them client-side.
      setRedeemError(error instanceof Error ? error.message : "That code could not be redeemed.");
    }
  }

  /**
   * Send the customer to Paystack's page for changing the card on one
   * subscription.
   *
   * This is a card-update link and nothing more. Paystack has no hosted
   * billing portal: there is no invoice history there, no cancellation and no
   * plan switching, so it must not be labelled "billing portal" the way the
   * Stripe-era button was — that button promised three things this link
   * cannot do.
   */
  async function openCardUpdate(subscriptionCode: string) {
    setManageError(null);
    setManageNotice(null);
    setCardBusy(subscriptionCode);
    try {
      const { link } = await cardUpdateLink.mutateAsync({
        subscription_code: subscriptionCode,
      });
      window.location.assign(link);
    } catch (error) {
      setManageError(
        error instanceof Error && error.message
          ? error.message
          : "That link could not be generated. Your card and your plan are unchanged.",
      );
    } finally {
      setCardBusy(null);
    }
  }

  /**
   * Stop a subscription at the end of the period already paid for, or undo
   * that while it is still undoable.
   *
   * Paystack's disable is end-of-cycle by construction — the subscription
   * becomes `non-renewing`, keeps working until its payment date and is never
   * charged again — which is the behaviour wanted here anyway: the period is
   * paid for, and cutting access off at the moment of cancellation would take
   * back time somebody bought. Same principle that keeps a cancel-pending
   * grant entitling in `resolve.ts`.
   *
   * Once the cycle closes Paystack cannot re-enable the subscription, and the
   * server refuses rather than pretending; the resume button is only offered
   * while the status is still `non-renewing`.
   */
  async function changeSubscription(
    subscriptionCode: string,
    action: "cancel" | "resume",
    label: string,
  ) {
    setManageError(null);
    setManageNotice(null);
    setManaging(subscriptionCode);
    try {
      if (action === "resume") {
        await resumeSubscription.mutateAsync({ subscription_code: subscriptionCode });
        setManageNotice(`${label} will renew as normal again.`);
      } else {
        const result = await cancelSubscription.mutateAsync({
          subscription_code: subscriptionCode,
        });
        setManageNotice(
          result.until
            ? `${label} will not renew. You keep it until ${formatDate(result.until)}.`
            : `${label} will not renew. You keep it until the end of the period you have already paid for.`,
        );
      }
      setConfirmCancel(null);
      // Re-read from the server rather than assumed here: a change the
      // gateway refused must not show as done.
      refreshEntitlements();
      await account.refetch();
    } catch (error) {
      setManageError(
        error instanceof Error && error.message
          ? error.message
          : "That change could not be made. Your plan is unchanged.",
      );
    } finally {
      setManaging(null);
    }
  }

  /**
   * Ask the server for permission, then ask it to open a Paystack page.
   *
   * Both halves are server calls now. Under Autumn the browser held the
   * checkout itself, so the server never knew a purchase had been attempted
   * and an abandoned checkout was indistinguishable from one that never
   * started. Here `checkout` writes the attempt down before Paystack is
   * contacted, and this function's only job afterwards is the redirect.
   *
   * preflight grants nothing — it refuses purchases that cannot work (an
   * unconfigured deployment, an option with no Paystack plan, a plan already
   * held). Its message is shown verbatim: rewording a server refusal here is
   * how a UI ends up lying about why a payment did not happen.
   */
  async function buy(optionId: string) {
    setCheckoutError(null);
    setBuying(optionId);
    try {
      const check = await preflight.mutateAsync({ option_id: optionId });
      if (!check.ok) {
        setCheckoutError({ message: check.message, blockers: [] });
        return;
      }

      const opened = await checkout.mutateAsync({ option_id: optionId });
      /**
       * Left in the busy state on purpose — `buying` is never cleared before
       * the browser leaves, so the button cannot be pressed a second time and
       * open a second payment page for the same thing.
       */
      window.location.assign(opened.authorization_url);
    } catch (error) {
      const blockers = (error as { data?: { blockers?: string[] } }).data?.blockers;
      setCheckoutError({
        message:
          error instanceof Error && error.message
            ? error.message
            : "Checkout could not be opened. Nothing was charged.",
        blockers: Array.isArray(blockers) ? blockers : [],
      });
      setBuying(null);
    }
  }

  const inputClass =
    "w-full rounded-xl border border-border bg-background px-4 py-2.5 text-[15px] outline-none transition focus:border-primary";

  return (
    <div className="mx-auto max-w-3xl space-y-7 py-2">
      <header className="space-y-3">
        <h1 className="font-display text-3xl font-bold">Your plan</h1>
        <Am className="block text-lg text-primary">ዕቅድዎ</Am>
        <TibebRule className="max-w-36" />
        {isSignedIn ? (
          <p className="text-sm text-muted-foreground">
            Signed in as {user?.email}. Your plan is resolved on the server from this account.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            You are not signed in.{" "}
            <Link to="/sign-in" className="font-medium text-primary hover:underline">
              Sign in
            </Link>{" "}
            to hold a real plan — without an account nothing can be granted to you.
          </p>
        )}
      </header>

      {/* Answer #10: an expired grant is stated, never a silent demotion. */}
      {data.expired_notice ? (
        <div className="flex items-start gap-3 rounded-xl border-l-[3px] border-warning bg-accent/15 p-4 text-sm text-warning">
          <Clock className="mt-0.5 size-4 shrink-0" />
          <span>
            <strong className="font-semibold">Your access code has expired.</strong> The{" "}
            {data.expired_notice.plan} access it granted ran out on{" "}
            {formatDate(data.expired_notice.expired_at)}, so this account is back on Free. Redeem a
            new code below if an administrator has given you one.
          </span>
        </div>
      ) : null}

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <p className="font-display text-2xl font-bold">{currentPlan.name_en}</p>
            <Am className="block text-primary">{currentPlan.name_am}</Am>
            <p className="text-sm text-muted-foreground">{currentPlan.tagline_en}</p>
          </div>
          <div className="space-y-2 text-right">
            {data.plan_is_verified ? (
              <Chip
                label="Verified"
                icon={BadgeCheck}
                className="bg-primary/10 text-primary"
              />
            ) : (
              <Chip label={source.label} icon={Eye} />
            )}
            {data.expires_at ? (
              <p className="text-xs text-muted-foreground">
                Until {formatDate(data.expires_at)} · {daysLeft(data.expires_at)} days left
              </p>
            ) : null}
          </div>
        </div>

        <p className="mt-4 border-t border-border pt-3 text-xs text-muted-foreground">
          {source.body}
        </p>
      </Card>

      {/* Feature truth table. `usable` gates the promise; `granted` alone never does. */}
      <section className="space-y-3">
        <h2 className="font-display text-xl font-bold">What this plan actually gives you</h2>
        <div className="space-y-2">
          {data.features.map((f) => {
            const usableNow = f.usable;
            const Icon = usableNow
              ? CheckCircle2
              : f.state === "plan_gated"
                ? Lock
                : CircleSlash;
            return (
              <Card key={f.id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <p className="flex items-center gap-2 text-sm font-semibold">
                      <Icon
                        className={`size-4 shrink-0 ${
                          usableNow ? "text-primary" : "text-muted-foreground"
                        }`}
                      />
                      {f.label_en}
                    </p>
                    <Am className="block text-xs text-muted-foreground">{f.label_am}</Am>
                  </div>
                  <Chip
                    label={f.state_label.en}
                    className={
                      usableNow ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
                    }
                  />
                </div>
                {f.caveat_en ? (
                  <p className="mt-2 text-xs text-warning">
                    {/* A plan-gated feature keeps its capability caveat, prefixed
                        so an upgrade is never implied to deliver it. */}
                    {f.state === "plan_gated" ? "Even on a higher plan: " : ""}
                    {f.caveat_en}
                  </p>
                ) : null}
              </Card>
            );
          })}
        </div>
      </section>

      {/* Billing: what is being paid for, and the receipts for it. Signed-in
          only — there is no billing account to show a visitor. */}
      {isSignedIn ? (
        <section className="space-y-3">
          <h2 className="flex items-center gap-2 font-display text-xl font-bold">
            <Wallet className="size-5 text-primary" />
            Billing and receipts
          </h2>

          {account.isLoading ? (
            <Loading label="Reading your billing account…" />
          ) : !account.data?.reachable ? (
            /* An empty invoice list and an unreadable billing account must
               never look alike, so the difference is stated. */
            <Card>
              <p className="flex items-start gap-2 text-sm text-warning">
                <AlertCircle className="mt-0.5 size-4 shrink-0" />
                <span>
                  {account.data?.billing_status.blockers[0] ??
                    "Your billing account could not be read just now. Your plan above is unaffected, and nothing has been charged or cancelled. Try again in a moment."}
                </span>
              </p>
            </Card>
          ) : account.data.holdings.length === 0 && account.data.invoices.length === 0 ? (
            <Card>
              <p className="text-sm text-muted-foreground">
                You have never been charged for AmharicAI, so there is nothing to manage here
                yet. The paid plans are below.
              </p>
            </Card>
          ) : (
            <>
              {account.data.holdings.length > 0 ? (
                <div className="space-y-2">
                  {account.data.holdings.map((h) => (
                    <Card key={h.option_id} className="space-y-3 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="space-y-1">
                          <p className="text-sm font-semibold">{h.label_en}</p>
                          <p className="text-xs text-muted-foreground">
                            {/* One date, three meanings — so it is always
                                labelled rather than printed bare. */}
                            {!h.recurring
                              ? h.until
                                ? `One payment. Access until ${formatDate(h.until)}.`
                                : "One payment. Yours for life — nothing renews and nothing expires."
                              : h.cancel_pending
                                ? h.until
                                  ? `Cancelled. Runs until ${formatDate(h.until)} (${daysLeft(h.until)} days left), then stops.`
                                  : "Cancelled. It will not renew."
                                : h.until
                                  ? `Renews on ${formatDate(h.until)}.`
                                  : "Renews automatically."}
                          </p>
                        </div>
                        {h.payment_failed ? (
                          <Chip
                            label="Payment failed"
                            icon={AlertCircle}
                            className="bg-accent/30 text-warning"
                          />
                        ) : h.cancel_pending ? (
                          <Chip label="Ending" icon={Clock} className="bg-muted text-warning" />
                        ) : h.recurring ? (
                          <Chip
                            label="Active"
                            icon={BadgeCheck}
                            className="bg-primary/10 text-primary"
                          />
                        ) : (
                          <Chip label="Owned" icon={BadgeCheck} className="bg-primary/10 text-primary" />
                        )}
                      </div>

                      {/* Paystack's renewal charge failed. Access continues to
                          the payment date, when it retries — the only warning
                          the customer gets before losing access, so it is
                          stated here rather than left to an email. */}
                      {h.payment_failed ? (
                        <p className="flex items-start gap-2 rounded-xl border-l-[3px] border-warning bg-accent/15 p-3 text-xs text-warning">
                          <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
                          <span>
                            The last renewal payment for this subscription did not go through.
                            You still have everything it gives you
                            {h.until ? ` until ${formatDate(h.until)}` : ""}, and the card will
                            be tried again. Update your card below if it has expired or been
                            replaced.
                          </span>
                        </p>
                      ) : null}

                      {/* A one-off purchase has nothing to cancel: there is no
                          renewal to stop and no refund to promise here. A
                          subscription with no stored code cannot be managed
                          through the gateway either, so no button is shown
                          that would only fail. */}
                      {h.recurring && h.subscription_code ? (
                        h.cancel_pending ? (
                          <button
                            type="button"
                            onClick={() =>
                              changeSubscription(h.subscription_code!, "resume", h.label_en)
                            }
                            disabled={managing !== null}
                            className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-xs font-semibold transition hover:bg-muted disabled:opacity-50"
                          >
                            <RotateCcw className="size-3.5" />
                            {managing === h.subscription_code
                              ? "Resuming…"
                              : "Resume this subscription"}
                          </button>
                        ) : confirmCancel === h.subscription_code ? (
                          /* Two taps, because one tap that stops somebody's
                             paid plan is a misclick waiting to happen. What
                             happens next is spelled out before they confirm. */
                          <div className="space-y-2 rounded-xl border-l-[3px] border-warning bg-accent/15 p-3">
                            <p className="text-xs text-warning">
                              Cancel {h.label_en}? You keep everything it gives you until{" "}
                              {h.until ? formatDate(h.until) : "the end of the paid period"}, it
                              will not renew after that, and this account then returns to Free.
                              You can resume it any time before then.
                            </p>
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() =>
                                  changeSubscription(h.subscription_code!, "cancel", h.label_en)
                                }
                                disabled={managing !== null}
                                className="rounded-full bg-destructive px-4 py-2 text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
                              >
                                {managing === h.subscription_code
                                  ? "Cancelling…"
                                  : "Yes, cancel at period end"}
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmCancel(null)}
                                disabled={managing !== null}
                                className="rounded-full border border-border px-4 py-2 text-xs font-semibold transition hover:bg-muted disabled:opacity-50"
                              >
                                Keep it
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              setManageError(null);
                              setManageNotice(null);
                              setConfirmCancel(h.subscription_code!);
                            }}
                            disabled={managing !== null}
                            className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-xs font-semibold transition hover:bg-muted disabled:opacity-50"
                          >
                            <CircleSlash className="size-3.5" />
                            Cancel subscription
                          </button>
                        )
                      ) : null}

                      {/* Card changes are the one thing Paystack does host,
                          and it is per subscription rather than per customer —
                          so the link belongs on the subscription it changes,
                          not in a single "portal" button at the bottom. */}
                      {h.recurring && h.subscription_code ? (
                        <button
                          type="button"
                          onClick={() => openCardUpdate(h.subscription_code!)}
                          disabled={cardBusy !== null}
                          className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-xs font-semibold transition hover:bg-muted disabled:opacity-50"
                        >
                          <CreditCard className="size-3.5" />
                          {cardBusy === h.subscription_code
                            ? "Opening…"
                            : "Update the card on this subscription"}
                        </button>
                      ) : null}
                    </Card>
                  ))}
                </div>
              ) : null}

              {/* What used to be an "Open billing portal" button.
                  Paystack has no hosted portal, so rather than a button that
                  opens a page doing none of what it promised, the three
                  things a customer comes here for are said plainly and each
                  is where it actually happens: the card on its subscription
                  above, cancellation above, receipts below. */}
              <Card className="space-y-2 p-4">
                <p className="text-sm font-semibold">Managing your payments</p>
                <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
                  <li>
                    Your card is changed per subscription, using the button on each one above.
                    The card itself is held by Paystack — AmharicAI never sees or stores it.
                  </li>
                  <li>
                    Cancelling is also per subscription, above. It stops the next renewal and
                    never cuts short a period you have already paid for.
                  </li>
                  <li>Every payment taken is listed below.</li>
                </ul>
              </Card>

              {account.data.invoices.length > 0 ? (
                <Card className="p-4">
                  <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    <ReceiptText className="size-3.5" />
                    Your receipts
                  </p>
                  <ul className="space-y-2 text-sm">
                    {account.data.invoices.map((i) => (
                      <li key={i.id} className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-xs text-muted-foreground">
                          {formatDate(i.created_at)}
                        </span>
                        <span className="min-w-0 flex-1 truncate">{i.label_en}</span>
                        <span className="font-medium">{i.total_label}</span>
                        {/* Paystack calls a completed charge "success". Any
                            other word on a row here is worth showing. */}
                        {i.status !== "success" ? (
                          <Chip label={i.status} className="bg-muted text-muted-foreground" />
                        ) : null}
                        {/* A test-mode payment took no money. A receipt that
                            does not say so is one somebody will try to
                            reconcile against a bank statement forever. */}
                        {i.test_mode ? (
                          <Chip label="Test mode" className="bg-muted text-muted-foreground" />
                        ) : null}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-3 border-t border-border pt-2 text-xs text-muted-foreground">
                    Paystack does not issue a hosted receipt page, so there is nothing to link
                    to here. Their own confirmation email for each payment is the document to
                    keep.
                  </p>
                </Card>
              ) : null}
            </>
          )}

          {manageNotice ? (
            <p className="flex items-start gap-2 rounded-xl border-l-[3px] border-primary bg-primary/5 p-4 text-sm">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" />
              <span>{manageNotice}</span>
            </p>
          ) : null}

          {manageError ? (
            <p className="flex items-start gap-2 rounded-xl border-l-[3px] border-warning bg-accent/15 p-4 text-sm text-warning">
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              <span>{manageError} Nothing about your plan has changed.</span>
            </p>
          ) : null}
        </section>
      ) : null}

      {/* Redeem */}
      <section className="space-y-3">
        <h2 className="flex items-center gap-2 font-display text-xl font-bold">
          <Ticket className="size-5 text-primary" />
          Redeem an access code
        </h2>
        <Card>
          {isSignedIn ? (
            <form onSubmit={submitCode} className="space-y-3">
              <p className="text-sm text-muted-foreground">
                An AmharicAI administrator can issue you a six-digit code that grants a plan for a
                set period without payment. A code works once per account.
              </p>
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-muted-foreground">Six-digit code</span>
                <input
                  value={code}
                  onChange={(e) => {
                    setCode(e.target.value.replace(/\D/g, "").slice(0, 6));
                    setRedeemError(null);
                  }}
                  aria-label="Six-digit access code"
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="000000"
                  className={`${inputClass} font-mono tracking-[0.4em]`}
                />
              </label>

              {redeemError ? (
                <p className="flex items-start gap-2 text-sm text-destructive">
                  <AlertCircle className="mt-0.5 size-4 shrink-0" />
                  <span>{redeemError}</span>
                </p>
              ) : null}

              {redeem.isSuccess && !redeemError ? (
                <p className="flex items-start gap-2 text-sm text-primary">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
                  <span>
                    <strong className="font-semibold">Code redeemed successfully.</strong> Your{" "}
                    {redeem.data.granted_plan} access runs for {redeem.data.duration_days} days and
                    expires on {formatDate(redeem.data.grants_until)}. After that this account
                    returns to its own paid subscription if it has one, and to Free if it does not.
                  </span>
                </p>
              ) : null}

              <button
                type="submit"
                disabled={redeem.isPending || code.trim().length !== 6}
                className="inline-flex items-center justify-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
              >
                <KeyRound className="size-4" />
                {redeem.isPending ? "Checking…" : "Redeem code"}
              </button>
            </form>
          ) : (
            <p className="text-sm text-muted-foreground">
              You need an account before a code can be redeemed — a code grants a plan to a
              specific account, so there is nothing for it to attach to yet.{" "}
              <Link to="/sign-in" className="font-medium text-primary hover:underline">
                Sign in or create an account
              </Link>
              .
            </p>
          )}
        </Card>

        {isSignedIn && (redemptions.data?.length ?? 0) > 0 ? (
          <Card className="p-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Codes you have redeemed
            </p>
            <ul className="space-y-2 text-sm">
              {redemptions.data!.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono text-xs text-muted-foreground">····{r.hint}</span>
                  <span>{r.granted_plan}</span>
                  <span className="text-xs text-muted-foreground">
                    {r.status === "active"
                      ? `until ${formatDate(r.grants_until)}`
                      : r.status === "revoked"
                        ? "revoked by an administrator"
                        : `expired ${formatDate(r.grants_until)}`}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}
      </section>

      {/* Paid upgrade — refuses honestly. */}
      <section className="space-y-3">
        <h2 className="flex items-center gap-2 font-display text-xl font-bold">
          <CreditCard className="size-5 text-primary" />
          Paid plans
        </h2>
        {catalogue.isLoading ? (
          <Loading label="Loading prices…" />
        ) : !catalogue.data ? (
          <Card>
            <p className="flex items-start gap-2 text-sm text-destructive">
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              <span>The price list could not be loaded. Reload the page and try again.</span>
            </p>
          </Card>
        ) : (
          <>
            {/* Checkout being off is stated before anyone taps, not after. */}
            {!catalogue.data.checkout_available ? (
              <div className="space-y-2 rounded-xl border-l-[3px] border-warning bg-accent/15 p-4 text-sm text-warning">
                <p className="flex items-start gap-2">
                  <AlertCircle className="mt-0.5 size-4 shrink-0" />
                  <span>
                    <strong className="font-semibold">Checkout is not open yet.</strong> The prices
                    below are the real ones, but this deployment cannot take a payment.
                  </span>
                </p>
                {catalogue.data.billing_status.blockers.length > 0 ? (
                  <ul className="list-disc space-y-1 pl-8 text-xs">
                    {catalogue.data.billing_status.blockers.map((b) => (
                      <li key={b}>{b}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}

            <div className="grid gap-3 md:grid-cols-3">
              {catalogue.data.plans.map((p) => {
                const isCurrent = p.id === catalogue.data.current_plan;
                const options = p.billing_options;
                // Open on the term they are actually paying for, not on
                // whichever one happens to be listed first — a Premium annual
                // subscriber arriving to a card preselected on "monthly" is
                // being shown somebody else's plan.
                const heldHere = options.find((o) =>
                  catalogue.data.held_option_ids.includes(o.id),
                );
                const selectedId =
                  chosenOption[p.id] ?? heldHere?.id ?? options[0]?.id ?? null;
                const selected = options.find((o) => o.id === selectedId) ?? options[0];

                return (
                  <Card key={p.id} className="flex flex-col gap-3 p-4">
                    <div className="space-y-1">
                      <p className="font-display text-lg font-bold">{p.name_en}</p>
                      <Am className="block text-sm text-primary">{p.name_am}</Am>
                    </div>

                    <p className="font-display text-2xl font-bold">
                      {options.length === 0 ? "Free" : (selected?.price_label ?? "—")}
                      {selected?.term === "monthly" ? (
                        <span className="text-sm font-normal text-muted-foreground"> /month</span>
                      ) : selected?.term === "annual" ? (
                        <span className="text-sm font-normal text-muted-foreground"> /year</span>
                      ) : selected?.term === "lifetime" ? (
                        <span className="text-sm font-normal text-muted-foreground"> once</span>
                      ) : null}
                    </p>
                    {/* The rand figure above is the charged one. This is a
                        conversion at a fixed reference rate, and it is never
                        shown without the approximation mark or the note. */}
                    {selected ? (
                      <p className="-mt-2 text-xs text-muted-foreground">
                        {selected.price_approx_usd_label} approximate · {selected.billed_in_note}
                      </p>
                    ) : null}

                    <p className="text-xs text-muted-foreground">{p.tagline_en}</p>

                    <ul className="space-y-1 text-xs text-muted-foreground">
                      <li>
                        {p.max_units === null
                          ? "Every written course unit"
                          : `The first ${p.max_units} course units`}
                      </li>
                      <li>{p.tutor_allowance_label}</li>
                      <li>
                        {p.quotas.tts_per_day === null
                          ? "Unmetered audio playback"
                          : `${p.quotas.tts_per_day} audio plays a day`}
                      </li>
                      <li>
                        {p.quotas.translate_chars === null
                          ? "Translation not included"
                          : `Translation up to ${p.quotas.translate_chars.toLocaleString()} characters a request`}
                      </li>
                    </ul>

                    {/* Premium is one tier sold three ways. The terms are a
                        choice inside its card, never three separate tiers. */}
                    {options.length > 1 ? (
                      <fieldset className="space-y-1.5">
                        <legend className="sr-only">Billing term for {p.name_en}</legend>
                        {options.map((o) => (
                          <label
                            key={o.id}
                            className={`flex cursor-pointer items-start gap-2 rounded-xl border p-2 text-xs transition ${
                              o.id === selectedId
                                ? "border-primary bg-primary/5"
                                : "border-border hover:bg-muted"
                            }`}
                          >
                            <input
                              type="radio"
                              name={`term-${p.id}`}
                              value={o.id}
                              aria-label={o.note_en ? `${o.label_en} — ${o.note_en}` : o.label_en}
                              checked={o.id === selectedId}
                              onChange={() =>
                                setChosenOption((prev) => ({ ...prev, [p.id]: o.id }))
                              }
                              className="mt-0.5 accent-primary"
                            />
                            <span>
                              <span className="font-semibold">{o.label_en}</span>
                              {o.note_en ? (
                                <span className="block text-muted-foreground">{o.note_en}</span>
                              ) : null}
                            </span>
                          </label>
                        ))}
                      </fieldset>
                    ) : null}

                    {/* "You are on this tier" and "you are paying for exactly
                        this" are different facts. Treating them as one hid the
                        annual and lifetime options from the people most likely
                        to want them: Premium monthly subscribers. */}
                    {selected && catalogue.data.held_option_ids.includes(selected.id) ? (
                      <span className="mt-auto rounded-full bg-primary/10 px-3 py-2 text-center text-xs font-semibold text-primary">
                        Your current plan
                      </span>
                    ) : isCurrent && catalogue.data.plan_source !== "subscription" ? (
                      <span className="mt-auto rounded-full bg-primary/10 px-3 py-2 text-center text-xs font-semibold text-primary">
                        Your current plan
                      </span>
                    ) : options.length === 0 ? (
                      <span className="mt-auto rounded-full bg-muted px-3 py-2 text-center text-xs font-semibold text-muted-foreground">
                        Free, always
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => selected && buy(selected.id)}
                        disabled={
                          !selected ||
                          buying !== null ||
                          !catalogue.data.checkout_available ||
                          // Per option, not per deployment: a missing Paystack
                          // plan for the annual term must not take monthly off
                          // sale with it.
                          !selected.sellable
                        }
                        className="mt-auto rounded-full bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
                      >
                        {buying === selected?.id
                          ? "Opening checkout…"
                          : !catalogue.data.checkout_available
                            ? "Checkout unavailable"
                            : selected && !selected.sellable
                              ? "Not available yet"
                              : isCurrent
                              ? // Same tier, different term: this is a change of
                                // how they pay, not a new plan, and saying "Get
                                // Premium" to a Premium subscriber reads as a
                                // mistake.
                                selected?.term === "lifetime"
                                ? `Buy ${p.name_en} for life — ${selected?.price_label}`
                                : `Switch to ${selected?.term ?? ""} — ${selected?.price_label}`
                              : `Get ${p.name_en} — ${selected?.price_label}`}
                      </button>
                    )}
                  </Card>
                );
              })}
            </div>

            <p className="text-xs text-muted-foreground">
              Every price here is charged in South African rand ({catalogue.data.currency}) — the
              dollar figures beside them are approximate conversions shown for reference and are
              not what is taken. Monthly and annual subscriptions renew until you cancel;
              Lifetime is a single payment. Annual and Lifetime are billing terms for Premium — they
              unlock exactly what monthly Premium does, no more.
            </p>
          </>
        )}

        {stopped.length > 0 ? (
          <div className="space-y-1 rounded-xl border-l-[3px] border-primary bg-primary/5 p-4 text-sm">
            <p className="flex items-start gap-2 font-medium">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" />
              <span>
                {stopped.length === 1
                  ? `Your ${stopped[0]} subscription has been cancelled.`
                  : "Subscriptions you have outgrown have been cancelled: " +
                    stopped.join(", ") + "."}
              </span>
            </p>
            <p className="pl-6 text-xs text-muted-foreground">
              You keep it until the end of the period you have already paid for, and it will not
              renew. Your plan above is unaffected.
            </p>
          </div>
        ) : null}

        {checkoutError ? (
          <div className="space-y-2 rounded-xl border-l-[3px] border-warning bg-accent/15 p-4 text-sm text-warning">
            <p className="flex items-start gap-2">
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              <span>{checkoutError.message}</span>
            </p>
            {checkoutError.blockers.length > 0 ? (
              <ul className="list-disc space-y-1 pl-8 text-xs">
                {checkoutError.blockers.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            ) : null}
            <p className="pl-8 text-xs">Nothing was charged.</p>
          </div>
        ) : null}
      </section>

      {access.data?.is_admin ? (
        <p className="text-sm">
          <Link to="/admin" className="font-medium text-primary hover:underline">
            Administrator: issue and manage access codes
          </Link>
        </p>
      ) : null}
    </div>
  );
}
