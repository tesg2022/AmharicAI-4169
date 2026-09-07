/**
 * Plans, entitlements and gating — shared by the website and the mobile app.
 *
 * Two things are kept deliberately separate:
 *
 *   grant      — does this plan include the feature? (real, enforced logic)
 *   capability — does the feature physically exist in this build yet?
 *
 * They are separate because the price list advertises things the platform
 * cannot do today: there is no trained Amharic voice yet, and there is no
 * speech recognizer at all (the AmharicAI backend synthesizes but does not
 * listen, and it is the only provider). Gating those behind a paid plan and
 * showing them as available would be selling vapour. So a paid plan grants
 * them, and the capability flag reports them as unavailable until they ship.
 *
 * Payment is NOT wired. There are no Stripe keys in this build, so checkout
 * fails honestly rather than pretending. Until accounts exist (Phase 2) the
 * active plan is a client-side preview switch, not an entitlement — which is
 * why nothing here is ever used to authorise a charge.
 */

export type PlanId = "free" | "learner" | "premium";

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

export const PLAN_ORDER: PlanId[] = ["free", "learner", "premium"];

const rank = (p: PlanId) => PLAN_ORDER.indexOf(p);

export interface Plan {
  id: PlanId;
  name_en: string;
  name_am: string;
  price_usd_month: number;
  /** Units of the 20-unit scope this plan may open. null = every written unit. */
  max_units: number | null;
  /** TTS syntheses per day. null = unmetered. */
  tts_per_day: number | null;
  tagline_en: string;
}

export const FREE_PLAN: Plan = {
  id: "free",
  name_en: "Free",
  name_am: "ነጻ",
  price_usd_month: 0,
  max_units: 2,
  tts_per_day: 20,
  tagline_en: "Fidel and pronunciation, with a limited tutor.",
};

export const PLANS: Plan[] = [
  FREE_PLAN,
  {
    id: "learner",
    name_en: "Learner",
    name_am: "ተማሪ",
    price_usd_month: 9.99,
    max_units: null,
    tts_per_day: 500,
    tagline_en: "The full written course and Amharic translation.",
  },
  {
    id: "premium",
    name_en: "Premium",
    name_am: "ፕሪሚየም",
    price_usd_month: 19.99,
    max_units: null,
    tts_per_day: null,
    tagline_en: "Everything, plus the custom voice and speaking feedback when they ship.",
  },
];

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
    min_plan: "learner",
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
    min_plan: "learner",
    capability: "not_configured",
    caveat_en: "Needs a translation provider key. Not set in this build.",
    caveat_am: "የትርጉም አገልግሎት ቁልፍ ያስፈልጋል። በዚህ ግንባታ ውስጥ አልተቀመጠም።",
  },
  {
    id: "tutor_limited",
    label_en: "AI tutor (limited)",
    label_am: "የAI አስተማሪ (ውስን)",
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

export function planById(id: string | undefined | null): Plan {
  return PLANS.find((p) => p.id === id) ?? FREE_PLAN;
}

/** Normalises untrusted input to a known plan. Never trusted for anything billable. */
export function planFromInput(raw: string | undefined | null): PlanId {
  return PLAN_ORDER.includes(raw as PlanId) ? (raw as PlanId) : "free";
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
    const required = PLANS.find((p) => p.max_units === null)?.id ?? "learner";
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
