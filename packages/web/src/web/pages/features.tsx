import { Link } from "wouter";
import { ArrowRight, CircleDashed, CircleSlash, Clock, Info } from "lucide-react";
import {
  FEATURES,
  PLANS,
  STATE_LABELS,
  planById,
  type CapabilityStatus,
  type PlanId,
} from "../../api/content/plans";
import { useSeo } from "../hooks/use-seo";
import { Am, Card, TibebRule } from "../components/ui/kit";

/**
 * The capability table, in public.
 *
 * This page is rendered straight from `api/content/plans.ts` rather than from
 * hand-written marketing copy, so it cannot drift from what the gates in the
 * app actually do. Anything not built says so here, in the same words the
 * signed-in screens use — a visitor should be able to find out that the custom
 * voice does not exist yet *before* paying, not after.
 */

const STATE_STYLE: Record<CapabilityStatus, { chip: string; icon: typeof Info; note: string }> = {
  available: {
    chip: "bg-primary/12 text-primary",
    icon: Info,
    note: "Built and working today.",
  },
  preview: {
    chip: "bg-sky/12 text-sky",
    icon: CircleDashed,
    note: "Usable, not yet verified end to end.",
  },
  not_configured: {
    chip: "bg-accent/25 text-warning",
    icon: CircleSlash,
    note: "The code is there; this deployment has not been given the service it needs.",
  },
  coming_soon: {
    chip: "bg-muted text-muted-foreground",
    icon: Clock,
    note: "Does not exist in this build. Never gated, never sold.",
  },
};

const PLAN_LABEL: Record<PlanId, string> = {
  free: "Free",
  basic: "Basic",
  premium: "Premium",
};

/** Grouping order: what works, then what half-works, then what does not exist. */
const GROUPS: { status: CapabilityStatus; heading: string; blurb: string }[] = [
  {
    status: "available",
    heading: "Working now",
    blurb: "Verified in this build. These are the reasons to sign up today.",
  },
  {
    status: "preview",
    heading: "In preview",
    blurb:
      "Reachable and usable, but not signed off. Use them, and judge the output rather than trusting it.",
  },
  {
    status: "not_configured",
    heading: "Needs a service this deployment has not been given",
    blurb:
      "Written and ready, waiting on a host or a provider key. The app tells you plainly instead of failing quietly.",
  },
  {
    status: "coming_soon",
    heading: "Not built yet",
    blurb:
      "Listed because they are on the roadmap and because hiding them would let the price list imply they exist. No plan unlocks these.",
  },
];

export default function FeaturesPage() {
  useSeo({
    title: "Features — what works today, and what does not",
    description:
      "Every AmharicAI feature with its real status: the ፊደል course and pronunciation guide work now, the AI tutor is a preview, and the custom Amharic voice and speaking feedback are not built yet.",
    path: "/features",
  });

  return (
    <div className="space-y-12">
      <header className="max-w-3xl space-y-4">
        <h1 className="font-display text-3xl font-bold leading-tight md:text-5xl">
          What AmharicAI actually does
        </h1>
        <TibebRule className="max-w-56" />
        <p className="text-base leading-relaxed text-muted-foreground">
          This page is generated from the same capability table the app uses to decide what to
          show you. If a feature is not finished, it says so here in the same words — before
          you pay, not after.
        </p>
      </header>

      {GROUPS.map((group) => {
        const items = FEATURES.filter((f) => f.capability === group.status);
        if (items.length === 0) return null;
        const style = STATE_STYLE[group.status];
        return (
          <section key={group.status} className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="font-display text-xl font-bold md:text-2xl">{group.heading}</h2>
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${style.chip}`}
              >
                <style.icon className="size-3" />
                {STATE_LABELS[group.status].en}
              </span>
            </div>
            <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
              {group.blurb}
            </p>

            <div className="grid gap-4 md:grid-cols-2">
              {items.map((f) => (
                <Card key={f.id} className="space-y-2.5">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <h3 className="font-display text-lg font-bold leading-snug">{f.label_en}</h3>
                    <span
                      className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${style.chip}`}
                    >
                      {STATE_LABELS[f.capability].en}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    <Am>{f.label_am}</Am>
                  </p>
                  {f.caveat_en ? (
                    <p className="rounded-lg border-l-[3px] border-border bg-muted/60 p-2.5 text-xs leading-relaxed text-muted-foreground">
                      {f.caveat_en}
                    </p>
                  ) : null}
                  <p className="text-xs font-medium text-muted-foreground">
                    {f.capability === "coming_soon"
                      ? "No plan unlocks this yet."
                      : `Included from ${PLAN_LABEL[f.min_plan]} upward.`}
                  </p>
                </Card>
              ))}
            </div>
          </section>
        );
      })}

      {/* Quotas, stated as numbers rather than as "unlimited". */}
      <section className="space-y-4">
        <h2 className="font-display text-xl font-bold md:text-2xl">The limits, as numbers</h2>
        <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
          Every allowance is a number the server enforces. Premium's tutor ceiling is a fair-use
          cap set far above any human study load — it is written down rather than advertised as
          unlimited, because an account with no ceiling at all is an unbounded bill.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[36rem] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="py-2.5 pr-4 font-semibold">Plan</th>
                <th className="py-2.5 pr-4 font-semibold">Course units</th>
                <th className="py-2.5 pr-4 font-semibold">Tutor questions</th>
                <th className="py-2.5 pr-4 font-semibold">Audio playbacks</th>
                <th className="py-2.5 font-semibold">Translation</th>
              </tr>
            </thead>
            <tbody>
              {PLANS.map((p) => {
                const q = planById(p.id).quotas;
                return (
                  <tr key={p.id} className="border-b border-border/60 align-top">
                    <td className="py-3 pr-4 font-semibold">{p.name_en}</td>
                    <td className="py-3 pr-4 text-muted-foreground">
                      {p.max_units === null ? "Every written unit" : `First ${p.max_units}`}
                    </td>
                    <td className="py-3 pr-4 text-muted-foreground">
                      {q.tutor_per_month.toLocaleString()} / month
                      {q.tutor_is_fair_use ? " (fair use)" : ""}
                    </td>
                    <td className="py-3 pr-4 text-muted-foreground">
                      {q.tts_per_day === null ? "Unmetered" : `${q.tts_per_day} / day`}
                    </td>
                    <td className="py-3 text-muted-foreground">
                      {q.translate_chars === null
                        ? "Not included"
                        : `${q.translate_chars.toLocaleString()} characters`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground">
          Audio playback and translation are listed as "Not configured" above — the allowances
          are what applies once the services they need are connected.
        </p>
      </section>

      <section className="rounded-2xl border border-border bg-card px-6 py-9 text-center">
        <h2 className="font-display text-2xl font-bold">The free plan is the honest way in</h2>
        <p className="mx-auto mt-2.5 max-w-xl text-sm leading-relaxed text-muted-foreground">
          The ፊደል, the pronunciation guide and the first two units cost nothing and do not
          expire. Decide from the real thing.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link
            to="/sign-in"
            className="inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground hover:opacity-90"
          >
            Start free <ArrowRight className="size-4" />
          </Link>
          <Link
            to="/pricing"
            className="inline-flex items-center gap-2 rounded-full border border-border px-6 py-3 text-sm font-semibold hover:bg-muted"
          >
            See the prices
          </Link>
        </div>
      </section>
    </div>
  );
}
