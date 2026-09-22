import { desc, eq, inArray } from "drizzle-orm";
import { db } from "../database";
import * as s from "../database/schema";
import { ensureStats, today } from "../lib/gamification";

/**
 * Learner progress, as functions rather than as route handlers.
 *
 * Both surfaces read progress — the oRPC `progress.*` procedures the first-party
 * clients call, and `/v1/progress` — and they have to agree. XP totals, streaks
 * and the leaderboard are the kind of thing a learner will screenshot and
 * compare, so two implementations that drift by a day boundary or an event
 * limit is a support ticket nobody can reproduce. The queries live here once;
 * both routes are thin wrappers that only translate shapes.
 *
 * Nothing here reads a request or a session. Every function takes the user id
 * it operates on, which is what lets `/v1` pass a key's owning user and the
 * oRPC layer pass a session user without either of them being special.
 */

/** Stats card: XP, streak, today's goal progress, recent events. */
export async function learnerStats(userId: string, displayName?: string | null) {
  const stats = await ensureStats(userId, displayName);

  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  const events = await db
    .select()
    .from(s.xpEvents)
    .where(eq(s.xpEvents.userId, userId))
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
}

/** Mastery per lesson, joined with the lesson rows the path UI labels with. */
export async function lessonMastery(userId: string) {
  const rows = await db
    .select()
    .from(s.userProgress)
    .where(eq(s.userProgress.userId, userId));

  const lessonIds = rows.map((r) => r.lessonId).filter((id): id is string => Boolean(id));
  const lessonRows = lessonIds.length
    ? await db.select().from(s.lessons).where(inArray(s.lessons.id, lessonIds))
    : [];
  const byId = new Map(lessonRows.map((l) => [l.id, l]));

  return rows.map((r) => ({
    ...r,
    lesson: r.lessonId ? (byId.get(r.lessonId) ?? null) : null,
  }));
}

/**
 * XP per day for the last N days, oldest first.
 *
 * Every day in the window is emitted, including the zeroes — a chart that
 * silently omits idle days draws a misleadingly flat streak.
 */
export async function xpActivity(userId: string, days: number) {
  const from = new Date(Date.now() - days * 86_400_000);
  const events = await db
    .select()
    .from(s.xpEvents)
    .where(eq(s.xpEvents.userId, userId))
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
}

/** Top learners by XP, plus the caller's own rank even when outside the slice. */
export async function leaderboard(
  userId: string,
  limit: number,
  displayName?: string | null,
) {
  await ensureStats(userId, displayName);

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
    isMe: row.userId === userId,
  }));

  return {
    top: ranked.slice(0, limit),
    me: ranked.find((r) => r.isMe) ?? null,
  };
}

export interface SettingsPatch {
  dailyGoalXp?: number;
  displayName?: string;
}

/** Daily XP goal and display name. Absent fields are left alone, not cleared. */
export async function updateLearnerSettings(
  userId: string,
  patch: SettingsPatch,
  fallbackName?: string | null,
) {
  await ensureStats(userId, fallbackName);
  const [updated] = await db
    .update(s.userStats)
    .set({
      ...(patch.dailyGoalXp !== undefined ? { dailyGoalXp: patch.dailyGoalXp } : {}),
      ...(patch.displayName !== undefined ? { displayName: patch.displayName } : {}),
      updatedAt: new Date(),
    })
    .where(eq(s.userStats.userId, userId))
    .returning();
  return updated!;
}
