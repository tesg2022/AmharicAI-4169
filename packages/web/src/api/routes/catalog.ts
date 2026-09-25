import { z } from "zod";
import { ORPCError } from "@orpc/server";
import { base } from "../__core/app";
import { withUser } from "../middleware/auth";
import { billingStatus, resolvePlan } from "../entitlements/resolve";
import { activeTranslator } from "../translate";
import {
  getCourseFlags,
  getCourseSummary,
  getLesson,
} from "../content/course-model";
import {
  entitlements,
  entryPrice,
  formatZar,
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
 * The `plan` input is a PREVIEW SWITCH, and it is honoured for ANONYMOUS
 * callers only. Once a request carries a session, the plan comes from the
 * server (`resolvePlan`) and the input is ignored — otherwise a query
 * parameter could upgrade a signed-in user and the login would gate nothing.
 * It is never used to authorise a charge in either case.
 */

const planInput = z.object({
  plan: z.string().optional(),
});

export const catalog = {
  /** Plans + per-feature grant/capability, so the client never guesses a gate. */
  me: withUser.input(planInput).handler(async ({ context, input }) => {
    const resolved = await resolvePlan({
      userId: context.user?.id ?? null,
      previewPlan: input.plan,
    });
    return {
      ...entitlements(resolved.plan, {
        source: resolved.plan_source,
        verified: resolved.plan_is_verified,
      }),
      expires_at: resolved.expires_at,
      expired_notice: resolved.expired_notice,
      signed_in: Boolean(context.user),
    };
  }),

  /**
   * The 20-unit map with access resolved server-side. Unwritten units come back
   * as `not_written` — never as a paywall, because selling them would be a lie.
   */
  course: withUser.input(planInput).handler(async ({ context, input }) => {
    const resolved = await resolvePlan({
      userId: context.user?.id ?? null,
      previewPlan: input.plan,
    });
    const plan = resolved.plan;
    const summary = getCourseSummary();
    return {
      ...summary,
      plan,
      plan_source: resolved.plan_source,
      plan_is_verified: resolved.plan_is_verified,
      units: summary.units.map((u) => ({
        ...u,
        access: unitAccess(plan, u),
      })),
    };
  }),

  /** The content check, published as-is. Warnings are not hidden from the user. */
  flags: base.handler(() => getCourseFlags()),

  /** One lesson, gated. */
  lesson: withUser
    .input(z.object({ lessonId: z.string(), plan: z.string().optional() }))
    .handler(async ({ context, input }) => {
      const { plan } = await resolvePlan({
        userId: context.user?.id ?? null,
        previewPlan: input.plan,
      });
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
  translate: withUser
    .input(
      z.object({
        text: z.string().min(1).max(2000),
        direction: z.enum(["en2am", "am2en"]),
        plan: z.string().optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      const { plan } = await resolvePlan({
        userId: context.user?.id ?? null,
        previewPlan: input.plan,
      });
      if (plan === "free") {
        throw new ORPCError("FORBIDDEN", {
          message: "Translating your own text is included from the Basic plan.",
          data: { reason: "plan_required", required_plan: "basic" as PlanId },
        });
      }

      /**
       * The vendor call now lives behind the translation provider registry
       * (`api/translate/`), the same seam `speech/providers/` gives synthesis.
       * This handler keeps the two things that are actually its business — the
       * plan gate above, and turning a provider failure into an oRPC error the
       * clients already handle — and knows nothing about the request shape or
       * the env vars behind it. Moving translation onto a GPU service is then a
       * URL in the environment, with no edit to this route.
       */
      const translator = activeTranslator();
      if (!translator) {
        throw new ORPCError("SERVICE_UNAVAILABLE", {
          message:
            "No translation provider is configured, so this build cannot translate free text. Set AMHARICAI_TRANSLATE_URL and AMHARICAI_TRANSLATE_KEY to enable it.",
          data: { reason: "translation_not_configured" },
        });
      }

      try {
        const result = await translator.translate({
          text: input.text,
          direction: input.direction,
        });
        return {
          translation: result.translation,
          direction: result.direction,
          source: "provider" as const,
        };
      } catch (error) {
        throw new ORPCError("BAD_GATEWAY", {
          message:
            error instanceof Error
              ? error.message
              : "The translation provider did not return a translation.",
          data: { reason: "translation_failed" },
        });
      }
    }),

  /**
   * Checkout. A deliberate refusal, not a fake stub.
   *
   * This is the OLD checkout procedure, kept only because older mobile builds
   * still call it. It has never taken a payment and must not start now: real
   * checkout is `billing.checkout`, which creates a Paystack transaction and
   * returns an authorization URL, and duplicating that here would be a second
   * way to charge somebody — written once, maintained never.
   *
   * So it refuses, and the refusal explains itself with the live price and
   * where to buy. When no Paystack key is configured at all it says that
   * instead, because "not available in the app" and "this deployment cannot
   * take payments" are different problems with different answers.
   */
  checkout: withUser
    .input(z.object({ plan: z.string() }))
    .handler(({ input }) => {
      const target = planFromInput(input.plan);
      if (target === "free") {
        throw new ORPCError("BAD_REQUEST", {
          message: "The Free plan costs nothing, so there is nothing to check out.",
          data: { reason: "plan_is_free" },
        });
      }

      const billing = billingStatus();
      const blockers = billing.blockers;
      const entry = entryPrice(target);
      const priceNote = entry
        ? `${planById(target).name_en} starts at ${formatZar(entry.price_zar)} a ${entry.term === "annual" ? "year" : "month"}.`
        : `${planById(target).name_en} has no purchasable option configured.`;

      /**
       * Paystack checkout lives on the website (billing.checkout), which needs
       * a browser to complete the hosted payment page and a callback URL to
       * return to. The mobile client has neither wired yet, so this stays a
       * refusal rather than returning a URL the app cannot finish. It reports
       * the real rand price so the app can still show what a plan costs, and it
       * never implies a charge was attempted.
       */
      throw new ORPCError("SERVICE_UNAVAILABLE", {
        message: billing.key_present
          ? `In-app purchase is not available yet, so nothing was charged. ${priceNote} Please subscribe on the website.`
          : `Payment is not connected, so nothing was charged. ${priceNote}`,
        data: {
          reason: billing.key_present ? "checkout_not_available_on_mobile" : "payment_not_configured",
          blockers,
        },
      });
    }),
};
