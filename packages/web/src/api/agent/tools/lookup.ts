import z from "zod";
import { tool } from "ai";
import { asc, eq, inArray, like, or } from "drizzle-orm";
import { db } from "../../database";
import * as s from "../../database/schema";

/**
 * Course-grounded lookup tools. They keep the tutor tied to the material the
 * learner actually studies instead of inventing vocabulary or paradigms.
 */

export const lookupVocabulary = tool({
  description:
    "Look up words from the AmharicAI course vocabulary by Amharic script, transliteration or English meaning. Use this before teaching a word so the spelling matches the course.",
  inputSchema: z.object({
    query: z.string().describe("Amharic, transliteration or English search term"),
  }),
  async execute({ query }) {
    const q = `%${query.trim()}%`;
    const rows = await db
      .select()
      .from(s.vocabulary)
      .where(
        or(
          like(s.vocabulary.amharic, q),
          like(s.vocabulary.transliteration, q),
          like(s.vocabulary.english, q),
        ),
      )
      .limit(12);

    return rows.map((r) => ({
      amharic: r.amharic,
      transliteration: r.transliteration,
      english: r.english,
      partOfSpeech: r.partOfSpeech,
      sourcePage: r.sourcePage,
    }));
  },
});

export const lookupLesson = tool({
  description:
    "Fetch the vocabulary and grammar of a specific course lesson by its id (e.g. 'u3-l2'). Use it when the learner asks about what they are currently studying.",
  inputSchema: z.object({ lessonId: z.string() }),
  async execute({ lessonId }) {
    const [lesson] = await db
      .select()
      .from(s.lessons)
      .where(eq(s.lessons.id, lessonId));
    if (!lesson) return { error: "Lesson not found" };

    const [words, grammar] = await Promise.all([
      db.select().from(s.vocabulary).where(eq(s.vocabulary.lessonId, lesson.id)).limit(60),
      db
        .select()
        .from(s.grammarConcepts)
        .where(eq(s.grammarConcepts.lessonId, lesson.id))
        .limit(10),
    ]);

    return {
      lesson: { id: lesson.id, title: lesson.titleEn, titleAm: lesson.titleAm },
      vocabulary: words.map((w) => ({
        amharic: w.amharic,
        transliteration: w.transliteration,
        english: w.english,
      })),
      grammar: grammar.map((g) => ({ name: g.nameEn, rule: g.ruleText })),
    };
  },
});

export const lookupConjugation = tool({
  description:
    "Get the conjugation table of a course verb, searched by its English meaning or Amharic infinitive.",
  inputSchema: z.object({ verb: z.string() }),
  async execute({ verb }) {
    const q = `%${verb.trim()}%`;
    const verbRows = await db
      .select()
      .from(s.verbs)
      .where(
        or(
          like(s.verbs.englishMeaning, q),
          like(s.verbs.infinitive, q),
          like(s.verbs.stem, q),
          like(s.verbs.root, q),
        ),
      )
      .limit(3);
    if (!verbRows.length) return { matches: [] };

    const forms = await db
      .select()
      .from(s.verbConjugations)
      .where(
        inArray(
          s.verbConjugations.verbId,
          verbRows.map((v) => v.id),
        ),
      )
      .orderBy(asc(s.verbConjugations.pronoun));

    return {
      matches: verbRows.map((v) => ({
        infinitive: v.infinitive,
        english: v.englishMeaning,
        verbType: v.verbType,
        forms: forms
          .filter((f) => f.verbId === v.id)
          .map((f) => ({
            pronoun: f.pronoun,
            form: f.form,
            transliteration: f.transliteration,
            tense: f.tense,
            polarity: f.polarity,
          })),
      })),
    };
  },
});
