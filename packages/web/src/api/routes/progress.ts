import { z } from "zod";
import { authed } from "../middleware/auth";
import {
  leaderboard,
  learnerStats,
  lessonMastery,
  updateLearnerSettings,
  xpActivity,
} from "../progress/service";

/**
 * Learner stats, per-lesson mastery, XP history and the leaderboard.
 *
 * The queries themselves live in `../progress/service.ts` because `/v1/progress`
 * serves the same data over plain HTTP. These procedures keep the input
 * validation and the session binding; everything below the validation is shared.
 */

export const progress = {
  /** Stats card: XP, streak, daily goal progress. */
  me: authed.handler(({ context }) => learnerStats(context.user.id, context.user.name)),

  /** Mastery per lesson, joined with lesson/unit titles for the path UI. */
  lessons: authed.handler(({ context }) => lessonMastery(context.user.id)),

  /** XP earned per day for the last N days, oldest first (activity chart). */
  activity: authed
    .input(z.object({ days: z.number().int().min(7).max(120).default(30) }).optional())
    .handler(({ input, context }) => xpActivity(context.user.id, input?.days ?? 30)),

  /** Top learners by XP, with the caller's rank even when outside the top slice. */
  leaderboard: authed
    .input(z.object({ limit: z.number().int().min(3).max(50).default(20) }).optional())
    .handler(({ input, context }) =>
      leaderboard(context.user.id, input?.limit ?? 20, context.user.name),
    ),

  /** Daily XP goal and display name. */
  updateSettings: authed
    .input(
      z.object({
        dailyGoalXp: z.number().int().min(10).max(500).optional(),
        displayName: z.string().min(1).max(40).optional(),
      }),
    )
    .handler(({ input, context }) =>
      updateLearnerSettings(context.user.id, input, context.user.name),
    ),
};
