import { useState } from "react";
import { Link, useLocation } from "wouter";
import {
  AlertTriangle,
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  Mail,
  ShieldCheck,
  Trash2,
  Undo2,
} from "lucide-react";
import { useSession } from "../hooks/use-session";
import { authClient } from "../lib/auth";
import {
  useAccount,
  useCancelDeletion,
  useDeleteNow,
  useRequestDeletion,
} from "../queries/account";
import { Card, Loading, TibebRule } from "../components/ui/kit";
import { useSeo } from "../hooks/use-seo";

/**
 * Account, and the deletion path Google Play requires.
 *
 * Three rules this screen holds to:
 *
 *   - it states exactly what is erased and exactly what is kept, from
 *     `deletion_policy` on the server, so the two can never drift apart
 *   - nothing irreversible happens on a single tap: the phrase is typed, and
 *     "delete immediately" re-asks for it even if a deletion is already
 *     scheduled
 *   - a scheduled deletion is read from the server, not from local state, so
 *     it shows up on every device the learner signs in on
 */

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function daysUntil(iso: string): number {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000));
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

// plan_source, not plan_is_verified, is what the learner needs explained: an
// unverified "free" plan is simply the default tier, not a failed subscription.
function planProvenance(source: string, verified: boolean): string {
  if (source === "default_free") return "You are on the free tier. Upgrade whenever you want more.";
  if (source === "preview_cookie")
    return "A preview on this device only — it is not recorded against your account.";
  return verified
    ? "Recorded against your account on the server."
    : "Not yet confirmed on the server. Reload in a moment, or contact support.";
}

export default function AccountPage() {
  useSeo({
    title: "Account & data",
    description: "Manage your AmharicAI account, your data and account deletion.",
    noIndex: true,
  });

  const [, navigate] = useLocation();
  const { isSignedIn, isPending } = useSession();
  const account = useAccount(isSignedIn);

  const requestDeletion = useRequestDeletion();
  const cancelDeletion = useCancelDeletion();
  const deleteNow = useDeleteNow();

  const [phrase, setPhrase] = useState("");
  const [reason, setReason] = useState("");
  const [mode, setMode] = useState<"schedule" | "immediate">("schedule");
  const [failure, setFailure] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // The erasure has already run; there is no account left to render. This is
  // checked *before* the session, because the erasure destroys the session —
  // otherwise the learner is bounced to "sign in to manage your account" and
  // never sees confirmation that their data is actually gone.
  if (done) {
    return (
      <div className="mx-auto max-w-xl py-16 text-center">
        <CheckCircle2 className="mx-auto size-10 text-primary" />
        <h1 className="mt-4 font-display text-3xl font-bold">Your account is deleted</h1>
        <p className="mt-3 leading-relaxed text-muted-foreground">
          Everything we held about you has been erased from our database. Nothing is recoverable,
          including by us. The only record kept is a dated note that a deletion happened, with no
          personal data in it, because the law requires us to be able to show that we honoured your
          request.
        </p>
        <a
          href="/app"
          className="mt-6 inline-block rounded-full bg-primary px-6 py-3 font-medium text-primary-foreground"
        >
          Back to the course
        </a>
      </div>
    );
  }

  if (isPending) return <Loading label="Loading" />;

  if (!isSignedIn) {
    return (
      <div className="mx-auto max-w-xl py-16 text-center">
        <h1 className="font-display text-3xl font-bold">Your account</h1>
        <p className="mt-3 text-muted-foreground">
          Sign in to manage your account, or to delete it and everything in it.
        </p>
        <Link
          to="/sign-in"
          className="mt-6 inline-block rounded-full bg-primary px-6 py-3 font-medium text-primary-foreground"
        >
          Sign in
        </Link>
        <p className="mt-8 text-sm text-muted-foreground">
          Cannot sign in and need your data deleted? Email{" "}
          <a className="text-primary hover:underline" href="mailto:admin@amharicai.org">
            admin@amharicai.org
          </a>{" "}
          from the address on the account.
        </p>
      </div>
    );
  }

  if (account.isLoading || !account.data) return <Loading label="Loading your account" />;

  const data = account.data;
  const policy = data.deletion_policy;
  const pending = data.deletion;
  const phraseOk = phrase.trim().toUpperCase() === policy.confirm_phrase;
  const busy = requestDeletion.isPending || deleteNow.isPending || cancelDeletion.isPending;

  async function submit() {
    setFailure(null);
    try {
      if (mode === "immediate") {
        await deleteNow.mutateAsync({ confirm: phrase.trim() });
        // The server has already destroyed the session rows; clear the local
        // token too so the app does not keep showing a signed-in shell.
        await authClient.signOut().catch(() => undefined);
        setDone(true);
        return;
      }
      await requestDeletion.mutateAsync({
        confirm: phrase.trim(),
        reason: reason.trim() || undefined,
      });
      setPhrase("");
      setReason("");
    } catch (error) {
      setFailure(errorMessage(error, "That did not go through. Nothing has been deleted."));
    }
  }

  async function cancel() {
    setFailure(null);
    try {
      await cancelDeletion.mutateAsync({});
    } catch (error) {
      setFailure(errorMessage(error, "The deletion could not be cancelled."));
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <button
        type="button"
        onClick={() => navigate("/progress")}
        className="mb-4 inline-flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Back
      </button>

      <h1 className="font-display text-3xl font-bold">Your account</h1>
      <p className="mt-2 text-muted-foreground">
        {data.user.email}
        {data.user.created_at ? ` · joined ${formatDate(data.user.created_at)}` : ""}
      </p>

      <Card className="mt-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-display text-base font-bold capitalize">{data.plan} plan</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {planProvenance(data.plan_source, data.plan_is_verified)}
              {data.expires_at ? ` Renews or ends ${formatDate(data.expires_at)}.` : ""}
            </p>
          </div>
          <Link
            to="/subscription"
            className="rounded-full border border-border px-4 py-2 text-sm font-medium hover:bg-muted"
          >
            Manage plan
          </Link>
        </div>
      </Card>

      <TibebRule className="my-8" />

      {/* Scheduled deletion takes over the screen — it is the most important
          fact about the account while it is true. */}
      {pending ? (
        <Card className="border-destructive/40">
          <div className="flex items-start gap-3">
            <CalendarClock className="mt-0.5 size-5 shrink-0 text-destructive" />
            <div>
              <p className="font-display text-lg font-bold">Deletion scheduled</p>
              <p className="mt-2 leading-relaxed text-muted-foreground">
                Your account and everything in it will be erased on{" "}
                <strong className="text-foreground">{formatDate(pending.execute_after)}</strong> —{" "}
                {daysUntil(pending.execute_after)} day
                {daysUntil(pending.execute_after) === 1 ? "" : "s"} from now. Until then you can
                keep learning, and you can change your mind.
              </p>
              <button
                type="button"
                onClick={cancel}
                disabled={busy}
                className="mt-4 inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                <Undo2 className="size-4" />
                {cancelDeletion.isPending ? "Cancelling…" : "Keep my account"}
              </button>
            </div>
          </div>
        </Card>
      ) : null}

      <Card className={pending ? "mt-4" : ""}>
        <div className="flex items-center gap-2">
          <Trash2 className="size-5 text-destructive" />
          <h2 className="font-display text-lg font-bold">
            {pending ? "Delete immediately instead" : "Delete your account"}
          </h2>
        </div>

        <p className="mt-3 leading-relaxed text-muted-foreground">
          This is a real deletion, not a deactivation. It cannot be undone once it runs, and we
          cannot restore anything afterwards.
        </p>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-sm font-semibold">What is erased</p>
            <ul className="mt-2 space-y-1.5">
              {policy.erased.map((item) => (
                <li key={item} className="flex gap-2 text-sm text-muted-foreground">
                  <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full bg-destructive/60" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-sm font-semibold">What is kept, and why</p>
            <ul className="mt-2 space-y-1.5">
              {policy.retained.map((item) => (
                <li key={item.what} className="text-sm text-muted-foreground">
                  <span className="text-foreground">{item.what}</span> — {item.why}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <fieldset className="mt-6">
          <legend className="text-sm font-semibold">When</legend>
          <div className="mt-2 space-y-2">
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border p-3 text-sm">
              <input
                type="radio"
                name="deletion-mode"
                className="mt-1"
                checked={mode === "schedule"}
                onChange={() => setMode("schedule")}
                disabled={Boolean(pending)}
              />
              <span>
                <span className="font-medium">
                  In {policy.grace_days} days {pending ? "(already scheduled)" : "(recommended)"}
                </span>
                <span className="block text-muted-foreground">
                  You can cancel at any point during those {policy.grace_days} days by signing in.
                </span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border p-3 text-sm">
              <input
                type="radio"
                name="deletion-mode"
                className="mt-1"
                checked={mode === "immediate"}
                onChange={() => setMode("immediate")}
              />
              <span>
                <span className="font-medium">Immediately</span>
                <span className="block text-muted-foreground">
                  Erased the moment you confirm. There is no grace period and no way back.
                </span>
              </span>
            </label>
          </div>
        </fieldset>

        {mode === "schedule" && !pending ? (
          <label className="mt-5 block">
            <span className="text-sm font-semibold">Why are you leaving? (optional)</span>
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={500}
              rows={2}
              placeholder="It helps us fix what drove you away."
              className="mt-2 w-full rounded-xl border border-border bg-background p-3 text-sm outline-none focus:border-primary"
            />
          </label>
        ) : null}

        <label className="mt-5 block">
          <span className="text-sm font-semibold">
            Type {policy.confirm_phrase} to confirm
          </span>
          <input
            value={phrase}
            onChange={(event) => setPhrase(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            aria-label={`Type ${policy.confirm_phrase} to confirm account deletion`}
            className="mt-2 w-full rounded-xl border border-border bg-background p-3 font-mono text-sm uppercase tracking-widest outline-none focus:border-destructive"
            placeholder={policy.confirm_phrase}
          />
        </label>

        {failure ? (
          <p
            role="alert"
            className="mt-4 flex items-start gap-2 rounded-xl bg-destructive/10 p-3 text-sm text-destructive"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            {failure}
          </p>
        ) : null}

        <button
          type="button"
          onClick={submit}
          disabled={!phraseOk || busy || (mode === "schedule" && Boolean(pending))}
          className="mt-5 inline-flex items-center gap-2 rounded-full bg-destructive px-6 py-3 text-sm font-semibold text-destructive-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Trash2 className="size-4" />
          {busy
            ? "Working…"
            : mode === "immediate"
              ? "Delete everything now"
              : `Schedule deletion in ${policy.grace_days} days`}
        </button>
      </Card>

      <Card className="mt-4" tone="muted">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 size-5 shrink-0 text-primary" />
          <p className="text-sm leading-relaxed text-muted-foreground">
            You can also ask for a copy of your data, or ask us to delete it on your behalf, by
            emailing{" "}
            <a className="text-primary hover:underline" href="mailto:admin@amharicai.org">
              admin@amharicai.org
            </a>{" "}
            from the address on your account. See the{" "}
            <Link to="/privacy" className="text-primary hover:underline">
              Privacy Policy
            </Link>{" "}
            for what we hold and for how long.
          </p>
        </div>
      </Card>

      <p className="mt-6 flex items-center gap-2 text-xs text-muted-foreground">
        <Mail className="size-3.5" />
        Questions about any of this: admin@amharicai.org
      </p>
    </div>
  );
}
