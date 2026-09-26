import { useMemo, useState } from "react";
import { Link } from "wouter";
import { ArrowRight, BookOpen, Library, Search, Sparkles } from "lucide-react";
import { useOutline, useVocabulary } from "../queries/content";
import { ORIGIN, useSeo } from "../hooks/use-seo";
import {
  Am,
  Card,
  Chip,
  EmptyState,
  ErrorState,
  Loading,
  SpeakButton,
  TibebRule,
  Translit,
} from "../components/ui/kit";

/**
 * The course dictionary.
 *
 * Every word here comes from the beginner course's own vocabulary tables — the
 * same rows the lessons, the review deck and the tutor's lookup tool read. It
 * is deliberately not presented as a complete Amharic lexicon: a learner
 * searching a word and finding nothing should understand that the course does
 * not teach it yet, rather than concluding the word does not exist.
 *
 * Read-only by design. Nothing here is gated, and nothing here writes.
 */

/** How many entries render before the list asks you to narrow the search. */
const PAGE_SIZE = 120;

/**
 * A glossary drawn from the course, described as exactly that. Claiming
 * `Dataset` or a complete dictionary here would overstate a 250-word list.
 */
const DICTIONARY_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "DefinedTermSet",
  "@id": `${ORIGIN}/dictionary#glossary`,
  name: "AmharicAI course dictionary",
  url: `${ORIGIN}/dictionary`,
  description:
    "Searchable glossary of the Amharic vocabulary taught in the AmharicAI beginner course, with Fidel spelling, transliteration and English meaning.",
  inLanguage: ["am", "en"],
  isAccessibleForFree: true,
  isPartOf: { "@id": `${ORIGIN}/app#course` },
};

export default function DictionaryPage() {
  const vocabulary = useVocabulary();
  const outline = useOutline();
  const [query, setQuery] = useState("");
  const [unitId, setUnitId] = useState("");

  const total = vocabulary.data?.length ?? 0;

  useSeo({
    title: "Amharic dictionary online — every word in the course",
    description:
      "A free Amharic dictionary you can search in Amharic script, in transliteration or in English. Every entry is a word taught in the AmharicAI beginner course, with its Fidel spelling, transliteration, English meaning and the lesson it comes from.",
    path: "/dictionary",
    jsonLd: DICTIONARY_JSON_LD,
  });

  /** Lesson ids belonging to the selected unit, for the unit filter. */
  const unitLessonIds = useMemo(() => {
    if (!unitId) return null;
    const unit = (outline.data?.units ?? []).find((u) => u.id === unitId);
    return new Set((unit?.lessons ?? []).map((l) => l.id));
  }, [outline.data, unitId]);

  const matches = useMemo(() => {
    const all = vocabulary.data ?? [];
    const q = query.trim().toLowerCase();
    return all.filter((word) => {
      if (unitLessonIds && !(word.lessonId && unitLessonIds.has(word.lessonId))) return false;
      if (!q) return true;
      return (
        word.amharic.toLowerCase().includes(q) ||
        (word.transliteration ?? "").toLowerCase().includes(q) ||
        (word.english ?? "").toLowerCase().includes(q)
      );
    });
  }, [vocabulary.data, query, unitLessonIds]);

  const shown = matches.slice(0, PAGE_SIZE);

  if (vocabulary.isLoading) return <Loading label="Loading the dictionary…" />;
  if (vocabulary.isError)
    return (
      <ErrorState message={vocabulary.error?.message} onRetry={() => vocabulary.refetch()} />
    );

  const units = (outline.data?.units ?? []).filter((u) => u.lessons.length > 0);

  return (
    <div className="space-y-8">
      <header className="space-y-3">
        <div className="flex items-center gap-2 text-primary">
          <Library className="size-5" />
          <span className="text-xs font-semibold uppercase tracking-wide">Dictionary</span>
        </div>
        <h1 className="text-3xl font-bold md:text-4xl">Amharic dictionary</h1>
        <TibebRule className="max-w-44" />
        <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
          Search {total ? `${total} ` : ""}Amharic words three ways — type the <Am>ፊደል</Am>{" "}
          spelling, type the transliteration, or type the English meaning. Each entry shows the
          word as it is written, how it is read aloud, what it means, and which lesson of the
          course teaches it.
        </p>
      </header>

      {/* Search + unit filter */}
      <div className="sticky top-[76px] z-30 -mx-1 space-y-2 bg-background/90 px-1 py-2 backdrop-blur">
        <label className="flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2.5">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search the Amharic dictionary"
            // Example words the course actually teaches, so the placeholder
            // does not demonstrate a search that returns nothing.
            placeholder="Search Amharic, transliteration or English — ውሃ, wïha, water"
            className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </label>
        {units.length ? (
          <div className="flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor="dictionary-unit">
              Filter by course unit
            </label>
            <select
              id="dictionary-unit"
              value={unitId}
              onChange={(e) => setUnitId(e.target.value)}
              className="rounded-full border border-border bg-card px-3.5 py-1.5 text-xs font-medium outline-none"
            >
              <option value="">Every unit</option>
              {units.map((unit) => (
                <option key={unit.id} value={unit.id}>
                  {unit.titleEn}
                </option>
              ))}
            </select>
            <Chip label={`${matches.length} of ${total} words`} />
          </div>
        ) : null}
      </div>

      {shown.length ? (
        <>
          <Card className="grid gap-x-6 divide-y divide-border/70 p-0 sm:grid-cols-2 sm:divide-y-0">
            {shown.map((word) => (
              <div
                key={word.id}
                className="flex items-center gap-3 border-b border-border/60 p-3.5"
              >
                <div className="min-w-0 flex-1">
                  <Am className="text-lg">{word.amharic}</Am>
                  {word.transliteration ? (
                    <div className="text-xs">
                      <Translit>{word.transliteration}</Translit>
                    </div>
                  ) : null}
                  <p className="text-sm text-muted-foreground">{word.english ?? "—"}</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground/80">
                    {word.partOfSpeech ? `${word.partOfSpeech} · ` : ""}
                    {word.lessonTitle ?? "Course vocabulary"}
                  </p>
                </div>
                <SpeakButton
                  amharic={word.amharic}
                  transliteration={word.transliteration}
                  className="size-8"
                />
              </div>
            ))}
          </Card>
          {matches.length > shown.length ? (
            <p className="text-xs text-muted-foreground">
              Showing the first {PAGE_SIZE} of {matches.length} matches — narrow the search or
              pick a single unit to see the rest.
            </p>
          ) : null}
        </>
      ) : (
        <EmptyState
          icon={Search}
          title="No entry for that"
          body={
            query.trim()
              ? `Nothing in the course vocabulary matches “${query.trim()}”. The course is a beginner course, so a word it does not teach yet will not be listed here.`
              : "No words in this unit yet."
          }
        />
      )}

      {/* What this is, stated plainly rather than implied. */}
      <section className="space-y-3">
        <h2 className="font-display text-xl font-bold">How this dictionary works</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <Card className="space-y-2">
            <h3 className="font-display text-base font-bold">Three ways in</h3>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Amharic script, transliteration or English all search the same entries, so you can
              look a word up before you can type <Am>ፊደል</Am> confidently.
            </p>
          </Card>
          <Card className="space-y-2">
            <h3 className="font-display text-base font-bold">Tied to the lessons</h3>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Every entry names the lesson it is taught in, so a word you half-remember leads
              you back to the material it came from instead of standing alone.
            </p>
          </Card>
          <Card className="space-y-2">
            <h3 className="font-display text-base font-bold">Course words, not a lexicon</h3>
            <p className="text-sm leading-relaxed text-muted-foreground">
              These are the words the beginner course teaches, kept as the source wrote them.
              It is not a complete dictionary of the Ethiopian language, and it does not pretend
              to be.
            </p>
          </Card>
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          The speaker button plays an Amharic voice when this deployment has one connected. When
          it does not, the button says so rather than reading the word with an English voice —{" "}
          <Link to="/features" className="font-medium underline hover:text-foreground">
            audio status is listed on the features page
          </Link>
          .
        </p>
      </section>

      {/* Dictionary → Translation, the next step in the chain. */}
      <section className="grid gap-4 sm:grid-cols-2">
        <Card className="space-y-2.5">
          <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Sparkles className="size-5" />
          </span>
          <h2 className="font-display text-lg font-bold">Drill these words</h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Looking a word up is not learning it. Send it through the review deck and the
            speaking loop on the practice page.
          </p>
          <Link
            to="/practice"
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline"
          >
            Go to Amharic practice <ArrowRight className="size-3.5" />
          </Link>
        </Card>
        <Card className="space-y-2.5">
          <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <BookOpen className="size-5" />
          </span>
          <h2 className="font-display text-lg font-bold">Words in context</h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Each word sits inside a written lesson with its dialogue and grammar. Read it there
            and the English gloss comes with it.
          </p>
          <Link
            to="/app"
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline"
          >
            Browse the Amharic lessons <ArrowRight className="size-3.5" />
          </Link>
        </Card>
      </section>
    </div>
  );
}
