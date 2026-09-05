/**
 * Fidel (ፊደል) analysis and normalization.
 *
 * This is the first stage of the Amharic speech pipeline. Its job is to turn
 * whatever text the course data or the LLM tutor produced into a canonical
 * Amharic string that a native `am-ET` voice can read correctly — *without*
 * ever converting Amharic into Latin phonetics, which is precisely the failure
 * this pipeline exists to eliminate.
 *
 * Nothing here is provider-specific: the output feeds Azure, Google or Addis AI
 * equally.
 */

/** Ethiopic syllabary block, plus the supplement/extended blocks. */
const ETHIOPIC = /[ሀ-፿ᎀ-᎟ⶀ-⷟꬀-꬯]/;

export function isAmharic(text: string): boolean {
  return ETHIOPIC.test(text);
}

/** Proportion of a string that is Ethiopic script, ignoring spaces/punctuation. */
export function amharicRatio(text: string): number {
  const letters = [...text].filter((c) => /\S/.test(c) && !/[\p{P}\p{S}\d]/u.test(c));
  if (!letters.length) return 0;
  return letters.filter((c) => ETHIOPIC.test(c)).length / letters.length;
}

/**
 * Amharic homophones — distinct Fidel characters that modern spoken Amharic
 * pronounces identically. Folding them is essential for *comparison* (scoring a
 * learner's answer) but must never be applied to text shown to a learner, since
 * the spelling itself is part of what is being taught.
 */
const HOMOPHONE_FOLD: Record<string, string> = {};

function addFold(variants: string[][]) {
  for (const row of variants) {
    const canonical = row[0];
    for (const v of row) HOMOPHONE_FOLD[v] = canonical;
  }
}

// h-series: ሀ / ሐ / ኀ orders all collapse to the ሀ order.
addFold([
  ["ሀ", "ሐ", "ኀ"],
  ["ሁ", "ሑ", "ኁ"],
  ["ሂ", "ሒ", "ኂ"],
  ["ሃ", "ሓ", "ኃ"],
  ["ሄ", "ሔ", "ኄ"],
  ["ህ", "ሕ", "ኅ"],
  ["ሆ", "ሖ", "ኆ"],
]);
// s-series: ሠ collapses to ሰ.
addFold([
  ["ሰ", "ሠ"],
  ["ሱ", "ሡ"],
  ["ሲ", "ሢ"],
  ["ሳ", "ሣ"],
  ["ሴ", "ሤ"],
  ["ስ", "ሥ"],
  ["ሶ", "ሦ"],
]);
// ts'-series: ፀ collapses to ጸ.
addFold([
  ["ጸ", "ፀ"],
  ["ጹ", "ፁ"],
  ["ጺ", "ፂ"],
  ["ጻ", "ፃ"],
  ["ጼ", "ፄ"],
  ["ጽ", "ፅ"],
  ["ጾ", "ፆ"],
]);
// glottal series: ዐ collapses to አ.
addFold([
  ["አ", "ዐ"],
  ["ኡ", "ዑ"],
  ["ኢ", "ዒ"],
  ["ኣ", "ዓ"],
  ["ኤ", "ዔ"],
  ["እ", "ዕ"],
  ["ኦ", "ዖ"],
]);

/**
 * Fold homophonous Fidel to a canonical form. Use for matching and scoring
 * only — never for display, and never for TTS input (a native voice reads the
 * original spelling correctly on its own).
 */
export function foldHomophones(text: string): string {
  return [...text].map((c) => HOMOPHONE_FOLD[c] ?? c).join("");
}

/** The Ethiopic wordspace `፡` is archaic in running text; modern usage is a space. */
export function modernizeWordspace(text: string): string {
  return text.replace(/፡/g, " ");
}

/**
 * Normalize Amharic text for synthesis.
 *
 * Deliberately conservative: it repairs encoding and spacing problems that make
 * a neural voice stumble, but never rewrites the spelling of a word, because
 * the spelling is the lesson content.
 */
export function normalizeForSpeech(text: string): string {
  return (
    modernizeWordspace(text)
      .normalize("NFC")
      // Latin punctuation that Amharic text often arrives with.
      .replace(/ /g, " ")
      .replace(/[​-‍﻿]/g, "")
      // Collapse repeated Ethiopic full stops, keep a single one.
      .replace(/።\s*።+/g, "።")
      .replace(/[ \t]+/g, " ")
      .replace(/ ?\n ?/g, "\n")
      .trim()
  );
}

/**
 * Ejective consonants — the sounds that make Amharic sound Amharic, and the
 * ones an English-style phonetic rendering destroys. Kept here so the speech
 * layer and the pronunciation curriculum agree on a single list.
 */
export const EJECTIVE_BASES = ["ጠ", "ቀ", "ጰ", "ጸ", "ጨ"] as const;

const EJECTIVE_RANGES: [number, number][] = [
  [0x1320, 0x1327], // ጠ order
  [0x1240, 0x1247], // ቀ order
  [0x1330, 0x1337], // ጰ order
  [0x1338, 0x133f], // ጸ order
  [0x1328, 0x132f], // ጨ order
];

export function isEjective(char: string): boolean {
  const code = char.codePointAt(0);
  if (code === undefined) return false;
  return EJECTIVE_RANGES.some(([lo, hi]) => code >= lo && code <= hi);
}

/** Count ejectives in a string — used to flag phrases worth extra drill time. */
export function countEjectives(text: string): number {
  return [...text].filter(isEjective).length;
}

/**
 * A Fidel character decomposes into a consonant family and one of seven vowel
 * orders. The Ethiopic block is laid out in rows of eight, so the order is the
 * offset within the row (the 8th slot is the labiovelar variant, not an order).
 */
export type FidelAnalysis = {
  char: string;
  /** 1-7 for the seven vowel orders, or null when the char is not a syllable. */
  order: number | null;
  /** First character of the consonant family (the 1st-order form). */
  family: string | null;
  isEjective: boolean;
};

export function analyzeFidel(char: string): FidelAnalysis {
  const code = char.codePointAt(0);
  if (code === undefined || !ETHIOPIC.test(char)) {
    return { char, order: null, family: null, isEjective: false };
  }
  // Syllable rows live in 0x1200-0x135A, eight slots per family.
  if (code < 0x1200 || code > 0x135a) {
    return { char, order: null, family: null, isEjective: isEjective(char) };
  }
  const offset = (code - 0x1200) % 8;
  const base = code - offset;
  return {
    char,
    order: offset < 7 ? offset + 1 : null,
    family: String.fromCodePoint(base),
    isEjective: isEjective(char),
  };
}

/** The seven-order family for a Fidel character, e.g. ለ → ለ ሉ ሊ ላ ሌ ል ሎ. */
export function fidelFamily(char: string): string[] {
  const { family } = analyzeFidel(char);
  if (!family) return [];
  const base = family.codePointAt(0)!;
  return Array.from({ length: 7 }, (_, i) => String.fromCodePoint(base + i));
}
