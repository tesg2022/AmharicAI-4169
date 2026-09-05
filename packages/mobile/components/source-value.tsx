import { Fragment } from "react";
import { View } from "react-native";
import { FontSize, Radius } from "@/constants/theme";
import { useColors } from "@/hooks/use-colors";
import { Am, Body, SpeakButton, Translit } from "@/components/ui";

/**
 * Generic renderer for the source material kept verbatim in
 * `lesson_sections.body`.
 *
 * The content policy is explicit: nothing from the source may be dropped or
 * reshaped. Sections therefore arrive as `{ key, value, source_pages }` where
 * `value` can be a string, a number, a list of strings, a list of tuples
 * (Amharic / transliteration / English), a list of objects, or a nested map.
 * Every one of those shapes has to render as *something* readable — an unknown
 * shape degrades to a labelled key/value block rather than disappearing.
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

/** One scalar cell — Amharic gets the Ethiopic face, everything else doesn't. */
function Scalar({
  value,
  size = FontSize.body,
  bold,
  color,
}: {
  value: unknown;
  size?: number;
  bold?: boolean;
  color?: string;
}) {
  const text = value === null || value === undefined ? "—" : String(value);
  if (isAmharic(text)) {
    return (
      <Am size={size + 2} bold={bold} color={color}>
        {text}
      </Am>
    );
  }
  return (
    <Body size={size} medium={bold} color={color}>
      {text}
    </Body>
  );
}

/**
 * A tuple row such as `["እኔ", "ïne", "I"]`. The source is consistent enough
 * that the first Ethiopic cell is the term, a following Latin cell is its
 * transliteration and the rest is the gloss — but the renderer never assumes
 * the arity, so 2-, 3- and 4-cell rows all survive.
 */
function TupleRow({ cells }: { cells: unknown[] }) {
  const colors = useColors();
  const amharicIndex = cells.findIndex((c) => isAmharic(c));
  const amharic = amharicIndex >= 0 ? String(cells[amharicIndex]) : null;
  const rest = cells.filter((_, i) => i !== amharicIndex);
  const translit =
    rest.length > 1 && typeof rest[0] === "string" && !isAmharic(rest[0]) ? String(rest[0]) : null;
  const gloss = (translit ? rest.slice(1) : rest).filter(
    (c) => c !== null && c !== undefined && String(c).length > 0,
  );

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingVertical: 8,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
      }}
    >
      <View style={{ flex: 1, gap: 1 }}>
        {amharic ? <Am size={FontSize.h3}>{amharic}</Am> : null}
        {translit ? <Translit>{translit}</Translit> : null}
        {gloss.length ? (
          <Body size={FontSize.small} color={colors.mutedForeground}>
            {gloss.map((g) => String(g)).join(" · ")}
          </Body>
        ) : null}
        {!amharic && !translit && !gloss.length ? <Scalar value={cells[0]} /> : null}
      </View>
      {amharic ? <SpeakButton amharic={amharic} transliteration={translit} size={32} /> : null}
    </View>
  );
}

/** An object entry rendered as `Label — value`, recursing for nested shapes. */
function ObjectEntry({ label, value }: { label: string; value: unknown }) {
  const colors = useColors();
  const nested = value !== null && typeof value === "object";

  if (nested) {
    return (
      <View style={{ gap: 6, paddingVertical: 6 }}>
        <Body size={FontSize.caption} medium color={colors.mutedForeground}>
          {humanize(label).toUpperCase()}
        </Body>
        <SourceValue value={value} />
      </View>
    );
  }

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 12,
        paddingVertical: 6,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
      }}
    >
      <Body size={FontSize.small} medium color={colors.mutedForeground} style={{ flex: 1 }}>
        {humanize(label)}
      </Body>
      <View style={{ flex: 1.4, alignItems: "flex-start" }}>
        <Scalar value={value} size={FontSize.small} />
      </View>
    </View>
  );
}

export function SourceValue({ value }: { value: unknown }) {
  const colors = useColors();

  if (value === null || value === undefined) return null;

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return <Scalar value={value} />;
  }

  if (Array.isArray(value)) {
    if (!value.length) return null;

    // A flat list of short Amharic strings reads best as a script grid.
    const allShortAmharic =
      value.every((v) => typeof v === "string") &&
      value.every((v) => isAmharic(v) && String(v).length <= 4);
    if (allShortAmharic) {
      return (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {(value as string[]).map((char, i) => (
            <View
              key={`${char}-${i}`}
              style={{
                minWidth: 44,
                alignItems: "center",
                paddingVertical: 8,
                paddingHorizontal: 10,
                borderRadius: Radius.card,
                backgroundColor: colors.scriptSurface,
                borderWidth: 1,
                borderColor: colors.border,
              }}
            >
              <Am size={FontSize.h2}>{char}</Am>
            </View>
          ))}
        </View>
      );
    }

    return (
      <View>
        {value.map((item, i) => (
          <Fragment key={i}>
            {Array.isArray(item) ? (
              <TupleRow cells={item} />
            ) : item !== null && typeof item === "object" ? (
              <View
                style={{
                  paddingVertical: 8,
                  borderBottomWidth: 1,
                  borderBottomColor: colors.border,
                }}
              >
                {visibleEntries(item as object).map(([k, v]) => (
                  <ObjectEntry key={k} label={k} value={v} />
                ))}
              </View>
            ) : (
              <View
                style={{
                  flexDirection: "row",
                  gap: 10,
                  alignItems: "flex-start",
                  paddingVertical: 6,
                }}
              >
                <Body color={colors.accent}>•</Body>
                <View style={{ flex: 1 }}>
                  <Scalar value={item} size={FontSize.small} />
                </View>
              </View>
            )}
          </Fragment>
        ))}
      </View>
    );
  }

  return (
    <View>
      {visibleEntries(value as object).map(([k, v]) => (
        <ObjectEntry key={k} label={k} value={v} />
      ))}
    </View>
  );
}
