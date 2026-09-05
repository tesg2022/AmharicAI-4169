/**
 * Addis AI adapter — an Ethiopia-based provider specialising in Amharic
 * speech, as opposed to the two hyperscalers where Amharic is one locale
 * among four hundred.
 *
 * Honest caveat, kept in code rather than buried in a doc: the request shape
 * below follows their published REST convention, but it has not been executed
 * against a live key from this sandbox. Everything is therefore driven by env
 * so the endpoint, model and field names can be corrected without a rebuild:
 *
 *   ADDIS_AI_API_KEY       required
 *   ADDIS_AI_BASE_URL      default https://api.addisassistant.com/v1
 *   ADDIS_AI_TTS_PATH      default /audio/speech
 *   ADDIS_AI_STT_PATH      default /audio/transcriptions
 *   ADDIS_AI_VOICE         default voice id
 *   ADDIS_AI_VOICE_ALT     second speaker for dialogue mode
 */

import { estimateDurationMs, prepareSpeech, renderSpeech } from "../normalize";
import type {
  ProviderStatus,
  RecognizeRequest,
  RecognizeResult,
  SpeechProvider,
  SpeechVoice,
  SynthesizeRequest,
  SynthesizeResult,
} from "./types";
import { SpeechProviderError } from "./types";

const ENV_KEY = "ADDIS_AI_API_KEY";

const config = () => ({
  key: process.env[ENV_KEY]?.trim() || "",
  baseUrl: (process.env.ADDIS_AI_BASE_URL?.trim() || "https://api.addisassistant.com/v1").replace(
    /\/+$/,
    "",
  ),
  ttsPath: process.env.ADDIS_AI_TTS_PATH?.trim() || "/audio/speech",
  sttPath: process.env.ADDIS_AI_STT_PATH?.trim() || "/audio/transcriptions",
  voice: process.env.ADDIS_AI_VOICE?.trim() || "amharic-female",
  voiceAlt: process.env.ADDIS_AI_VOICE_ALT?.trim() || "amharic-male",
});

function voices(): SpeechVoice[] {
  const c = config();
  return [
    { id: c.voice, label: "Addis AI — female", gender: "female", locale: "am-ET" },
    { id: c.voiceAlt, label: "Addis AI — male", gender: "male", locale: "am-ET" },
  ];
}

function status(): ProviderStatus {
  const c = config();
  return {
    id: "addis",
    label: "Addis AI",
    configured: Boolean(c.key),
    missingEnv: c.key ? [] : [ENV_KEY],
    supportsSynthesis: true,
    supportsRecognition: true,
    voices: voices(),
    notes:
      "Amharic-specialist provider. Endpoint paths and voice ids are env-configurable because the request shape has not been verified against a live key.",
  };
}

async function synthesize(request: SynthesizeRequest): Promise<SynthesizeResult> {
  const c = config();
  if (!c.key) {
    throw new SpeechProviderError(`Addis AI is not configured. Set ${ENV_KEY}.`, "addis");
  }

  const voice = request.voice ?? c.voice;
  const prepared = prepareSpeech(request.text, { mode: request.mode });
  // No SSML dialect is documented, so the plain rendering is sent and the
  // learner pace is carried out-of-band as a numeric rate.
  const input = renderSpeech(prepared, "plain", voice);
  const rate = prepared.mode === "native" ? 1 : prepared.mode === "slow" ? 0.7 : 0.6;

  const response = await fetch(`${c.baseUrl}${c.ttsPath}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${c.key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ input, voice, language: "am", speed: rate, format: "mp3" }),
  });

  if (!response.ok) {
    throw new SpeechProviderError(
      `Addis AI synthesis failed (${response.status}): ${await response.text().catch(() => "")}`.trim(),
      "addis",
    );
  }

  const contentType = response.headers.get("content-type") ?? "";
  let audio: Uint8Array;

  if (contentType.includes("application/json")) {
    const body = (await response.json()) as { audio?: string; audioContent?: string };
    const b64 = body.audio ?? body.audioContent;
    if (!b64) throw new SpeechProviderError("Addis AI returned no audio.", "addis");
    audio = Uint8Array.from(Buffer.from(b64, "base64"));
  } else {
    audio = new Uint8Array(await response.arrayBuffer());
  }

  return {
    audio,
    mimeType: "audio/mpeg",
    provider: "addis",
    voice,
    mode: prepared.mode,
    normalized: prepared.normalized,
    estimatedMs: estimateDurationMs(prepared),
  };
}

async function recognize(request: RecognizeRequest): Promise<RecognizeResult> {
  const c = config();
  if (!c.key) {
    throw new SpeechProviderError(`Addis AI is not configured. Set ${ENV_KEY}.`, "addis");
  }

  const form = new FormData();
  form.append("file", new Blob([request.audio as BlobPart], { type: request.mimeType }), "take.webm");
  form.append("language", "am");
  if (request.expected) form.append("prompt", request.expected);

  const response = await fetch(`${c.baseUrl}${c.sttPath}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${c.key}` },
    body: form,
  });

  if (!response.ok) {
    throw new SpeechProviderError(`Addis AI recognition failed (${response.status}).`, "addis");
  }

  const body = (await response.json()) as { text?: string; transcript?: string; confidence?: number };

  return {
    transcript: (body.text ?? body.transcript ?? "").trim(),
    confidence: typeof body.confidence === "number" ? body.confidence : null,
    provider: "addis",
  };
}

export const addisProvider: SpeechProvider = {
  id: "addis",
  label: "Addis AI",
  dialect: "plain",
  get voices() {
    return voices();
  },
  get defaultVoice() {
    return config().voice;
  },
  get secondVoice() {
    return config().voiceAlt;
  },
  status,
  synthesize,
  recognize,
};
