import { useState } from "react";
import { Link } from "wouter";
import {
  AlertCircle,
  Ban,
  Copy,
  KeyRound,
  Plus,
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
import { useSeo } from "../hooks/use-seo";

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

/**
 * What an administrator picks from, and what that means underneath.
 *
 * Basic and Premium are the only entitlement tiers the build has. Annual is a
 * *billing term of Premium* — an annual and a monthly Premium subscriber can
 * do exactly the same things — so it is offered here as a ready-made duration
 * of Premium rather than as an invented tier. That keeps every server-side
 * gate working off the same three plan ids it already knows.
 *
 * The durations stop at a year on purpose. A code is a granted period of
 * access, and there is no permanent grant to hand out: billing is
 * subscription-only, so nothing here should mint something the shop does not
 * sell. The duration field below is still editable for the odd longer case.
 */
const PLAN_CHOICES = [
  { id: "basic", plan: "basic" as const, days: 30, label: "Basic — 30 days" },
  { id: "premium", plan: "premium" as const, days: 30, label: "Premium — 30 days" },
  { id: "annual", plan: "premium" as const, days: 365, label: "Annual (Premium) — 365 days" },
] as const;

type PlanChoiceId = (typeof PLAN_CHOICES)[number]["id"];

const STATUS_TONE: Record<string, string> = {
  active: "bg-primary/10 text-primary",
  exhausted: "bg-muted text-muted-foreground",
  expired: "bg-muted text-muted-foreground",
  revoked: "bg-destructive/10 text-destructive",
};

export default function AdminPage() {
  useSeo({ title: "Admin", description: "Internal.", noIndex: true });

  const { isSignedIn, user, isPending } = useSession();
  const status = useAdminStatus(isSignedIn);
  const isAdmin = status.isSuccess;

  const summary = useAdminSummary(isAdmin);
  const codes = useAdminCodes(isAdmin);
  const grants = useAdminGrants(isAdmin);
  const issue = useIssueCode();
  const revokeCode = useRevokeCode();
  const revokeGrant = useRevokeGrant();

  const [choice, setChoice] = useState<PlanChoiceId>("basic");
  const [durationDays, setDurationDays] = useState<number>(PLAN_CHOICES[0].days);
  const [expiresInDays, setExpiresInDays] = useState(30);
  const [quantity, setQuantity] = useState(1);
  const [maxRedemptions, setMaxRedemptions] = useState(1);
  const [note, setNote] = useState("");
  const [features, setFeatures] = useState<string[]>([]);
  const [issueError, setIssueError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  /**
   * Plaintext codes minted in this browser session, keyed by code id. The
   * server stores only a keyed hash, so this map is the one and only place a
   * full code can still be read — and it dies with the page. The table says
   * so instead of implying an admin can come back for it later.
   */
  const [revealed, setRevealed] = useState<Record<string, string>>({});

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

  const selected = PLAN_CHOICES.find((c) => c.id === choice) ?? PLAN_CHOICES[0];

  async function submitIssue(event: React.FormEvent) {
    event.preventDefault();
    setIssueError(null);
    setCopied(false);
    try {
      const result = await issue.mutateAsync({
        plan: selected.plan,
        durationDays,
        expiresInDays,
        quantity,
        maxRedemptions,
        features: features.length > 0 ? features : null,
        note: note.trim() || null,
      });
      // Hold the plaintexts for this session so the table can show them.
      setRevealed((prev) => {
        const next = { ...prev };
        for (const c of result.codes) next[c.id] = c.code;
        return next;
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

      {/* Access codes */}
      <section className="space-y-3" id="access-codes">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 font-display text-xl font-bold">
            <Ticket className="size-5 text-primary" />
            Access Codes
          </h2>
          <button
            type="button"
            onClick={() => setFormOpen((open) => !open)}
            aria-expanded={formOpen}
            aria-controls="create-access-code"
            className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
          >
            <Plus className="size-4" />
            {formOpen ? "Close" : "Create Access Code"}
          </button>
        </div>

        {formOpen ? (
        <Card>
          <div id="create-access-code">
          <form onSubmit={submitIssue} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-muted-foreground">Plan</span>
                <select
                  value={choice}
                  onChange={(e) => {
                    const next = e.target.value as PlanChoiceId;
                    setChoice(next);
                    // The picked term sets the duration; it stays editable,
                    // because "Annual, but 400 days" is a real thing to want.
                    const found = PLAN_CHOICES.find((c) => c.id === next);
                    if (found) setDurationDays(found.days);
                  }}
                  aria-label="Plan"
                  className={inputClass}
                >
                  {PLAN_CHOICES.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
                <span className="block text-[11px] text-muted-foreground">
                  Grants the {selected.plan} tier. Annual is a term of Premium, not a separate
                  tier — it differs only in how many days it grants.
                </span>
              </label>
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-muted-foreground">
                  Duration (days of access per redeemer)
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
                <span className="block text-[11px] text-muted-foreground">
                  Counted from each person's redemption, so a code handed out today and redeemed
                  next week still gives its full {durationDays} days.
                </span>
              </label>
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-muted-foreground">
                  Number of codes to generate
                </span>
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={quantity}
                  onChange={(e) => setQuantity(Number(e.target.value))}
                  aria-label="Number of codes to generate"
                  className={inputClass}
                />
                <span className="block text-[11px] text-muted-foreground">
                  Separate codes, each redeemable and revocable on its own.
                </span>
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
                <span className="block text-[11px] text-muted-foreground">
                  How long the code stays redeemable. After this it is dead whether or not anyone
                  used it.
                </span>
              </label>
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-muted-foreground">
                  Redemptions per code
                </span>
                <input
                  type="number"
                  min={1}
                  max={1000}
                  value={maxRedemptions}
                  onChange={(e) => setMaxRedemptions(Number(e.target.value))}
                  aria-label="Maximum redemptions per code"
                  className={inputClass}
                />
                <span className="block text-[11px] text-muted-foreground">
                  Keep at 1 for one-person codes. Any one account can redeem a given code only
                  once regardless.
                </span>
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
              {issue.isPending
                ? "Generating…"
                : quantity === 1
                  ? "Generate code"
                  : `Generate ${quantity} codes`}
            </button>
          </form>
          </div>
        </Card>
        ) : null}

        {/* Shown once. The plaintext is unrecoverable after this. */}
        {issue.isSuccess && !issueError ? (
          <Card className="border-l-[3px] border-warning bg-accent/10">
            <p className="text-xs font-semibold uppercase tracking-wide text-warning">
              {issue.data.codes.length === 1 ? "New code" : `${issue.data.codes.length} new codes`}{" "}
              — shown once
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-x-6 gap-y-2">
              {issue.data.codes.map((c) => (
                <span key={c.id} className="font-mono text-3xl font-bold tracking-[0.3em]">
                  {c.code}
                </span>
              ))}
            </div>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(
                  issue.data!.codes.map((c) => c.code).join("\n"),
                );
                setCopied(true);
              }}
              className="mt-3 inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-semibold hover:bg-muted"
            >
              <Copy className="size-3.5" />
              {copied ? "Copied" : issue.data.codes.length === 1 ? "Copy" : "Copy all"}
            </button>
            <p className="mt-2 text-sm text-warning">{issue.data.warning}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Grants {issue.data.plan} for {issue.data.duration_days} days · redeemable until{" "}
              {formatDate(issue.data.expires_at)} · {issue.data.max_redemptions} redemption
              {issue.data.max_redemptions === 1 ? "" : "s"} each
            </p>
          </Card>
        ) : null}

        {/* The register. Columns are the ones an admin actually acts on. */}
        {codes.isLoading ? (
          <Loading label="Loading codes…" />
        ) : (codes.data?.length ?? 0) === 0 ? (
          <Card>
            <p className="text-sm text-muted-foreground">
              No codes yet. Create one and it appears here.
            </p>
          </Card>
        ) : (
          <Card className="overflow-x-auto p-0">
            <table className="w-full min-w-[52rem] text-left text-xs">
              <thead className="border-b border-border bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-semibold">Code</th>
                  <th className="px-3 py-2 font-semibold">Plan</th>
                  <th className="px-3 py-2 font-semibold">Duration</th>
                  <th className="px-3 py-2 font-semibold">Status</th>
                  <th className="px-3 py-2 font-semibold">Created</th>
                  <th className="px-3 py-2 font-semibold">Redeemed by</th>
                  <th className="px-3 py-2 font-semibold">Redeemed</th>
                  <th className="px-3 py-2 font-semibold">Expiry</th>
                  <th className="px-3 py-2 font-semibold" />
                </tr>
              </thead>
              <tbody>
                {codes.data!.map((c) => {
                  const first = c.redemptions[0];
                  return (
                    <tr key={c.id} className="border-b border-border/60 last:border-0 align-top">
                      <td className="px-3 py-2 font-mono text-sm font-semibold">
                        {revealed[c.id] ? (
                          <span className="tracking-[0.2em]">{revealed[c.id]}</span>
                        ) : (
                          <span className="text-muted-foreground">····{c.hint}</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {c.plan}
                        {c.features ? (
                          <span className="block text-[11px] text-muted-foreground">
                            only {c.features.join(", ")}
                          </span>
                        ) : null}
                        {c.note ? (
                          <span className="block text-[11px] text-muted-foreground">{c.note}</span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2">{c.duration_days} days</td>
                      <td className="px-3 py-2">
                        <Chip
                          label={c.status}
                          className={STATUS_TONE[c.status] ?? "bg-muted text-muted-foreground"}
                        />
                        {c.max_redemptions > 1 ? (
                          <span className="mt-1 block text-[11px] text-muted-foreground">
                            {c.redemption_count}/{c.max_redemptions} used
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {formatDate(c.created_at)}
                      </td>
                      <td className="px-3 py-2">
                        {first ? (
                          <span className="font-mono text-[11px]">{first.user_id}</span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                        {c.redemptions.length > 1 ? (
                          <span className="block text-[11px] text-muted-foreground">
                            +{c.redemptions.length - 1} more
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {first ? formatDate(first.redeemed_at) : "—"}
                      </td>
                      <td className="px-3 py-2">
                        {first ? (
                          <>
                            {formatDate(first.grants_until)}
                            <span className="block text-[11px] text-muted-foreground">
                              access ends
                            </span>
                          </>
                        ) : (
                          <>
                            {formatDate(c.expires_at)}
                            <span className="block text-[11px] text-muted-foreground">
                              redeemable until
                            </span>
                          </>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {c.status === "revoked" ? null : (
                          <button
                            type="button"
                            onClick={() => revokeCode.mutate({ codeId: c.id })}
                            disabled={revokeCode.isPending}
                            className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-[11px] font-semibold text-destructive hover:bg-destructive/5 disabled:opacity-50"
                          >
                            <Ban className="size-3" />
                            Disable
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        )}
        <p className="text-xs text-muted-foreground">
          A full code is shown only at the moment it is generated — the server keeps a keyed hash,
          never the digits, so the table can only show the last two afterwards. Disabling a code
          stops further redemptions; it does not take access away from someone who already
          redeemed it, which is the separate action on each grant below.
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
