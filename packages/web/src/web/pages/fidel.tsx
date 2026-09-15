import { useMemo, useState } from "react";
import { Search, Type } from "lucide-react";
import { useFidel } from "../queries/content";
import { useSeo } from "../hooks/use-seo";
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

export default function FidelPage() {
  const fidel = useFidel();
  const [query, setQuery] = useState("");

  useSeo({
    title: "The ፊደል — all 34 consonants across seven vowel orders",
    description:
      "The full Amharic syllabary as a grid: every base consonant through its seven vowel orders, with transliteration and audio.",
    path: "/fidel",
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
          Amharic is written in an abugida: every symbol is a consonant plus a vowel. Each row below
          is one consonant, each column one of the seven vowel orders. Tap any letter to hear it.
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
    </div>
  );
}
