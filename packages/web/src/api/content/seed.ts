/**
 * Source-faithful ingester: loads `amharic-course.json` (the Amharic Course
 * Content Specification) into the database.
 *
 * Rules followed here:
 * - Nothing from the source is dropped. Every lesson key that has no dedicated
 *   table is preserved verbatim in `lesson_sections.body` under its original key.
 * - Source wording and answers are stored as written; nothing is auto-corrected.
 * - Provenance (`source_file_id`, `source_page(s)`, `qa_flag`) is carried through.
 * - Practice questions derived from source content are marked
 *   `qa_flag = 'generated_from_source'` so they can never be confused with the
 *   source assessment bank.
 *
 * Run with: bun run seed  (from packages/web)
 */
import { db } from "../database";
import * as s from "../database/schema";
import courseJson from "./amharic-course.json";
import { FIDEL_ROWS } from "./fidel-data";
import { buildExtraRows } from "./seed-extra";

type Json = Record<string, any>;

const spec = (courseJson as Json).specification as Json;
const course = (courseJson as Json).course as Json;
const sourceFileId = spec?.source?.source_file_id ?? null;
const sourceTitle = spec?.source?.title ?? null;

const id = (...parts: (string | number)[]) => parts.join("-");

/** Lesson keys that have dedicated tables — everything else becomes a section. */
const HANDLED_KEYS = new Set([
  "id",
  "title",
  "title_en",
  "title_am",
  "source_pages",
]);

/** Section ordering for the lesson reader. */
const SECTION_ORDER = [
  "alphabet_categories",
  "orders",
  "charts",
  "vowels",
  "special_consonants",
  "wa_combinations",
  "example_words",
  "grammar_terms",
  "punctuation",
  "linguistic_terms",
  "hello",
  "leave_takings",
  "time_greetings",
  "grammar",
  "vocabulary",
  "kinship_vocabulary",
  "family_tree_roles",
  "source_family_relations",
  "root_verbs",
  "dictionary_form_note",
  "examples",
  "rotä_past",
  "dialogues",
  "numbers",
  "ordinals",
  "ordinal_rules",
  "fractions",
  "price_table",
  "cultural_note",
  "notes",
  "source_assessment_bank",
  "activities",
  "application_activities",
];

const sectionRank = (key: string) => {
  const i = SECTION_ORDER.indexOf(key);
  return i === -1 ? SECTION_ORDER.length + 1 : i;
};

async function wipe() {
  // Content tables only — learner data (progress, xp, srs) is never touched.
  await db.delete(s.pronunciationDrills);
  await db.delete(s.minimalPairs);
  await db.delete(s.pronunciationSounds);
  await db.delete(s.questionOptions);
  await db.delete(s.assessmentQuestions);
  await db.delete(s.questions);
  await db.delete(s.assessments);
  await db.delete(s.activities);
  await db.delete(s.dialogueLines);
  await db.delete(s.dialogues);
  await db.delete(s.verbConjugations);
  await db.delete(s.verbs);
  await db.delete(s.grammarConcepts);
  await db.delete(s.vocabulary);
  await db.delete(s.lessonSections);
  await db.delete(s.learningObjectives);
  await db.delete(s.lessons);
  await db.delete(s.units);
  await db.delete(s.levels);
  await db.delete(s.courses);
  await db.delete(s.fidel);
}

type Row = Record<string, any>;

const rows = {
  levels: [] as Row[],
  units: [] as Row[],
  objectives: [] as Row[],
  lessons: [] as Row[],
  sections: [] as Row[],
  vocabulary: [] as Row[],
  grammar: [] as Row[],
  verbs: [] as Row[],
  conjugations: [] as Row[],
  dialogues: [] as Row[],
  dialogueLines: [] as Row[],
  activities: [] as Row[],
  assessments: [] as Row[],
  questions: [] as Row[],
  options: [] as Row[],
  assessmentQuestions: [] as Row[],
};

/** Rows from the second source (textbook + pronunciation), filled by `ingest()`. */
let extra: ReturnType<typeof buildExtraRows> | null = null;

const firstPage = (pages: number[] | undefined) =>
  Array.isArray(pages) && pages.length > 0 ? pages[0] : null;

/** Extract [amharic, transliteration, english] triples into vocabulary rows. */
function pushVocab(
  lessonId: string,
  key: string,
  entries: any[],
  page: number | null,
) {
  entries.forEach((entry, i) => {
    if (!Array.isArray(entry)) return;
    const [amharic, transliteration, english] = entry;
    if (typeof amharic !== "string" || !amharic.trim()) return;
    rows.vocabulary.push({
      id: id(lessonId, key, i),
      lessonId,
      amharic,
      transliteration: typeof transliteration === "string" ? transliteration : null,
      english:
        english === undefined || english === null ? null : String(english),
      partOfSpeech: key === "kinship_vocabulary" ? "kinship" : null,
      notes: null,
      sourcePage: page,
      sourceText: entry,
      status: "published",
    });
  });
}

/** Conjugation-style tables inside `grammar`. */
const CONJUGATION_KEYS = [
  "forms",
  "present_forms",
  "affirmative_negative",
  "present_and_past",
  "to_have_past",
  "presence_forms",
  "possessive_suffixes",
  "demonstratives",
];

function ingestGrammar(lesson: Json, lessonId: string, page: number | null) {
  const grammar = lesson.grammar as Json | undefined;
  if (!grammar) return;

  const ruleParts: string[] = [];
  for (const [k, v] of Object.entries(grammar)) {
    if (typeof v === "string") ruleParts.push(`${k}: ${v}`);
    else if (Array.isArray(v) && v.every((x) => typeof x === "string"))
      ruleParts.push(`${k}: ${v.join(" ")}`);
  }

  rows.grammar.push({
    id: id(lessonId, "grammar"),
    lessonId,
    nameEn: lesson.title_en ?? lesson.title ?? "Grammar",
    nameAm: lesson.title_am ?? null,
    ruleText: ruleParts.join("\n") || null,
    // The whole source grammar block is preserved verbatim.
    examples: [grammar],
    sourcePage: page,
    qaFlag: null,
    status: "published",
  });

  const verbName = typeof grammar.verb === "string" ? grammar.verb : null;
  const conjTables = CONJUGATION_KEYS.filter((k) => Array.isArray(grammar[k]));
  if (conjTables.length === 0) return;

  const verbId = id(lessonId, "verb");
  rows.verbs.push({
    id: verbId,
    lessonId,
    root: null,
    stem: null,
    infinitive: verbName,
    englishMeaning: verbName,
    verbType: verbName ? "source_verb" : "paradigm",
    sourcePage: page,
    qaFlag: null,
  });

  for (const table of conjTables) {
    (grammar[table] as any[]).forEach((entry, i) => {
      if (!Array.isArray(entry)) return;
      const [pronoun, form, transliteration] = entry;
      if (typeof form !== "string") return;
      rows.conjugations.push({
        id: id(verbId, table, i),
        verbId,
        pronoun: String(pronoun ?? ""),
        person: null,
        number: null,
        gender: null,
        tense: table,
        polarity: table === "affirmative_negative" ? "both" : "affirmative",
        form,
        transliteration:
          typeof transliteration === "string" ? transliteration : null,
        sourcePage: page,
        qaFlag: null,
      });
    });
  }
}

function ingestRootVerbs(lesson: Json, lessonId: string, page: number | null) {
  const list = lesson.root_verbs as any[] | undefined;
  if (!Array.isArray(list)) return;
  list.forEach((entry, i) => {
    if (!Array.isArray(entry)) return;
    const [root, stem, infinitive] = entry;
    rows.verbs.push({
      id: id(lessonId, "root", i),
      lessonId,
      root: root ?? null,
      stem: stem ?? null,
      infinitive: infinitive ?? null,
      englishMeaning: null,
      verbType: "root",
      sourcePage: page,
      qaFlag: null,
    });
  });
}

function ingestDialogues(lesson: Json, lessonId: string, pages: number[]) {
  const list = lesson.dialogues as any[] | undefined;
  if (!Array.isArray(list)) return;
  list.forEach((dialogue) => {
    const dialogueId: string = dialogue.id ?? id(lessonId, "dialogue");
    rows.dialogues.push({
      id: dialogueId,
      lessonId,
      code: dialogueId,
      title: dialogue.title ?? "Dialogue",
      sourcePages: pages,
      status: "published",
    });
    (dialogue.lines ?? []).forEach((line: any[], i: number) => {
      const [speaker, amharic, english] = line;
      rows.dialogueLines.push({
        id: id(dialogueId, "line", i),
        dialogueId,
        lineNo: i + 1,
        speaker: speaker ?? null,
        amharic: amharic ?? null,
        transliteration: null,
        english: english ?? null,
        audioAssetId: null,
      });
    });
  });
}

function ingestActivities(lesson: Json, lessonId: string, pages: number[]) {
  const list = [
    ...((lesson.activities as any[]) ?? []),
    ...((lesson.application_activities as any[]) ?? []),
  ];
  list.forEach((activity, i) => {
    rows.activities.push({
      id: activity.id ?? id(lessonId, "a", i),
      lessonId,
      code: activity.id ?? id(lessonId, "a", i),
      activityType: activity.type ?? "practice",
      title: activity.title ?? "Activity",
      instructions: activity.instructions ?? null,
      payload: activity, // verbatim
      sourcePages: pages,
      status: "published",
    });
  });
}

function ingestAssessments(unit: Json) {
  (unit.assessments ?? []).forEach((assessment: Json) => {
    const assessmentId: string = assessment.id;
    rows.assessments.push({
      id: assessmentId,
      unitId: unit.id,
      code: assessmentId,
      title: assessment.title ?? "Assessment",
      sourcePages: assessment.source_pages ?? [],
      status: "published",
    });
    (assessment.questions ?? []).forEach((q: Json, i: number) => {
      const questionId: string = q.id ?? id(assessmentId, "q", i);
      rows.questions.push({
        id: questionId,
        assessmentId,
        activityId: null,
        lessonId: null,
        questionType: q.type ?? "short_answer",
        questionText: q.question ?? "",
        questionAm: q.question_am ?? null,
        // `answer` keeps the source shape (string, object, or array).
        answer: q.answer ?? q.pairs ?? null,
        explanation: q.explanation ?? null,
        sourcePage: q.source_page ?? null,
        qaFlag: q.qa_flag ?? null,
        sortOrder: i,
      });
      (q.options ?? []).forEach((opt: any, oi: number) => {
        rows.options.push({
          id: id(questionId, "o", oi),
          questionId,
          optionKey: String.fromCharCode(97 + oi),
          optionText: typeof opt === "string" ? opt : JSON.stringify(opt),
          isCorrect:
            typeof q.answer === "string" && typeof opt === "string"
              ? q.answer.trim() === opt.trim()
              : null,
          sortOrder: oi,
        });
      });
      rows.assessmentQuestions.push({
        id: id(assessmentId, "aq", i),
        assessmentId,
        questionId,
        sortOrder: i,
      });
    });
  });
}

/* ------------------------------------------------ derived practice questions */

function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/**
 * Builds answerable practice questions from the source vocabulary and
 * conjugation tables. Source text is reused verbatim; only the *arrangement*
 * (which distractors appear) is generated — hence `qa_flag`.
 */
function buildPracticeQuestions() {
  const byLesson = new Map<string, Row[]>();
  for (const v of rows.vocabulary) {
    if (!v.english) continue;
    const list = byLesson.get(v.lessonId) ?? [];
    list.push(v);
    byLesson.set(v.lessonId, list);
  }

  const allVocab = rows.vocabulary.filter((v) => v.english);

  for (const [lessonId, vocab] of byLesson) {
    vocab.slice(0, 12).forEach((v, i) => {
      const pool = shuffle(
        (vocab.length >= 4 ? vocab : allVocab).filter(
          (o) => o.id !== v.id && o.english !== v.english,
        ),
      ).slice(0, 3);
      if (pool.length < 3) return;

      // Amharic -> English
      const qId = id(lessonId, "pq", i, "am2en");
      rows.questions.push({
        id: qId,
        assessmentId: null,
        activityId: null,
        lessonId,
        questionType: "multiple_choice",
        questionText: `What does “${v.amharic}” mean?`,
        questionAm: v.amharic,
        answer: v.english,
        explanation: v.transliteration
          ? `${v.amharic} (${v.transliteration}) — ${v.english}`
          : `${v.amharic} — ${v.english}`,
        sourcePage: v.sourcePage,
        qaFlag: "generated_from_source",
        sortOrder: i * 2,
      });
      shuffle([v, ...pool]).forEach((opt, oi) => {
        rows.options.push({
          id: id(qId, "o", oi),
          questionId: qId,
          optionKey: String.fromCharCode(97 + oi),
          optionText: opt.english,
          isCorrect: opt.id === v.id,
          sortOrder: oi,
        });
      });

      // English -> Amharic
      const qId2 = id(lessonId, "pq", i, "en2am");
      rows.questions.push({
        id: qId2,
        assessmentId: null,
        activityId: null,
        lessonId,
        questionType: "translation",
        questionText: `Which one means “${v.english}”?`,
        questionAm: null,
        answer: v.amharic,
        explanation: v.transliteration ? `${v.amharic} — ${v.transliteration}` : null,
        sourcePage: v.sourcePage,
        qaFlag: "generated_from_source",
        sortOrder: i * 2 + 1,
      });
      shuffle([v, ...pool]).forEach((opt, oi) => {
        rows.options.push({
          id: id(qId2, "o", oi),
          questionId: qId2,
          optionKey: String.fromCharCode(97 + oi),
          optionText: opt.amharic,
          isCorrect: opt.id === v.id,
          sortOrder: oi,
        });
      });
    });
  }

  // Conjugation drills: "Which form goes with <pronoun>?"
  const byVerb = new Map<string, Row[]>();
  for (const c of rows.conjugations) {
    const list = byVerb.get(c.verbId) ?? [];
    list.push(c);
    byVerb.set(c.verbId, list);
  }
  for (const [verbId, forms] of byVerb) {
    const verb = rows.verbs.find((v) => v.id === verbId);
    if (!verb?.lessonId || forms.length < 4) continue;
    forms.slice(0, 8).forEach((f, i) => {
      const pool = shuffle(forms.filter((o) => o.form !== f.form)).slice(0, 3);
      if (pool.length < 3 || !f.pronoun) return;
      const qId = id(verbId, "conj", i);
      rows.questions.push({
        id: qId,
        assessmentId: null,
        activityId: null,
        lessonId: verb.lessonId,
        questionType: "conjugation",
        questionText: verb.infinitive
          ? `${verb.infinitive} — which form goes with “${f.pronoun}”?`
          : `Which form goes with “${f.pronoun}”?`,
        questionAm: f.pronoun,
        answer: f.form,
        explanation: f.transliteration ? `${f.form} — ${f.transliteration}` : null,
        sourcePage: f.sourcePage,
        qaFlag: "generated_from_source",
        sortOrder: 100 + i,
      });
      shuffle([f, ...pool]).forEach((opt, oi) => {
        rows.options.push({
          id: id(qId, "o", oi),
          questionId: qId,
          optionKey: String.fromCharCode(97 + oi),
          optionText: opt.form,
          isCorrect: opt.form === f.form,
          sortOrder: oi,
        });
      });
    });
  }
}

/* --------------------------------------------------------------- ingestion */

function ingest() {
  const levelId = id(course.id, "level", course.level ?? "beginner");
  rows.levels.push({
    id: levelId,
    courseId: course.id,
    code: course.level ?? "beginner",
    titleEn: `${course.title_en}`,
    titleAm: course.title_am ?? null,
    sortOrder: 0,
  });

  (course.units as Json[]).forEach((unit, unitIndex) => {
    rows.units.push({
      id: unit.id,
      levelId,
      courseId: course.id,
      code: unit.id,
      sourceChapter: unit.source_chapter ?? null,
      titleEn: unit.title_en,
      titleAm: unit.title_am ?? null,
      sortOrder: unitIndex,
      sourcePages: unit.source_pages ?? [],
      status: "published",
    });

    (unit.learning_objectives ?? []).forEach((text: string, i: number) => {
      rows.objectives.push({
        id: id(unit.id, "obj", i),
        unitId: unit.id,
        objectiveText: text,
        sortOrder: i,
      });
    });

    (unit.lessons as Json[]).forEach((lesson, lessonIndex) => {
      const lessonId: string = lesson.id;
      const pages: number[] = lesson.source_pages ?? [];
      const page = firstPage(pages);

      rows.lessons.push({
        id: lessonId,
        unitId: unit.id,
        code: lessonId,
        titleEn: lesson.title_en ?? lesson.title ?? "Lesson",
        titleAm: lesson.title_am ?? null,
        sortOrder: lessonIndex,
        sourcePages: pages,
        status: "published",
      });

      // Dedicated tables
      if (Array.isArray(lesson.vocabulary))
        pushVocab(lessonId, "vocabulary", lesson.vocabulary, page);
      if (Array.isArray(lesson.kinship_vocabulary))
        pushVocab(lessonId, "kinship_vocabulary", lesson.kinship_vocabulary, page);
      if (Array.isArray(lesson.numbers))
        lesson.numbers.forEach((entry: any[], i: number) => {
          rows.vocabulary.push({
            id: id(lessonId, "numbers", i),
            lessonId,
            amharic: entry[0],
            transliteration: entry[1] ?? null,
            english: entry[2] === undefined ? null : String(entry[2]),
            partOfSpeech: "number",
            notes: null,
            sourcePage: page,
            sourceText: entry,
            status: "published",
          });
        });
      ingestGrammar(lesson, lessonId, page);
      ingestRootVerbs(lesson, lessonId, page);
      ingestDialogues(lesson, lessonId, pages);
      ingestActivities(lesson, lessonId, pages);

      // Everything else, verbatim, as renderable sections.
      const sectionEntries: [string, unknown][] = [];
      for (const [key, value] of Object.entries(lesson)) {
        if (HANDLED_KEYS.has(key)) continue;
        if (key === "content" && value && typeof value === "object") {
          for (const [ck, cv] of Object.entries(value as Json))
            sectionEntries.push([ck, cv]);
          continue;
        }
        sectionEntries.push([key, value]);
      }
      sectionEntries
        .sort((a, b) => sectionRank(a[0]) - sectionRank(b[0]))
        .forEach(([key, value], i) => {
          rows.sections.push({
            id: id(lessonId, "sec", key),
            lessonId,
            sectionType: key,
            title: null,
            body: { key, value, source_pages: pages },
            sortOrder: i,
          });
        });
    });

    ingestAssessments(unit);
  });

  // Second source: textbook units 7-20, the appendix reference tables, and the
  // pronunciation curriculum. Merged before question generation so the new
  // vocabulary also gets practice questions.
  extra = buildExtraRows(course.id, levelId);
  rows.units.push(...extra.units);
  rows.objectives.push(...extra.objectives);
  rows.lessons.push(...extra.lessons);
  rows.sections.push(...extra.sections);
  rows.vocabulary.push(...extra.vocabulary);
  rows.verbs.push(...extra.verbs);
  rows.dialogues.push(...extra.dialogues);
  rows.dialogueLines.push(...extra.dialogueLines);
  rows.activities.push(...extra.activities);

  buildPracticeQuestions();
}

async function insertAll() {
  const chunk = <T>(arr: T[], size = 100) => {
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  };
  const bulk = async (table: any, data: Row[]) => {
    for (const part of chunk(data)) if (part.length) await db.insert(table).values(part);
  };

  await db.insert(s.courses).values({
    id: course.id,
    code: course.id,
    titleEn: course.title_en,
    titleAm: course.title_am ?? null,
    level: course.level ?? null,
    status: "published",
    sourceFileId,
    sourceTitle,
  });

  await bulk(s.levels, rows.levels);
  await bulk(s.units, rows.units);
  await bulk(s.learningObjectives, rows.objectives);
  await bulk(s.lessons, rows.lessons);
  await bulk(s.lessonSections, rows.sections);
  await bulk(s.vocabulary, rows.vocabulary);
  await bulk(s.grammarConcepts, rows.grammar);
  await bulk(s.verbs, rows.verbs);
  await bulk(s.verbConjugations, rows.conjugations);
  await bulk(s.dialogues, rows.dialogues);
  await bulk(s.dialogueLines, rows.dialogueLines);
  await bulk(s.activities, rows.activities);
  await bulk(s.assessments, rows.assessments);
  await bulk(s.questions, rows.questions);
  await bulk(s.questionOptions, rows.options);
  await bulk(s.assessmentQuestions, rows.assessmentQuestions);
  await bulk(s.fidel, FIDEL_ROWS);

  if (extra) {
    await bulk(s.pronunciationSounds, extra.sounds);
    await bulk(s.minimalPairs, extra.minimalPairs);
    await bulk(s.pronunciationDrills, extra.drills);
  }
}

async function main() {
  console.log("wiping content tables…");
  await wipe();
  console.log("ingesting course JSON…");
  ingest();
  console.log("inserting…");
  await insertAll();
  console.log(
    JSON.stringify(
      {
        units: rows.units.length,
        lessons: rows.lessons.length,
        sections: rows.sections.length,
        vocabulary: rows.vocabulary.length,
        grammar: rows.grammar.length,
        verbs: rows.verbs.length,
        conjugations: rows.conjugations.length,
        dialogues: rows.dialogues.length,
        dialogueLines: rows.dialogueLines.length,
        activities: rows.activities.length,
        assessments: rows.assessments.length,
        questions: rows.questions.length,
        options: rows.options.length,
        fidel: FIDEL_ROWS.length,
        pronunciationSounds: extra?.sounds.length ?? 0,
        minimalPairs: extra?.minimalPairs.length ?? 0,
        pronunciationDrills: extra?.drills.length ?? 0,
      },
      null,
      2,
    ),
  );
}

await main();
