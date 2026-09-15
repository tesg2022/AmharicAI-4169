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
 * Annual (R1 399/yr) and Lifetime (R2 599) are *billing terms of Premium*, not
 * extra entitlement tiers. A lifetime buyer and a monthly Premium subscriber
 * can do exactly the same things, so they share one `PlanId` and every gate in
 * the codebase keeps working without learning about billing at all.
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

export interface Plan {
  id: PlanId;
  name_en: string;
  name_am: string;
  /**
   * Headline monthly price in rand. Premium's other terms live in
   * BILLING_OPTIONS. Rand because rand is what is charged — see the currency
   * note above BILLING_OPTIONS.
   */
  price_zar_month: number;
  /** Units of the 20-unit scope this plan may open. null = every written unit. */
  max_units: number | null;
  quotas: PlanQuotas;
  tagline_en: string;
  tagline_am: string;
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
  },
];

/* -------------------------------------------------------------- billing */

export type BillingTerm = "monthly" | "annual" | "lifetime";

/**
 * EVERYTHING IS PRICED AND CHARGED IN SOUTH AFRICAN RAND.
 *
 * Not a preference — a constraint. Billing runs on Paystack under a South
 * African legal entity, and Paystack's currency support is per country: a
 * Nigerian or Kenyan account may charge in USD, a South African one may charge
 * in ZAR and nothing else. There is no setting to change this and no plan
 * shape that works around it.
 *
 * International customers can still pay, once international payments are
 * enabled on the account: their own bank converts at the card network's rate
 * and settles Paystack in ZAR. What they see at checkout, and on their
 * statement, is a rand amount.
 *
 * Which is why every option carries a USD figure that is explicitly
 * approximate and explicitly not charged. Most learners here do not think in
 * rand, and a price list that only says "R179" to somebody in Chicago is a
 * price list they cannot evaluate. Showing a converted figure without saying
 * it is converted would be worse: their card would be billed a different
 * number and the difference would look like a bait and switch.
 */

/**
 * The reference rate the displayed USD figures are derived from.
 *
 * One constant, not four hand-written dollar prices, so the four can never
 * drift out of proportion to each other or to the rand prices they claim to
 * approximate. Display only: nothing is ever charged in USD, and this number
 * being stale costs a customer nothing because the rand amount is the price.
 *
 * Source: open.er-api.com, 14 September 2026. Worth refreshing when it has
 * moved far enough that the approximations mislead — roughly 10%.
 */
export const ZAR_PER_USD_REFERENCE = 16.16;

/** The rand price as an indicative USD figure. Display only, never charged. */
export function approxUsd(zar: number): number {
  return Math.round((zar / ZAR_PER_USD_REFERENCE) * 100) / 100;
}

/** "R179", "R1 399" — no cents, because none of these prices have any. */
export function formatZar(zar: number): string {
  return new Intl.NumberFormat("en-ZA", {
    style: "currency",
    currency: "ZAR",
    minimumFractionDigits: Number.isInteger(zar) ? 0 : 2,
  }).format(zar);
}

/** "≈US$11.08" — always with the approximation mark and the currency, never bare. */
export function formatApproxUsd(zar: number): string {
  return `≈US$${approxUsd(zar).toFixed(2)}`;
}

/**
 * One purchasable thing.
 *
 * There is deliberately no Paystack plan code here. Plan codes are
 * account-specific — a code created in test mode does not exist in live mode
 * — so they live in the deployment's environment and are mapped to these ids
 * by `billing/config.ts`. Putting them in this file would make the price list
 * unusable against a second Paystack account, which is exactly what test mode
 * is.
 */
export interface BillingOption {
  id: string;
  plan: PlanId;
  term: BillingTerm;
  /**
   * What the customer is actually charged, in rand, for one term. Not a
   * monthly rate for the annual or lifetime options.
   */
  price_zar: number;
  label_en: string;
  label_am: string;
  /** Marketing note, e.g. the saving against paying monthly. Honest arithmetic only. */
  note_en?: string;
}

/**
 * The price list.
 *
 * These rand figures are NOT conversions of the old dollar prices. They carry
 * a deliberate buffer, because the exchange rate moves and a price list that
 * tracked it would either have to be edited every quarter or quietly lose
 * margin — and re-pricing an existing subscriber on Paystack means cancelling
 * their subscription and asking them to buy a new one, which is a far worse
 * thing to do to somebody than charging a little above spot from the start.
 *
 * At the 14 September 2026 reference rate that buffer works out at roughly
 * 8-10% above the previous dollar prices ($4.99 → ≈$5.51, $9.99 → ≈$11.08).
 * Intentional, and the reason the USD figures shown are labelled approximate
 * rather than presented as the price.
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
  {
    id: "premium_lifetime",
    plan: "premium",
    term: "lifetime",
    price_zar: 2599,
    label_en: "R2 599 once",
    label_am: "R2 599 አንዴ",
    // 2599 / 1399 = 1.86 years against annual; 2599 / 179 = 14.5 months
    // against monthly. "Under two years" is the annual comparison, which is
    // the honest one to make against the cheapest recurring route.
    note_en: "One payment. Pays for itself against annual in under two years.",
  },
];

export function billingOptionsFor(plan: PlanId): BillingOption[] {
  return BILLING_OPTIONS.filter((o) => o.plan === plan);
}

export function billingOptionById(id: string | null | undefined): BillingOption | undefined {
  return BILLING_OPTIONS.find((o) => o.id === id);
}

/** The cheapest way into a tier, used for "from R89" copy. */
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
