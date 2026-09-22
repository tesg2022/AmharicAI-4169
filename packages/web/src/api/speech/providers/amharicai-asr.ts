import { prepareSpeech } from "../normalize";
import type {
  ProviderStatus,
  RecognizeRequest,
  RecognizeResult,
  SpeechProvider,
  SynthesizeRequest,
  SynthesizeResult,
} from "./types";
import { SpeechProviderError } from "./types";

/**
 * AmharicAI speech recognition — the listening half of the GPU service.
 *
 * `activeRecognizer()` has always been a seam with nothing behind it: the
 * native-voice LoRA synthesizes and does not listen, so recognition returned
 * null and the speaking loop fell back to its deterministic typed self-check.
 * This is the adapter that fills the seam when an Amharic ASR endpoint exists,
 * and it is configured exactly like its synthesis sibling, so both halves can
 * live on one box:
 *
 *   POST <url><path>   body: raw audio bytes, Content-Type from the recording
 *   → { "text": "…", "confidence": 0.93 }
 *     (also accepts `transcript`, and `{ "results": [{ "text": … }] }`)
 *
 * Env:
 *   AMHARICAI_ASR_URL          required — full endpoint URL
 *   AMHARICAI_ASR_TOKEN        optional bearer token
 *   AMHARICAI_ASR_PATH         optional path appended to the URL
 *   AMHARICAI_ASR_MODEL        optional model id, sent as a query parameter
 *   AMHARICAI_ASR_TIMEOUT_MS   optional, default 30000
 *
 * Until `AMHARICAI_ASR_URL` is set this provider reports itself unconfigured
 * and every caller behaves exactly as it does today. Turning recognition on is
 * one environment variable and no code change — which is the whole reason the
 * seam was kept rather than deleted.
 */

const ENV_URL = "AMHARICAI_ASR_URL";

const config = () => ({
  url: (process.env[ENV_URL]?.trim() || "").replace(/\/+$/, ""),
  token: process.env["AMHARICAI_ASR_TOKEN"]?.trim() || "",
  path: process.env["AMHARICAI_ASR_PATH"]?.trim() || "",
  model: process.env["AMHARICAI_ASR_MODEL"]?.trim() || "",
  timeoutMs: Number(process.env["AMHARICAI_ASR_TIMEOUT_MS"]?.trim() || 30_000),
});

function status(): ProviderStatus {
  const c = config();
  return {
    id: "amharicai-asr",
    label: "AmharicAI speech recognition",
    configured: Boolean(c.url),
    missingEnv: c.url ? [] : [ENV_URL],
    // Listen-only. `activeProvider()` filters on this, so registering a
    // recognizer can never accidentally become the synthesis provider and
    // start throwing on every audio request.
    supportsSynthesis: false,
    supportsRecognition: true,
    voices: [],
    notes:
      "Amharic ASR behind AMHARICAI_ASR_URL. Used by the speaking loop and POST /v1/transcribe; when unset both fall back to the deterministic typed self-check.",
  };
}

function synthesize(_request: SynthesizeRequest): Promise<SynthesizeResult> {
  return Promise.reject(
    new SpeechProviderError(
      "The AmharicAI recognizer does not synthesize speech. Synthesis is AMHARICAI_TTS_URL.",
      "amharicai-asr",
    ),
  );
}

/**
 * Read a transcript out of whatever the endpoint answered.
 *
 * Three shapes are accepted because three are common — a bare `text`, Whisper's
 * `text`, and a `results[]` array — and an ASR container swap should not be a
 * code change. A shape that carries none of them is an error rather than an
 * empty transcript: an empty transcript scores as "you said nothing", which
 * would tell a learner who spoke perfectly that they failed.
 */
function transcriptOf(body: unknown): { text: string; confidence: number | null } {
  if (!body || typeof body !== "object") {
    throw new SpeechProviderError(
      "The recognizer returned a body that was not JSON.",
      "amharicai-asr",
    );
  }
  const b = body as {
    text?: string;
    transcript?: string;
    confidence?: number;
    results?: { text?: string; transcript?: string; confidence?: number }[];
  };
  const first = b.results?.[0];
  const text = (b.text ?? b.transcript ?? first?.text ?? first?.transcript ?? "").trim();
  if (!text) {
    throw new SpeechProviderError(
      "The recognizer returned no transcript.",
      "amharicai-asr",
    );
  }
  const confidence = b.confidence ?? first?.confidence ?? null;
  return { text, confidence: typeof confidence === "number" ? confidence : null };
}

async function recognize(request: RecognizeRequest): Promise<RecognizeResult> {
  const c = config();
  if (!c.url) {
    throw new SpeechProviderError(
      `AmharicAI recognition is not configured. Set ${ENV_URL}.`,
      "amharicai-asr",
    );
  }

  const url = new URL(`${c.url}${c.path}`);
  if (c.model) url.searchParams.set("model", c.model);
  /**
   * The expected phrase is passed through normalization before being sent as a
   * decoding hint. Sending the raw lesson string would hand the recognizer
   * punctuation and digits the model never saw in training, and the same
   * pipeline runs on the synthesis side, so a hint and the audio it is a hint
   * for are shaped identically.
   */
  if (request.expected) {
    url.searchParams.set("hint", prepareSpeech(request.expected, { mode: "native" }).normalized);
  }
  url.searchParams.set("language", "am");

  /**
   * The recording is wrapped in a Blob rather than posted as a bare
   * `Uint8Array`. Both are legal request bodies at runtime, but the Blob
   * carries its own content type, so the recording's format travels with the
   * bytes instead of depending on a header a proxy is free to rewrite.
   *
   * `slice()` is a copy, and a deliberate one: it narrows the view to exactly
   * the bytes this request owns, so a caller that hands us a window into a
   * larger (or shared) buffer cannot leak the rest of it upstream. A take is
   * a few seconds of speech, so the copy is cheap.
   */
  const body = new Blob([request.audio.slice()], { type: request.mimeType });

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": request.mimeType,
      ...(c.token ? { Authorization: `Bearer ${c.token}` } : {}),
    },
    body,
    signal: AbortSignal.timeout(c.timeoutMs),
  }).catch((error: unknown) => {
    throw new SpeechProviderError(
      `The recognizer did not respond (${error instanceof Error ? error.message : "unknown"}).`,
      "amharicai-asr",
    );
  });

  if (!response.ok) {
    throw new SpeechProviderError(
      `The recognizer answered HTTP ${response.status}.`,
      "amharicai-asr",
    );
  }

  const { text, confidence } = transcriptOf(await response.json().catch(() => null));
  return { transcript: text, confidence, provider: "amharicai-asr" };
}

export const amharicaiRecognizer: SpeechProvider = {
  id: "amharicai-asr",
  label: "AmharicAI speech recognition",
  dialect: "plain",
  voices: [],
  defaultVoice: null,
  secondVoice: null,
  status,
  synthesize,
  recognize,
};
