/**
 * Amharic speech recognition for the web app.
 *
 * The ladder, in order, is:
 *   1. record the mic and POST the bytes to `/api/speech/recognize`, which
 *      runs real `am-ET` recognition on the configured provider
 *   2. the browser's own Web Speech API, if it happens to have an am-ET model
 *      (in practice almost nothing does — this is a bonus, not the plan)
 *   3. the typed self-check, which runs through the exact same server-side
 *      Levenshtein scorer, so the learner still gets a real score
 *
 * Codec note: Azure's short-audio REST endpoint accepts WAV/PCM and OGG-Opus
 * but not WebM, so we ask MediaRecorder for OGG-Opus first and only fall back
 * to WebM. This ordering has NOT been confirmed against a live key — there is
 * no provider key configured yet — so treat it as the documented intent.
 */

export type RecognizeFailure = "no_mic" | "no_recognizer" | "empty" | "failed";

export type RecognizeOutcome =
  | { ok: true; transcript: string; confidence: number | null; provider: string }
  | { ok: false; reason: RecognizeFailure; message: string };

/** Ordered by what the server's providers can actually decode. */
const PREFERRED_MIME_TYPES = [
  "audio/ogg;codecs=opus",
  "audio/ogg",
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
];

export function micSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof navigator !== "undefined" &&
    Boolean(navigator.mediaDevices?.getUserMedia) &&
    typeof MediaRecorder !== "undefined"
  );
}

function bestMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return PREFERRED_MIME_TYPES.find((type) => {
    try {
      return MediaRecorder.isTypeSupported(type);
    } catch {
      return false;
    }
  });
}

export type Recorder = {
  /** Stops the take and resolves with the recorded audio. */
  stop: () => Promise<Blob>;
  /** Aborts without producing audio and releases the mic. */
  cancel: () => void;
};

/**
 * Opens the mic and starts a take. Rejects when permission is refused, so the
 * caller can drop straight to the typed self-check.
 */
export async function startRecording(): Promise<Recorder> {
  if (!micSupported()) throw new Error("no_mic");

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mimeType = bestMimeType();
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks: BlobPart[] = [];

  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };
  recorder.start();

  const release = () => {
    for (const track of stream.getTracks()) track.stop();
  };

  return {
    stop: () =>
      new Promise<Blob>((resolve) => {
        recorder.onstop = () => {
          release();
          resolve(new Blob(chunks, { type: mimeType ?? "audio/webm" }));
        };
        if (recorder.state === "inactive") {
          release();
          resolve(new Blob(chunks, { type: mimeType ?? "audio/webm" }));
        } else {
          recorder.stop();
        }
      }),
    cancel: () => {
      try {
        if (recorder.state !== "inactive") recorder.stop();
      } catch {
        // Already stopped — releasing the tracks is what matters.
      }
      release();
    },
  };
}

/** Sends recorded audio to the server recognizer. */
export async function recognizeBlob(blob: Blob, expected?: string): Promise<RecognizeOutcome> {
  if (blob.size === 0) {
    return { ok: false, reason: "empty", message: "Nothing was recorded — try again." };
  }

  const params = new URLSearchParams();
  if (expected) params.set("expected", expected);
  const query = params.toString();

  try {
    const response = await fetch(`/api/speech/recognize${query ? `?${query}` : ""}`, {
      method: "POST",
      headers: { "Content-Type": blob.type || "audio/webm" },
      body: blob,
    });

    if (response.status === 503) {
      return {
        ok: false,
        reason: "no_recognizer",
        message:
          "No Amharic recognizer is configured on the server yet. Type what you said instead — it is scored the same way.",
      };
    }
    if (!response.ok) {
      return { ok: false, reason: "failed", message: "Recognition failed. Try again." };
    }

    const body = (await response.json()) as {
      transcript?: string;
      confidence?: number | null;
      provider?: string;
    };
    const transcript = (body.transcript ?? "").trim();
    if (!transcript) {
      return {
        ok: false,
        reason: "empty",
        message: "Nothing was picked up — try again a little louder.",
      };
    }

    return {
      ok: true,
      transcript,
      confidence: body.confidence ?? null,
      provider: body.provider ?? "server",
    };
  } catch {
    return { ok: false, reason: "failed", message: "Could not reach the recognizer." };
  }
}

/** Convenience: record for `ms`, then recognize. Used by the one-tap SPEAK stage. */
export async function recordAndRecognize(
  ms: number,
  expected?: string,
): Promise<RecognizeOutcome> {
  let recorder: Recorder;
  try {
    recorder = await startRecording();
  } catch {
    return {
      ok: false,
      reason: "no_mic",
      message: "Microphone access was blocked. Type what you said instead.",
    };
  }
  await new Promise((resolve) => setTimeout(resolve, ms));
  const blob = await recorder.stop();
  return recognizeBlob(blob, expected);
}

/* ------------------------------------------------------------------ *
 * Browser Web Speech API — the optional middle rung of the ladder.
 * ------------------------------------------------------------------ */

type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
};

type RecognitionCtor = new () => SpeechRecognitionLike;

function ctor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function recognitionSupported(): boolean {
  return ctor() !== null;
}

/**
 * Listens once and resolves with the transcript.
 * Returns a `stop` handle so the UI can end the take early.
 */
export function listenOnce(options: {
  lang?: string;
  onResult: (transcript: string) => void;
  onError: (message: string) => void;
  onEnd: () => void;
}): { stop: () => void } {
  const Ctor = ctor();
  if (!Ctor) {
    options.onError("Speech recognition is not available in this browser.");
    options.onEnd();
    return { stop: () => {} };
  }

  const recognition = new Ctor();
  recognition.lang = options.lang ?? "am-ET";
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  recognition.continuous = false;

  recognition.onresult = (event) => {
    const transcript = event.results?.[0]?.[0]?.transcript ?? "";
    if (transcript) options.onResult(transcript);
  };
  recognition.onerror = (event) => {
    const code = event.error ?? "unknown";
    options.onError(
      code === "not-allowed"
        ? "Microphone access was blocked."
        : code === "no-speech"
          ? "Nothing was picked up — try again a little louder."
          : code === "language-not-supported"
            ? "This browser has no Amharic recognition model. Use the typed self-check instead."
            : "Recognition failed. Try again.",
    );
  };
  recognition.onend = () => options.onEnd();

  try {
    recognition.start();
  } catch {
    options.onError("Could not start the microphone.");
    options.onEnd();
  }

  return { stop: () => recognition.abort() };
}
