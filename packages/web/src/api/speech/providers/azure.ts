/**
 * Azure Cognitive Services adapter.
 *
 * Azure is the reference implementation here because it is the one vendor with
 * both a neural `am-ET` voice pair and `am-ET` recognition, and because its
 * SSML dialect is the richest — the prosody plan survives intact.
 *
 * Voices: `am-ET-MekdesNeural` (female), `am-ET-AmehaNeural` (male).
 * Two distinct voices is what makes Conversation mode a real dialogue rather
 * than one speaker reading both parts.
 */

import { prepareSpeech, renderSpeech, estimateDurationMs } from "../normalize";
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
  { id: "am-ET-MekdesNeural", label: "Mekdes — መቅደስ", gender: "female", locale: "am-ET" },
  { id: "am-ET-AmehaNeural", label: "Ameha — አምሀ", gender: "male", locale: "am-ET" },
];

const ENV_KEY = "AZURE_SPEECH_KEY";
const ENV_REGION = "AZURE_SPEECH_REGION";

function credentials() {
  return {
    key: process.env[ENV_KEY]?.trim() || "",
    region: process.env[ENV_REGION]?.trim() || "",
  };
}

function missingEnv(): string[] {
  const { key, region } = credentials();
  const missing: string[] = [];
  if (!key) missing.push(ENV_KEY);
  if (!region) missing.push(ENV_REGION);
  return missing;
}

function status(): ProviderStatus {
  const missing = missingEnv();
  return {
    id: "azure",
    label: "Azure Neural TTS",
    configured: missing.length === 0,
    missingEnv: missing,
    supportsSynthesis: true,
    supportsRecognition: true,
    voices: VOICES,
    notes:
      "Neural am-ET voices (Mekdes, Ameha) plus am-ET speech recognition. Richest SSML support, so the prosody plan is applied in full.",
  };
}

async function synthesize(request: SynthesizeRequest): Promise<SynthesizeResult> {
  const { key, region } = credentials();
  if (!key || !region) {
    throw new SpeechProviderError(
      `Azure is not configured. Set ${missingEnv().join(" and ")}.`,
      "azure",
    );
  }

  const voice = request.voice ?? VOICES[0]!.id;
  const prepared = prepareSpeech(request.text, { mode: request.mode });
  const ssml = renderSpeech(prepared, "azure", voice);

  const response = await fetch(
    `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`,
    {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": key,
        "Content-Type": "application/ssml+xml",
        // 48kHz mono MP3: small enough to cache per phrase, high enough that
        // the ejective release is still audible.
        "X-Microsoft-OutputFormat": "audio-48khz-96kbitrate-mono-mp3",
        "User-Agent": "AmharicAI",
      },
      body: ssml,
    },
  );

  if (!response.ok) {
    throw new SpeechProviderError(
      `Azure synthesis failed (${response.status}): ${await response.text().catch(() => "")}`.trim(),
      "azure",
    );
  }

  return {
    audio: new Uint8Array(await response.arrayBuffer()),
    mimeType: "audio/mpeg",
    provider: "azure",
    voice,
    mode: prepared.mode,
    normalized: prepared.normalized,
    estimatedMs: estimateDurationMs(prepared),
  };
}

async function recognize(request: RecognizeRequest): Promise<RecognizeResult> {
  const { key, region } = credentials();
  if (!key || !region) {
    throw new SpeechProviderError(
      `Azure is not configured. Set ${missingEnv().join(" and ")}.`,
      "azure",
    );
  }

  const url = new URL(
    `https://${region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1`,
  );
  url.searchParams.set("language", "am-ET");
  url.searchParams.set("format", "detailed");

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": key,
      "Content-Type": request.mimeType,
      Accept: "application/json",
    },
    body: request.audio as unknown as BodyInit,
  });

  if (!response.ok) {
    throw new SpeechProviderError(
      `Azure recognition failed (${response.status}).`,
      "azure",
    );
  }

  const body = (await response.json()) as {
    DisplayText?: string;
    NBest?: { Display?: string; Lexical?: string; Confidence?: number }[];
  };
  const best = body.NBest?.[0];

  return {
    transcript: body.DisplayText ?? best?.Display ?? best?.Lexical ?? "",
    confidence: typeof best?.Confidence === "number" ? best.Confidence : null,
    provider: "azure",
  };
}

export const azureProvider: SpeechProvider = {
  id: "azure",
  label: "Azure Neural TTS",
  dialect: "azure",
  voices: VOICES,
  defaultVoice: VOICES[0]!.id,
  secondVoice: VOICES[1]!.id,
  status,
  synthesize,
  recognize,
};
