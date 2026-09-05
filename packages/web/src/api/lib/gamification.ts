import { and, eq, isNull } from "drizzle-orm";
import { db } from "../database";
import * as s from "../database/schema";

/** yyyy-mm-dd in UTC — the day key streaks are counted on. */
export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function dayDiff(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

export async function ensureStats(userId: string, displayName?: string | null) {
  const [existing] = await db
    .select()
    .from(s.userStats)
    .where(eq(s.userStats.userId, userId));
  if (existing) return existing;

  const [created] = await db
    .insert(s.userStats)
    .values({ userId, displayName: displayName ?? null })
    .onConflictDoNothing()
    .returning();
  if (created) return created;

  const [row] = await db
    .select()
    .from(s.userStats)
    .where(eq(s.userStats.userId, userId));
  return row!;
}

/**
 * Records XP for an action and rolls the daily streak forward.
 * Same-day activity keeps the streak, a one-day gap extends it, anything
 * longer resets it to 1.
 */
export async function awardXp(opts: {
  userId: string;
  amount: number;
  kind: string;
  refId?: string | null;
  displayName?: string | null;
}) {
  const stats = await ensureStats(opts.userId, opts.displayName);

  if (opts.amount > 0) {
    await db.insert(s.xpEvents).values({
      id: crypto.randomUUID(),
      userId: opts.userId,
      amount: opts.amount,
      kind: opts.kind,
      refId: opts.refId ?? null,
    });
  }

  const day = today();
  let streakDays = stats.streakDays;
  if (stats.lastActiveDate === day) {
    streakDays = Math.max(1, stats.streakDays);
  } else if (stats.lastActiveDate && dayDiff(stats.lastActiveDate, day) === 1) {
    streakDays = stats.streakDays + 1;
  } else {
    streakDays = 1;
  }

  const [updated] = await db
    .update(s.userStats)
    .set({
      xp: stats.xp + Math.max(0, opts.amount),
      streakDays,
      longestStreak: Math.max(stats.longestStreak, streakDays),
      lastActiveDate: day,
      displayName: stats.displayName ?? opts.displayName ?? null,
      updatedAt: new Date(),
    })
    .where(eq(s.userStats.userId, opts.userId))
    .returning();

  return updated!;
}

/** Upserts lesson mastery from a graded attempt. Mastery is an EMA of correctness. */
export async function recordLessonAttempt(opts: {
  userId: string;
  lessonId: string;
  correct: boolean;
}) {
  const [existing] = await db
    .select()
    .from(s.userProgress)
    .where(
      and(
        eq(s.userProgress.userId, opts.userId),
        eq(s.userProgress.lessonId, opts.lessonId),
        isNull(s.userProgress.activityId),
      ),
    );

  const score = opts.correct ? 1 : 0;

  if (!existing) {
    const [row] = await db
      .insert(s.userProgress)
      .values({
        id: crypto.randomUUID(),
        userId: opts.userId,
        lessonId: opts.lessonId,
        activityId: null,
        mastery: score * 0.3,
        status: "in_progress",
        attempts: 1,
        correctAttempts: score,
        lastAttemptAt: new Date(),
      })
      .returning();
    return row!;
  }

  const mastery = Math.min(1, Math.max(0, existing.mastery * 0.7 + score * 0.3));
  const attempts = existing.attempts + 1;
  const correctAttempts = existing.correctAttempts + score;
  const status: (typeof s.PROGRESS_STATUS)[number] =
    mastery >= 0.85 && attempts >= 5 ? "mastered" : "in_progress";

  const [row] = await db
    .update(s.userProgress)
    .set({ mastery, attempts, correctAttempts, status, lastAttemptAt: new Date() })
    .where(eq(s.userProgress.id, existing.id))
    .returning();
  return row!;
}
