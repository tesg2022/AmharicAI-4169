import { Link } from "wouter";
import { ArrowRight, BookOpen, CheckCircle2, Flame, GraduationCap, Layers, Sparkles } from "lucide-react";
import { useCourseStats, useOutline } from "../queries/content";
import { useLessonProgress, useMyProgress } from "../queries/progress";
import { useSession } from "../hooks/use-session";
import { useSeo } from "../hooks/use-seo";
import { Am, Card, Chip, ErrorState, Loading, ProgressBar, TibebRule } from "../components/ui/kit";

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
    title: "The course — every unit, lesson by lesson",
    description:
      "Browse the AmharicAI beginner course: the ፊደል syllabary, pronunciation, vocabulary and grammar, unit by unit.",
    path: "/app",
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
