/**
 * Second ingestion source: the rewritten source-based textbook
 * (`textbook.json`, extracted from the DOCX by `scripts/extract-textbook.py`)
 * plus the pronunciation curriculum in `pronunciation-data.ts`.
 *
 * Only textbook units 7-20 are ingested here. Units 1-6 already come from
 * `amharic-course.json`, which is the authoritative 1:1 source for them —
 * re-ingesting would duplicate or contradict it.
 *
 * As with the primary ingester, nothing from the source is dropped: unit
 * practice/checkpoint text becomes activities, and appendix material that has
 * no dedicated table is preserved verbatim in `lesson_sections.body`.
 */
import {
  ALL_SOUNDS,
  DRILLS,
  MINIMAL_PAIRS,
} from "./pronunciation-data";
import textbookJson from "./textbook.json";

type Row = Record<string, unknown>;

interface TextbookUnit {
  number: number;
  titleAm: string;
  titleEn: string;
  objectives: string[];
  vocabulary: { amharic: string; transliteration: string; english: string }[];
  dialogue: { speaker: string; amharic: string; english: string }[];
  practice: string | null;
  checkpoint: string | null;
}

interface Textbook {
  units: TextbookUnit[];
  pronouns: { amharic: string; transliteration: string; english: string }[];
  highValueVerbs: {
    infinitive: string;
    transliteration: string;
    past3ms: string;
    meaning: string;
  }[];
  vowelCues: { cue: string; reminder: string }[];
  practicePlan: { day: string; task: string }[];
  performanceTasks: { area: string; task: string }[];
}

const book = textbookJson as Textbook;

export interface ExtraRows {
  units: Row[];
  objectives: Row[];
  lessons: Row[];
  sections: Row[];
  vocabulary: Row[];
  verbs: Row[];
  dialogues: Row[];
  dialogueLines: Row[];
  activities: Row[];
  sounds: Row[];
  minimalPairs: Row[];
  drills: Row[];
}

/** Unit id for the appendix material that follows unit 20 in the textbook. */
const APPENDIX_UNIT = "u-appendix";

export function buildExtraRows(courseId: string, levelId: string): ExtraRows {
  const out: ExtraRows = {
    units: [],
    objectives: [],
    lessons: [],
    sections: [],
    vocabulary: [],
    verbs: [],
    dialogues: [],
    dialogueLines: [],
    activities: [],
    sounds: [],
    minimalPairs: [],
    drills: [],
  };

  /* ------------------------------------------------- textbook units 7 - 20 */

  for (const unit of book.units) {
    const unitId = `u${unit.number}`;
    const lessonId = `${unitId}-l1`;

    out.units.push({
      id: unitId,
      levelId,
      courseId,
      code: unitId,
      sourceChapter: `Unit ${unit.number}`,
      titleEn: unit.titleEn,
      titleAm: unit.titleAm || null,
      // Unit numbering in the textbook is 1-based and continues the course.
      sortOrder: unit.number - 1,
      sourcePages: [],
      status: "published",
    });

    unit.objectives.forEach((text, i) => {
      out.objectives.push({
        id: `${unitId}-obj-${i}`,
        unitId,
        objectiveText: text,
        sortOrder: i,
      });
    });

    out.lessons.push({
      id: lessonId,
      unitId,
      code: lessonId,
      titleEn: unit.titleEn,
      titleAm: unit.titleAm || null,
      sortOrder: 0,
      sourcePages: [],
      status: "published",
    });

    unit.vocabulary.forEach((v, i) => {
      out.vocabulary.push({
        id: `${lessonId}-vocab-${i}`,
        lessonId,
        amharic: v.amharic,
        transliteration: v.transliteration || null,
        english: v.english || null,
        partOfSpeech: null,
        notes: null,
        sourcePage: null,
        sourceText: v,
        status: "published",
      });
    });

    if (unit.dialogue.length > 0) {
      const dialogueId = `${lessonId}-dlg`;
      out.dialogues.push({
        id: dialogueId,
        lessonId,
        code: "model-dialogue",
        title: "Model dialogue",
        sourcePages: [],
        status: "published",
      });
      unit.dialogue.forEach((line, i) => {
        out.dialogueLines.push({
          id: `${dialogueId}-${i}`,
          dialogueId,
          lineNo: i + 1,
          speaker: line.speaker || null,
          amharic: line.amharic || null,
          transliteration: null,
          english: line.english || null,
        });
      });
    }

    if (unit.practice) {
      out.activities.push({
        id: `${lessonId}-act-practice`,
        lessonId,
        code: "practice",
        activityType: "practice",
        title: "Practice",
        instructions: unit.practice,
        payload: { text: unit.practice },
        sourcePages: [],
        status: "published",
      });
    }
    if (unit.checkpoint) {
      out.activities.push({
        id: `${lessonId}-act-checkpoint`,
        lessonId,
        code: "checkpoint",
        activityType: "checkpoint",
        title: "Checkpoint",
        instructions: unit.checkpoint,
        payload: { text: unit.checkpoint },
        sourcePages: [],
        status: "published",
      });
    }
  }

  /* ---------------------------------------------------- appendix material */

  const appendixLesson = `${APPENDIX_UNIT}-l1`;
  out.units.push({
    id: APPENDIX_UNIT,
    levelId,
    courseId,
    code: APPENDIX_UNIT,
    sourceChapter: "Appendices",
    titleEn: "Appendices & Reference",
    titleAm: "ተጨማሪ ማጣቀሻ",
    sortOrder: 100,
    sourcePages: [],
    status: "published",
  });
  out.lessons.push({
    id: appendixLesson,
    unitId: APPENDIX_UNIT,
    code: appendixLesson,
    titleEn: "Reference tables",
    titleAm: "ማጣቀሻ ሠንጠረዦች",
    sortOrder: 0,
    sourcePages: [],
    status: "published",
  });

  book.pronouns.forEach((p, i) => {
    out.vocabulary.push({
      id: `${appendixLesson}-pronoun-${i}`,
      lessonId: appendixLesson,
      amharic: p.amharic,
      transliteration: p.transliteration || null,
      english: p.english || null,
      partOfSpeech: "pronoun",
      notes: null,
      sourcePage: null,
      sourceText: p,
      status: "published",
    });
  });

  book.highValueVerbs.forEach((v, i) => {
    out.verbs.push({
      id: `${appendixLesson}-verb-${i}`,
      lessonId: appendixLesson,
      root: null,
      stem: v.past3ms || null,
      infinitive: v.infinitive,
      englishMeaning: v.meaning || null,
      verbType: "high_value",
      sourcePage: null,
      qaFlag: null,
    });
  });

  const appendixSections: [string, unknown][] = [
    ["pronouns", book.pronouns],
    ["high_value_verbs", book.highValueVerbs],
    ["vowel_cues", book.vowelCues],
    ["practice_plan", book.practicePlan],
    ["performance_tasks", book.performanceTasks],
  ];
  appendixSections.forEach(([key, value], i) => {
    out.sections.push({
      id: `${appendixLesson}-sec-${key}`,
      lessonId: appendixLesson,
      sectionType: key,
      title: null,
      body: { key, value, source_pages: [] },
      sortOrder: i,
    });
  });

  /* ------------------------------------------------------- pronunciation */

  for (const sound of ALL_SOUNDS) {
    out.sounds.push({
      id: sound.id,
      fidel: sound.fidel,
      family: sound.family,
      roman: sound.roman,
      ipa: sound.ipa,
      soundClass: sound.soundClass,
      label: sound.label,
      englishApprox: sound.englishApprox,
      warning: sound.warning,
      mouthPosition: sound.mouthPosition,
      contrastWith: sound.contrastWith,
      examples: sound.examples,
      sortOrder: sound.sortOrder,
    });
  }

  for (const pair of MINIMAL_PAIRS) {
    out.minimalPairs.push({ ...pair });
  }

  for (const drill of DRILLS) {
    out.drills.push({ ...drill });
  }

  return out;
}
