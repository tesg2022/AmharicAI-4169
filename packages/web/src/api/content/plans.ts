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

export type CapabilityStatus =
  /** Works right now. */
  | "available"
  /** Granted by the plan, but the underlying capability does not exist yet. */
  | "not_built"
  /** Exists but needs configuration the deployment has not supplied. */
  | "not_configured";

export interface Feature {
  id: string;
  label_en: string;
  label_am: string;
  /** Lowest plan that includes the feature. */
  min_plan: PlanId;
  capability: CapabilityStatus;
  /** Shown verbatim in the UI when capability !== 'available'. */
  caveat_en?: string;
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
  },
  {
    id: "translate_free_text",
    label_en: "Translate your own text",
    label_am: "የራስዎን ጽሑፍ መተርጎም",
    min_plan: "learner",
    capability: "not_configured",
    caveat_en: "Needs a translation provider key. Not set in this build.",
  },
  {
    id: "tutor_limited",
    label_en: "AI tutor (limited)",
    label_am: "የAI አስተማሪ (ውስን)",
    min_plan: "free",
    capability: "not_configured",
    caveat_en: "The tutor stream is written but has not been verified end to end.",
  },
  {
    id: "custom_voice",
    label_en: "Custom Amharic voice",
    label_am: "ብጁ የአማርኛ ድምፅ",
    min_plan: "premium",
    capability: "not_built",
    caveat_en:
      "No fine-tuned voice exists yet. The 5-hour corpus is manifest-only — the audio has not been delivered, so nothing has been trained.",
  },
  {
    id: "speech_recognition",
    label_en: "Speaking feedback from your microphone",
    label_am: "ከማይክሮፎን የንግግር ግምገማ",
    min_plan: "premium",
    capability: "not_built",
    caveat_en:
      "There is no speech recognizer in this build. Speaking practice is scored by typed self-check instead.",
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

/** Everything the client needs to render gates without guessing. */
export function entitlements(plan: PlanId) {
  return {
    plan,
    /** The plan is a preview switch held by the client, not a verified entitlement. */
    plan_source: "preview_client" as const,
    plan_is_verified: false,
    plans: PLANS,
    features: FEATURES.map((f) => ({
      ...f,
      granted: grants(plan, f.id),
      usable: usable(plan, f.id),
    })),
  };
}
