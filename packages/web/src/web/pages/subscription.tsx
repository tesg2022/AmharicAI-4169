import { useState } from "react";
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
  Ticket,
} from "lucide-react";
import { useSession } from "../hooks/use-session";
import { useAccess, useCheckout, useMyRedemptions, useRedeemCode } from "../queries/access";
import { Am, Card, Chip, Loading, TibebRule } from "../components/ui/kit";

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
 *   - checkout cannot charge, so the button reports the real blockers rather
 *     than opening a payment flow that goes nowhere
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
  const { isSignedIn, user } = useSession();
  const access = useAccess();
  const redemptions = useMyRedemptions(isSignedIn);
  const redeem = useRedeemCode();
  const checkout = useCheckout();

  const [code, setCode] = useState("");
  const [redeemError, setRedeemError] = useState<string | null>(null);
  const [checkoutError, setCheckoutError] = useState<{
    message: string;
    blockers: string[];
  } | null>(null);

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

  async function tryCheckout(planId: string) {
    setCheckoutError(null);
    try {
      await checkout.mutateAsync({ plan: planId });
    } catch (error) {
      const data_ = (error as { data?: { blockers?: string[] } }).data;
      setCheckoutError({
        message: error instanceof Error ? error.message : "Checkout is unavailable.",
        blockers: Array.isArray(data_?.blockers) ? data_.blockers : [],
      });
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
                    Code accepted — {redeem.data.granted_plan} until{" "}
                    {formatDate(redeem.data.grants_until)} ({redeem.data.duration_days} days).
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
        <div className="grid gap-3 sm:grid-cols-3">
          {data.plans.map((p) => (
            <Card key={p.id} className="flex flex-col gap-2 p-4">
              <p className="font-display text-lg font-bold">{p.name_en}</p>
              <p className="text-sm text-muted-foreground">
                {p.price_usd_month === 0 ? "Free" : `$${p.price_usd_month.toFixed(2)}/month`}
              </p>
              <p className="text-xs text-muted-foreground">
                {p.max_units === null
                  ? "Every written unit"
                  : `First ${p.max_units} units`}
                {" · "}
                {p.tts_per_day === null
                  ? "Unmetered audio"
                  : `${p.tts_per_day} audio plays/day (not enforced yet)`}
              </p>
              {p.id === data.plan ? (
                <span className="mt-auto rounded-full bg-primary/10 px-3 py-2 text-center text-xs font-semibold text-primary">
                  Your current plan
                </span>
              ) : p.price_usd_month === 0 ? null : (
                <button
                  type="button"
                  onClick={() => tryCheckout(p.id)}
                  disabled={checkout.isPending}
                  className="mt-auto rounded-full border border-border px-3 py-2 text-xs font-semibold transition hover:bg-muted disabled:opacity-50"
                >
                  {checkout.isPending ? "Checking…" : `Upgrade to ${p.name_en}`}
                </button>
              )}
            </Card>
          ))}
        </div>

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
            <p className="pl-8 text-xs">
              Nothing was charged. An administrator-issued access code is the only way to hold a
              paid plan in this build.
            </p>
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
