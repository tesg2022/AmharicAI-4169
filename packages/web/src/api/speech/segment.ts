/**
 * Sentence segmentation and prosody planning.
 *
 * Amharic punctuation is its own system: `።` ends a sentence, `፣` is a comma,
 * `፤` a semicolon, `፥`/`፦` colons, `፧` a question mark. A TTS engine handed raw
 * text usually reads straight through these, which is what makes synthetic
 * Amharic sound like "seven isolated syllables" rather than a spoken sentence.
 *
 * This stage decides, per sentence: what kind of utterance it is, how long the
 * pause after it should be, and what intonation contour it needs.
 */

export type Intonation = "statement" | "question" | "exclamation" | "listItem";

export type Segment = {
  /** Sentence text with its terminator removed. */
  text: string;
  /** Terminator that ended it, kept so the original can be reconstructed. */
  terminator: string;
  intonation: Intonation;
  /** Pause to insert after this segment, in milliseconds. */
  pauseMs: number;
};

/** Ethiopic terminators plus the Latin ones Amharic text is often written with. */
const TERMINATORS = /([።.!?፧፨]|\.\.\.|…)/;

const PAUSE = {
  sentence: 420,
  question: 480,
  exclamation: 380,
  clause: 220,
  comma: 160,
  listItem: 260,
} as const;

function classify(text: string, terminator: string): Intonation {
  if (terminator === "?" || terminator === "፧") return "question";
  if (terminator === "!") return "exclamation";

  // Amharic yes/no and content questions frequently appear without a question
  // mark, especially in course dialogue data. These interrogatives are reliable.
  const interrogatives = [
    "ማን", "ምን", "የት", "መቼ", "እንዴት", "ስንት", "ለምን", "የትኛው", "ማንን", "ምንድን",
  ];
  const words = text.split(/\s+/);
  if (interrogatives.some((q) => words.some((w) => w.startsWith(q)))) return "question";

  return "statement";
}

/**
 * Split text into prosodic segments.
 *
 * Newlines are treated as hard breaks so that vocabulary lists and dialogue
 * turns do not run together into one breathless utterance.
 */
export function segment(text: string): Segment[] {
  const segments: Segment[] = [];

  for (const line of text.split(/\n+/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Split while keeping terminators.
    const parts = trimmed.split(TERMINATORS).filter((p) => p !== undefined);
    let buffer = "";

    for (const part of parts) {
      if (TERMINATORS.test(part) && part.length <= 3 && buffer.trim()) {
        const body = buffer.trim();
        const intonation = classify(body, part);
        segments.push({
          text: body,
          terminator: part,
          intonation,
          pauseMs:
            intonation === "question"
              ? PAUSE.question
              : intonation === "exclamation"
                ? PAUSE.exclamation
                : PAUSE.sentence,
        });
        buffer = "";
      } else {
        buffer += part;
      }
    }

    if (buffer.trim()) {
      const body = buffer.trim();
      const intonation = classify(body, "");
      // A line with no terminator is still a complete utterance (list item,
      // vocabulary entry, dialogue turn) — it just gets a shorter pause.
      segments.push({
        text: body,
        terminator: "",
        intonation: intonation === "question" ? "question" : "listItem",
        pauseMs: intonation === "question" ? PAUSE.question : PAUSE.listItem,
      });
    }
  }

  return segments;
}

/**
 * Intra-sentence pauses. `፣` and `፤` are real breath points for a native
 * speaker; marking them stops long sentences from being read as one rush.
 */
export function clausePauses(text: string): { text: string; pauseMs: number }[] {
  const out: { text: string; pauseMs: number }[] = [];
  const parts = text.split(/([፣፤፥፦,;:])/);

  let buffer = "";
  for (const part of parts) {
    if (/^[፣፤፥፦,;:]$/.test(part)) {
      const body = buffer.trim();
      if (body) {
        out.push({
          text: body,
          pauseMs: part === "፣" || part === "," ? PAUSE.comma : PAUSE.clause,
        });
      }
      buffer = "";
    } else {
      buffer += part;
    }
  }

  const tail = buffer.trim();
  if (tail) out.push({ text: tail, pauseMs: 0 });

  return out;
}
