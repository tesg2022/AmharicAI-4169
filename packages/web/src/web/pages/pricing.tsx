import { useState } from "react";
import { Link } from "wouter";
import { ArrowRight, Check, Minus } from "lucide-react";
import {
  BILLING_OPTIONS,
  FEATURES,
  PLANS,
  PLAN_ORDER,
  billingOptionsFor,
  featureState,
  formatApproxUsd,
  formatZar,
  tutorAllowanceLabel,
  type BillingTerm,
  type PlanId,
} from "../../api/content/plans";
import { useSession } from "../hooks/use-session";
import { useSeo } from "../hooks/use-seo";
import { Am, Card, TibebRule } from "../components/ui/kit";

/**
 * The public price list.
 *
 * Deliberately separate from /subscription, which is the signed-in billing
 * screen: this page sells, that page charges. Both read their numbers from
 * `api/content/plans.ts`, so a price can never be changed on one and left
 * stale on the other, and neither can offer a feature the capability table
 * says does not exist.
 */

const TERMS: { id: BillingTerm; label: string; hint: string }[] = [
  { id: "monthly", label: "Monthly", hint: "Cancel any time" },
  { id: "annual", label: "Annual", hint: "33% less than monthly" },
  { id: "lifetime", label: "Lifetime", hint: "One payment" },
];

/** Rows of the comparison table: label, then what each plan gets. */
function planRowValue(plan: PlanId, row: string): string | boolean {
  const p = PLANS.find((x) => x.id === plan)!;
  switch (row) {
    case "units":
      return p.max_units === null ? "Every written unit" : `First ${p.max_units} units`;
    case "fidel":
      return true;
    case "tutor":
      return tutorAllowanceLabel(plan);
    case "tts":
      return p.quotas.tts_per_day === null
        ? "Unmetered"
        : `${p.quotas.tts_per_day} a day`;
    case "translate":
      return p.quotas.translate_chars === null
        ? false
        : `${p.quotas.translate_chars.toLocaleString()} characters`;
    case "practice":
      return true;
    default:
      return false;
  }
}

const ROWS: { id: string; label: string; note?: string }[] = [
  { id: "fidel", label: "ፊደል chart and pronunciation guide" },
  { id: "units", label: "Written course units" },
  { id: "tutor", label: "AI tutor questions", note: "Preview — its Amharic is a draft" },
  { id: "tts", label: "Listen to Amharic lines", note: "Needs a TTS host; not connected yet" },
  { id: "translate", label: "Translate your own text", note: "Needs a provider key; not set" },
  { id: "practice", label: "Flashcards, quizzes, streaks and XP" },
];

/**
 * The charged figure is the rand one — that is what Paystack takes and what
 * appears on the card statement. The dollar figure underneath is a rough
 * conversion at a fixed reference rate, shown because most learners here do
 * not price things in rand, and marked approximate every time so nobody reads
 * it as the amount being charged.
 */
function priceLine(
  plan: PlanId,
  term: BillingTerm,
): { amount: string; sub: string; approx: string | null } | null {
  if (plan === "free") return { amount: formatZar(0), sub: "forever, no card", approx: null };
  const options = billingOptionsFor(plan);
  const exact = options.find((o) => o.term === term);
  const chosen = exact ?? options.find((o) => o.term === "monthly");
  if (!chosen) return null;
  const suffix =
    chosen.term === "monthly" ? "per month" : chosen.term === "annual" ? "per year" : "once";
  return {
    amount: formatZar(chosen.price_zar),
    sub: suffix,
    approx: `${formatApproxUsd(chosen.price_zar)} — approximate`,
  };
}

export default function PricingPage() {
  const [term, setTerm] = useState<BillingTerm>("monthly");
  const { isSignedIn } = useSession();

  useSeo({
    title: "Pricing — free to start, R89 a month for the full course",
    description:
      "AmharicAI plans: Free (ፊደል, pronunciation and the first two units), Basic at R89 a month, and Premium at R179 a month, R1,399 a year or R2,599 once. All prices in South African rand.",
    path: "/pricing",
  });

  const ctaTarget = isSignedIn ? "/subscription" : "/sign-in";

  return (
    <div className="space-y-12">
      <header className="max-w-3xl space-y-4">
        <h1 className="font-display text-3xl font-bold leading-tight md:text-5xl">
          Pay once you have decided it works
        </h1>
        <TibebRule className="max-w-56" />
        <p className="text-base leading-relaxed text-muted-foreground">
          The free plan is not a trial. It does not expire and it does not ask for a card — you
          get the ፊደል, the pronunciation guide and the first two units for as long as you want
          them. Every price here is charged in South African rand (ZAR); the dollar figures are
          approximate conversions for reference only.
        </p>
      </header>

      {/* Billing term switch — only Premium has more than one term, and the
          cards say so rather than pretending every plan changes. */}
      <fieldset className="inline-flex flex-wrap gap-1 rounded-full border border-border bg-card p-1">
        <legend className="sr-only">Billing term</legend>
        {TERMS.map((t) => (
          <button
            key={t.id}
            type="button"
            aria-pressed={term === t.id}
            onClick={() => setTerm(t.id)}
            className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
              term === t.id
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted"
            }`}
          >
            {t.label}
            <span className="ml-1.5 hidden text-[11px] font-normal opacity-80 sm:inline">
              {t.hint}
            </span>
          </button>
        ))}
      </fieldset>

      {/* Plan cards */}
      <section className="grid gap-5 lg:grid-cols-3">
        {PLANS.map((plan) => {
          const price = priceLine(plan.id, term);
          const options = billingOptionsFor(plan.id);
          const hasTerm = plan.id === "free" || options.some((o) => o.term === term);
          const featured = plan.id === "premium";
          const chosen = options.find((o) => o.term === term) ?? options[0];
          return (
            <Card
              key={plan.id}
              className={`flex flex-col gap-4 ${
                featured ? "border-primary/40 ring-1 ring-primary/25" : ""
              }`}
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <h2 className="font-display text-xl font-bold">{plan.name_en}</h2>
                  {featured ? (
                    <span className="rounded-full bg-primary/12 px-2.5 py-0.5 text-[11px] font-semibold text-primary">
                      Most complete
                    </span>
                  ) : null}
                </div>
                <p className="text-sm text-muted-foreground">
                  <Am>{plan.name_am}</Am>
                </p>
              </div>

              <div>
                <p className="font-display text-4xl font-bold">{price?.amount ?? "—"}</p>
                <p className="text-sm text-muted-foreground">{price?.sub ?? ""}</p>
                {price?.approx ? (
                  <p className="text-xs text-muted-foreground">{price.approx}</p>
                ) : null}
                {!hasTerm ? (
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    {plan.name_en} is billed monthly only — the {term} term applies to Premium.
                  </p>
                ) : null}
                {chosen?.note_en && chosen.term === term ? (
                  <p className="mt-1.5 text-xs font-medium text-primary">{chosen.note_en}</p>
                ) : null}
              </div>

              <p className="text-sm leading-relaxed text-muted-foreground">{plan.tagline_en}</p>

              <ul className="space-y-2 text-sm">
                {ROWS.map((row) => {
                  const value = planRowValue(plan.id, row.id);
                  if (value === false) {
                    return (
                      <li key={row.id} className="flex items-start gap-2 text-muted-foreground/70">
                        <Minus className="mt-0.5 size-4 shrink-0" />
                        <span className="line-through">{row.label}</span>
                      </li>
                    );
                  }
                  return (
                    <li key={row.id} className="flex items-start gap-2">
                      <Check className="mt-0.5 size-4 shrink-0 text-primary" />
                      <span>
                        {row.label}
                        {typeof value === "string" ? (
                          <span className="block text-xs text-muted-foreground">{value}</span>
                        ) : null}
                      </span>
                    </li>
                  );
                })}
              </ul>

              <Link
                to={plan.id === "free" ? "/sign-in" : ctaTarget}
                className={`mt-auto inline-flex items-center justify-center gap-2 rounded-full px-5 py-3 text-sm font-semibold transition ${
                  featured
                    ? "bg-primary text-primary-foreground hover:opacity-90"
                    : "border border-border hover:bg-muted"
                }`}
              >
                {plan.id === "free"
                  ? "Start free"
                  : isSignedIn
                    ? `Choose ${plan.name_en}`
                    : `Sign up for ${plan.name_en}`}
                <ArrowRight className="size-4" />
              </Link>
            </Card>
          );
        })}
      </section>

      {/* What paying does not buy — stated here rather than in the footnotes. */}
      <section className="space-y-3 rounded-2xl border border-border bg-muted/50 px-6 py-7">
        <h2 className="font-display text-xl font-bold">What no plan buys yet</h2>
        <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
          Premium is described as including the custom Amharic voice and microphone-based
          speaking feedback when they ship. They have not shipped. Nothing you pay today
          switches them on, and the app will not pretend otherwise.
        </p>
        <ul className="space-y-2 text-sm">
          {FEATURES.filter((f) => f.capability === "coming_soon").map((f) => (
            <li key={f.id} className="flex items-start gap-2">
              <Minus className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <span>
                <span className="font-medium">{f.label_en}</span>
                <span className="block text-xs text-muted-foreground">{f.caveat_en}</span>
              </span>
            </li>
          ))}
        </ul>
        <Link
          to="/features"
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline"
        >
          The full capability table <ArrowRight className="size-3.5" />
        </Link>
      </section>

      {/* Billing terms, in the same words as the Terms of Service. */}
      <section className="space-y-4">
        <h2 className="font-display text-xl font-bold md:text-2xl">Billing, plainly</h2>
        <div className="grid gap-4 md:grid-cols-3">
          <Card className="space-y-1.5">
            <p className="font-medium">Subscriptions renew</p>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Monthly and annual plans renew automatically until you cancel. Cancel from the
              Plan page and your access runs to the end of the period you have already paid for.
            </p>
          </Card>
          <Card className="space-y-1.5">
            <p className="font-medium">Refunds</p>
            <p className="text-sm leading-relaxed text-muted-foreground">
              We do not pro-rate refunds for partial periods. If we discontinue a paid feature
              you have already paid for, we refund the unused part.
            </p>
          </Card>
          <Card className="space-y-1.5">
            <p className="font-medium">Lifetime</p>
            <p className="text-sm leading-relaxed text-muted-foreground">
              A single payment granting Premium for as long as the service operates. It is not a
              subscription and there is nothing to cancel.
            </p>
          </Card>
        </div>
        <p className="text-xs text-muted-foreground">
          Full detail in the{" "}
          <Link to="/terms" className="font-medium underline hover:text-foreground">
            Terms of Service
          </Link>
          . Questions about a charge:{" "}
          <a href="mailto:admin@amharicai.org" className="font-medium underline">
            admin@amharicai.org
          </a>
          .
        </p>
      </section>

      <p className="text-xs text-muted-foreground">
        {BILLING_OPTIONS.length} purchasable options across {PLAN_ORDER.length} plans. Every
        price on this page is read from the same file the checkout uses, so what you are quoted
        is what you are charged.{" "}
        {FEATURES.filter((f) => featureState("premium", f.id) === "available").length} features
        are verified working on Premium today.
      </p>
    </div>
  );
}
