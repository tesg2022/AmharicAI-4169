import { z } from "zod";
import { desc, eq, inArray } from "drizzle-orm";
import { db } from "../database";
import * as s from "../database/schema";
import { authed } from "../middleware/auth";
import { ensureStats, today } from "../lib/gamification";

/** Learner stats, per-lesson mastery, XP history and the leaderboard. */

export const progress = {
  /** Stats card: XP, streak, daily goal progress. */
  me: authed.handler(async ({ context }) => {
    const stats = await ensureStats(context.user.id, context.user.name);

    const since = new Date();
    since.setUTCHours(0, 0, 0, 0);
    const events = await db
      .select()
      .from(s.xpEvents)
      .where(eq(s.xpEvents.userId, context.user.id))
      .orderBy(desc(s.xpEvents.createdAt))
      .limit(200);

    const todayXp = events
      .filter((e) => e.createdAt.getTime() >= since.getTime())
      .reduce((sum, e) => sum + e.amount, 0);

    return {
      stats,
      todayXp,
      goalMet: todayXp >= stats.dailyGoalXp,
      streakActiveToday: stats.lastActiveDate === today(),
      recentEvents: events.slice(0, 20),
    };
  }),

  /** Mastery per lesson, joined with lesson/unit titles for the path UI. */
  lessons: authed.handler(async ({ context }) => {
    const rows = await db
      .select()
      .from(s.userProgress)
      .where(eq(s.userProgress.userId, context.user.id));

    const lessonIds = rows
      .map((r) => r.lessonId)
      .filter((id): id is string => Boolean(id));
    const lessonRows = lessonIds.length
      ? await db.select().from(s.lessons).where(inArray(s.lessons.id, lessonIds))
      : [];
    const byId = new Map(lessonRows.map((l) => [l.id, l]));

    return rows.map((r) => ({
      ...r,
      lesson: r.lessonId ? (byId.get(r.lessonId) ?? null) : null,
    }));
  }),

  /** XP earned per day for the last N days, oldest first (activity chart). */
  activity: authed
    .input(z.object({ days: z.number().int().min(7).max(120).default(30) }).optional())
    .handler(async ({ input, context }) => {
      const days = input?.days ?? 30;
      const from = new Date(Date.now() - days * 86_400_000);
      const events = await db
        .select()
        .from(s.xpEvents)
        .where(eq(s.xpEvents.userId, context.user.id))
        .orderBy(desc(s.xpEvents.createdAt))
        .limit(2000);

      const buckets = new Map<string, number>();
      for (let i = 0; i < days; i++) {
        const d = new Date(from.getTime() + i * 86_400_000).toISOString().slice(0, 10);
        buckets.set(d, 0);
      }
      for (const e of events) {
        const key = e.createdAt.toISOString().slice(0, 10);
        if (buckets.has(key)) buckets.set(key, (buckets.get(key) ?? 0) + e.amount);
      }

      return [...buckets.entries()].map(([date, xp]) => ({ date, xp }));
    }),

  /** Top learners by XP, with the caller's rank even when outside the top slice. */
  leaderboard: authed
    .input(z.object({ limit: z.number().int().min(3).max(50).default(20) }).optional())
    .handler(async ({ input, context }) => {
      await ensureStats(context.user.id, context.user.name);

      const rows = await db
        .select()
        .from(s.userStats)
        .orderBy(desc(s.userStats.xp))
        .limit(500);

      const ranked = rows.map((row, i) => ({
        rank: i + 1,
        userId: row.userId,
        displayName: row.displayName ?? "Learner",
        xp: row.xp,
        streakDays: row.streakDays,
        isMe: row.userId === context.user.id,
      }));

      return {
        top: ranked.slice(0, input?.limit ?? 20),
        me: ranked.find((r) => r.isMe) ?? null,
      };
    }),

  /** Daily XP goal and display name. */
  updateSettings: authed
    .input(
      z.object({
        dailyGoalXp: z.number().int().min(10).max(500).optional(),
        displayName: z.string().min(1).max(40).optional(),
      }),
    )
    .handler(async ({ input, context }) => {
      await ensureStats(context.user.id, context.user.name);
      const [updated] = await db
        .update(s.userStats)
        .set({
          ...(input.dailyGoalXp !== undefined ? { dailyGoalXp: input.dailyGoalXp } : {}),
          ...(input.displayName !== undefined
            ? { displayName: input.displayName }
            : {}),
          updatedAt: new Date(),
        })
        .where(eq(s.userStats.userId, context.user.id))
        .returning();
      return updated!;
    }),
};
