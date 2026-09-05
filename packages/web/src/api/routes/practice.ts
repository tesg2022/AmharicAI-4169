import { z } from "zod";
import { and, asc, eq, inArray } from "drizzle-orm";
import { ORPCError } from "@orpc/server";
import { base } from "../__core/app";
import { db } from "../database";
import * as s from "../database/schema";
import { authed, withUser } from "../middleware/auth";
import { awardXp, recordLessonAttempt } from "../lib/gamification";

/**
 * Quiz generation and grading.
 *
 * Two question sources exist and are never mixed silently:
 *  - `qa_flag = "generated_from_source"` — drills derived from source vocabulary
 *    and paradigms, safe to shuffle and auto-grade.
 *  - source assessment banks (unit 5 and 6) — kept exactly as written, so the
 *    answer text is returned verbatim and grading is lenient.
 */

const XP_PER_CORRECT = 10;

function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** Loose comparison: ignores case, punctuation and Latin/Amharic spacing noise. */
function normalize(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[.,!?"'’“”()[\]፡።፣፤]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function loadQuestions(questionIds: string[]) {
  if (!questionIds.length) return [];
  const [questionRows, optionRows] = await Promise.all([
    db.select().from(s.questions).where(inArray(s.questions.id, questionIds)),
    db
      .select()
      .from(s.questionOptions)
      .where(inArray(s.questionOptions.questionId, questionIds))
      .orderBy(asc(s.questionOptions.sortOrder)),
  ]);

  return questionRows.map((q) => ({
    id: q.id,
    lessonId: q.lessonId,
    questionType: q.questionType,
    questionText: q.questionText,
    questionAm: q.questionAm,
    sourcePage: q.sourcePage,
    qaFlag: q.qaFlag,
    // The answer is withheld from the client until the attempt is graded.
    options: optionRows
      .filter((o) => o.questionId === q.id)
      .map((o) => ({ id: o.id, optionKey: o.optionKey, optionText: o.optionText })),
  }));
}

export const practice = {
  /** A shuffled drill set for one lesson. */
  quiz: base
    .input(
      z.object({
        lessonId: z.string(),
        limit: z.number().int().min(1).max(30).default(10),
      }),
    )
    .handler(async ({ input }) => {
      const [lesson] = await db
        .select()
        .from(s.lessons)
        .where(eq(s.lessons.id, input.lessonId));
      if (!lesson) throw new ORPCError("NOT_FOUND", { message: "Lesson not found" });

      const pool = await db
        .select({ id: s.questions.id })
        .from(s.questions)
        .where(
          and(
            eq(s.questions.lessonId, lesson.id),
            eq(s.questions.qaFlag, "generated_from_source"),
          ),
        );

      const picked = shuffle(pool.map((q) => q.id)).slice(0, input.limit);
      const questions = await loadQuestions(picked);
      // Preserve the shuffled order the ids were picked in.
      const byId = new Map(questions.map((q) => [q.id, q]));
      return {
        lesson,
        questions: picked
          .map((id) => byId.get(id))
          .filter((q): q is NonNullable<typeof q> => Boolean(q))
          .map((q) => ({ ...q, options: shuffle(q.options) })),
      };
    }),

  /** The source assessment bank for a unit, questions as written. */
  unitExam: base
    .input(z.object({ unitId: z.string() }))
    .handler(async ({ input }) => {
      const [assessment] = await db
        .select()
        .from(s.assessments)
        .where(eq(s.assessments.unitId, input.unitId));
      if (!assessment)
        throw new ORPCError("NOT_FOUND", {
          message: "This unit has no source assessment",
        });

      const questionRows = await db
        .select()
        .from(s.questions)
        .where(eq(s.questions.assessmentId, assessment.id))
        .orderBy(asc(s.questions.sortOrder));

      const questions = await loadQuestions(questionRows.map((q) => q.id));
      const order = new Map(questionRows.map((q, i) => [q.id, i]));
      questions.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));

      return { assessment, questions };
    }),

  /**
   * Grades one answer, stores the attempt and moves mastery/XP.
   * Anonymous callers still get graded feedback, nothing is persisted for them.
   */
  submit: withUser
    .input(
      z.object({
        questionId: z.string(),
        answer: z.union([z.string(), z.array(z.string())]),
        optionId: z.string().optional(),
      }),
    )
    .handler(async ({ input, context }) => {
      const [question] = await db
        .select()
        .from(s.questions)
        .where(eq(s.questions.id, input.questionId));
      if (!question)
        throw new ORPCError("NOT_FOUND", { message: "Question not found" });

      const options = await db
        .select()
        .from(s.questionOptions)
        .where(eq(s.questionOptions.questionId, question.id))
        .orderBy(asc(s.questionOptions.sortOrder));

      const correctOption = options.find((o) => o.isCorrect);
      let isCorrect: boolean;

      if (input.optionId && options.length) {
        isCorrect = correctOption?.id === input.optionId;
      } else if (correctOption) {
        isCorrect = normalize(input.answer) === normalize(correctOption.optionText);
      } else {
        const expected = question.answer;
        const given = normalize(Array.isArray(input.answer) ? input.answer[0] : input.answer);
        isCorrect = Array.isArray(expected)
          ? expected.some((e) => normalize(e) === given)
          : normalize(expected) === given && given.length > 0;
      }

      const result = {
        isCorrect,
        correctOptionId: correctOption?.id ?? null,
        correctAnswer: correctOption?.optionText ?? question.answer ?? null,
        explanation: question.explanation,
        sourcePage: question.sourcePage,
        xpAwarded: 0,
      };

      if (!context.user) return result;

      await db.insert(s.answerAttempts).values({
        id: crypto.randomUUID(),
        userId: context.user.id,
        questionId: question.id,
        lessonId: question.lessonId,
        answer: input.answer,
        isCorrect,
        score: isCorrect ? 1 : 0,
        feedback: null,
      });

      if (question.lessonId) {
        await recordLessonAttempt({
          userId: context.user.id,
          lessonId: question.lessonId,
          correct: isCorrect,
        });
      }

      if (isCorrect) {
        await awardXp({
          userId: context.user.id,
          amount: XP_PER_CORRECT,
          kind: "quiz_correct",
          refId: question.id,
          displayName: context.user.name,
        });
        result.xpAwarded = XP_PER_CORRECT;
      }

      return result;
    }),

  /** Marks a lesson as completed once the learner finishes reading it. */
  completeLesson: authed
    .input(z.object({ lessonId: z.string() }))
    .handler(async ({ input, context }) => {
      const [lesson] = await db
        .select()
        .from(s.lessons)
        .where(eq(s.lessons.id, input.lessonId));
      if (!lesson) throw new ORPCError("NOT_FOUND", { message: "Lesson not found" });

      const progress = await recordLessonAttempt({
        userId: context.user.id,
        lessonId: lesson.id,
        correct: true,
      });
      const stats = await awardXp({
        userId: context.user.id,
        amount: 15,
        kind: "lesson_complete",
        refId: lesson.id,
        displayName: context.user.name,
      });

      return { progress, stats };
    }),

  /** Recent attempt history, newest first — powers the review screen. */
  history: authed
    .input(z.object({ limit: z.number().int().min(1).max(100).default(25) }).optional())
    .handler(async ({ input, context }) => {
      const attempts = await db
        .select()
        .from(s.answerAttempts)
        .where(eq(s.answerAttempts.userId, context.user.id))
        .orderBy(asc(s.answerAttempts.createdAt))
        .limit(input?.limit ?? 25);
      return attempts.reverse();
    }),
};
