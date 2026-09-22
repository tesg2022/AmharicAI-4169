import { Hono } from "hono";
import { getCourseFlags, getCourseSummary, getLesson } from "../../content/course-model";
import { unitAccess } from "../../content/plans";
import { ApiError, notFound, ok } from "../http";
import { guard } from "../middleware";

/**
 * `/v1/lessons` — the course, gated server-side.
 *
 * Anonymous reads are allowed, because the unit map is the product's shop
 * window and an API that will not show it is useless for building anything on
 * top. What anonymity does not get is lesson *bodies* beyond the free units:
 * the gate is `unitAccess()`, the same function the app and the oRPC
 * procedures use, so `/v1` cannot become the unpaywalled way in.
 *
 * Three states, never conflated: a lesson that does not exist is a 404, a
 * lesson in a unit nobody has written yet is a 404 with `not_written` (it is
 * not for sale, so offering to sell it would be a lie), and a lesson behind a
 * higher plan is a 402 naming that plan.
 */

export const lessonRoutes = new Hono();

/** The unit map with access resolved per unit for the calling plan. */
lessonRoutes.get("/", (c) => {
  const caller = guard(c, { scope: "lessons:read" });
  const summary = getCourseSummary();
  return ok(c, {
    ...summary,
    plan: caller.plan,
    plan_is_verified: caller.planVerified,
    units: summary.units.map((u) => ({ ...u, access: unitAccess(caller.plan, u) })),
  });
});

/** The content QA report, published as-is — warnings are not hidden. */
lessonRoutes.get("/flags", (c) => {
  guard(c, { scope: "lessons:read" });
  const report = getCourseFlags();
  return ok(c, {
    generated_at: report.generated_at,
    policy: report.policy,
    counts: report.counts,
    flags: report.flags,
  });
});

lessonRoutes.get("/:id", (c) => {
  const caller = guard(c, { scope: "lessons:read" });
  const found = getLesson(c.req.param("id"));
  if (!found) {
    throw notFound("No such lesson. Units 7-20 have no lessons written yet.", {
      reason: "lesson_not_found",
    });
  }

  const access = unitAccess(caller.plan, found.unit);
  if (!access.allowed) {
    if (access.reason === "not_written") {
      throw notFound("This unit has not been written yet.", { reason: "not_written" });
    }
    throw new ApiError(
      "plan_required",
      "This unit is included from a higher plan.",
      {
        reason: "plan_required",
        required_plan: access.required_plan ?? null,
        current_plan: caller.plan,
      },
    );
  }

  return ok(c, { ...found, plan: caller.plan });
});
