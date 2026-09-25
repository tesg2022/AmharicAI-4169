/**
 * Plans, entitlements, quotas and gating — shared by the website and the app.
 *
 * Three axes are kept deliberately separate, because collapsing any two of
 * them is how a price list ends up promising something the build cannot do:
 *
 *   tier        — what a person is entitled to DO         (`PlanId`)
 *   billing     — how they PAY for that tier              (`BillingOption`)
 *   capability  — whether the feature physically EXISTS   (`CapabilityStatus`)
 *
 * Annual is a *billing term*, not an extra entitlement tier. An annual and a
 * monthly subscriber on the same tier can do exactly the same things, so they
 * share one `PlanId` and every gate in the codebase keeps working without
 * learning about billing at all.
 *
 * Capability still overrides everything: there is no trained Amharic voice yet
 * and no speech recognizer in this build, so a paid plan *grants* those and
 * the capability flag reports them unavailable until they actually ship. A
 * paid plan never makes vapour appear.
 */

export type PlanId = "free" | "basic" | "premium";

/**
 * Plan ids that existed in an earlier release and still sit in the database on
 * issued access codes and their redemptions. Read-only compatibility: these
 * are mapped on the way in and never written again.
 *
 * `learner` ($9.99/mo, full written course + translation) is the same
 * entitlement set as today's `basic`, so it maps there. Nobody's redeemed code
 * silently loses access across the rename.
 */
export const LEGACY_PLAN_ALIASES: Record<string, PlanId> = {
  learner: "basic",
};

/**
 * Does the capability physically exist? This axis knows nothing about plans.
 */
export type CapabilityStatus =
  /** Built, verified, works right now. */
  | "available"
  /** Built and reachable, but not verified end to end — usable, not promised. */
  | "preview"
  /** Does not exist in this build yet. Never sell it, never gate it. */
  | "coming_soon"
  /** Code exists; the deployment has not supplied the config it needs. */
  | "not_configured";

/**
 * What the UI should actually say about a feature for a given plan. This is
 * the single resolved answer, folding the grant axis into the capability axis
 * so no screen has to combine them by hand and get the order wrong.
 */
export type FeatureState = CapabilityStatus | "plan_gated";

/** Chip copy per state. Kept here so the website and the app never diverge. */
export const STATE_LABELS: Record<FeatureState, { en: string; am: string }> = {
  available: { en: "Available", am: "ይሠራል" },
  preview: { en: "Preview", am: "በቅድመ እይታ" },
  coming_soon: { en: "Coming soon", am: "በቅርቡ ይመጣል" },
  not_configured: { en: "Not configured", am: "አልተዘጋጀም" },
  plan_gated: { en: "Needs a higher plan", am: "ከፍ ያለ ዕቅድ ያስፈልጋል" },
};

export interface Feature {
  id: string;
  label_en: string;
  label_am: string;
  /** Lowest plan that includes the feature. */
  min_plan: PlanId;
  capability: CapabilityStatus;
  /** Shown verbatim in the UI whenever capability !== "available". */
  caveat_en?: string;
  caveat_am?: string;
}

export const PLAN_ORDER: PlanId[] = ["free", "basic", "premium"];

const rank = (p: PlanId) => PLAN_ORDER.indexOf(p);

/* --------------------------------------------------------------- quotas */

/**
 * Metered limits, enforced on the server (see `api/entitlements/usage.ts`).
 *
 * `null` never means "no limit is checked" — it means this plan has no limit
 * for that meter. Every paid tier still carries a `tutor_per_month` number,
 * including Premium, because an LLM turn costs real money and an account with
 * genuinely no ceiling is an unbounded bill waiting for one bad actor. The
 * Premium ceiling is a fair-use cap set far above any human study load, and it
 * is labelled honestly rather than advertised as "unlimited".
 */
export interface PlanQuotas {
  /** AI tutor turns per calendar month. */
  tutor_per_month: number;
  /** Whether `tutor_per_month` is a fair-use ceiling rather than the product. */
  tutor_is_fair_use: boolean;
  /** TTS syntheses per day. null = unmetered. */
  tts_per_day: number | null;
  /** Characters per translation request. null = no cap. */
  translate_chars: number | null;
}

/**
 * One marketing bullet on the price list, carrying its own honesty.
 *
 * The bullets are the sales copy; `FEATURES` is the capability matrix. They
 * are joined here rather than written twice, because a bullet that promises
 * something the build does not have is the one thing this file exists to
 * prevent. Where a bullet corresponds to a `FEATURES` entry it names it in
 * `feature`, and the UI resolves the chip from that entry's capability. Where
 * it does not — a bullet describing course material rather than a gated
 * capability — it carries its own `capability` instead.
 */
export interface PlanHighlight {
  label_en: string;
  /** `FEATURES` id whose capability governs this bullet, when one does. */
  feature?: string;
  /** Capability for bullets with no `FEATURES` entry. Defaults to available. */
  capability?: CapabilityStatus;
}

export interface Plan {
  id: PlanId;
  name_en: string;
  name_am: string;
  /**
   * Headline monthly price in South African rand — the canonical
   * customer-facing figure, and the currency Paystack actually charges. The
   * other terms live in BILLING_OPTIONS. See the currency note above it.
   */
  price_zar_month: number;
  /** Units of the 20-unit scope this plan may open. null = every written unit. */
  max_units: number | null;
  quotas: PlanQuotas;
  tagline_en: string;
  tagline_am: string;
  /** The price-list headline, e.g. "Build your Amharic foundation". */
  headline_en: string;
  /** Who the plan is for, shown under the headline. */
  audience_en: string;
  /** The bullet list on the price list, in order. */
  highlights: PlanHighlight[];
  /** Call to action on this plan's button. */
  cta_en: string;
  /** Exactly one plan may carry this. */
  most_popular?: true;
}

export const FREE_PLAN: Plan = {
  id: "free",
  name_en: "Free",
  name_am: "ነጻ",
  price_zar_month: 0,
  max_units: 2,
  quotas: {
    tutor_per_month: 10,
    tutor_is_fair_use: false,
    tts_per_day: 20,
    translate_chars: null,
  },
  tagline_en: "Fidel, pronunciation and the first two units, with 10 tutor questions a month.",
  tagline_am: "ፊደል፣ አጠራር እና የመጀመሪያዎቹ ሁለት ምዕራፎች፤ በወር 10 ጥያቄ።",
  headline_en: "Start learning Amharic",
  audience_en: "For learners who want to explore AmharicAI before subscribing.",
  highlights: [
    { label_en: "ፊደል Amharic alphabet", feature: "course_units_1_2" },
    { label_en: "Basic pronunciation", feature: "course_units_1_2" },
    { label_en: "Introductory vocabulary" },
    { label_en: "Selected beginner lessons", feature: "course_units_1_2" },
    { label_en: "Selected listening exercises", feature: "tts_playback" },
    { label_en: "Basic translation", feature: "lesson_gloss" },
    { label_en: "Limited interactive activities" },
  ],
  cta_en: "Start learning",
};

export const PLANS: Plan[] = [
  FREE_PLAN,
  {
    id: "basic",
    name_en: "Basic",
    name_am: "መሠረታዊ",
    price_zar_month: 89,
    max_units: null,
    quotas: {
      tutor_per_month: 300,
      tutor_is_fair_use: false,
      tts_per_day: 300,
      translate_chars: 1000,
    },
    tagline_en: "The full written course, Amharic translation and 300 tutor questions a month.",
    tagline_am: "ሙሉው የተጻፈ ኮርስ፣ የአማርኛ ትርጉም እና በወር 300 ጥያቄ።",
    headline_en: "Build your Amharic foundation",
    audience_en: "For learners who want structured lessons and regular practice.",
    highlights: [
      { label_en: "Full beginner curriculum", feature: "course_full" },
      { label_en: "Reading and writing practice" },
      { label_en: "Grammar lessons" },
      { label_en: "Vocabulary exercises" },
      { label_en: "Listening practice", feature: "tts_playback" },
      { label_en: "Native Amharic audio", feature: "custom_voice" },
      { label_en: "Speaking exercises", feature: "speech_recognition" },
      { label_en: "Pronunciation practice", feature: "speech_recognition" },
      { label_en: "Progress tracking" },
      { label_en: "Translation tools", feature: "translate_free_text" },
      { label_en: "Cultural lessons" },
    ],
    cta_en: "Choose Basic",
  },
  {
    id: "premium",
    name_en: "Premium",
    name_am: "ፕሪሚየም",
    price_zar_month: 179,
    max_units: null,
    quotas: {
      tutor_per_month: 3000,
      tutor_is_fair_use: true,
      tts_per_day: null,
      translate_chars: 5000,
    },
    // "Everything currently available", not "Everything". Two Premium
    // features — the custom Amharic voice and speaking feedback — are not
    // built yet, and they are listed on this page as coming soon. A bare
    // "Everything" beside a coming-soon row promises the buyer the unbuilt
    // half of what they can see.
    tagline_en:
      "Everything currently available, unmetered audio, long-form translation — plus the custom voice and speaking feedback when they ship.",
    tagline_am: "በአሁኑ ጊዜ ያለው ሁሉም፣ ያልተገደበ ድምፅ እና ረጅም ትርጉም፤ ብጁ ድምፅም ሲደርስ።",
    headline_en: "Speak Amharic with confidence",
    audience_en:
      "For serious learners who want AI-powered speaking and personalised practice.",
    highlights: [
      { label_en: "Full AmharicAI curriculum", feature: "course_full" },
      { label_en: "AI Amharic Tutor", feature: "tutor_limited" },
      { label_en: "AI conversation practice", feature: "tutor_limited" },
      { label_en: "Native Amharic pronunciation", feature: "custom_voice" },
      { label_en: "Text-to-Speech", feature: "tts_playback" },
      { label_en: "Personalised learning", capability: "coming_soon" },
      { label_en: "Advanced speaking practice", feature: "speech_recognition" },
      { label_en: "Advanced progress analytics", capability: "preview" },
      { label_en: "Premium cultural content" },
      { label_en: "Learning certificates", capability: "coming_soon" },
      { label_en: "Priority support" },
    ],
    cta_en: "Choose Premium",
    most_popular: true,
  },
];

/**
 * The resolved state of one price-list bullet: the chip the UI shows beside it.
 *
 * A bullet naming a `FEATURES` entry inherits that entry's capability and its
 * caveat, so "Native Amharic audio" on the price list and "Custom Amharic
 * voice" in the comparison table can never disagree about whether the voice
 * exists. This is the function the comparison section and the plan cards both
 * call, which is what makes them consistent by construction.
 */
export function highlightState(h: PlanHighlight): {
  state: CapabilityStatus;
  caveat_en?: string;
} {
  if (h.feature) {
    const f = FEATURES.find((x) => x.id === h.feature);
    if (f) return { state: f.capability, caveat_en: f.caveat_en };
  }
  return { state: h.capability ?? "available" };
}

/* -------------------------------------------------------------- billing */

/**
 * Every term is recurring. There is no one-off purchase: billing is
 * subscription-only, so anything the codebase reads out of the database has
 * an end date and a renewal, and `until: null` is never a valid paid state.
 */
export type BillingTerm = "monthly" | "annual";

/**
 * Option ids that were once sold and are not sold any more.
 *
 * `premium_lifetime` was a single R2 599 payment. It is withdrawn, and the
 * withdrawal has to survive more than deleting it from the list below,
 * because an id is a string and a string can arrive in a request body from
 * anywhere — a stale price page in a browser tab left open since last week,
 * an old mobile build, somebody reading the network tab and retrying the call
 * by hand. `billingOptionById` returns nothing for these, which is what every
 * purchase path already treats as a hard error, and `isRetiredOption` lets
 * checkout say *why* rather than "unknown option".
 *
 * Nobody outside the test accounts ever bought it, so there is no grandfather
 * case here: this list exists to refuse the sale, not to honour it.
 */
export const RETIRED_OPTION_IDS = new Set(["premium_lifetime"]);

export function isRetiredOption(id: string | null | undefined): boolean {
  return id !== null && id !== undefined && RETIRED_OPTION_IDS.has(id);
}

/**
 * ONE CUSTOMER-FACING CURRENCY: SOUTH AFRICAN RAND.
 *
 * Every price quoted to a customer — price list, app, checkout, receipt,
 * structured data — is the rand figure on the option, and Paystack is the
 * provider that charges it. There is exactly one number per option and it is
 * the number that leaves the customer's account.
 *
 * WHY RAND AND NOT DOLLARS
 *
 * This deployment's Paystack account is a South African one, and a South
 * African Paystack account may charge ZAR and nothing else. That is probed
 * against the live account rather than taken from documentation: a USD
 * `transaction/initialize` comes back `"Currency not supported by merchant"`
 * while the identical ZAR call succeeds. So rand is not a presentation
 * choice here, it is the only amount this account can take.
 *
 * A dollar price list was built against PayPal and is parked on the
 * `usd-paypal-pricing` branch. It never went live — PayPal was never
 * configured, so no dollar payment was ever taken and no subscriber was ever
 * affected — and it is recoverable from there rather than half-present here.
 *
 * THERE IS DELIBERATELY NO CONVERSION FUNCTION IN THIS FILE.
 *
 * An approximate "≈$X" beside each rand price was tried and removed. It is a
 * second number for the same plan that nobody is ever charged, it goes stale
 * with the exchange rate, and a customer reading the dollar figure as the
 * price is a customer surprised by their card statement. One price, in the
 * currency of the charge, is the whole rule.
 */

/** The currency every customer-facing price is quoted and charged in. */
export const DISPLAY_CURRENCY = "ZAR";

/**
 * "R89", "R1 399" — the price, so no approximation mark, ever.
 *
 * Whole rand where the amount is whole, because every price on the list is,
 * and "R89.00" on a price page reads like a conversion of something else.
 */
export function formatZar(zar: number): string {
  return new Intl.NumberFormat("en-ZA", {
    style: "currency",
    currency: "ZAR",
    minimumFractionDigits: Number.isInteger(zar) ? 0 : 2,
  }).format(zar);
}

/**
 * One purchasable thing.
 *
 * There is deliberately no provider plan identifier here — no Paystack plan
 * code and no PayPal plan id. Both are account-specific: a `PLN_xxxx` created
 * in Paystack test mode does not exist in live mode, and a PayPal sandbox
 * `P-xxxx` does not exist in production. So they live in the deployment's
 * environment and are mapped to these ids by `billing/config.ts` and
 * `billing/paypal-config.ts`. Putting them in this file would make the price
 * list unusable against a second account of either provider, which is exactly
 * what test/sandbox mode is.
 */
export interface BillingOption {
  id: string;
  plan: PlanId;
  term: BillingTerm;
  /**
   * THE price: what the customer is charged, in rand, for one whole term.
   * Not a monthly rate for the annual option — R1 399 is the amount that
   * leaves their account once a year.
   *
   * Required, and required for a reason. This is the number the price list,
   * the app, the checkout button, the receipt and the structured data all
   * render, and it is the amount Paystack is asked to charge. An option with
   * no rand price is an option nothing can sell.
   */
  price_zar: number;
  /** The price, formatted. */
  label_en: string;
  label_am: string;
  /** Marketing note, e.g. the saving against paying monthly. Honest arithmetic only. */
  note_en?: string;
}

/**
 * The price list. Three options, in rand, and nothing else is a price.
 *
 * The savings copy is checked arithmetic, because it is the easiest place in
 * a price list to publish a number nobody can reproduce:
 *
 *   premium  R179 x 12 = R2 148;  R1 399 is R749 less  →  34.9% off
 *
 * These are the live Paystack plans, at exactly the amounts they have always
 * been. Paystack cannot re-price a subscription in place — changing the
 * amount means cancelling the subscriber and asking them to buy again — so
 * every figure here is also what the existing subscribers keep paying.
 *
 * Basic is monthly-only, as it always has been: there is no Paystack annual
 * plan for it, and inventing a price without a plan code behind it would put
 * a button on the page that checkout cannot honour.
 */
export const BILLING_OPTIONS: BillingOption[] = [
  {
    id: "basic_monthly",
    plan: "basic",
    term: "monthly",
    price_zar: 89,
    label_en: "R89 / month",
    label_am: "R89 በወር",
  },
  {
    id: "premium_monthly",
    plan: "premium",
    term: "monthly",
    price_zar: 179,
    label_en: "R179 / month",
    label_am: "R179 በወር",
  },
  {
    id: "premium_annual",
    plan: "premium",
    term: "annual",
    price_zar: 1399,
    label_en: "R1 399 / year",
    label_am: "R1 399 በዓመት",
    // 179 * 12 = 2148; 2148 - 1399 = 749 saved, which is 34.9% off.
    note_en: "Save R749 a year — 35% less than paying monthly.",
  },
];

export function billingOptionsFor(plan: PlanId): BillingOption[] {
  return BILLING_OPTIONS.filter((o) => o.plan === plan);
}

export function billingOptionById(id: string | null | undefined): BillingOption | undefined {
  return BILLING_OPTIONS.find((o) => o.id === id);
}

/**
 * The cheapest way into a tier, used for "from R89" copy.
 *
 * Cheapest by the amount charged per term, which for every tier here is the
 * monthly option — an annual term is a lower rate but a larger single
 * charge, and "from" copy is about the smallest amount that gets you in.
 */
export function entryPrice(plan: PlanId): BillingOption | undefined {
  return billingOptionsFor(plan).reduce<BillingOption | undefined>(
    (best, o) => (best === undefined || o.price_zar < best.price_zar ? o : best),
    undefined,
  );
}

/* ------------------------------------------------------------- features */

export const FEATURES: Feature[] = [
  {
    id: "course_units_1_2",
    label_en: "Fidel and pronunciation (units 1-2)",
    label_am: "ፊደል እና አጠራር",
    min_plan: "free",
    capability: "available",
  },
  {
    id: "course_full",
    label_en: "All written course units",
    label_am: "ሁሉም የተጻፉ ምዕራፎች",
    min_plan: "basic",
    capability: "available",
  },
  {
    id: "lesson_gloss",
    label_en: "English gloss inside lessons",
    label_am: "በትምህርቱ ውስጥ የእንግሊዝኛ ትርጉም",
    min_plan: "free",
    capability: "available",
  },
  {
    id: "tts_playback",
    label_en: "Listen to any Amharic line",
    label_am: "ማንኛውንም የአማርኛ መስመር ማዳመጥ",
    min_plan: "free",
    capability: "not_configured",
    caveat_en:
      "Needs a reachable AmharicAI TTS host. Without one the app says so instead of playing silence.",
    caveat_am: "የAmharicAI ድምፅ አገልጋይ ያስፈልጋል። ከሌለ መተግበሪያው ዝምታ አያጫውትም፤ ይነግርዎታል።",
  },
  {
    id: "translate_free_text",
    label_en: "Translate your own text",
    label_am: "የራስዎን ጽሑፍ መተርጎም",
    min_plan: "basic",
    capability: "not_configured",
    caveat_en: "Needs a translation provider key. Not set in this build.",
    caveat_am: "የትርጉም አገልግሎት ቁልፍ ያስፈልጋል። በዚህ ግንባታ ውስጥ አልተቀመጠም።",
  },
  {
    id: "tutor_limited",
    label_en: "AI tutor",
    label_am: "የAI አስተማሪ",
    min_plan: "free",
    capability: "preview",
    caveat_en:
      "The tutor stream is written but has not been verified end to end. Treat its Amharic as a draft, not as a teacher.",
    caveat_am: "አስተማሪው ተጽፏል፣ ግን ሙሉ በሙሉ አልተፈተነም። አማርኛውን እንደ ረቂቅ ይያዙት።",
  },
  {
    id: "custom_voice",
    label_en: "Custom Amharic voice",
    label_am: "ብጁ የአማርኛ ድምፅ",
    min_plan: "premium",
    capability: "coming_soon",
    caveat_en:
      "No fine-tuned voice exists yet. The 5-hour corpus is manifest-only — the audio has not been delivered, so nothing has been trained.",
    caveat_am: "ብጁ ድምፅ እስካሁን አልሠለጠነም። የድምፅ ፋይሎቹ አልደረሱም።",
  },
  {
    id: "speech_recognition",
    label_en: "Speaking feedback from your microphone",
    label_am: "ከማይክሮፎን የንግግር ግምገማ",
    min_plan: "premium",
    capability: "coming_soon",
    caveat_en:
      "There is no speech recognizer in this build. Speaking practice is scored by typed self-check instead.",
    caveat_am: "በዚህ ግንባታ ውስጥ የንግግር መለያ የለም። የመናገር ልምምድ በጽሑፍ ራስን በመፈተሽ ይገመገማል።",
  },
];

/* --------------------------------------------------------------- lookup */

export function planById(id: string | undefined | null): Plan {
  const normalized = planFromInput(id);
  return PLANS.find((p) => p.id === normalized) ?? FREE_PLAN;
}

/**
 * Normalises untrusted input — a query parameter, a stored legacy value, an
 * old client build — to a known plan. Never trusted for anything billable.
 */
export function planFromInput(raw: string | undefined | null): PlanId {
  if (!raw) return "free";
  if (PLAN_ORDER.includes(raw as PlanId)) return raw as PlanId;
  return LEGACY_PLAN_ALIASES[raw] ?? "free";
}

export function quotasFor(plan: PlanId): PlanQuotas {
  return planById(plan).quotas;
}

/** Human copy for a tutor allowance, honest about the fair-use ceiling. */
export function tutorAllowanceLabel(plan: PlanId): string {
  const q = quotasFor(plan);
  return q.tutor_is_fair_use
    ? `Unlimited within a fair-use ceiling of ${q.tutor_per_month.toLocaleString()} questions a month`
    : `${q.tutor_per_month.toLocaleString()} tutor questions a month`;
}

export function grants(plan: PlanId, featureId: string): boolean {
  const f = FEATURES.find((x) => x.id === featureId);
  if (!f) return false;
  return rank(plan) >= rank(f.min_plan);
}

/** Grant AND capability — the only check the UI should use before promising. */
export function usable(plan: PlanId, featureId: string): boolean {
  const f = FEATURES.find((x) => x.id === featureId);
  if (!f) return false;
  return grants(plan, featureId) && f.capability === "available";
}

/**
 * The resolved four-state answer for one feature and one plan.
 *
 * Order matters and is the same principle as `unitAccess`: what does not exist
 * is never dressed up as something you could buy. So `coming_soon` is reported
 * before `plan_gated` — a learner on Free is told the custom voice is not built
 * yet, rather than being invited to upgrade for it.
 */
export function featureState(plan: PlanId, featureId: string): FeatureState {
  const f = FEATURES.find((x) => x.id === featureId);
  if (!f) return "coming_soon";
  if (f.capability === "coming_soon") return "coming_soon";
  if (!grants(plan, featureId)) return "plan_gated";
  return f.capability;
}

export interface UnitAccess {
  allowed: boolean;
  reason: "ok" | "not_written" | "plan_required";
  required_plan?: PlanId;
}

/**
 * Unit-level gate. "Not written" is checked first: an unwritten unit is not a
 * paywall, and offering to sell it would be a lie.
 */
export function unitAccess(
  plan: PlanId,
  unit: { shell_unit: number; status: string },
): UnitAccess {
  if (unit.status !== "written") return { allowed: false, reason: "not_written" };
  const max = planById(plan).max_units;
  if (max !== null && unit.shell_unit > max) {
    const required = PLANS.find((p) => p.max_units === null)?.id ?? "basic";
    return { allowed: false, reason: "plan_required", required_plan: required };
  }
  return { allowed: true, reason: "ok" };
}

/**
 * Where an active plan came from. Only `subscription` and `access_code` are
 * verified entitlements — the other two are the honest "we have nothing to go
 * on" answers and must never be reported as verified.
 */
export type PlanSource =
  | "subscription"
  | "access_code"
  | "preview_cookie"
  | "default_free";

/**
 * Everything the client needs to render gates without guessing.
 *
 * `source` defaults to the anonymous preview answer so any caller that has not
 * resolved a session yet stays truthful by omission rather than by accident.
 */
export function entitlements(
  plan: PlanId,
  provenance: { source: PlanSource; verified: boolean } = {
    source: "preview_cookie",
    verified: false,
  },
) {
  return {
    plan,
    /** How this plan was established. See `PlanSource`. */
    plan_source: provenance.source,
    plan_is_verified: provenance.verified,
    plans: PLANS,
    billing_options: BILLING_OPTIONS,
    quotas: quotasFor(plan),
    features: FEATURES.map((f) => ({
      ...f,
      granted: grants(plan, f.id),
      usable: usable(plan, f.id),
      state: featureState(plan, f.id),
      state_label: STATE_LABELS[featureState(plan, f.id)],
    })),
    state_labels: STATE_LABELS,
  };
}
