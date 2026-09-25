import { useState } from "react";
import { Link } from "wouter";
import { ArrowRight, Check, Minus } from "lucide-react";
import {
  BILLING_OPTIONS,
  DISPLAY_CURRENCY,
  FEATURES,
  PLANS,
  PLAN_ORDER,
  STATE_LABELS,
  billingOptionsFor,
  featureState,
  formatZar,
  highlightState,
  type BillingTerm,
  type Plan,
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
 *
 * ONE CURRENCY ON THIS PAGE: SOUTH AFRICAN RAND. Every figure below is
 * `option.price_zar`, which is the amount Paystack is asked to charge and the
 * amount `billing/fulfil.ts` checks the completed payment against. A dollar
 * price list was tried and is parked on the `usd-paypal-pricing` branch, and
 * so was an approximate "≈$X" under each rand figure. Neither is here now:
 * this account can only take rand, and a second number on a price card is a
 * number some reader takes for the price.
 */

const TERMS: { id: BillingTerm; label: string; hint: string }[] = [
  { id: "monthly", label: "Monthly", hint: "Cancel any time" },
  { id: "annual", label: "Annual", hint: "Save R749 on Premium" },
];

/**
 * The price and the lines under it, for one plan at the selected term.
 *
 * One figure per card, and it is the amount that leaves the customer's
 * account for one whole term. Anything else worth saying about the price —
 * the annual saving — comes from `note_en` on the option, which is checked
 * arithmetic in the price list rather than a sum done here.
 */
function priceLine(
  plan: PlanId,
  term: BillingTerm,
): {
  amount: string;
  sub: string;
  note: string | null;
  term_used: BillingTerm | null;
} | null {
  if (plan === "free")
    return {
      amount: formatZar(0),
      sub: "forever, no card",
      note: null,
      term_used: null,
    };

  const options = billingOptionsFor(plan);
  const exact = options.find((o) => o.term === term);
  const chosen = exact ?? options.find((o) => o.term === "monthly");
  if (!chosen) return null;

  return {
    amount: formatZar(chosen.price_zar),
    sub: chosen.term === "annual" ? "per year" : "per month",
    note: chosen.note_en ?? null,
    term_used: chosen.term,
  };
}

/** The chip beside a bullet, or nothing at all when the bullet just works. */
function BulletState({ state, caveat }: { state: string; caveat?: string }) {
  if (state === "available") return null;
  const label = STATE_LABELS[state as keyof typeof STATE_LABELS]?.en ?? state;
  return (
    <span className="block text-xs text-muted-foreground">
      {label}
      {caveat ? ` — ${caveat}` : ""}
    </span>
  );
}

/**
 * Every bullet across all three plans, de-duplicated, grouped by the plan it
 * first appears on and marked CUMULATIVELY.
 *
 * Cumulative matters: the plans are nested, so everything Free opens is also
 * open on Basic and Premium. Marking each row against only the card it is
 * printed on produced a table that said Basic does not include the ፈደል chart,
 * which is both untrue and the sort of thing a person notices after paying.
 *
 * Built from `PLANS` rather than typed out, so the table cannot promise a row
 * the cards do not, or miss one they do.
 */
function comparisonGroups(): {
  plan: PlanId;
  heading: string;
  rows: { label: string; plans: Record<PlanId, boolean> }[];
}[] {
  const rank: Record<PlanId, number> = { free: 0, basic: 1, premium: 2 };
  const seen = new Set<string>();

  return PLANS.map((plan) => {
    const rows: { label: string; plans: Record<PlanId, boolean> }[] = [];
    for (const h of plan.highlights) {
      // First appearance only: a label repeated on a higher plan is the same
      // row, already listed under the plan that introduces it.
      if (seen.has(h.label_en)) continue;
      seen.add(h.label_en);
      rows.push({
        label: h.label_en,
        plans: {
          free: rank.free >= rank[plan.id],
          basic: rank.basic >= rank[plan.id],
          premium: rank.premium >= rank[plan.id],
        },
      });
    }
    return {
      plan: plan.id,
      heading:
        plan.id === "free"
          ? "In Free — and in every paid plan"
          : `Added on ${plan.name_en}`,
      rows,
    };
  }).filter((group) => group.rows.length > 0);
}

const COMPARISON_GROUPS = comparisonGroups();

export default function PricingPage() {
  const [term, setTerm] = useState<BillingTerm>("monthly");
  const { isSignedIn } = useSession();

  useSeo({
    title: "Pricing — free to start, R89 a month for the full course",
    description:
      "AmharicAI plans: Free (ፊደል, pronunciation and the first two units), Basic at R89 a month, and Premium at R179 a month or R1 399 a year. Charged in South African rand through Paystack.",
    path: "/pricing",
  });

  const ctaTarget = isSignedIn ? "/subscription" : "/sign-in";

  return (
    <div className="space-y-12">
      <header className="max-w-3xl space-y-4">
        <h1 className="font-display text-3xl font-bold leading-tight md:text-5xl">
          Start free. Subscribe when it works for you
        </h1>
        <TibebRule className="max-w-56" />
        <p className="text-base leading-relaxed text-muted-foreground">
          The free plan is not a trial. It does not expire and it does not ask for a card — you
          get the ፊደል, the pronunciation guide and the first two units for as long as you want
          them. Paid plans are priced in South African rand ({DISPLAY_CURRENCY}) and charged
          in rand through Paystack — the figure on each card is the amount that leaves your
          account, with no conversion and no second currency to check.
        </p>
      </header>

      {/* Billing term switch. */}
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
        {PLANS.map((plan: Plan) => {
          const price = priceLine(plan.id, term);
          const options = billingOptionsFor(plan.id);
          const hasTerm = plan.id === "free" || options.some((o) => o.term === term);
          const featured = plan.most_popular === true;
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
                      Most popular
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
                {price?.note ? (
                  <p className="mt-1.5 text-xs font-medium text-primary">{price.note}</p>
                ) : null}
                {!hasTerm ? (
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    {plan.name_en} has no {term} term — the price shown is the monthly one.
                  </p>
                ) : null}
              </div>

              <div className="space-y-1">
                <p className="font-medium">{plan.headline_en}</p>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {plan.audience_en}
                </p>
              </div>

              <ul className="space-y-2 text-sm">
                {plan.highlights.map((h) => {
                  const resolved = highlightState(h);
                  const built = resolved.state === "available";
                  return (
                    <li key={h.label_en} className="flex items-start gap-2">
                      {built ? (
                        <Check className="mt-0.5 size-4 shrink-0 text-primary" />
                      ) : (
                        <Minus className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                      )}
                      <span>
                        {h.label_en}
                        <BulletState state={resolved.state} caveat={resolved.caveat_en} />
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
                {plan.id === "free" || isSignedIn
                  ? plan.cta_en
                  : `Sign up for ${plan.name_en}`}
                <ArrowRight className="size-4" />
              </Link>
            </Card>
          );
        })}
      </section>

      {/* Feature comparison, built from the same bullets as the cards. */}
      <section className="space-y-4">
        <div className="space-y-1">
          <h2 className="font-display text-xl font-bold md:text-2xl">Compare every feature</h2>
          <p className="text-sm text-muted-foreground">
            Free = Explore · Basic = Learn · Premium = Speak + AI
          </p>
        </div>
        <div className="overflow-x-auto rounded-2xl border border-border">
          <table className="w-full min-w-[34rem] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-left">
                <th scope="col" className="px-4 py-3 font-semibold">
                  Feature
                </th>
                {PLAN_ORDER.map((id) => (
                  <th key={id} scope="col" className="px-4 py-3 text-center font-semibold">
                    {PLANS.find((p) => p.id === id)?.name_en ?? id}
                  </th>
                ))}
              </tr>
            </thead>
            {COMPARISON_GROUPS.map((group) => (
              <tbody key={group.plan}>
                <tr className="border-b border-border/60 bg-muted/30">
                  <th
                    scope="colgroup"
                    colSpan={PLAN_ORDER.length + 1}
                    className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                  >
                    {group.heading}
                  </th>
                </tr>
                {group.rows.map((row) => (
                  <tr key={row.label} className="border-b border-border/60">
                    <th scope="row" className="px-4 py-2.5 text-left font-normal">
                      {row.label}
                    </th>
                    {PLAN_ORDER.map((id) => (
                      <td key={id} className="px-4 py-2.5 text-center">
                        {row.plans[id] ? (
                          <Check
                            className="mx-auto size-4 text-primary"
                            aria-label={`Included in ${id}`}
                          />
                        ) : (
                          <Minus
                            className="mx-auto size-4 text-muted-foreground/60"
                            aria-label={`Not in ${id}`}
                          />
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
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

      {/* Subscriptions and payment, in the same words as the Terms of Service. */}
      <section className="space-y-4">
        <h2 className="font-display text-xl font-bold md:text-2xl">Subscriptions and payment</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <Card className="space-y-1.5">
            <p className="font-medium">You need an account</p>
            <p className="text-sm leading-relaxed text-muted-foreground">
              A subscription is attached to an AmharicAI account, so you sign in — or sign up —
              before checkout. That is what your plan, your progress and your receipts hang on.
            </p>
          </Card>
          <Card className="space-y-1.5">
            <p className="font-medium">Paystack handles the payment</p>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Payment is handled entirely by Paystack on their own hosted page. Card details
              are never stored or handled by AmharicAI.
            </p>
          </Card>
          <Card className="space-y-1.5">
            <p className="font-medium">Cancel whenever you like</p>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Cancel from Account &amp; data and the subscription stops renewing. No email,
              no waiting for a reply.
            </p>
          </Card>
          <Card className="space-y-1.5">
            <p className="font-medium">You keep what you paid for</p>
            <p className="text-sm leading-relaxed text-muted-foreground">
              After you cancel, access continues to the end of the period you have already paid
              for. We do not cut it short, and we do not pro-rate refunds for partial periods.
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
        {BILLING_OPTIONS.length} purchasable options across {PLAN_ORDER.length} plans, all priced
        in {DISPLAY_CURRENCY}. Every price on this page is read from the same file checkout
        uses, and a completed payment is checked against that same figure before access is
        granted — so the amount you were shown is the amount you are charged.{" "}
        {FEATURES.filter((f) => featureState("premium", f.id) === "available").length} features
        are verified working on Premium today.
      </p>
    </div>
  );
}
