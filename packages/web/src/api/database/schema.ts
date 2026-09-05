import { sql } from "drizzle-orm";
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

/**
 * AmharicAI content model.
 *
 * This is a direct port of the source PostgreSQL schema
 * (`amharic_postgresql_schema.sql`) onto SQLite/Drizzle. Nothing from the source
 * model is dropped: enums become text columns with the same allowed values,
 * `JSONB` becomes `text({ mode: "json" })`, `INT[]` becomes a json array, and
 * UUID primary keys stay text so a future migration back to PostgreSQL is a
 * straight copy. Source provenance (`source_file_id`, `source_page(s)`,
 * `qa_flag`) is first class everywhere it exists upstream.
 */

export const CONTENT_STATUS = [
  "draft",
  "review",
  "approved",
  "published",
  "archived",
] as const;
export type ContentStatus = (typeof CONTENT_STATUS)[number];

export const QUESTION_TYPES = [
  "multiple_choice",
  "true_false",
  "matching",
  "short_answer",
  "fill_blank",
  "translation",
  "word_order",
  "listening",
  "speaking",
  "role_play",
  "conjugation",
  "pattern",
  "family_tree",
  "question_generation",
  "scenario",
  "exam",
  "market_visit",
] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

export const PROGRESS_STATUS = ["not_started", "in_progress", "mastered"] as const;
export type ProgressStatus = (typeof PROGRESS_STATUS)[number];

const now = sql`(unixepoch())`;

/* ------------------------------------------------------------------ content */

export const courses = sqliteTable("courses", {
  id: text("id").primaryKey(),
  code: text("code").notNull().unique(),
  titleEn: text("title_en").notNull(),
  titleAm: text("title_am"),
  level: text("level"),
  status: text("status").$type<ContentStatus>().notNull().default("draft"),
  sourceFileId: text("source_file_id"),
  sourceTitle: text("source_title"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(now),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(now),
});

export const levels = sqliteTable(
  "levels",
  {
    id: text("id").primaryKey(),
    courseId: text("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    titleEn: text("title_en").notNull(),
    titleAm: text("title_am"),
    sortOrder: integer("sort_order").notNull(),
  },
  (t) => [uniqueIndex("levels_course_code").on(t.courseId, t.code)],
);

export const units = sqliteTable(
  "units",
  {
    id: text("id").primaryKey(),
    levelId: text("level_id").references(() => levels.id, { onDelete: "cascade" }),
    courseId: text("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    sourceChapter: text("source_chapter"),
    titleEn: text("title_en").notNull(),
    titleAm: text("title_am"),
    sortOrder: integer("sort_order").notNull(),
    sourcePages: text("source_pages", { mode: "json" })
      .$type<number[]>()
      .notNull()
      .default(sql`'[]'`),
    status: text("status").$type<ContentStatus>().notNull().default("draft"),
  },
  (t) => [
    uniqueIndex("units_course_code").on(t.courseId, t.code),
    index("idx_units_course_sort").on(t.courseId, t.sortOrder),
  ],
);

export const learningObjectives = sqliteTable("learning_objectives", {
  id: text("id").primaryKey(),
  unitId: text("unit_id")
    .notNull()
    .references(() => units.id, { onDelete: "cascade" }),
  objectiveText: text("objective_text").notNull(),
  sortOrder: integer("sort_order").notNull(),
});

export const lessons = sqliteTable(
  "lessons",
  {
    id: text("id").primaryKey(),
    unitId: text("unit_id")
      .notNull()
      .references(() => units.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    titleEn: text("title_en").notNull(),
    titleAm: text("title_am"),
    sortOrder: integer("sort_order").notNull(),
    sourcePages: text("source_pages", { mode: "json" })
      .$type<number[]>()
      .notNull()
      .default(sql`'[]'`),
    status: text("status").$type<ContentStatus>().notNull().default("draft"),
  },
  (t) => [
    uniqueIndex("lessons_unit_code").on(t.unitId, t.code),
    index("idx_lessons_unit_sort").on(t.unitId, t.sortOrder),
  ],
);

/**
 * Source-faithful storage: every block of the original course JSON that has no
 * dedicated table (alphabet_categories, vowels, ordinals, price_table,
 * cultural_note, notes, …) is kept verbatim here, keyed by `sectionType`.
 */
export const lessonSections = sqliteTable("lesson_sections", {
  id: text("id").primaryKey(),
  lessonId: text("lesson_id")
    .notNull()
    .references(() => lessons.id, { onDelete: "cascade" }),
  sectionType: text("section_type").notNull(),
  title: text("title"),
  body: text("body", { mode: "json" })
    .$type<unknown>()
    .notNull()
    .default(sql`'{}'`),
  sortOrder: integer("sort_order").notNull(),
});

export const vocabulary = sqliteTable(
  "vocabulary",
  {
    id: text("id").primaryKey(),
    lessonId: text("lesson_id").references(() => lessons.id, { onDelete: "set null" }),
    amharic: text("amharic").notNull(),
    transliteration: text("transliteration"),
    english: text("english"),
    partOfSpeech: text("part_of_speech"),
    notes: text("notes"),
    sourcePage: integer("source_page"),
    sourceText: text("source_text", { mode: "json" }).$type<unknown>(),
    status: text("status").$type<ContentStatus>().notNull().default("draft"),
  },
  (t) => [index("idx_vocab_amharic").on(t.amharic)],
);

export const grammarConcepts = sqliteTable("grammar_concepts", {
  id: text("id").primaryKey(),
  lessonId: text("lesson_id").references(() => lessons.id, { onDelete: "set null" }),
  nameEn: text("name_en").notNull(),
  nameAm: text("name_am"),
  ruleText: text("rule_text"),
  examples: text("examples", { mode: "json" })
    .$type<unknown[]>()
    .notNull()
    .default(sql`'[]'`),
  sourcePage: integer("source_page"),
  qaFlag: text("qa_flag"),
  status: text("status").$type<ContentStatus>().notNull().default("draft"),
});

export const verbs = sqliteTable("verbs", {
  id: text("id").primaryKey(),
  lessonId: text("lesson_id").references(() => lessons.id, { onDelete: "set null" }),
  root: text("root"),
  stem: text("stem"),
  infinitive: text("infinitive"),
  englishMeaning: text("english_meaning"),
  verbType: text("verb_type"),
  sourcePage: integer("source_page"),
  qaFlag: text("qa_flag"),
});

export const verbConjugations = sqliteTable("verb_conjugations", {
  id: text("id").primaryKey(),
  verbId: text("verb_id")
    .notNull()
    .references(() => verbs.id, { onDelete: "cascade" }),
  pronoun: text("pronoun").notNull(),
  person: text("person"),
  number: text("number"),
  gender: text("gender"),
  tense: text("tense"),
  polarity: text("polarity"),
  form: text("form").notNull(),
  transliteration: text("transliteration"),
  sourcePage: integer("source_page"),
  qaFlag: text("qa_flag"),
});

export const dialogues = sqliteTable(
  "dialogues",
  {
    id: text("id").primaryKey(),
    lessonId: text("lesson_id").references(() => lessons.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    title: text("title").notNull(),
    sourcePages: text("source_pages", { mode: "json" })
      .$type<number[]>()
      .notNull()
      .default(sql`'[]'`),
    status: text("status").$type<ContentStatus>().notNull().default("draft"),
  },
  (t) => [uniqueIndex("dialogues_lesson_code").on(t.lessonId, t.code)],
);

export const dialogueLines = sqliteTable(
  "dialogue_lines",
  {
    id: text("id").primaryKey(),
    dialogueId: text("dialogue_id")
      .notNull()
      .references(() => dialogues.id, { onDelete: "cascade" }),
    lineNo: integer("line_no").notNull(),
    speaker: text("speaker"),
    amharic: text("amharic"),
    transliteration: text("transliteration"),
    english: text("english"),
    audioAssetId: text("audio_asset_id"),
  },
  (t) => [uniqueIndex("dialogue_lines_no").on(t.dialogueId, t.lineNo)],
);

export const activities = sqliteTable(
  "activities",
  {
    id: text("id").primaryKey(),
    lessonId: text("lesson_id")
      .notNull()
      .references(() => lessons.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    activityType: text("activity_type").notNull(),
    title: text("title").notNull(),
    instructions: text("instructions"),
    payload: text("payload", { mode: "json" })
      .$type<unknown>()
      .notNull()
      .default(sql`'{}'`),
    sourcePages: text("source_pages", { mode: "json" })
      .$type<number[]>()
      .notNull()
      .default(sql`'[]'`),
    status: text("status").$type<ContentStatus>().notNull().default("draft"),
  },
  (t) => [uniqueIndex("activities_lesson_code").on(t.lessonId, t.code)],
);

export const assessments = sqliteTable(
  "assessments",
  {
    id: text("id").primaryKey(),
    unitId: text("unit_id")
      .notNull()
      .references(() => units.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    title: text("title").notNull(),
    sourcePages: text("source_pages", { mode: "json" })
      .$type<number[]>()
      .notNull()
      .default(sql`'[]'`),
    status: text("status").$type<ContentStatus>().notNull().default("draft"),
  },
  (t) => [uniqueIndex("assessments_unit_code").on(t.unitId, t.code)],
);

export const questions = sqliteTable(
  "questions",
  {
    id: text("id").primaryKey(),
    assessmentId: text("assessment_id").references(() => assessments.id, {
      onDelete: "cascade",
    }),
    activityId: text("activity_id").references(() => activities.id, {
      onDelete: "cascade",
    }),
    lessonId: text("lesson_id").references(() => lessons.id, { onDelete: "cascade" }),
    questionType: text("question_type").$type<QuestionType>().notNull(),
    questionText: text("question_text").notNull(),
    questionAm: text("question_am"),
    answer: text("answer", { mode: "json" }).$type<unknown>(),
    explanation: text("explanation"),
    sourcePage: integer("source_page"),
    qaFlag: text("qa_flag"),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [
    index("idx_questions_assessment").on(t.assessmentId),
    index("idx_questions_lesson").on(t.lessonId),
  ],
);

export const questionOptions = sqliteTable("question_options", {
  id: text("id").primaryKey(),
  questionId: text("question_id")
    .notNull()
    .references(() => questions.id, { onDelete: "cascade" }),
  optionKey: text("option_key"),
  optionText: text("option_text").notNull(),
  isCorrect: integer("is_correct", { mode: "boolean" }),
  sortOrder: integer("sort_order").notNull(),
});

export const assessmentQuestions = sqliteTable(
  "assessment_questions",
  {
    id: text("id").primaryKey(),
    assessmentId: text("assessment_id")
      .notNull()
      .references(() => assessments.id, { onDelete: "cascade" }),
    questionId: text("question_id")
      .notNull()
      .references(() => questions.id, { onDelete: "cascade" }),
    sortOrder: integer("sort_order").notNull(),
  },
  (t) => [uniqueIndex("assessment_questions_pair").on(t.assessmentId, t.questionId)],
);

export const mediaAssets = sqliteTable("media_assets", {
  id: text("id").primaryKey(),
  ownerType: text("owner_type"),
  ownerId: text("owner_id"),
  mediaType: text("media_type").notNull(),
  uri: text("uri").notNull(),
  altText: text("alt_text"),
  transcript: text("transcript"),
  durationMs: integer("duration_ms"),
  sourcePage: integer("source_page"),
  sourceFileId: text("source_file_id"),
  status: text("status").$type<ContentStatus>().notNull().default("draft"),
});

/** Fidel (ፊደል) syllabary — 7 orders per base consonant, used by the script trainer. */
export const fidel = sqliteTable(
  "fidel",
  {
    id: text("id").primaryKey(),
    baseOrder: integer("base_order").notNull(),
    baseChar: text("base_char").notNull(),
    romanBase: text("roman_base").notNull(),
    category: text("category"),
    orderIndex: integer("order_index").notNull(),
    character: text("character").notNull(),
    transliteration: text("transliteration").notNull(),
  },
  (t) => [uniqueIndex("fidel_char").on(t.character)],
);

/* ------------------------------------------------------------ pronunciation */

/**
 * "Amharic Pronunciation for English Speakers" curriculum.
 *
 * Kept in its own tables (rather than folded into `vocabulary`) because a sound
 * carries fields no vocabulary row has: IPA, articulatory description, sound
 * class, and the plain/ejective contrast link. `examples` is a json array of
 * `{ amharic, transliteration, english }`.
 */
export const pronunciationSounds = sqliteTable(
  "pronunciation_sounds",
  {
    id: text("id").primaryKey(),
    /** Base (1st-order) Fidel character. */
    fidel: text("fidel").notNull(),
    /** The seven-order family, space separated. */
    family: text("family").notNull(),
    roman: text("roman").notNull(),
    ipa: text("ipa").notNull(),
    /** vowel | plain | ejective | palatal | labiovelar */
    soundClass: text("sound_class").notNull(),
    label: text("label").notNull(),
    englishApprox: text("english_approx").notNull(),
    /** The trap an English speaker falls into, when there is one. */
    warning: text("warning"),
    mouthPosition: text("mouth_position").notNull(),
    /** id of the counterpart sound this one contrasts with. */
    contrastWith: text("contrast_with"),
    examples: text("examples", { mode: "json" })
      .$type<{ amharic: string; transliteration: string; english: string }[]>()
      .notNull(),
    sortOrder: integer("sort_order").notNull(),
  },
  (t) => [index("idx_sound_class").on(t.soundClass, t.sortOrder)],
);

export const minimalPairs = sqliteTable(
  "minimal_pairs",
  {
    id: text("id").primaryKey(),
    /** `syllable` rows are true minimal pairs; `word` rows are contrast examples. */
    kind: text("kind").notNull(),
    plainText: text("plain_text").notNull(),
    plainRoman: text("plain_roman").notNull(),
    plainSoundId: text("plain_sound_id").notNull(),
    ejectiveText: text("ejective_text").notNull(),
    ejectiveRoman: text("ejective_roman").notNull(),
    ejectiveSoundId: text("ejective_sound_id").notNull(),
    note: text("note").notNull(),
    sortOrder: integer("sort_order").notNull(),
  },
  (t) => [index("idx_pair_kind").on(t.kind, t.sortOrder)],
);

export const pronunciationDrills = sqliteTable("pronunciation_drills", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  instructions: text("instructions").notNull(),
  /** Spoken one at a time by the app's TTS layer. */
  items: text("items", { mode: "json" }).$type<string[]>().notNull(),
  soundId: text("sound_id"),
  sortOrder: integer("sort_order").notNull(),
});

/* ------------------------------------------------------------- learner data */

export const userProgress = sqliteTable(
  "user_progress",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    lessonId: text("lesson_id").references(() => lessons.id, { onDelete: "cascade" }),
    activityId: text("activity_id").references(() => activities.id, {
      onDelete: "cascade",
    }),
    mastery: real("mastery").notNull().default(0),
    status: text("status").$type<ProgressStatus>().notNull().default("not_started"),
    attempts: integer("attempts").notNull().default(0),
    correctAttempts: integer("correct_attempts").notNull().default(0),
    lastAttemptAt: integer("last_attempt_at", { mode: "timestamp" }),
  },
  (t) => [
    uniqueIndex("user_progress_scope").on(t.userId, t.lessonId, t.activityId),
    index("idx_progress_user").on(t.userId),
  ],
);

export const answerAttempts = sqliteTable(
  "answer_attempts",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    questionId: text("question_id").references(() => questions.id, {
      onDelete: "cascade",
    }),
    lessonId: text("lesson_id").references(() => lessons.id, { onDelete: "cascade" }),
    answer: text("answer", { mode: "json" }).$type<unknown>().notNull(),
    isCorrect: integer("is_correct", { mode: "boolean" }),
    score: real("score"),
    feedback: text("feedback"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(now),
  },
  (t) => [index("idx_attempts_user_time").on(t.userId, t.createdAt)],
);

/** SM-2 spaced repetition state, one card per (user, vocabulary) pair. */
export const srsCards = sqliteTable(
  "srs_cards",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    vocabularyId: text("vocabulary_id")
      .notNull()
      .references(() => vocabulary.id, { onDelete: "cascade" }),
    ease: real("ease").notNull().default(2.5),
    intervalDays: real("interval_days").notNull().default(0),
    repetitions: integer("repetitions").notNull().default(0),
    lapses: integer("lapses").notNull().default(0),
    dueAt: integer("due_at", { mode: "timestamp" }).notNull().default(now),
    lastReviewedAt: integer("last_reviewed_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(now),
  },
  (t) => [
    uniqueIndex("srs_user_vocab").on(t.userId, t.vocabularyId),
    index("idx_srs_due").on(t.userId, t.dueAt),
  ],
);

export const xpEvents = sqliteTable(
  "xp_events",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    amount: integer("amount").notNull(),
    kind: text("kind").notNull(),
    refId: text("ref_id"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(now),
  },
  (t) => [index("idx_xp_user_time").on(t.userId, t.createdAt)],
);

export const userStats = sqliteTable("user_stats", {
  userId: text("user_id").primaryKey(),
  displayName: text("display_name"),
  xp: integer("xp").notNull().default(0),
  streakDays: integer("streak_days").notNull().default(0),
  longestStreak: integer("longest_streak").notNull().default(0),
  /** ISO yyyy-mm-dd of the last day with any learning activity. */
  lastActiveDate: text("last_active_date"),
  dailyGoalXp: integer("daily_goal_xp").notNull().default(50),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(now),
});

export const speakingAttempts = sqliteTable(
  "speaking_attempts",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    lessonId: text("lesson_id").references(() => lessons.id, { onDelete: "set null" }),
    targetText: text("target_text").notNull(),
    transcript: text("transcript"),
    score: real("score"),
    feedback: text("feedback"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(now),
  },
  (t) => [index("idx_speaking_user_time").on(t.userId, t.createdAt)],
);

export const tutorMessages = sqliteTable(
  "tutor_messages",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    role: text("role").notNull(),
    content: text("content").notNull(),
    lessonId: text("lesson_id").references(() => lessons.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(now),
  },
  (t) => [index("idx_tutor_user_time").on(t.userId, t.createdAt)],
);


/**
 * Cache of synthesized native Amharic audio.
 *
 * Fixed course content (vocabulary, dialogue lines, pronunciation drills) is
 * pre-generated once and served from here; only free-form tutor replies are
 * synthesized live. The cache key is a hash of the exact normalized text, the
 * provider, the voice and the voice mode, so changing any of them produces a
 * new clip rather than silently serving a stale one.
 *
 * Audio is stored base64 in-row. Course phrases are a few kilobytes each,
 * which keeps this well inside SQLite's comfort zone and removes any object
 * storage dependency. `storageKey` is the hook for moving clips to object
 * storage later without changing the lookup path.
 */
export const speechAudio = sqliteTable(
  "speech_audio",
  {
    /** sha256(provider|voice|mode|normalizedText), hex. */
    id: text("id").primaryKey(),
    provider: text("provider").notNull(),
    voice: text("voice").notNull(),
    /** One of native | slow | syllable. */
    mode: text("mode").notNull(),
    /** Raw source text, kept for provenance and re-generation. */
    sourceText: text("source_text").notNull(),
    /** Text actually sent to the engine, after normalization. */
    normalizedText: text("normalized_text").notNull(),
    mimeType: text("mime_type").notNull().default("audio/mpeg"),
    /** base64 payload; null once the clip lives in object storage. */
    audioBase64: text("audio_base64"),
    /** Object storage key, when the clip has been offloaded. */
    storageKey: text("storage_key"),
    byteLength: integer("byte_length").notNull().default(0),
    durationMsEstimate: integer("duration_ms_estimate"),
    /** What this clip belongs to: vocabulary | dialogue_line | drill | tutor | ad_hoc. */
    kind: text("kind").notNull().default("ad_hoc"),
    refId: text("ref_id"),
    hits: integer("hits").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(now),
  },
  (t) => [
    index("idx_speech_audio_ref").on(t.kind, t.refId),
    index("idx_speech_audio_voice").on(t.provider, t.voice, t.mode),
  ],
);

/**
 * A learner's pass through the READ -> LISTEN -> REPEAT -> SPEAK -> FEEDBACK
 * loop for one lesson. Stored separately from `speaking_attempts` because an
 * attempt is one utterance, while this is the shape of the practice session
 * around it.
 */
export const speechSessions = sqliteTable(
  "speech_sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    lessonId: text("lesson_id").references(() => lessons.id, { onDelete: "set null" }),
    /** read | listen | repeat | speak | feedback */
    stage: text("stage").notNull().default("read"),
    itemsTotal: integer("items_total").notNull().default(0),
    itemsCompleted: integer("items_completed").notNull().default(0),
    /** Mean pronunciation score across the session's spoken items, 0-100. */
    averageScore: real("average_score"),
    completedAt: integer("completed_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(now),
  },
  (t) => [index("idx_speech_session_user").on(t.userId, t.createdAt)],
);


export * from "./auth-schema";
