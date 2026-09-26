import { Link } from "wouter";
import { ArrowRight, BookOpen, CheckCircle2, Flame, GraduationCap, Layers, Sparkles } from "lucide-react";
import { useCourseStats, useOutline } from "../queries/content";
import { useLessonProgress, useMyProgress } from "../queries/progress";
import { useSession } from "../hooks/use-session";
import { ORIGIN, useSeo } from "../hooks/use-seo";
import { Am, Card, Chip, ErrorState, Loading, ProgressBar, TibebRule } from "../components/ui/kit";

/**
 * The course, as structured data. Kept to what is true of the deployed build:
 * the course is written and the first units are free, so `isAccessibleForFree`
 * is stated on the free part rather than on the whole thing.
 */
const COURSE_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "Course",
  "@id": `${ORIGIN}/app#course`,
  url: `${ORIGIN}/app`,
  name: "Amharic Language — Beginner",
  description:
    "Amharic lessons for beginners: the ፊደል syllabary, pronunciation for English speakers, everyday vocabulary, dialogue and grammar, unit by unit.",
  inLanguage: "en",
  teaches: "Reading, pronouncing and using beginner Amharic, the Ethiopian language",
  educationalLevel: "Beginner",
  provider: { "@type": "Organization", name: "AmharicAI", url: `${ORIGIN}/` },
  hasCourseInstance: {
    "@type": "CourseInstance",
    courseMode: "online",
    courseWorkload: "PT30M",
    inLanguage: "en",
  },
  offers: {
    "@type": "Offer",
    category: "Free",
    price: "0",
    priceCurrency: "ZAR",
    description: "The ፊደል, the pronunciation guide and the first two units are free.",
  },
};

/**
 * Course browser — the unit path.
 *
 * Units alternate their offset down the page rather than stacking as identical
 * cards, so the course reads as a route through the material (see design.md).
 */
export default function IndexPage() {
  const outline = useOutline();
  const stats = useCourseStats();
  const { isSignedIn } = useSession();
  const progress = useMyProgress(isSignedIn);
  const lessonProgress = useLessonProgress(isSignedIn);

  useSeo({
    title: "Amharic lessons for beginners — the full course, unit by unit",
    description:
      "Work through Amharic lessons written for beginners: the ፊደል syllabary, pronunciation, everyday vocabulary, dialogue and grammar, one unit at a time. Each lesson carries an English gloss, and the first two units are free.",
    path: "/app",
    jsonLd: COURSE_JSON_LD,
  });

  const doneIds = new Set(
    (lessonProgress.data ?? [])
      .filter((row) => row.status === "mastered")
      .map((row) => row.lessonId),
  );

  if (outline.isLoading) return <Loading label="Loading the course…" />;
  if (outline.isError) return <ErrorState message={outline.error?.message} onRetry={() => outline.refetch()} />;

  const course = outline.data?.course;
  const units = outline.data?.units ?? [];

  return (
    <div className="space-y-10">
      {/* Hero */}
      <section className="grid gap-8 md:grid-cols-[1.4fr_1fr] md:items-end">
        <div className="space-y-4">
          <Chip label="Beginner course" icon={GraduationCap} />
          <h1 className="text-4xl font-bold leading-tight md:text-5xl">
            {course?.titleEn ?? "Amharic Language — Beginner"}
          </h1>
          {course?.titleAm ? (
            <Am className="block text-2xl text-primary">{course.titleAm}</Am>
          ) : null}
          <TibebRule className="max-w-56" />
          <p className="max-w-xl text-[15px] leading-relaxed text-muted-foreground">
            Amharic from the ፊደል syllabary up — greetings, introductions, verbs, food,
            travel and work, plus a pronunciation guide built for English speakers. Read on the
            web, practise on your phone; progress syncs across both.
          </p>
          <div className="flex flex-wrap gap-2">
            <Link
              to={units[0]?.lessons[0] ? `/lesson/${units[0].lessons[0].id}` : "/fidel"}
              className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90"
            >
              Start learning <ArrowRight className="size-4" />
            </Link>
            <Link
              to="/fidel"
              className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-5 py-2.5 text-sm font-semibold hover:bg-muted"
            >
              Browse <Am>ፊደል</Am>
            </Link>
          </div>
        </div>

        <Card className="space-y-4">
          {isSignedIn ? (
            <>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Today</p>
                  <p className="text-2xl font-bold">
                    {progress.data?.todayXp ?? 0}
                    <span className="text-sm font-medium text-muted-foreground">
                      {" "}
                      / {progress.data?.stats.dailyGoalXp ?? 50} XP
                    </span>
                  </p>
                </div>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-accent/20 px-3 py-1.5 text-sm font-semibold text-accent-foreground">
                  <Flame className="size-4" />
                  {progress.data?.stats.streakDays ?? 0}
                </span>
              </div>
              <ProgressBar
                value={(progress.data?.todayXp ?? 0) / (progress.data?.stats.dailyGoalXp || 50)}
                barClassName="bg-accent"
              />
              <p className="text-xs text-muted-foreground">
                {progress.data?.goalMet
                  ? "Daily goal met — streak safe."
                  : "Finish a lesson or a review session to keep the streak."}
              </p>
            </>
          ) : (
            <>
              <p className="text-sm font-semibold">Learn without an account</p>
              <p className="text-sm text-muted-foreground">
                Lessons and the ፊደል chart are open. Sign in when you want XP, streaks and a review
                deck that follows you between web and mobile.
              </p>
              <Link
                to="/sign-in"
                className="inline-flex w-fit items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90"
              >
                Sign in <ArrowRight className="size-4" />
              </Link>
            </>
          )}

          <div className="grid grid-cols-2 gap-3 border-t border-border pt-4 text-sm">
            <Stat label="Units" value={stats.data?.units} />
            <Stat label="Lessons" value={stats.data?.lessons} />
            <Stat label="Words" value={stats.data?.words} />
            <Stat label="Drills" value={stats.data?.practiceQuestions} />
          </div>
        </Card>
      </section>

      {/* What a lesson is made of, plus the honest state of translation. Both
          are here because this is the page a visitor searching for "Amharic
          lessons" lands on, and neither is obvious from a list of unit cards. */}
      <section className="space-y-5">
        <div>
          <h2 className="text-xl font-bold">What each Amharic lesson contains</h2>
          <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Lessons are written, not filmed — you read them at your own pace and come back to
            them as reference. Every one is built from the same beginner textbook and keeps the
            source wording rather than paraphrasing it.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card className="space-y-2">
            <h3 className="font-display text-base font-bold">Words with English glosses</h3>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Each vocabulary row shows the <Am>ፊደል</Am> spelling, a transliteration and the
              English meaning, so nothing depends on guessing.
            </p>
          </Card>
          <Card className="space-y-2">
            <h3 className="font-display text-base font-bold">Dialogue you can replay</h3>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Short exchanges — greeting someone, introducing yourself, ordering food — line by
              line, with the English beside them.
            </p>
          </Card>
          <Card className="space-y-2">
            <h3 className="font-display text-base font-bold">Grammar, stated as rules</h3>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Pronouns, verb stems and the patterns behind them, written out with the examples
              the source uses rather than invented ones.
            </p>
          </Card>
          <Card className="space-y-2">
            <h3 className="font-display text-base font-bold">A quiz at the end</h3>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Questions generated from that lesson's own material, so passing means you read the
              lesson and not a general knowledge round.
            </p>
          </Card>
        </div>

        {/* Amharic translation, as it actually exists in this build. */}
        <Card className="space-y-2.5">
          <h3 className="font-display text-lg font-bold">Amharic translation inside the course</h3>
          <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
            Every Amharic line in a lesson — vocabulary, dialogue, grammar examples — carries its
            English translation alongside it, on every plan including the free one. That is what
            translation means here: the course material is glossed for you as you read, so you are
            never left staring at a sentence with no way in.
          </p>
          <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
            Translating your own arbitrary text is a separate, paid-plan feature, and it is
            currently listed as not configured — it needs a translation provider this deployment
            has not been given. We say so rather than shipping a box that silently returns
            nothing.
          </p>
          <div className="flex flex-wrap gap-x-5 gap-y-2 pt-0.5">
            <Link
              to="/features"
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline"
            >
              Check the translation status <ArrowRight className="size-3.5" />
            </Link>
            <Link
              to="/dictionary"
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline"
            >
              Search the Amharic dictionary <ArrowRight className="size-3.5" />
            </Link>
          </div>
        </Card>

        <p className="text-sm leading-relaxed text-muted-foreground">
          New to the script? Start on the{" "}
          <Link to="/fidel" className="font-medium text-primary hover:underline">
            Amharic Fidel chart
          </Link>
          , then the{" "}
          <Link to="/pronunciation" className="font-medium text-primary hover:underline">
            pronunciation guide
          </Link>
          . Once a unit is behind you, drill it on the{" "}
          <Link to="/practice" className="font-medium text-primary hover:underline">
            practice page
          </Link>
          .
        </p>
      </section>

      {/* Unit path */}
      <section className="space-y-5">
        <div className="flex items-center gap-3">
          <Layers className="size-5 text-primary" />
          <h2 className="text-xl font-bold">Units</h2>
        </div>

        <div className="space-y-5">
          {units.map((unit, i) => {
            const total = unit.lessons.length;
            const done = unit.lessons.filter((l) => doneIds.has(l.id)).length;
            return (
              <Card
                key={unit.id}
                className={`space-y-4 md:max-w-[88%] ${i % 2 === 1 ? "md:ml-auto" : ""}`}
              >
                <div className="flex flex-wrap items-start gap-3">
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10 font-display text-lg font-bold text-primary">
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-lg font-bold leading-snug">{unit.titleEn}</h3>
                    {unit.titleAm ? <Am className="text-primary">{unit.titleAm}</Am> : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <Chip label={`${total} lessons`} icon={BookOpen} />
                  </div>
                </div>

                {unit.objectives.length ? (
                  <ul className="grid gap-1.5 text-sm text-muted-foreground sm:grid-cols-2">
                    {unit.objectives.slice(0, 4).map((objective, oi) => (
                      <li key={oi} className="flex items-start gap-2">
                        <Sparkles className="mt-0.5 size-3.5 shrink-0 text-accent" />
                        <span>{objective}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}

                {isSignedIn && total ? (
                  <div className="space-y-1.5">
                    <ProgressBar value={done / total} />
                    <p className="text-xs text-muted-foreground">
                      {done} of {total} lessons complete
                    </p>
                  </div>
                ) : null}

                <div className="flex flex-wrap gap-2 border-t border-border pt-4">
                  {unit.lessons.map((lesson) => {
                    const complete = doneIds.has(lesson.id);
                    return (
                      <Link
                        key={lesson.id}
                        to={`/lesson/${lesson.id}`}
                        className={`inline-flex max-w-full items-center gap-2 rounded-full border px-3.5 py-2 text-sm transition ${
                          complete
                            ? "border-primary/30 bg-primary/10 text-primary"
                            : "border-border bg-background hover:bg-muted"
                        }`}
                      >
                        {complete ? <CheckCircle2 className="size-3.5 shrink-0" /> : null}
                        <span className="truncate">{lesson.titleEn}</span>
                      </Link>
                    );
                  })}
                </div>

                <Link
                  to={`/quiz/unit-${unit.id}`}
                  className="inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline"
                >
                  Unit assessment <ArrowRight className="size-4" />
                </Link>
              </Card>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value?: number }) {
  return (
    <div>
      <p className="font-display text-xl font-bold">{value ?? "—"}</p>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
    </div>
  );
}
