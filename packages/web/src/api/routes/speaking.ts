import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { db } from "../database";
import * as s from "../database/schema";
import { authed, withUser } from "../middleware/auth";
import { awardXp } from "../lib/gamification";

/**
 * Pronunciation practice scoring.
 *
 * The client does the recognition (on-device speech-to-text) and sends the
 * transcript here. Scoring is deterministic character-similarity against the
 * target phrase — no model call, so it stays instant and works the same for
 * every learner.
 */

const XP_PER_GOOD_ATTEMPT = 6;

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[.,!?"'’“”()[\]፡።፣፤]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Levenshtein distance, iterative with a single row buffer. */
function distance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(row[j - 1]! + 1, prev[j]! + 1, prev[j - 1]! + cost);
    }
    prev = row;
  }
  return prev[b.length]!;
}

function similarity(target: string, said: string): number {
  const a = normalize(target);
  const b = normalize(said);
  if (!a.length || !b.length) return 0;
  return Math.max(0, 1 - distance(a, b) / Math.max(a.length, b.length));
}

function feedbackFor(score: number): string {
  if (score >= 0.92) return "ጥሩ! (ṭiru) — spot on. Clear and natural.";
  if (score >= 0.75) return "Close. Most of it matched — slow down on the ending sounds.";
  if (score >= 0.5)
    return "Recognisable, but several syllables drifted. Listen once more, then repeat sound by sound.";
  return "That did not match yet. Play the audio, then say it one syllable at a time.";
}

export const speaking = {
  /**
   * Scores a spoken attempt. Anonymous callers get the score without it being
   * stored; signed-in learners get an attempt row and XP for a good take.
   */
  score: withUser
    .input(
      z.object({
        targetText: z.string().min(1),
        transcript: z.string(),
        lessonId: z.string().nullish(),
      }),
    )
    .handler(async ({ input, context }) => {
      const score = similarity(input.targetText, input.transcript);
      const feedback = feedbackFor(score);
      const result = { score, feedback, xpAwarded: 0, attemptId: null as string | null };

      if (!context.user) return result;

      const attemptId = crypto.randomUUID();
      await db.insert(s.speakingAttempts).values({
        id: attemptId,
        userId: context.user.id,
        lessonId: input.lessonId ?? null,
        targetText: input.targetText,
        transcript: input.transcript,
        score,
        feedback,
      });
      result.attemptId = attemptId;

      if (score >= 0.75) {
        await awardXp({
          userId: context.user.id,
          amount: XP_PER_GOOD_ATTEMPT,
          kind: "speaking_attempt",
          refId: attemptId,
          displayName: context.user.name,
        });
        result.xpAwarded = XP_PER_GOOD_ATTEMPT;
      }

      return result;
    }),

  /** Recent attempts, newest first. */
  history: authed
    .input(z.object({ limit: z.number().int().min(1).max(100).default(30) }).optional())
    .handler(async ({ input, context }) => {
      return db
        .select()
        .from(s.speakingAttempts)
        .where(eq(s.speakingAttempts.userId, context.user.id))
        .orderBy(desc(s.speakingAttempts.createdAt))
        .limit(input?.limit ?? 30);
    }),

  /** Phrases worth drilling: dialogue lines and vocabulary from a lesson. */
  prompts: withUser
    .input(z.object({ lessonId: z.string() }))
    .handler(async ({ input }) => {
      const [words, dialogueRows] = await Promise.all([
        db.select().from(s.vocabulary).where(eq(s.vocabulary.lessonId, input.lessonId)),
        db.select().from(s.dialogues).where(eq(s.dialogues.lessonId, input.lessonId)),
      ]);

      const lines = dialogueRows.length
        ? await db
            .select()
            .from(s.dialogueLines)
            .where(eq(s.dialogueLines.dialogueId, dialogueRows[0]!.id))
        : [];

      return [
        ...lines
          .filter((l) => l.amharic)
          .map((l) => ({
            kind: "dialogue" as const,
            amharic: l.amharic!,
            transliteration: l.transliteration,
            english: l.english,
          })),
        ...words.map((w) => ({
          kind: "word" as const,
          amharic: w.amharic,
          transliteration: w.transliteration,
          english: w.english,
        })),
      ];
    }),
};
