import { useMemo, useState } from "react";
import { Link } from "wouter";
import { Search, Type } from "lucide-react";
import { useFidel } from "../queries/content";
import { ORIGIN, useSeo } from "../hooks/use-seo";
import {
  Am,
  Card,
  Chip,
  ErrorState,
  Loading,
  SpeakButton,
  TibebRule,
  Translit,
} from "../components/ui/kit";

/**
 * ፊደል browser.
 *
 * The syllabary is a 34 × 7 grid: each base consonant runs through seven
 * vowel orders. Rendering it as a real grid (rather than a list) is the whole
 * point — learners read down a column to hear one vowel across consonants.
 */

/**
 * The chart is a real, free-to-read learning resource, so it is described as
 * one. Nothing here claims audio always plays — that depends on a TTS host
 * being configured, and /features reports the truth about it.
 */
const FIDEL_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "LearningResource",
  "@id": `${ORIGIN}/fidel#resource`,
  name: "Amharic Fidel chart — the complete ፊደል alphabet",
  url: `${ORIGIN}/fidel`,
  learningResourceType: "Reference chart",
  educationalLevel: "Beginner",
  teaches: "Amharic Fidel (ፊደል), the alphabet of the Ethiopian language",
  inLanguage: ["en", "am"],
  isAccessibleForFree: true,
  isPartOf: { "@id": `${ORIGIN}/app#course` },
};

export default function FidelPage() {
  const fidel = useFidel();
  const [query, setQuery] = useState("");

  useSeo({
    // No "with audio" here: playback needs a TTS host this build has not been
    // given, so the title promises only what the page certainly shows.
    title: "Amharic Fidel — the complete ፊደል alphabet chart",
    description:
      "Read the Amharic alphabet as it is actually written: all 34 Fidel consonants across their seven vowel orders, each with transliteration, in one scrollable chart.",
    path: "/fidel",
    jsonLd: FIDEL_JSON_LD,
  });

  const [selected, setSelected] = useState<{
    character: string;
    transliteration: string | null;
    romanBase: string;
    order: string;
  } | null>(null);

  const groups = useMemo(() => {
    const all = fidel.data?.groups ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter(
      (g) =>
        g.romanBase.toLowerCase().includes(q) ||
        g.baseChar.includes(q) ||
        g.letters.some((l) => (l.transliteration ?? "").toLowerCase().includes(q)),
    );
  }, [fidel.data, query]);

  if (fidel.isLoading) return <Loading label="Loading the syllabary…" />;
  if (fidel.isError)
    return <ErrorState message={fidel.error?.message} onRetry={() => fidel.refetch()} />;

  const orders = fidel.data?.orders ?? [];

  return (
    <div className="space-y-6">
      <header className="space-y-3">
        <div className="flex items-center gap-2 text-primary">
          <Type className="size-5" />
          <span className="text-xs font-semibold uppercase tracking-wide">The syllabary</span>
        </div>
        <h1 className="text-3xl font-bold md:text-4xl">
          <Am>ፊደል</Am> <span className="text-muted-foreground">— fidäl</span>
        </h1>
        <TibebRule className="max-w-44" />
        <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
          The Amharic alphabet is not an alphabet in the European sense — it is an abugida, where
          every symbol carries a consonant and a vowel together. Each row below is one consonant,
          each column one of the seven vowel orders. Tap any letter to see it enlarged with its
          transliteration.
        </p>
      </header>

      <div className="sticky top-[76px] z-30 -mx-1 bg-background/90 px-1 py-2 backdrop-blur">
        <label className="flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2.5">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Filter consonants by sound"
            placeholder="Filter by sound — h, l, m, s…"
            className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </label>
      </div>

      {selected ? (
        <Card tone="script" className="flex flex-wrap items-center gap-5">
          <Am className="text-6xl leading-none text-primary">{selected.character}</Am>
          <div className="min-w-0 flex-1">
            <p className="font-display text-2xl font-bold">{selected.transliteration ?? "—"}</p>
            <p className="text-sm text-muted-foreground">
              base <span className="font-semibold">{selected.romanBase}</span> · order{" "}
              <Translit>{selected.order}</Translit>
            </p>
          </div>
          <SpeakButton
            amharic={selected.character}
            transliteration={selected.transliteration}
            className="size-11"
          />
        </Card>
      ) : null}

      {/* Order legend */}
      <div className="overflow-x-auto">
        <div className="min-w-[680px]">
          <div className="grid grid-cols-[64px_repeat(7,1fr)] gap-2 pb-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Base
            </span>
            {orders.map((order, i) => (
              <span
                key={order}
                className="text-center text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
              >
                {i + 1}
                <span className="ml-1 normal-case italic">{order}</span>
              </span>
            ))}
          </div>

          <div className="space-y-2">
            {groups.map((group) => (
              <div
                key={group.baseOrder}
                className="grid grid-cols-[64px_repeat(7,1fr)] items-center gap-2"
              >
                <div className="flex items-center gap-1.5">
                  <Am className="text-lg text-primary">{group.baseChar}</Am>
                  <span className="text-xs font-semibold text-muted-foreground">
                    {group.romanBase}
                  </span>
                </div>
                {group.letters.map((letter, i) => {
                  const active = selected?.character === letter.character;
                  return (
                    <button
                      key={letter.id}
                      type="button"
                      onClick={() =>
                        setSelected({
                          character: letter.character,
                          transliteration: letter.transliteration,
                          romanBase: group.romanBase,
                          order: orders[i] ?? String(i + 1),
                        })
                      }
                      title={letter.transliteration ?? undefined}
                      className={`script-surface flex flex-col items-center justify-center rounded-xl border px-1 py-2 transition ${
                        active
                          ? "border-primary bg-primary/10"
                          : "border-border hover:border-primary/40 hover:bg-primary/5"
                      }`}
                    >
                      <Am className="text-xl leading-none">{letter.character}</Am>
                      <span className="pt-1 text-[10px] text-muted-foreground">
                        {letter.transliteration ?? ""}
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>

      {groups.length === 0 ? (
        <Card className="text-center text-sm text-muted-foreground">
          No consonant matches “{query}”.
        </Card>
      ) : null}

      <Card className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <Chip label={`${fidel.data?.groups.length ?? 0} consonants`} />
        <Chip label={`${orders.length} vowel orders`} />
        <Chip
          label={`${(fidel.data?.groups ?? []).reduce((n, g) => n + g.letters.length, 0)} letters`}
        />
        <span>Ordered as the source manual presents them.</span>
      </Card>

      {/* Explanatory content + the Fidel link in the Learn → Fidel → Lessons chain. */}
      <section className="space-y-4">
        <h2 className="font-display text-xl font-bold">How to read the Amharic Fidel chart</h2>
        <div className="grid gap-4 md:grid-cols-3">
          <Card className="space-y-2">
            <h3 className="font-semibold">Read across for one consonant</h3>
            <p className="text-sm leading-relaxed text-muted-foreground">
              A row takes a single sound — say <Translit>h</Translit> — through all seven vowels:{" "}
              <Am>ሀ ሁ ሂ ሃ ሄ ህ ሆ</Am>. The consonant never changes; only the small marks hanging off
              it do.
            </p>
          </Card>
          <Card className="space-y-2">
            <h3 className="font-semibold">Read down for one vowel</h3>
            <p className="text-sm leading-relaxed text-muted-foreground">
              A column holds one vowel order across every consonant. Reading down is the fastest way
              to hear what a vowel order does, because the vowel is the only thing held constant.
            </p>
          </Card>
          <Card className="space-y-2">
            <h3 className="font-semibold">Learn the sixth order early</h3>
            <p className="text-sm leading-relaxed text-muted-foreground">
              The sixth order is the bare consonant — no vowel, or a very short one. It turns up
              constantly in real words, so it is worth recognising before you memorise the rest.
            </p>
          </Card>
        </div>
        <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
          The Fidel is the first thing to learn in the Ethiopian language, because every lesson after
          it is written in this script rather than in transliteration. Once the shapes stop being
          unfamiliar, work through the{" "}
          <Link to="/pronunciation" className="font-medium text-primary hover:underline">
            pronunciation guide
          </Link>{" "}
          for the sounds the chart cannot show you, then start the{" "}
          <Link to="/app" className="font-medium text-primary hover:underline">
            Amharic lessons for beginners
          </Link>
          . To drill the letters instead of reading them, use{" "}
          <Link to="/practice" className="font-medium text-primary hover:underline">
            Amharic pronunciation practice
          </Link>
          , and to look a word up in the script, search the{" "}
          <Link to="/dictionary" className="font-medium text-primary hover:underline">
            Amharic dictionary
          </Link>
          .
        </p>
      </section>
    </div>
  );
}
