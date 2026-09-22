import { Hono } from "hono";
import {
  leaderboard,
  learnerStats,
  lessonMastery,
  updateLearnerSettings,
  xpActivity,
} from "../../progress/service";
import { badRequest, jsonBody, ok } from "../http";
import { guard } from "../middleware";

/**
 * `/v1/progress` — a learner's XP, streak, mastery and rank.
 *
 * Every route here is about one learner and that learner is always the caller.
 * There is deliberately no `?user_id=` parameter: a key acts as its owning
 * account and nothing else, so no amount of guessing ids gets one account's
 * progress out of another's. The leaderboard is the single place other people
 * appear, and it exposes only what a leaderboard has to — display name, XP,
 * streak — never an email or an internal id belonging to someone else.
 *
 * Reads need `progress:read`; the settings write needs `progress:write`. Both
 * need a real user, so anonymous callers are refused rather than handed an
 * empty skeleton that looks like a brand-new account.
 */

export const progressRoutes = new Hono();

/** Stats card: XP, streak, today's goal progress, recent XP events. */
progressRoutes.get("/", async (c) => {
  const caller = guard(c, { identity: "user", scope: "progress:read" });
  return ok(c, await learnerStats(caller.userId!));
});

/** Mastery per lesson. A learner who has started nothing gets an empty list. */
progressRoutes.get("/lessons", async (c) => {
  const caller = guard(c, { identity: "user", scope: "progress:read" });
  return ok(c, { lessons: await lessonMastery(caller.userId!) });
});

/**
 * XP per day, oldest first. `days` is clamped to the same 7-120 window the
 * oRPC procedure accepts — the bound exists because the underlying query reads
 * a fixed slice of events, and a wider window would quietly under-report.
 */
progressRoutes.get("/activity", async (c) => {
  const caller = guard(c, { identity: "user", scope: "progress:read" });
  const raw = c.req.query("days");
  const days = raw === undefined ? 30 : Number(raw);
  if (!Number.isInteger(days) || days < 7 || days > 120) {
    throw badRequest("days must be a whole number between 7 and 120.", { received: raw });
  }
  return ok(c, { days, activity: await xpActivity(caller.userId!, days) });
});

/** Top learners, plus the caller's own rank even when outside the slice. */
progressRoutes.get("/leaderboard", async (c) => {
  const caller = guard(c, { identity: "user", scope: "progress:read" });
  const raw = c.req.query("limit");
  const limit = raw === undefined ? 20 : Number(raw);
  if (!Number.isInteger(limit) || limit < 3 || limit > 50) {
    throw badRequest("limit must be a whole number between 3 and 50.", { received: raw });
  }
  return ok(c, await leaderboard(caller.userId!, limit));
});

interface SettingsBody {
  daily_goal_xp?: unknown;
  display_name?: unknown;
}

/**
 * Daily goal and display name.
 *
 * PATCH, not PUT: the body is a partial and an omitted field means "leave it
 * alone". Sending `{}` is accepted and changes nothing, which keeps a client
 * that diffs a form and posts the diff from having to special-case "no
 * changes".
 */
progressRoutes.patch("/settings", async (c) => {
  const caller = guard(c, { identity: "user", scope: "progress:write" });
  const body = await jsonBody<SettingsBody>(c);

  const patch: { dailyGoalXp?: number; displayName?: string } = {};

  if (body.daily_goal_xp !== undefined) {
    const goal = Number(body.daily_goal_xp);
    if (!Number.isInteger(goal) || goal < 10 || goal > 500) {
      throw badRequest("daily_goal_xp must be a whole number between 10 and 500.", {
        received: body.daily_goal_xp,
      });
    }
    patch.dailyGoalXp = goal;
  }

  if (body.display_name !== undefined) {
    const name = typeof body.display_name === "string" ? body.display_name.trim() : "";
    if (!name || name.length > 40) {
      throw badRequest("display_name must be 1-40 characters.");
    }
    patch.displayName = name;
  }

  return ok(c, { stats: await updateLearnerSettings(caller.userId!, patch) });
});
