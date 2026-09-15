import { useState } from "react";
import { Link, useParams } from "wouter";
import {
  ArrowLeft,
  ArrowRight,
  BookMarked,
  CheckCircle2,
  Layers,
  Mic,
  Sparkles,
} from "lucide-react";
import { useLesson } from "../queries/content";
import { useCompleteLesson } from "../queries/practice";
import { useAddLessonToDeck } from "../queries/srs";
import { useSession } from "../hooks/use-session";
import { SourceValue, humanize } from "../components/source-value";
import { DialoguePlayer } from "../components/dialogue-player";
import {
  Am,
  Card,
  Chip,
  ErrorState,
  Loading,
  QaNote,
  SpeakButton,
  TibebRule,
  Translit,
} from "../components/ui/kit";
import { useSeo } from "../hooks/use-seo";

/**
 * One lesson, rendered source-faithfully.
 *
 * Typed tables (vocabulary, grammar, verbs, dialogues) get purpose-built
 * layouts; everything else in the source spec survives verbatim inside
 * `lesson_sections.body` and renders through `SourceValue`, so no key from the
 * manual is ever dropped just because the UI has no opinion about it.
 */

type SectionBody = {
  key?: string;
  value?: unknown;
};

export default function LessonPage() {
  const params = useParams<{ id: string }>();
  const lessonId = params.id ?? "";
  const lesson = useLesson(lessonId);
  const { isSignedIn } = useSession();
  const completeLesson = useCompleteLesson();
  const addDeck = useAddLessonToDeck();
  const [deckMessage, setDeckMessage] = useState<string | null>(null);

  // Written before the early returns: hooks cannot sit behind a loading branch,
  // and the lesson title arrives a tick later than the route does.
  useSeo({
    title: lesson.data?.lesson.titleEn ?? "Lesson",
    description:
      lesson.data?.unit.titleEn
        ? `${lesson.data.lesson.titleEn} — vocabulary, grammar and dialogue from ${lesson.data.unit.titleEn}.`
        : "An AmharicAI lesson: vocabulary, grammar, verbs and dialogue.",
    path: lessonId ? `/lesson/${lessonId}` : undefined,
  });

  if (lesson.isLoading) return <Loading label="Loading the lesson…" />;
  if (lesson.isError)
    return <ErrorState message={lesson.error?.message} onRetry={() => lesson.refetch()} />;

  const data = lesson.data;
  if (!data) return <ErrorState message="Lesson not found." />;

  const { vocabulary, grammar, verbs, dialogues, sections, activities } = data;

  const rail = [
    vocabulary.length ? { href: "#vocabulary", label: `Vocabulary (${vocabulary.length})` } : null,
    grammar.length ? { href: "#grammar", label: `Grammar (${grammar.length})` } : null,
    verbs.length ? { href: "#verbs", label: `Verbs (${verbs.length})` } : null,
    dialogues.length ? { href: "#dialogues", label: `Dialogues (${dialogues.length})` } : null,
    activities.length ? { href: "#activities", label: `Activities (${activities.length})` } : null,
    sections.length ? { href: "#source", label: `From the manual (${sections.length})` } : null,
  ].filter((item): item is { href: string; label: string } => Boolean(item));

  return (
    <div className="space-y-8">
      {/* Header */}
      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to="/app"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" /> Course
          </Link>
          {data.unit ? (
            <>
              <span className="text-muted-foreground">/</span>
              <span className="text-sm text-muted-foreground">{data.unit.titleEn}</span>
            </>
          ) : null}
        </div>
        <h1 className="text-3xl font-bold leading-tight md:text-4xl">{data.lesson.titleEn}</h1>
        {data.lesson.titleAm ? (
          <Am className="block text-xl text-primary">{data.lesson.titleAm}</Am>
        ) : null}
        <TibebRule className="max-w-44" />
        <div className="flex flex-wrap items-center gap-2">
          {data.lesson.code ? <Chip label={data.lesson.code} /> : null}
        </div>
      </header>

      <div className="grid gap-8 md:grid-cols-[220px_1fr]">
        {/* Outline rail */}
        <aside className="md:sticky md:top-24 md:self-start">
          <nav className="space-y-1 rounded-2xl border border-border bg-card p-3">
            <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              In this lesson
            </p>
            {rail.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="block rounded-lg px-2 py-1.5 text-sm text-muted-foreground transition hover:bg-muted hover:text-foreground"
              >
                {item.label}
              </a>
            ))}
            <div className="mt-2 flex items-center gap-2 border-t border-border pt-2">
              {data.prevLessonId ? (
                <Link
                  to={`/lesson/${data.prevLessonId}`}
                  className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-primary hover:bg-muted"
                >
                  <ArrowLeft className="size-3.5" /> Previous
                </Link>
              ) : null}
              {data.nextLessonId ? (
                <Link
                  to={`/lesson/${data.nextLessonId}`}
                  className="ml-auto inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-primary hover:bg-muted"
                >
                  Next <ArrowRight className="size-3.5" />
                </Link>
              ) : null}
            </div>
          </nav>
        </aside>

        {/* Main column */}
        <div className="min-w-0 space-y-8">
          {vocabulary.length ? (
            <section id="vocabulary" className="space-y-3 scroll-mt-24">
              <SectionHeading icon={<BookMarked className="size-4" />} title="Vocabulary" />
              <Card className="divide-y divide-border/70 p-0">
                {vocabulary.map((word) => (
                  <div key={word.id} className="flex items-center gap-4 p-4">
                    <div className="min-w-0 flex-1">
                      <Am className="text-xl">{word.amharic}</Am>
                      {word.transliteration ? (
                        <div className="text-sm">
                          <Translit>{word.transliteration}</Translit>
                        </div>
                      ) : null}
                      {word.english ? (
                        <p className="text-sm text-muted-foreground">{word.english}</p>
                      ) : null}
                      {word.notes ? (
                        <p className="pt-1 text-xs text-muted-foreground">{word.notes}</p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {word.partOfSpeech ? <Chip label={word.partOfSpeech} /> : null}
                      <SpeakButton amharic={word.amharic} transliteration={word.transliteration} />
                    </div>
                  </div>
                ))}
              </Card>
            </section>
          ) : null}

          {grammar.length ? (
            <section id="grammar" className="space-y-3 scroll-mt-24">
              <SectionHeading icon={<Sparkles className="size-4" />} title="Grammar" />
              {grammar.map((concept) => (
                <Card key={concept.id} className="space-y-3">
                  <div className="flex flex-wrap items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <h3 className="font-semibold">{concept.nameEn}</h3>
                      {concept.nameAm ? <Am className="text-primary">{concept.nameAm}</Am> : null}
                    </div>
                  </div>
                  {concept.ruleText ? (
                    <p className="text-[15px] leading-relaxed">{concept.ruleText}</p>
                  ) : null}
                  {concept.examples ? (
                    <div className="rounded-xl bg-muted/60 p-3">
                      <SourceValue value={concept.examples} />
                    </div>
                  ) : null}
                  <QaNote flag={concept.qaFlag} />
                </Card>
              ))}
            </section>
          ) : null}

          {verbs.length ? (
            <section id="verbs" className="space-y-3 scroll-mt-24">
              <SectionHeading icon={<Layers className="size-4" />} title="Verbs" />
              {verbs.map((verb) => (
                <Card key={verb.id} className="space-y-3">
                  <div className="flex flex-wrap items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        {verb.infinitive ? <Am className="text-lg">{verb.infinitive}</Am> : null}
                        {verb.infinitive ? (
                          <SpeakButton amharic={verb.infinitive} className="size-8" />
                        ) : null}
                      </div>
                      {verb.englishMeaning ? (
                        <p className="text-sm text-muted-foreground">{verb.englishMeaning}</p>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {verb.root ? <Chip label={`root ${verb.root}`} /> : null}
                      {verb.verbType ? <Chip label={verb.verbType} /> : null}
                    </div>
                  </div>

                  {verb.conjugations.length ? (
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[420px] text-sm">
                        <thead>
                          <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                            <th className="py-2 pr-3 font-semibold">Pronoun</th>
                            <th className="py-2 pr-3 font-semibold">Form</th>
                            <th className="py-2 pr-3 font-semibold">Transliteration</th>
                            <th className="py-2 font-semibold">Tense</th>
                          </tr>
                        </thead>
                        <tbody>
                          {verb.conjugations.map((row) => (
                            <tr key={row.id} className="border-b border-border/60 last:border-b-0">
                              <td className="py-2 pr-3">
                                {row.pronoun ? <Am>{row.pronoun}</Am> : "—"}
                              </td>
                              <td className="py-2 pr-3">
                                {row.form ? <Am className="text-base">{row.form}</Am> : "—"}
                              </td>
                              <td className="py-2 pr-3">
                                <Translit>{row.transliteration ?? "—"}</Translit>
                              </td>
                              <td className="py-2 text-xs text-muted-foreground">
                                {[row.tense, row.polarity].filter(Boolean).join(" · ") || "—"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : null}
                  <QaNote flag={verb.qaFlag} />
                </Card>
              ))}
            </section>
          ) : null}

          {dialogues.length ? (
            <section id="dialogues" className="space-y-3 scroll-mt-24">
              <SectionHeading icon={<Sparkles className="size-4" />} title="Dialogues" />
              {dialogues.map((dialogue) => (
                <Card key={dialogue.id} tone="script" className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="flex-1 font-semibold">{dialogue.title ?? dialogue.code}</h3>
                  </div>
                  <DialoguePlayer dialogueId={dialogue.id} lines={dialogue.lines} />
                </Card>
              ))}
            </section>
          ) : null}

          {activities.length ? (
            <section id="activities" className="space-y-3 scroll-mt-24">
              <SectionHeading icon={<Sparkles className="size-4" />} title="Activities" />
              {activities.map((activity) => (
                <Card key={activity.id} className="space-y-3">
                  <div className="flex flex-wrap items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <h3 className="font-semibold">{activity.title ?? humanize(activity.code)}</h3>
                      {activity.instructions ? (
                        <p className="text-sm text-muted-foreground">{activity.instructions}</p>
                      ) : null}
                    </div>
                    {activity.activityType ? <Chip label={activity.activityType} /> : null}
                  </div>
                  {activity.payload ? <SourceValue value={activity.payload} /> : null}
                </Card>
              ))}
            </section>
          ) : null}

          {sections.length ? (
            <section id="source" className="space-y-3 scroll-mt-24">
              <SectionHeading
                icon={<BookMarked className="size-4" />}
                title="From the manual"
                note="Kept exactly as written in the source spec."
              />
              {sections.map((section) => {
                const body = (section.body ?? {}) as SectionBody;
                return (
                  <Card key={section.id} className="space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="flex-1 font-semibold">
                        {section.title ?? humanize(body.key ?? section.sectionType)}
                      </h3>
                    </div>
                    <SourceValue value={body.value ?? body} />
                  </Card>
                );
              })}
            </section>
          ) : null}

          {/* Footer actions */}
          <Card className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Link
                to={`/quiz/${data.lesson.id}`}
                className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90"
              >
                Practise this lesson <ArrowRight className="size-4" />
              </Link>

              {vocabulary.length ? (
                <button
                  type="button"
                  disabled={!isSignedIn || addDeck.isPending}
                  onClick={() =>
                    addDeck.mutate(
                      { lessonId: data.lesson.id },
                      {
                        onSuccess: (result) =>
                          setDeckMessage(
                            result.added
                              ? `${result.added} word${result.added === 1 ? "" : "s"} added to your review deck.`
                              : "These words are already in your deck.",
                          ),
                        onError: (err) => setDeckMessage(err.message),
                      },
                    )
                  }
                  className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-5 py-2.5 text-sm font-semibold hover:bg-muted disabled:opacity-50"
                >
                  <BookMarked className="size-4" /> Add words to my deck
                </button>
              ) : null}

              <Link
                to={`/practice`}
                className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-5 py-2.5 text-sm font-semibold hover:bg-muted"
              >
                <Mic className="size-4" /> Speaking practice
              </Link>

              <button
                type="button"
                disabled={!isSignedIn || completeLesson.isPending}
                onClick={() => completeLesson.mutate({ lessonId: data.lesson.id })}
                className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-5 py-2.5 text-sm font-semibold hover:bg-muted disabled:opacity-50"
              >
                <CheckCircle2 className="size-4" />
                {completeLesson.isSuccess ? "Marked complete" : "Mark lesson complete"}
              </button>
            </div>

            {deckMessage ? <p className="text-xs text-muted-foreground">{deckMessage}</p> : null}
            {!isSignedIn ? (
              <p className="text-xs text-muted-foreground">
                <Link to="/sign-in" className="font-semibold text-primary hover:underline">
                  Sign in
                </Link>{" "}
                to save progress, build a review deck and earn XP.
              </p>
            ) : null}
          </Card>

          {/* Prev / next */}
          <div className="flex items-center justify-between gap-3">
            {data.prevLessonId ? (
              <Link
                to={`/lesson/${data.prevLessonId}`}
                className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-sm font-medium hover:bg-muted"
              >
                <ArrowLeft className="size-4" /> Previous lesson
              </Link>
            ) : (
              <span />
            )}
            {data.nextLessonId ? (
              <Link
                to={`/lesson/${data.nextLessonId}`}
                className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-sm font-medium hover:bg-muted"
              >
                Next lesson <ArrowRight className="size-4" />
              </Link>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function SectionHeading({
  icon,
  title,
  note,
}: {
  icon: React.ReactNode;
  title: string;
  note?: string;
}) {
  return (
    <div className="space-y-1">
      <h2 className="flex items-center gap-2 text-lg font-bold">
        <span className="text-primary">{icon}</span>
        {title}
      </h2>
      {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
    </div>
  );
}
