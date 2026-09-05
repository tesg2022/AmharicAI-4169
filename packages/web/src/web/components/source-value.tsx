import { Fragment } from "react";
import { Am, SpeakButton, Translit } from "./ui/kit";

/**
 * Generic renderer for the source material kept verbatim in
 * `lesson_sections.body`.
 *
 * The content policy is explicit: nothing from the source may be dropped or
 * reshaped. Sections arrive as `{ key, value, source_pages }` where `value`
 * can be a string, a number, a list of strings, a list of tuples (Amharic /
 * transliteration / English), a list of objects, or a nested map. Every shape
 * has to render as *something* readable — an unknown shape degrades to a
 * labelled key/value block rather than disappearing.
 */

const ETHIOPIC = /[ሀ-፿]/;

export function isAmharic(value: unknown): boolean {
  return typeof value === "string" && ETHIOPIC.test(value);
}

/** `alphabet_categories` → `Alphabet categories`. */
export function humanize(key: string): string {
  const spaced = key.replace(/[_-]+/g, " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Provenance keys are kept in the data but never rendered. */
const HIDDEN_KEYS = new Set(["source_page", "source_pages", "sourcePage", "sourcePages"]);

function visibleEntries(value: object): [string, unknown][] {
  return Object.entries(value as Record<string, unknown>).filter(([k]) => !HIDDEN_KEYS.has(k));
}

function Scalar({ value, className }: { value: unknown; className?: string }) {
  const text = value === null || value === undefined ? "—" : String(value);
  if (isAmharic(text)) return <Am className={className}>{text}</Am>;
  return <span className={className}>{text}</span>;
}

/**
 * A tuple row such as `["እኔ", "ïne", "I"]`. The first Ethiopic cell is the
 * term, a following Latin cell its transliteration, the rest the gloss — but
 * arity is never assumed, so 2-, 3- and 4-cell rows all survive.
 */
function TupleRow({ cells }: { cells: unknown[] }) {
  const amharicIndex = cells.findIndex((c) => isAmharic(c));
  const amharic = amharicIndex >= 0 ? String(cells[amharicIndex]) : null;
  const rest = cells.filter((_, i) => i !== amharicIndex);
  const translit =
    rest.length > 1 && typeof rest[0] === "string" && !isAmharic(rest[0]) ? String(rest[0]) : null;
  const gloss = (translit ? rest.slice(1) : rest).filter(
    (c) => c !== null && c !== undefined && String(c).length > 0,
  );

  return (
    <div className="flex items-center gap-3 border-b border-border/70 py-2 last:border-b-0">
      <div className="flex-1">
        {amharic ? <Am className="text-lg">{amharic}</Am> : null}
        {translit ? <div className="text-sm"><Translit>{translit}</Translit></div> : null}
        {gloss.length ? (
          <div className="text-sm text-muted-foreground">{gloss.map(String).join(" · ")}</div>
        ) : null}
        {!amharic && !translit && !gloss.length ? <Scalar value={cells[0]} /> : null}
      </div>
      {amharic ? <SpeakButton amharic={amharic} transliteration={translit} className="size-8" /> : null}
    </div>
  );
}

function ObjectEntry({ label, value }: { label: string; value: unknown }) {
  if (value !== null && typeof value === "object") {
    return (
      <div className="space-y-2 py-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {humanize(label)}
        </p>
        <SourceValue value={value} />
      </div>
    );
  }

  return (
    <div className="flex items-start gap-4 border-b border-border/70 py-1.5 last:border-b-0">
      <span className="flex-1 text-sm font-medium text-muted-foreground">{humanize(label)}</span>
      <span className="flex-[1.4] text-sm">
        <Scalar value={value} />
      </span>
    </div>
  );
}

export function SourceValue({ value }: { value: unknown }) {
  if (value === null || value === undefined) return null;

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return <Scalar value={value} className="text-[15px] leading-relaxed" />;
  }

  if (Array.isArray(value)) {
    if (!value.length) return null;

    // A flat list of short Amharic strings reads best as a script grid.
    const allShortAmharic =
      value.every((v) => typeof v === "string") &&
      value.every((v) => isAmharic(v) && String(v).length <= 4);
    if (allShortAmharic) {
      return (
        <div className="flex flex-wrap gap-2">
          {(value as string[]).map((char, i) => (
            <span
              key={`${char}-${i}`}
              className="script-surface flex min-w-11 items-center justify-center rounded-lg border border-border px-3 py-2"
            >
              <Am className="text-xl">{char}</Am>
            </span>
          ))}
        </div>
      );
    }

    return (
      <div>
        {value.map((item, i) => (
          <Fragment key={i}>
            {Array.isArray(item) ? (
              <TupleRow cells={item} />
            ) : item !== null && typeof item === "object" ? (
              <div className="border-b border-border/70 py-2 last:border-b-0">
                {visibleEntries(item as object).map(([k, v]) => (
                  <ObjectEntry key={k} label={k} value={v} />
                ))}
              </div>
            ) : (
              <div className="flex items-start gap-2.5 py-1.5">
                <span className="mt-2 size-1.5 shrink-0 rounded-full bg-primary/50" />
                <Scalar value={item} className="text-[15px]" />
              </div>
            )}
          </Fragment>
        ))}
      </div>
    );
  }

  // A nested map — recurse so no key is lost.
  return (
    <div className="space-y-1">
      {visibleEntries(value as object).map(([k, v]) => (
        <ObjectEntry key={k} label={k} value={v} />
      ))}
    </div>
  );
}
