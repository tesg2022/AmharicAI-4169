import { z } from "zod";
import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";
import { ORPCError } from "@orpc/server";
import { base } from "../__core/app";
import { db } from "../database";
import * as s from "../database/schema";

/**
 * Read-only course content API. The shapes returned here mirror the ported
 * content model exactly — `lesson_sections.body` is passed through verbatim so
 * clients render the source material without it being reshaped on the server.
 */

const COURSE_CODE = "amharic-beginner-001";

async function getCourse() {
  const [course] = await db
    .select()
    .from(s.courses)
    .where(eq(s.courses.code, COURSE_CODE));
  if (!course) throw new ORPCError("NOT_FOUND", { message: "Course not seeded" });
  return course;
}

export const content = {
  /** Course header + units with lesson counts — powers the learning path. */
  outline: base.handler(async () => {
    const course = await getCourse();

    const unitRows = await db
      .select()
      .from(s.units)
      .where(eq(s.units.courseId, course.id))
      .orderBy(asc(s.units.sortOrder));

    const unitIds = unitRows.map((u) => u.id);
    const lessonRows = unitIds.length
      ? await db
          .select()
          .from(s.lessons)
          .where(inArray(s.lessons.unitId, unitIds))
          .orderBy(asc(s.lessons.sortOrder))
      : [];
    const objectiveRows = unitIds.length
      ? await db
          .select()
          .from(s.learningObjectives)
          .where(inArray(s.learningObjectives.unitId, unitIds))
          .orderBy(asc(s.learningObjectives.sortOrder))
      : [];

    return {
      course,
      units: unitRows.map((unit) => ({
        ...unit,
        objectives: objectiveRows
          .filter((o) => o.unitId === unit.id)
          .map((o) => o.objectiveText),
        lessons: lessonRows.filter((l) => l.unitId === unit.id),
      })),
    };
  }),

  unit: base
    .input(z.object({ unitId: z.string() }))
    .handler(async ({ input }) => {
      const [unit] = await db.select().from(s.units).where(eq(s.units.id, input.unitId));
      if (!unit) throw new ORPCError("NOT_FOUND", { message: "Unit not found" });

      const [lessonRows, objectiveRows, assessmentRows] = await Promise.all([
        db
          .select()
          .from(s.lessons)
          .where(eq(s.lessons.unitId, unit.id))
          .orderBy(asc(s.lessons.sortOrder)),
        db
          .select()
          .from(s.learningObjectives)
          .where(eq(s.learningObjectives.unitId, unit.id))
          .orderBy(asc(s.learningObjectives.sortOrder)),
        db.select().from(s.assessments).where(eq(s.assessments.unitId, unit.id)),
      ]);

      return {
        unit,
        lessons: lessonRows,
        objectives: objectiveRows,
        assessments: assessmentRows,
      };
    }),

  /** Everything needed to render one lesson, source-faithful. */
  lesson: base
    .input(z.object({ lessonId: z.string() }))
    .handler(async ({ input }) => {
      const [lesson] = await db
        .select()
        .from(s.lessons)
        .where(eq(s.lessons.id, input.lessonId));
      if (!lesson) throw new ORPCError("NOT_FOUND", { message: "Lesson not found" });

      const [unit] = await db.select().from(s.units).where(eq(s.units.id, lesson.unitId));

      const [
        sections,
        vocab,
        grammar,
        verbRows,
        dialogueRows,
        activityRows,
        siblings,
      ] = await Promise.all([
        db
          .select()
          .from(s.lessonSections)
          .where(eq(s.lessonSections.lessonId, lesson.id))
          .orderBy(asc(s.lessonSections.sortOrder)),
        db.select().from(s.vocabulary).where(eq(s.vocabulary.lessonId, lesson.id)),
        db
          .select()
          .from(s.grammarConcepts)
          .where(eq(s.grammarConcepts.lessonId, lesson.id)),
        db.select().from(s.verbs).where(eq(s.verbs.lessonId, lesson.id)),
        db.select().from(s.dialogues).where(eq(s.dialogues.lessonId, lesson.id)),
        db
          .select()
          .from(s.activities)
          .where(eq(s.activities.lessonId, lesson.id)),
        db
          .select()
          .from(s.lessons)
          .where(eq(s.lessons.unitId, lesson.unitId))
          .orderBy(asc(s.lessons.sortOrder)),
      ]);

      const verbIds = verbRows.map((v) => v.id);
      const conjugations = verbIds.length
        ? await db
            .select()
            .from(s.verbConjugations)
            .where(inArray(s.verbConjugations.verbId, verbIds))
        : [];

      const dialogueIds = dialogueRows.map((d) => d.id);
      const lines = dialogueIds.length
        ? await db
            .select()
            .from(s.dialogueLines)
            .where(inArray(s.dialogueLines.dialogueId, dialogueIds))
            .orderBy(asc(s.dialogueLines.lineNo))
        : [];

      const index = siblings.findIndex((l) => l.id === lesson.id);

      return {
        lesson,
        unit: unit ?? null,
        sections,
        vocabulary: vocab,
        grammar,
        verbs: verbRows.map((v) => ({
          ...v,
          conjugations: conjugations.filter((c) => c.verbId === v.id),
        })),
        dialogues: dialogueRows.map((d) => ({
          ...d,
          lines: lines.filter((l) => l.dialogueId === d.id),
        })),
        activities: activityRows,
        prevLessonId: index > 0 ? siblings[index - 1]!.id : null,
        nextLessonId:
          index >= 0 && index < siblings.length - 1 ? siblings[index + 1]!.id : null,
      };
    }),

  /** ፊደል syllabary, grouped by base consonant. */
  fidel: base.handler(async () => {
    const rows = await db
      .select()
      .from(s.fidel)
      .orderBy(asc(s.fidel.baseOrder), asc(s.fidel.orderIndex));

    const groups: {
      baseOrder: number;
      baseChar: string;
      romanBase: string;
      category: string | null;
      letters: typeof rows;
    }[] = [];

    for (const row of rows) {
      let group = groups.find((g) => g.baseOrder === row.baseOrder);
      if (!group) {
        group = {
          baseOrder: row.baseOrder,
          baseChar: row.baseChar,
          romanBase: row.romanBase,
          category: row.category,
          letters: [],
        };
        groups.push(group);
      }
      group.letters.push(row);
    }

    return { orders: ["ä", "u", "i", "a", "e", "ï", "o"], groups };
  }),

  /** Source assessment bank for a unit (questions kept as written). */
  assessment: base
    .input(z.object({ assessmentId: z.string() }))
    .handler(async ({ input }) => {
      const [assessment] = await db
        .select()
        .from(s.assessments)
        .where(eq(s.assessments.id, input.assessmentId));
      if (!assessment)
        throw new ORPCError("NOT_FOUND", { message: "Assessment not found" });

      const questionRows = await db
        .select()
        .from(s.questions)
        .where(eq(s.questions.assessmentId, assessment.id))
        .orderBy(asc(s.questions.sortOrder));

      const questionIds = questionRows.map((q) => q.id);
      const optionRows = questionIds.length
        ? await db
            .select()
            .from(s.questionOptions)
            .where(inArray(s.questionOptions.questionId, questionIds))
            .orderBy(asc(s.questionOptions.sortOrder))
        : [];

      return {
        assessment,
        questions: questionRows.map((q) => ({
          ...q,
          options: optionRows.filter((o) => o.questionId === q.id),
        })),
      };
    }),

  /** Vocabulary browser — all words, optionally filtered by unit. */
  vocabulary: base
    .input(z.object({ unitId: z.string().optional() }).optional())
    .handler(async ({ input }) => {
      const lessonRows = input?.unitId
        ? await db
            .select()
            .from(s.lessons)
            .where(eq(s.lessons.unitId, input.unitId))
            .orderBy(asc(s.lessons.sortOrder))
        : await db.select().from(s.lessons).orderBy(asc(s.lessons.sortOrder));

      const lessonIds = lessonRows.map((l) => l.id);
      if (!lessonIds.length) return [];

      // Unfiltered browsing also surfaces words that were not attached to a
      // specific lesson in the source spec.
      const filter = input?.unitId
        ? inArray(s.vocabulary.lessonId, lessonIds)
        : or(inArray(s.vocabulary.lessonId, lessonIds), isNull(s.vocabulary.lessonId));

      const words = await db.select().from(s.vocabulary).where(filter);

      const lessonById = new Map(lessonRows.map((l) => [l.id, l]));
      return words.map((w) => ({
        ...w,
        lessonTitle: w.lessonId ? (lessonById.get(w.lessonId)?.titleEn ?? null) : null,
      }));
    }),

  /** Search across vocabulary (Amharic, transliteration or English). */
  search: base
    .input(z.object({ query: z.string().min(1) }))
    .handler(async ({ input }) => {
      const q = input.query.trim().toLowerCase();
      const words = await db.select().from(s.vocabulary);
      return words
        .filter(
          (w) =>
            w.amharic.toLowerCase().includes(q) ||
            (w.transliteration ?? "").toLowerCase().includes(q) ||
            (w.english ?? "").toLowerCase().includes(q),
        )
        .slice(0, 50);
    }),

  /** Dialogues across the course — used by role-play practice. */
  dialogues: base.handler(async () => {
    const dialogueRows = await db.select().from(s.dialogues);
    const ids = dialogueRows.map((d) => d.id);
    const lines = ids.length
      ? await db
          .select()
          .from(s.dialogueLines)
          .where(inArray(s.dialogueLines.dialogueId, ids))
          .orderBy(asc(s.dialogueLines.lineNo))
      : [];
    return dialogueRows.map((d) => ({
      ...d,
      lines: lines.filter((l) => l.dialogueId === d.id),
    }));
  }),

  /** Course-wide counts for the profile/marketing surfaces. */
  stats: base.handler(async () => {
    const [unitRows, lessonRows, vocabRows, questionRows] = await Promise.all([
      db.select({ id: s.units.id }).from(s.units),
      db.select({ id: s.lessons.id }).from(s.lessons),
      db.select({ id: s.vocabulary.id }).from(s.vocabulary),
      db
        .select({ id: s.questions.id })
        .from(s.questions)
        .where(and(eq(s.questions.qaFlag, "generated_from_source"))),
    ]);
    return {
      units: unitRows.length,
      lessons: lessonRows.length,
      words: vocabRows.length,
      practiceQuestions: questionRows.length,
    };
  }),
};
