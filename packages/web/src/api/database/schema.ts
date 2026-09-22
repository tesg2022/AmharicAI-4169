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


/* ------------------------------------------------ entitlements and comp codes */

/**
 * Where a user's active plan came from. Only `subscription` and `access_code`
 * are verified entitlements; the other two are the honest "we have nothing"
 * answers and must never be reported as verified.
 */
export const PLAN_SOURCES = [
  "subscription",
  "access_code",
  "preview_cookie",
  "default_free",
] as const;
export type PlanSource = (typeof PLAN_SOURCES)[number];

export const ACCESS_CODE_STATUS = [
  "active",
  "revoked",
  "expired",
  "exhausted",
] as const;
export type AccessCodeStatus = (typeof ACCESS_CODE_STATUS)[number];

/**
 * An administrator-issued comp code granting a plan without payment.
 *
 * The six-digit code itself is NEVER stored. `code_hash` is
 * HMAC-SHA256(pepper, code) with a server-side pepper that does not live in
 * this database, because a plain hash over a 10^6 keyspace is brute-forced
 * offline in milliseconds by anyone who reads the table. HMAC is
 * deterministic, so redemption is still a single indexed lookup.
 *
 * Consequence, surfaced in the admin UI: the plaintext is shown exactly once,
 * at creation, and cannot be recovered afterwards.
 *
 * This is a comp code. It is not an admin password, not an MFA code, and not a
 * passwordless sign-in code — redeeming it requires an already-authenticated
 * session and only ever grants an entitlement.
 */
export const accessCodes = sqliteTable(
  "access_codes",
  {
    id: text("id").primaryKey(),
    /** HMAC-SHA256(pepper, code), hex. Unique so collisions are rejected at insert. */
    codeHash: text("code_hash").notNull(),
    /** Last two digits, for the admin list only — 100 candidates is not a code. */
    hint: text("hint").notNull(),
    /** Plan granted on redemption: free | learner | premium. */
    plan: text("plan").notNull(),
    /** How long the grant lasts, per redeemer, from the moment they redeem. */
    durationDays: integer("duration_days").notNull(),
    /** After this instant the code cannot be redeemed at all. */
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
    maxRedemptions: integer("max_redemptions").notNull().default(1),
    redemptionCount: integer("redemption_count").notNull().default(0),
    /**
     * Optional narrowing of the granted plan to specific feature ids. null =
     * exactly what the plan includes. Never widens a plan.
     */
    features: text("features", { mode: "json" }).$type<string[] | null>(),
    status: text("status").$type<AccessCodeStatus>().notNull().default("active"),
    /** Free-text admin note: who it is for, why it was issued. */
    note: text("note"),
    createdBy: text("created_by").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(now),
    revokedBy: text("revoked_by"),
    revokedAt: integer("revoked_at", { mode: "timestamp" }),
  },
  (t) => [
    uniqueIndex("access_codes_hash").on(t.codeHash),
    index("idx_access_codes_created").on(t.createdAt),
    index("idx_access_codes_status").on(t.status),
  ],
);

/**
 * One redemption of one code by one account. The unique index is the
 * single-use-per-user rule, enforced by the database rather than by a check
 * that a race could slip past.
 */
export const accessCodeRedemptions = sqliteTable(
  "access_code_redemptions",
  {
    id: text("id").primaryKey(),
    codeId: text("code_id")
      .notNull()
      .references(() => accessCodes.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    /** Copied from the code at redemption so later edits cannot rewrite history. */
    grantedPlan: text("granted_plan").notNull(),
    grantedFeatures: text("granted_features", { mode: "json" }).$type<string[] | null>(),
    redeemedAt: integer("redeemed_at", { mode: "timestamp" }).notNull().default(now),
    /** The grant lapses here; entitlement resolution treats past-due as Free. */
    grantsUntil: integer("grants_until", { mode: "timestamp" }).notNull(),
    revokedBy: text("revoked_by"),
    revokedAt: integer("revoked_at", { mode: "timestamp" }),
  },
  (t) => [
    uniqueIndex("access_code_redemption_once").on(t.codeId, t.userId),
    index("idx_redemption_user").on(t.userId, t.grantsUntil),
  ],
);

/**
 * Every redemption attempt, successful or not. This table is the rate limiter:
 * six digits is a 10^6 keyspace, which is minutes of guessing unthrottled, so
 * the lockout that reads this table is load-bearing security, not telemetry.
 */
export const accessCodeAttempts = sqliteTable(
  "access_code_attempts",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    succeeded: integer("succeeded", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(now),
  },
  (t) => [index("idx_code_attempts_user_time").on(t.userId, t.createdAt)],
);

/* ---------------------------------------------------------- usage metering */

/** Metered resources. Each one costs the operator real money per call. */
export const METERS = ["tutor_turn", "tts_synthesis", "translate_request"] as const;
export type Meter = (typeof METERS)[number];

/**
 * One counter per (subject, meter, period). This is the server-side quota
 * ledger and the only thing standing between the AI provider bill and a bad
 * actor with a loop, so it is written on the request path, not asynchronously.
 *
 * `subject` is the user id for a signed-in caller. Anonymous callers are keyed
 * by a salted hash of their client address instead — never the raw address,
 * which is personal data we have no reason to retain.
 *
 * `period` is the bucket label, not a timestamp: "2026-09" for monthly meters
 * and "2026-09-12" for daily ones. Making it a string means the reset is a key
 * change rather than a scheduled job that can fail to run.
 *
 * The unique index is the concurrency control: two simultaneous requests race
 * to insert, one loses, and the loser falls back to an atomic increment. A
 * read-then-write would let a burst of parallel calls all pass the same check.
 */
export const usageCounters = sqliteTable(
  "usage_counters",
  {
    id: text("id").primaryKey(),
    subject: text("subject").notNull(),
    subjectKind: text("subject_kind").$type<"user" | "anon">().notNull(),
    meter: text("meter").$type<Meter>().notNull(),
    period: text("period").notNull(),
    count: integer("count").notNull().default(0),
    /** The plan in force when the bucket was opened — for support, not for gating. */
    planAtOpen: text("plan_at_open"),
    firstAt: integer("first_at", { mode: "timestamp" }).notNull().default(now),
    lastAt: integer("last_at", { mode: "timestamp" }).notNull().default(now),
  },
  (t) => [
    uniqueIndex("usage_counter_bucket").on(t.subject, t.meter, t.period),
    index("idx_usage_last").on(t.lastAt),
  ],
);

/* ------------------------------------------------------- account deletion */

export const DELETION_STATUS = ["pending", "completed", "cancelled"] as const;
export type DeletionStatus = (typeof DELETION_STATUS)[number];

/**
 * Account-deletion requests.
 *
 * Google Play requires an in-app route to delete the account *and* its data,
 * so deletion here is real: the learner's rows are removed, not flagged. This
 * table is the audit trail of that having happened, and it deliberately keeps
 * no personal data — only the opaque user id, so a later "did you actually
 * delete me" question can be answered without retaining what was deleted.
 *
 * A grace window exists because deletion is irreversible and an angry tap at
 * midnight is not informed consent. `executeAfter` is when the purge may run;
 * the user can cancel by signing in before then.
 */
export const accountDeletions = sqliteTable(
  "account_deletions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    status: text("status").$type<DeletionStatus>().notNull().default("pending"),
    reason: text("reason"),
    requestedAt: integer("requested_at", { mode: "timestamp" }).notNull().default(now),
    executeAfter: integer("execute_after", { mode: "timestamp" }).notNull(),
    completedAt: integer("completed_at", { mode: "timestamp" }),
    cancelledAt: integer("cancelled_at", { mode: "timestamp" }),
    /** Row counts per table, for the audit trail. No content, no personal data. */
    purged: text("purged", { mode: "json" }).$type<Record<string, number> | null>(),
  },
  (t) => [
    index("idx_deletion_user").on(t.userId),
    index("idx_deletion_due").on(t.status, t.executeAfter),
  ],
);


/**
 * Launch notification list — the only thing /download can honestly offer while
 * the Android build is not on Google Play.
 *
 * Deliberately minimal: an address, where it was typed, and when. No name, no
 * marketing profile, nothing that would turn a "tell me when it ships" into a
 * contact record the privacy policy would then have to account for. The email
 * is stored lowercased and is unique, so a second submission is a no-op rather
 * than a duplicate send.
 */
export const launchSignups = sqliteTable(
  "launch_signups",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull().unique(),
    /** Which surface captured it, e.g. "download" — for nothing but attribution. */
    source: text("source").notNull().default("download"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(now),
    /** Set when a launch mail has actually been sent, so nobody is mailed twice. */
    notifiedAt: integer("notified_at", { mode: "timestamp" }),
  },
  (t) => [index("idx_launch_signup_email").on(t.email)],
);


export * from "./auth-schema";
export * from "./billing-schema";
export * from "./paypal-schema";
export * from "./api-schema";
