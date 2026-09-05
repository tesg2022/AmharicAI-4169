/**
 * Google Cloud Text-to-Speech / Speech-to-Text adapter.
 *
 * Google lists `am-ET` in two generations: the older `am-ET-Standard-A/B`
 * voices and the newer Gemini-TTS `am-ET` voices, which are still marked
 * preview. Preview voices are flagged so the UI can say so rather than
 * quietly serving a voice that may change or disappear.
 *
 * Google's SSML is narrower than Azure's — no `range` on `<prosody>` — so the
 * `google` dialect drops the contour width and keeps pitch and breaks.
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

const VOICES: SpeechVoice[] = [
  { id: "am-ET-Standard-A", label: "Standard A", gender: "female", locale: "am-ET" },
  { id: "am-ET-Standard-B", label: "Standard B", gender: "male", locale: "am-ET" },
  {
    id: "am-ET-Chirp3-HD-Achernar",
    label: "Gemini-TTS Achernar (preview)",
    gender: "female",
    locale: "am-ET",
    preview: true,
  },
  {
    id: "am-ET-Chirp3-HD-Algenib",
    label: "Gemini-TTS Algenib (preview)",
    gender: "male",
    locale: "am-ET",
    preview: true,
  },
];

const ENV_KEY = "GOOGLE_SPEECH_API_KEY";

function apiKey(): string {
  return process.env[ENV_KEY]?.trim() || "";
}

function missingEnv(): string[] {
  return apiKey() ? [] : [ENV_KEY];
}

function status(): ProviderStatus {
  const missing = missingEnv();
  return {
    id: "google",
    label: "Google Cloud Speech",
    configured: missing.length === 0,
    missingEnv: missing,
    supportsSynthesis: true,
    supportsRecognition: true,
    voices: VOICES,
    notes:
      "am-ET Standard voices plus Gemini-TTS am-ET in preview. Narrower SSML than Azure: pitch and breaks are honoured, contour width is not.",
  };
}

async function synthesize(request: SynthesizeRequest): Promise<SynthesizeResult> {
  const key = apiKey();
  if (!key) {
    throw new SpeechProviderError(`Google is not configured. Set ${ENV_KEY}.`, "google");
  }

  const voice = request.voice ?? VOICES[0]!.id;
  const prepared = prepareSpeech(request.text, { mode: request.mode });
  const ssml = renderSpeech(prepared, "google", voice);

  const response = await fetch(
    `https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(key)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input: { ssml },
        voice: { languageCode: "am-ET", name: voice },
        audioConfig: { audioEncoding: "MP3", sampleRateHertz: 24000 },
      }),
    },
  );

  if (!response.ok) {
    throw new SpeechProviderError(
      `Google synthesis failed (${response.status}): ${await response.text().catch(() => "")}`.trim(),
      "google",
    );
  }

  const body = (await response.json()) as { audioContent?: string };
  if (!body.audioContent) {
    throw new SpeechProviderError("Google returned no audio.", "google");
  }

  return {
    audio: Uint8Array.from(Buffer.from(body.audioContent, "base64")),
    mimeType: "audio/mpeg",
    provider: "google",
    voice,
    mode: prepared.mode,
    normalized: prepared.normalized,
    estimatedMs: estimateDurationMs(prepared),
  };
}

async function recognize(request: RecognizeRequest): Promise<RecognizeResult> {
  const key = apiKey();
  if (!key) {
    throw new SpeechProviderError(`Google is not configured. Set ${ENV_KEY}.`, "google");
  }

  const encoding = request.mimeType.includes("webm")
    ? "WEBM_OPUS"
    : request.mimeType.includes("ogg")
      ? "OGG_OPUS"
      : request.mimeType.includes("wav") || request.mimeType.includes("x-wav")
        ? "LINEAR16"
        : "ENCODING_UNSPECIFIED";

  const response = await fetch(
    `https://speech.googleapis.com/v1/speech:recognize?key=${encodeURIComponent(key)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        config: {
          languageCode: "am-ET",
          encoding,
          enableAutomaticPunctuation: true,
          // The expected phrase biases the model, which matters a lot for
          // single vocabulary words with no surrounding context.
          speechContexts: request.expected ? [{ phrases: [request.expected] }] : undefined,
        },
        audio: { content: Buffer.from(request.audio).toString("base64") },
      }),
    },
  );

  if (!response.ok) {
    throw new SpeechProviderError(`Google recognition failed (${response.status}).`, "google");
  }

  const body = (await response.json()) as {
    results?: { alternatives?: { transcript?: string; confidence?: number }[] }[];
  };
  const best = body.results?.[0]?.alternatives?.[0];

  return {
    transcript: best?.transcript?.trim() ?? "",
    confidence: typeof best?.confidence === "number" ? best.confidence : null,
    provider: "google",
  };
}

export const googleProvider: SpeechProvider = {
  id: "google",
  label: "Google Cloud Speech",
  dialect: "google",
  voices: VOICES,
  defaultVoice: VOICES[0]!.id,
  secondVoice: VOICES[1]!.id,
  status,
  synthesize,
  recognize,
};
