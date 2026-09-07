/**
 * Course access layer — the same generated model the website reads.
 *
 * `course.generated.json` is produced by the Nuxt repo's scripts/build-course.mjs
 * from the Amharic course content spec. Nothing here reshapes or corrects
 * content: it only indexes what the generator produced, so the source-faithful
 * guarantee survives all the way to the mobile client.
 *
 * Units 1-6 are `written` (real lessons from the source textbook). Units 7-20
 * are `not_written`: advertised scope only — a title, a description and one key
 * phrase. No lesson content exists for them and none is invented here.
 */

import courseData from "./course.generated.json";
import flagData from "./course.flags.json";

export type BlockKind = "table" | "list" | "note" | "dialogue" | "raw";

export interface CourseBlock {
  id: string;
  kind: BlockKind;
  title: string;
  source_key: string;
  source_file_id: string;
  source_pages: number[];
  /** Set when the generator found something odd. Shown, never silently fixed. */
  qa_flag: string | null;
  headers?: string[] | null;
  rows?: string[][];
  items?: string[];
  text?: string;
  lines?: { speaker: string | null; amharic: string; cells: string[] }[];
  json?: unknown;
}

export interface CourseActivity {
  id: string;
  type: string;
  title: string;
  interactive: boolean;
}

export interface CourseLesson {
  id: string;
  unit_id: string;
  title_en: string | null;
  title_am: string | null;
  source_pages: number[];
  source_file_id: string;
  blocks: CourseBlock[];
  activities: CourseActivity[];
  speakables: string[];
}

export interface CourseAssessmentQuestion {
  id: string;
  type: string;
  question: string;
  options: string[] | null;
  answer_as_written: string;
  source_page: number | null;
  source_file_id: string;
}

export interface CourseUnit {
  id: string;
  /** Position in the advertised 20-unit scope, 1-based. */
  shell_unit: number;
  /**
   * "written"     — backed by the source content spec, has real lessons.
   * "not_written" — advertised scope only: title, description, one key phrase.
   */
  status: "written" | "not_written";
  description: string;
  key_phrase: { amharic: string; english: string } | null;
  shell_title_en: string;
  shell_title_am: string;
  source_chapter: string | null;
  title_en: string;
  title_am: string;
  source_pages: number[];
  learning_objectives: string[];
  lessons: CourseLesson[];
  assessments: {
    id: string;
    title: string;
    source_pages: number[];
    question_policy: string;
    questions: CourseAssessmentQuestion[];
  }[];
}

export interface Course {
  meta: Record<string, unknown> & {
    course_id: string;
    title_en: string;
    title_am: string;
    segmentation_principle: string | null;
    qa_policy: string;
  };
  stats: Record<string, number>;
  units: CourseUnit[];
}

export interface CourseFlag {
  level: "error" | "warn" | "info";
  where: string;
  code: string;
  detail: string;
}

interface CourseFlagFile {
  generated_at: string;
  policy: string;
  counts: { error: number; warn: number; info: number };
  flags: CourseFlag[];
}

const course = courseData as unknown as Course;
const flags = flagData as unknown as CourseFlagFile;

/** lesson id -> { unit, lesson, index in the flat reading order } */
const lessonIndex = new Map<
  string,
  { unit: CourseUnit; lesson: CourseLesson; order: number }
>();
const readingOrder: CourseLesson[] = [];

for (const unit of course.units) {
  for (const lesson of unit.lessons) {
    lessonIndex.set(lesson.id, { unit, lesson, order: readingOrder.length });
    readingOrder.push(lesson);
  }
}

/** Flags that name a lesson or one of its parts, e.g. "u5-l5" or "u5-l5.examples". */
const flagsByLesson = new Map<string, CourseFlag[]>();
for (const f of flags.flags) {
  const lessonId = f.where.split(".")[0];
  if (!lessonId || !lessonIndex.has(lessonId)) continue;
  const list = flagsByLesson.get(lessonId) ?? [];
  list.push(f);
  flagsByLesson.set(lessonId, list);
}

export function getCourse(): Course {
  return course;
}

export function getCourseFlags(): CourseFlagFile {
  return flags;
}

/**
 * Lesson label. Lessons whose source has no English title keep the Amharic
 * title rather than being given an invented English one.
 */
export function lessonLabel(lesson: CourseLesson): string {
  return lesson.title_en || lesson.title_am || lesson.id;
}

/** Unit list with lesson stubs — enough to render the browser, no block payload. */
export function getCourseSummary() {
  return {
    meta: course.meta,
    stats: course.stats,
    qa: {
      errors: flags.counts.error,
      warnings: flags.counts.warn,
      info: flags.counts.info,
      policy: flags.policy,
    },
    units: course.units.map((u) => ({
      id: u.id,
      shell_unit: u.shell_unit,
      status: u.status,
      description: u.description,
      key_phrase: u.key_phrase,
      source_chapter: u.source_chapter,
      title_en: u.title_en,
      title_am: u.title_am,
      shell_title_en: u.shell_title_en,
      shell_title_am: u.shell_title_am,
      source_pages: u.source_pages,
      learning_objectives: u.learning_objectives,
      assessment_questions: u.assessments.reduce((n, a) => n + a.questions.length, 0),
      lessons: u.lessons.map((l) => ({
        id: l.id,
        title_en: l.title_en,
        title_am: l.title_am,
        label: lessonLabel(l),
        source_pages: l.source_pages,
        blocks: l.blocks.length,
        activities: l.activities.length,
        speakables: l.speakables.length,
        flags: (flagsByLesson.get(l.id) ?? []).length,
      })),
    })),
  };
}

/** One lesson with its unit context and reading-order neighbours. */
export function getLesson(id: string) {
  const hit = lessonIndex.get(id);
  if (!hit) return null;
  const { unit, lesson, order } = hit;
  const stub = (l: CourseLesson | undefined) =>
    l ? { id: l.id, label: lessonLabel(l) } : null;
  const source = course.meta["source"] as { title?: string } | undefined;
  return {
    lesson,
    label: lessonLabel(lesson),
    unit: {
      id: unit.id,
      shell_unit: unit.shell_unit,
      status: unit.status,
      source_chapter: unit.source_chapter,
      title_en: unit.title_en,
      title_am: unit.title_am,
      learning_objectives: unit.learning_objectives,
    },
    assessments: unit.assessments,
    flags: flagsByLesson.get(lesson.id) ?? [],
    position: { order: order + 1, total: readingOrder.length },
    prev: stub(readingOrder[order - 1]),
    next: stub(readingOrder[order + 1]),
    provenance: {
      source_file_id: lesson.source_file_id,
      source_pages: lesson.source_pages,
      source_title: source?.title ?? null,
      segmentation_principle: course.meta.segmentation_principle,
      qa_policy: course.meta.qa_policy,
    },
  };
}

export function firstLessonId(): string {
  return readingOrder[0]?.id ?? "";
}
