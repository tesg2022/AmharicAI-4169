/**
 * The text-processing stage that runs before any voice is asked to speak.
 *
 * Order matters and is deliberate:
 *   1. repair encoding/spacing (`normalizeForSpeech`) — never spelling
 *   2. verbalize numbers, times, dates, percentages into Amharic words
 *   3. segment into utterances and plan prosody
 *   4. render SSML for the chosen provider dialect
 *
 * Steps 1-3 are pure and provider-independent, which is why they are testable
 * with no API key at all.
 */

import { amharicRatio, isAmharic, normalizeForSpeech } from "./fidel";
import { expandNumbers } from "./numbers";
import { segment, type Segment } from "./segment";
import {
  toAzureSsml,
  toGoogleSsml,
  toPlainSpeech,
  type VoiceMode,
} from "./ssml";

export type SsmlDialect = "azure" | "google" | "plain";

export type PreparedSpeech = {
  /** The original input, untouched — kept for display and cache provenance. */
  raw: string;
  /** Cleaned, number-expanded text. This is what is actually spoken. */
  normalized: string;
  segments: Segment[];
  /** Proportion of Ethiopic characters, 0-1. */
  amharicRatio: number;
  /** False when the text is Latin — the caller must not send it to an am-ET voice. */
  isAmharic: boolean;
  mode: VoiceMode;
};

/**
 * Runs the pure pipeline. No network, no provider, no key.
 */
export function prepareSpeech(
  raw: string,
  options: { mode?: VoiceMode } = {},
): PreparedSpeech {
  const cleaned = normalizeForSpeech(raw);
  const normalized = expandNumbers(cleaned);

  return {
    raw,
    normalized,
    segments: segment(normalized),
    amharicRatio: amharicRatio(normalized),
    isAmharic: isAmharic(normalized),
    mode: options.mode ?? "native",
  };
}

/** Renders prepared text into the markup a specific provider dialect wants. */
export function renderSpeech(
  prepared: PreparedSpeech,
  dialect: SsmlDialect,
  voice: string,
): string {
  switch (dialect) {
    case "azure":
      return toAzureSsml(prepared.normalized, { voice, mode: prepared.mode });
    case "google":
      return toGoogleSsml(prepared.normalized, { voice, mode: prepared.mode });
    case "plain":
      return toPlainSpeech(prepared.normalized);
  }
}

/**
 * Rough spoken duration, used to decide whether a synthesis request is worth
 * caching and to size the client's playback progress bar before audio arrives.
 * Amharic averages close to 4.5 syllables/second at native pace; one fidel is
 * one syllable, which makes the character count a decent proxy.
 */
export function estimateDurationMs(prepared: PreparedSpeech): number {
  const syllables = [...prepared.normalized].filter((c) => {
    const cp = c.codePointAt(0) ?? 0;
    return cp >= 0x1200 && cp <= 0x135a;
  }).length;
  const latinWords = prepared.normalized.split(/\s+/).filter((w) => /[A-Za-z]/.test(w)).length;

  const rateFactor = prepared.mode === "native" ? 1 : prepared.mode === "slow" ? 1.45 : 1.8;
  const speech = (syllables / 4.5 + latinWords / 2.5) * 1000 * rateFactor;
  const pauses = prepared.segments.reduce((sum, s) => sum + s.pauseMs, 0);

  return Math.round(speech + pauses);
}
