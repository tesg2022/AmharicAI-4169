import { useState } from "react";
import { Link } from "wouter";
import {
  AlertCircle,
  Ban,
  Copy,
  KeyRound,
  ShieldAlert,
  ShieldCheck,
  Ticket,
  Users,
} from "lucide-react";
import { useSession } from "../hooks/use-session";
import {
  useAdminCodes,
  useAdminGrants,
  useAdminStatus,
  useAdminSummary,
  useIssueCode,
  useRevokeCode,
  useRevokeGrant,
} from "../queries/admin";
import { Am, Card, Chip, Loading, TibebRule } from "../components/ui/kit";

/**
 * Administrator surface: issue comp codes, see who holds what, revoke either.
 *
 * The gate is entirely server-side (ADMIN_EMAILS checked against the verified
 * session on every call). This page therefore renders the refusal honestly
 * instead of hiding itself — a blank screen would leave a legitimate admin
 * with a misconfigured ADMIN_EMAILS unable to tell what went wrong.
 */

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

const STATUS_TONE: Record<string, string> = {
  active: "bg-primary/10 text-primary",
  exhausted: "bg-muted text-muted-foreground",
  expired: "bg-muted text-muted-foreground",
  revoked: "bg-destructive/10 text-destructive",
};

export default function AdminPage() {
  const { isSignedIn, user, isPending } = useSession();
  const status = useAdminStatus(isSignedIn);
  const isAdmin = status.isSuccess;

  const summary = useAdminSummary(isAdmin);
  const codes = useAdminCodes(isAdmin);
  const grants = useAdminGrants(isAdmin);
  const issue = useIssueCode();
  const revokeCode = useRevokeCode();
  const revokeGrant = useRevokeGrant();

  const [plan, setPlan] = useState<"learner" | "premium">("learner");
  const [durationDays, setDurationDays] = useState(30);
  const [expiresInDays, setExpiresInDays] = useState(30);
  const [maxRedemptions, setMaxRedemptions] = useState(1);
  const [note, setNote] = useState("");
  const [features, setFeatures] = useState<string[]>([]);
  const [issueError, setIssueError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  if (isPending || status.isLoading) return <Loading label="Checking administrator access…" />;

  if (!isSignedIn) {
    return (
      <div className="mx-auto max-w-xl py-10">
        <Card>
          <p className="flex items-start gap-2 text-sm">
            <ShieldAlert className="mt-0.5 size-4 shrink-0 text-warning" />
            <span>
              The administrator surface needs a signed-in account.{" "}
              <Link to="/sign-in" className="font-medium text-primary hover:underline">
                Sign in
              </Link>
              .
            </span>
          </p>
        </Card>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-xl py-10">
        <Card>
          <p className="flex items-start gap-2 text-sm">
            <ShieldAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
            <span>
              <strong className="font-semibold">Not an administrator.</strong> {user?.email} is not
              listed in this deployment's <code className="font-mono text-xs">ADMIN_EMAILS</code>.
              The check runs on the server for every administrator call, so adding your address to
              that variable and signing in again is the only way in.
            </span>
          </p>
        </Card>
      </div>
    );
  }

  const s = status.data!;

  async function submitIssue(event: React.FormEvent) {
    event.preventDefault();
    setIssueError(null);
    setCopied(false);
    try {
      await issue.mutateAsync({
        plan,
        durationDays,
        expiresInDays,
        maxRedemptions,
        features: features.length > 0 ? features : null,
        note: note.trim() || null,
      });
      setNote("");
    } catch (error) {
      setIssueError(error instanceof Error ? error.message : "Could not issue a code.");
    }
  }

  const inputClass =
    "w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none transition focus:border-primary";

  return (
    <div className="mx-auto max-w-4xl space-y-7 py-2">
      <header className="space-y-3">
        <h1 className="font-display text-3xl font-bold">Administrator</h1>
        <Am className="block text-lg text-primary">አስተዳዳሪ</Am>
        <TibebRule className="max-w-36" />
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <ShieldCheck className="size-4 text-primary" />
          Signed in as {s.admin.email}
        </p>
      </header>

      {/* Deployment truth: what can and cannot be done here. */}
      <div className="grid gap-3 sm:grid-cols-2">
        <Card className="p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Access codes
          </p>
          <p className="mt-1 text-sm">
            {s.access_codes.configured ? "Ready to issue" : "Not configured"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Keyed hash from {s.access_codes.pepper_source ?? "—"}
          </p>
          {s.access_codes.note ? (
            <p className="mt-2 text-xs text-warning">{s.access_codes.note}</p>
          ) : null}
        </Card>
        <Card className="p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Billing ({s.billing.provider})
          </p>
          <p className="mt-1 text-sm">
            {s.billing.configured ? "Configured" : "Cannot take payments"}
          </p>
          {/* Blockers verbatim — an admin has to know why they cannot sell. */}
          {s.billing.blockers.length > 0 ? (
            <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-warning">
              {s.billing.blockers.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          ) : null}
          {s.billing.note ? (
            <p className="mt-2 text-xs text-muted-foreground">{s.billing.note}</p>
          ) : null}
        </Card>
      </div>

      {summary.data ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: "Codes issued", value: summary.data.codes_total },
            { label: "Codes live", value: summary.data.codes_active },
            { label: "Grants total", value: summary.data.grants_total },
            { label: "Grants live", value: summary.data.grants_live },
          ].map((k) => (
            <Card key={k.label} className="p-4">
              <p className="font-display text-2xl font-bold">{k.value}</p>
              <p className="text-xs text-muted-foreground">{k.label}</p>
            </Card>
          ))}
        </div>
      ) : null}

      {/* Issue */}
      <section className="space-y-3">
        <h2 className="flex items-center gap-2 font-display text-xl font-bold">
          <Ticket className="size-5 text-primary" />
          Issue an access code
        </h2>
        <Card>
          <form onSubmit={submitIssue} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-muted-foreground">Plan granted</span>
                <select
                  value={plan}
                  onChange={(e) => setPlan(e.target.value as "learner" | "premium")}
                  aria-label="Plan granted"
                  className={inputClass}
                >
                  <option value="learner">Learner</option>
                  <option value="premium">Premium</option>
                </select>
              </label>
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-muted-foreground">
                  Access duration (days per redeemer)
                </span>
                <input
                  type="number"
                  min={1}
                  max={3650}
                  value={durationDays}
                  onChange={(e) => setDurationDays(Number(e.target.value))}
                  aria-label="Access duration in days"
                  className={inputClass}
                />
              </label>
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-muted-foreground">
                  Code expires in (days)
                </span>
                <input
                  type="number"
                  min={1}
                  max={365}
                  value={expiresInDays}
                  onChange={(e) => setExpiresInDays(Number(e.target.value))}
                  aria-label="Code expires in days"
                  className={inputClass}
                />
              </label>
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-muted-foreground">
                  Maximum redemptions
                </span>
                <input
                  type="number"
                  min={1}
                  max={1000}
                  value={maxRedemptions}
                  onChange={(e) => setMaxRedemptions(Number(e.target.value))}
                  aria-label="Maximum redemptions"
                  className={inputClass}
                />
              </label>
            </div>

            <fieldset className="space-y-2">
              <legend className="text-xs font-medium text-muted-foreground">
                Narrow to specific features (optional — leaving this empty grants the whole plan;
                selecting features can only narrow it, never widen it)
              </legend>
              <div className="flex flex-wrap gap-2">
                {s.features.map((f) => {
                  const on = features.includes(f.id);
                  return (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() =>
                        setFeatures((prev) =>
                          prev.includes(f.id) ? prev.filter((x) => x !== f.id) : [...prev, f.id],
                        )
                      }
                      aria-pressed={on}
                      className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                        on
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border text-muted-foreground hover:bg-muted"
                      }`}
                    >
                      {f.label_en}
                    </button>
                  );
                })}
              </div>
            </fieldset>

            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">
                Note (who this is for — stored with the code)
              </span>
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                aria-label="Note"
                placeholder="Beta tester — Addis teachers cohort"
                maxLength={500}
                className={inputClass}
              />
            </label>

            {issueError ? (
              <p className="flex items-start gap-2 text-sm text-destructive">
                <AlertCircle className="mt-0.5 size-4 shrink-0" />
                <span>{issueError}</span>
              </p>
            ) : null}

            <button
              type="submit"
              disabled={issue.isPending || !s.access_codes.configured}
              className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
            >
              <KeyRound className="size-4" />
              {issue.isPending ? "Generating…" : "Generate code"}
            </button>
          </form>
        </Card>

        {/* Shown once. The plaintext is unrecoverable after this. */}
        {issue.isSuccess && !issueError ? (
          <Card className="border-l-[3px] border-warning bg-accent/10">
            <p className="text-xs font-semibold uppercase tracking-wide text-warning">
              New code — shown once
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <span className="font-mono text-3xl font-bold tracking-[0.3em]">
                {issue.data.code}
              </span>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard?.writeText(issue.data!.code);
                  setCopied(true);
                }}
                className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-semibold hover:bg-muted"
              >
                <Copy className="size-3.5" />
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <p className="mt-2 text-sm text-warning">{issue.data.warning}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Grants {issue.data.plan} for {issue.data.duration_days} days · redeemable until{" "}
              {formatDate(issue.data.expires_at)} · {issue.data.max_redemptions} redemption
              {issue.data.max_redemptions === 1 ? "" : "s"}
            </p>
          </Card>
        ) : null}
      </section>

      {/* Codes */}
      <section className="space-y-3">
        <h2 className="font-display text-xl font-bold">Issued codes</h2>
        {codes.isLoading ? (
          <Loading label="Loading codes…" />
        ) : (codes.data?.length ?? 0) === 0 ? (
          <Card>
            <p className="text-sm text-muted-foreground">No codes issued yet.</p>
          </Card>
        ) : (
          <div className="space-y-2">
            {codes.data!.map((c) => (
              <Card key={c.id} className="p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="space-y-1">
                    <p className="flex items-center gap-2 text-sm font-semibold">
                      <span className="font-mono">····{c.hint}</span>
                      <Chip
                        label={c.status}
                        className={STATUS_TONE[c.status] ?? "bg-muted text-muted-foreground"}
                      />
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {c.plan} · {c.duration_days} days of access · {c.redemption_count}/
                      {c.max_redemptions} redeemed · redeemable until {formatDate(c.expires_at)}
                    </p>
                    {c.note ? <p className="text-xs text-muted-foreground">{c.note}</p> : null}
                    {c.features ? (
                      <p className="text-xs text-muted-foreground">
                        Narrowed to: {c.features.join(", ")}
                      </p>
                    ) : null}
                  </div>
                  {c.status === "revoked" ? null : (
                    <button
                      type="button"
                      onClick={() => revokeCode.mutate({ codeId: c.id })}
                      disabled={revokeCode.isPending}
                      className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-1.5 text-xs font-semibold text-destructive hover:bg-destructive/5 disabled:opacity-50"
                    >
                      <Ban className="size-3.5" />
                      Revoke code
                    </button>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          Revoking a code stops further redemptions. It does not take access away from people who
          already redeemed it — that is the separate action on each grant below.
        </p>
      </section>

      {/* Grants */}
      <section className="space-y-3">
        <h2 className="flex items-center gap-2 font-display text-xl font-bold">
          <Users className="size-5 text-primary" />
          Who holds what
        </h2>
        {grants.data?.note ? (
          <p className="rounded-xl bg-muted p-3 text-xs text-muted-foreground">
            {grants.data.note}
          </p>
        ) : null}
        {grants.isLoading ? (
          <Loading label="Loading grants…" />
        ) : (grants.data?.grants.length ?? 0) === 0 ? (
          <Card>
            <p className="text-sm text-muted-foreground">Nobody has redeemed a code yet.</p>
          </Card>
        ) : (
          <div className="space-y-2">
            {grants.data!.grants.map((g) => (
              <Card key={g.id} className="p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="space-y-1">
                    <p className="flex items-center gap-2 text-sm font-semibold">
                      <span className="font-mono text-xs">{g.user_id}</span>
                      <Chip
                        label={g.status}
                        className={STATUS_TONE[g.status] ?? "bg-muted text-muted-foreground"}
                      />
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {g.granted_plan} · from code ····{g.hint} · redeemed{" "}
                      {formatDate(g.redeemed_at)} · until {formatDate(g.grants_until)}
                    </p>
                    {g.note ? <p className="text-xs text-muted-foreground">{g.note}</p> : null}
                  </div>
                  {g.status === "revoked" ? null : (
                    <button
                      type="button"
                      onClick={() => revokeGrant.mutate({ redemptionId: g.id })}
                      disabled={revokeGrant.isPending}
                      className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-1.5 text-xs font-semibold text-destructive hover:bg-destructive/5 disabled:opacity-50"
                    >
                      <Ban className="size-3.5" />
                      Revoke access
                    </button>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
