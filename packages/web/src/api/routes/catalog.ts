import { z } from "zod";
import { ORPCError } from "@orpc/server";
import { base } from "../__core/app";
import {
  getCourseFlags,
  getCourseSummary,
  getLesson,
} from "../content/course-model";
import {
  entitlements,
  planById,
  planFromInput,
  unitAccess,
  type PlanId,
} from "../content/plans";

/**
 * Course catalogue, plans and translation — the mobile app's read surface,
 * matching the website's /api/course, /api/me, /api/translate and
 * /api/billing/checkout exactly.
 *
 * The `plan` input is a PREVIEW SWITCH held by the client. There are no
 * accounts in this build, so it is not an entitlement and is never used to
 * authorise a charge. Gating is still resolved server-side so the client
 * cannot accidentally render content it was not granted.
 */

const planInput = z.object({
  plan: z.string().optional(),
});

/** Reads the translation provider config at request time, like the website does. */
function translateConfig() {
  const url = process.env["AMHARICAI_TRANSLATE_URL"]?.trim() ?? "";
  const key = process.env["AMHARICAI_TRANSLATE_KEY"]?.trim() ?? "";
  const model = process.env["AMHARICAI_TRANSLATE_MODEL"]?.trim() ?? "";
  return { url, key, model, configured: Boolean(url && key) };
}

function billingConfig() {
  const secret = process.env["STRIPE_SECRET_KEY"]?.trim() ?? "";
  return { secret, configured: Boolean(secret) };
}

export const catalog = {
  /** Plans + per-feature grant/capability, so the client never guesses a gate. */
  me: base.input(planInput).handler(({ input }) => {
    return entitlements(planFromInput(input.plan));
  }),

  /**
   * The 20-unit map with access resolved server-side. Unwritten units come back
   * as `not_written` — never as a paywall, because selling them would be a lie.
   */
  course: base.input(planInput).handler(({ input }) => {
    const plan = planFromInput(input.plan);
    const summary = getCourseSummary();
    return {
      ...summary,
      plan,
      plan_is_verified: false,
      units: summary.units.map((u) => ({
        ...u,
        access: unitAccess(plan, u),
      })),
    };
  }),

  /** The content check, published as-is. Warnings are not hidden from the user. */
  flags: base.handler(() => getCourseFlags()),

  /** One lesson, gated. */
  lesson: base
    .input(z.object({ lessonId: z.string(), plan: z.string().optional() }))
    .handler(({ input }) => {
      const plan = planFromInput(input.plan);
      const found = getLesson(input.lessonId);
      // A lesson in an unwritten unit does not exist at all: 404, not a paywall.
      if (!found) {
        throw new ORPCError("NOT_FOUND", {
          message: "No such lesson. Units 7-20 have no lessons written yet.",
          data: { reason: "lesson_not_found" },
        });
      }
      const access = unitAccess(plan, found.unit);
      if (!access.allowed) {
        throw new ORPCError("FORBIDDEN", {
          message:
            access.reason === "not_written"
              ? "This unit has not been written yet."
              : "This unit is included from a higher plan.",
          data: { reason: access.reason, required_plan: access.required_plan ?? null },
        });
      }
      return found;
    }),

  /**
   * Free-text translation. When no provider is configured this fails with a
   * machine-readable reason — it NEVER echoes the input back as a translation.
   * (The English gloss inside lessons is different: it comes from the course
   * data, works offline, and needs no provider.)
   */
  translate: base
    .input(
      z.object({
        text: z.string().min(1).max(2000),
        direction: z.enum(["en2am", "am2en"]),
        plan: z.string().optional(),
      }),
    )
    .handler(async ({ input }) => {
      const plan = planFromInput(input.plan);
      if (plan === "free") {
        throw new ORPCError("FORBIDDEN", {
          message: "Translating your own text is included from the Learner plan.",
          data: { reason: "plan_required", required_plan: "learner" as PlanId },
        });
      }

      const cfg = translateConfig();
      if (!cfg.configured) {
        throw new ORPCError("SERVICE_UNAVAILABLE", {
          message:
            "No translation provider is configured, so this build cannot translate free text. Set AMHARICAI_TRANSLATE_URL and AMHARICAI_TRANSLATE_KEY to enable it.",
          data: { reason: "translation_not_configured" },
        });
      }

      const res = await fetch(cfg.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${cfg.key}`,
        },
        body: JSON.stringify({
          model: cfg.model || undefined,
          text: input.text,
          source: input.direction === "en2am" ? "en" : "am",
          target: input.direction === "en2am" ? "am" : "en",
        }),
      }).catch(() => null);

      if (!res || !res.ok) {
        throw new ORPCError("BAD_GATEWAY", {
          message: `The translation provider did not return a translation${
            res ? ` (HTTP ${res.status})` : ""
          }.`,
          data: { reason: "translation_failed" },
        });
      }

      const body = (await res.json().catch(() => null)) as
        | { translation?: string; text?: string; output?: string }
        | null;
      const translation = body?.translation ?? body?.output ?? body?.text ?? "";
      if (!translation.trim()) {
        throw new ORPCError("BAD_GATEWAY", {
          message: "The translation provider returned an empty translation.",
          data: { reason: "translation_empty" },
        });
      }
      return { translation, direction: input.direction, source: "provider" as const };
    }),

  /**
   * Checkout. A deliberate refusal, not a fake stub: there are no payment keys
   * AND no account store to record a subscription against, so adding Stripe
   * keys alone would still not make this chargeable. Both blockers are listed.
   */
  checkout: base
    .input(z.object({ plan: z.string() }))
    .handler(({ input }) => {
      const target = planFromInput(input.plan);
      if (target === "free") {
        throw new ORPCError("BAD_REQUEST", {
          message: "The Free plan costs nothing, so there is nothing to check out.",
          data: { reason: "plan_is_free" },
        });
      }

      const blockers = [
        ...(billingConfig().configured
          ? []
          : ["No Stripe secret key is configured in this build."]),
        "There is no account store yet, so a subscription could not be recorded against a user even with keys configured.",
      ];

      throw new ORPCError("SERVICE_UNAVAILABLE", {
        message: `Payment is not connected, so nothing was charged. ${planById(target).name_en} costs $${planById(target).price_usd_month.toFixed(2)}/month once billing is wired.`,
        data: { reason: "payment_not_configured", blockers },
      });
    }),
};
