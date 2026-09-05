/**
 * SSML generation.
 *
 * The point of this stage is that a neural `am-ET` voice handed a bare string
 * reads it flat and fast. Wrapping the same text in explicit prosody — a rate,
 * a pitch contour per utterance type, and real breaks at Amharic punctuation —
 * is what makes the difference between "a machine reading fidel" and speech.
 *
 * Providers differ in how much SSML they honour, so the shape is decided here
 * and each adapter chooses whether to send SSML or plain text.
 */

import { clausePauses, type Segment, segment } from "./segment";

/** How a line should be spoken. */
export const VOICE_MODES = ["native", "slow", "syllable"] as const;
export type VoiceMode = (typeof VOICE_MODES)[number];

export type ProsodySettings = {
  /** Multiplier on the voice's natural rate. 1 = native pace. */
  rate: number;
  /** Semitone offset applied to the whole utterance. */
  pitchSemitones: number;
  /** Multiplier applied to every planned pause. */
  pauseScale: number;
};

export const MODE_PROSODY: Record<VoiceMode, ProsodySettings> = {
  /** Full speed, as a native speaker would say it. */
  native: { rate: 1, pitchSemitones: 0, pauseScale: 1 },
  /**
   * Learner pace. 0.7 is deliberate: below roughly 0.65 neural voices start
   * smearing the ejectives (ጠ ቀ ጰ ጸ ጨ) into their plain counterparts, which
   * teaches the wrong contrast.
   */
  slow: { rate: 0.7, pitchSemitones: 0, pauseScale: 1.6 },
  /** Syllable-by-syllable, for drilling a single word's fidel. */
  syllable: { rate: 0.6, pitchSemitones: 0, pauseScale: 2.2 },
};

export function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Pitch contour per utterance type, expressed as an SSML-safe percentage. */
function contour(seg: Segment): string | null {
  switch (seg.intonation) {
    // Amharic yes/no questions rise on the final syllable.
    case "question":
      return '<prosody pitch="+8%" range="+12%">';
    case "exclamation":
      return '<prosody pitch="+4%" volume="+2dB">';
    default:
      return null;
  }
}

function renderSegment(seg: Segment, mode: VoiceMode): string {
  const p = MODE_PROSODY[mode];
  const open = contour(seg);

  // Intra-sentence breath points. Without these, long sentences arrive as one
  // unbroken rush no matter what the rate is.
  const clauses = clausePauses(seg.text);
  const body = clauses
    .map((c, i) => {
      const pause = Math.round(c.pauseMs * p.pauseScale);
      const text = escapeXml(c.text);
      const isLast = i === clauses.length - 1;
      return pause > 0 && !isLast ? `${text}<break time="${pause}ms"/>` : text;
    })
    .join(" ");

  const inner = open ? `${open}${body}</prosody>` : body;
  const after = Math.round(seg.pauseMs * p.pauseScale);

  return `${inner}<break time="${after}ms"/>`;
}

export type SsmlOptions = {
  voice: string;
  mode?: VoiceMode;
  /** BCP-47 locale. Always `am-ET` for Amharic content. */
  locale?: string;
};

/**
 * Microsoft/Azure-flavoured SSML — the most complete dialect, and the one the
 * `am-ET-MekdesNeural` / `am-ET-AmehaNeural` voices are served through.
 */
export function toAzureSsml(text: string, options: SsmlOptions): string {
  const mode = options.mode ?? "native";
  const locale = options.locale ?? "am-ET";
  const p = MODE_PROSODY[mode];
  const segments = segment(text);

  const spoken =
    segments.length > 0
      ? segments.map((s) => renderSegment(s, mode)).join("")
      : escapeXml(text);

  const pitch =
    p.pitchSemitones === 0
      ? ""
      : ` pitch="${p.pitchSemitones > 0 ? "+" : ""}${p.pitchSemitones}st"`;

  return [
    `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${locale}">`,
    `<voice name="${escapeXml(options.voice)}">`,
    `<prosody rate="${p.rate}"${pitch}>`,
    spoken,
    `</prosody></voice></speak>`,
  ].join("");
}

/**
 * Google Cloud TTS SSML. Google rejects `range` on `<prosody>` and wants rate
 * as a percentage string, so the contour is expressed with pitch alone.
 */
export function toGoogleSsml(text: string, options: SsmlOptions): string {
  const mode = options.mode ?? "native";
  const p = MODE_PROSODY[mode];
  const segments = segment(text);

  const spoken = segments
    .map((seg) => {
      const clauses = clausePauses(seg.text);
      const body = clauses
        .map((c, i) => {
          const pause = Math.round(c.pauseMs * p.pauseScale);
          const isLast = i === clauses.length - 1;
          const t = escapeXml(c.text);
          return pause > 0 && !isLast ? `${t}<break time="${pause}ms"/>` : t;
        })
        .join(" ");
      const wrapped =
        seg.intonation === "question" ? `<prosody pitch="+2st">${body}</prosody>` : body;
      return `${wrapped}<break time="${Math.round(seg.pauseMs * p.pauseScale)}ms"/>`;
    })
    .join("");

  const rate = `${Math.round(p.rate * 100)}%`;
  return `<speak><prosody rate="${rate}">${spoken || escapeXml(text)}</prosody></speak>`;
}

/**
 * Plain-text rendering for providers with no SSML support. Punctuation is kept
 * (engines do use it for pausing) and the mode is carried out-of-band as a
 * numeric rate by the adapter.
 */
export function toPlainSpeech(text: string): string {
  const segments = segment(text);
  if (segments.length === 0) return text;
  return segments.map((s) => `${s.text}${s.terminator || "።"}`).join(" ");
}
