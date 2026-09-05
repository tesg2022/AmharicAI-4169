import { z } from "zod";
import { and, asc, eq, inArray, lte } from "drizzle-orm";
import { ORPCError } from "@orpc/server";
import { db } from "../database";
import * as s from "../database/schema";
import { authed } from "../middleware/auth";
import { awardXp } from "../lib/gamification";

/**
 * Spaced repetition over the course vocabulary (SM-2).
 *
 * Cards are created lazily: adding a lesson's words creates one card per
 * vocabulary row, and reviews move `ease`/`intervalDays`/`dueAt` forward.
 */

const XP_PER_REVIEW = 4;

/** SM-2 quality scale, mapped from the four buttons the UI shows. */
const GRADES = { again: 0, hard: 3, good: 4, easy: 5 } as const;
type Grade = keyof typeof GRADES;

function scheduleNext(
  card: { ease: number; intervalDays: number; repetitions: number; lapses: number },
  grade: Grade,
) {
  const q = GRADES[grade];

  if (q < 3) {
    return {
      ease: Math.max(1.3, card.ease - 0.2),
      intervalDays: 0,
      repetitions: 0,
      lapses: card.lapses + 1,
    };
  }

  const repetitions = card.repetitions + 1;
  const ease = Math.max(
    1.3,
    card.ease + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)),
  );
  const intervalDays =
    repetitions === 1 ? 1 : repetitions === 2 ? 6 : Math.round(card.intervalDays * ease);

  return { ease, intervalDays, repetitions, lapses: card.lapses };
}

function dueDate(intervalDays: number): Date {
  // A lapsed card comes back in ten minutes rather than the next day.
  const ms = intervalDays === 0 ? 10 * 60_000 : intervalDays * 86_400_000;
  return new Date(Date.now() + ms);
}

type SrsCardRow = typeof s.srsCards.$inferSelect;
type VocabularyRow = typeof s.vocabulary.$inferSelect;

async function attachVocabulary(
  cards: SrsCardRow[],
): Promise<{ card: SrsCardRow; word: VocabularyRow }[]> {
  if (!cards.length) return [];
  const words = await db
    .select()
    .from(s.vocabulary)
    .where(inArray(s.vocabulary.id, cards.map((c) => c.vocabularyId)));
  const byId = new Map(words.map((w) => [w.id, w]));
  return cards
    .map((card) => ({ card, word: byId.get(card.vocabularyId) ?? null }))
    .filter((row): row is { card: SrsCardRow; word: VocabularyRow } => Boolean(row.word));
}

export const srs = {
  /** Cards due now, oldest due first. */
  due: authed
    .input(z.object({ limit: z.number().int().min(1).max(60).default(20) }).optional())
    .handler(async ({ input, context }) => {
      const cards = await db
        .select()
        .from(s.srsCards)
        .where(
          and(
            eq(s.srsCards.userId, context.user.id),
            lte(s.srsCards.dueAt, new Date()),
          ),
        )
        .orderBy(asc(s.srsCards.dueAt))
        .limit(input?.limit ?? 20);

      return attachVocabulary(cards);
    }),

  /** Deck overview: how many cards exist, are due, and are still new. */
  summary: authed.handler(async ({ context }) => {
    const cards = await db
      .select()
      .from(s.srsCards)
      .where(eq(s.srsCards.userId, context.user.id));

    const now = Date.now();
    return {
      total: cards.length,
      due: cards.filter((c) => c.dueAt.getTime() <= now).length,
      learning: cards.filter((c) => c.repetitions > 0 && c.repetitions < 3).length,
      mature: cards.filter((c) => c.intervalDays >= 21).length,
      nextDueAt:
        cards
          .map((c) => c.dueAt.getTime())
          .filter((t) => t > now)
          .sort((a, b) => a - b)[0] ?? null,
    };
  }),

  /** Adds every word of a lesson to the deck (existing cards are left alone). */
  addLesson: authed
    .input(z.object({ lessonId: z.string() }))
    .handler(async ({ input, context }) => {
      const words = await db
        .select({ id: s.vocabulary.id })
        .from(s.vocabulary)
        .where(eq(s.vocabulary.lessonId, input.lessonId));
      if (!words.length)
        throw new ORPCError("NOT_FOUND", { message: "No vocabulary in this lesson" });

      const inserted = await db
        .insert(s.srsCards)
        .values(
          words.map((w) => ({
            id: crypto.randomUUID(),
            userId: context.user.id,
            vocabularyId: w.id,
            dueAt: new Date(),
          })),
        )
        .onConflictDoNothing()
        .returning({ id: s.srsCards.id });

      return { added: inserted.length, lessonWords: words.length };
    }),

  /** Grades one card and reschedules it. */
  review: authed
    .input(
      z.object({
        cardId: z.string(),
        grade: z.enum(["again", "hard", "good", "easy"]),
      }),
    )
    .handler(async ({ input, context }) => {
      const [card] = await db
        .select()
        .from(s.srsCards)
        .where(
          and(eq(s.srsCards.id, input.cardId), eq(s.srsCards.userId, context.user.id)),
        );
      if (!card) throw new ORPCError("NOT_FOUND", { message: "Card not found" });

      const next = scheduleNext(card, input.grade);
      const [updated] = await db
        .update(s.srsCards)
        .set({
          ...next,
          dueAt: dueDate(next.intervalDays),
          lastReviewedAt: new Date(),
        })
        .where(eq(s.srsCards.id, card.id))
        .returning();

      const stats = await awardXp({
        userId: context.user.id,
        amount: input.grade === "again" ? 1 : XP_PER_REVIEW,
        kind: "srs_review",
        refId: card.id,
        displayName: context.user.name,
      });

      return { card: updated!, stats };
    }),
};
