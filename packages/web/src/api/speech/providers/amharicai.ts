/**
 * AmharicAI native-voice adapter — our own OmniVoice/HiggsAudio LoRA, served
 * from `tts/serving/`.
 *
 * This is the only speech provider. It is a voice trained on native Amharic
 * speech recorded for this course, and there is deliberately no commercial
 * fallback behind it: when this endpoint is unreachable the app degrades to a
 * device am-ET voice, or to honest silence with a stated reason. It never
 * substitutes a hyperscaler locale while claiming a native voice.
 *
 * Host-agnostic on purpose. The primary target is a Hugging Face Inference
 * Endpoint, but nothing here assumes HF — point the URL at a container, a
 * Modal function or a laptop and it works, because the request shape is the one
 * `tts/serving/server.py` and `tts/serving/handler.py` both implement:
 *
 *   POST <url>              { "inputs": "<amharic text>",
 *                             "parameters": { "voice", "speed", "format", "sample_rate" } }
 *   → audio/wav bytes, or { "audio": "<base64>", "mime_type": "audio/wav" }
 *
 * Env:
 *   AMHARICAI_TTS_URL          required — full endpoint URL
 *   AMHARICAI_TTS_TOKEN        optional bearer token
 *   AMHARICAI_TTS_PATH         optional path appended to the URL
 *   AMHARICAI_TTS_VOICE        default voice id
 *   AMHARICAI_TTS_VOICE_ALT    second speaker for dialogue mode
 *   AMHARICAI_TTS_FORMAT       wav (default) | mp3
 *   AMHARICAI_TTS_SAMPLE_RATE  24000, matching training_config.audio.sample_rate
 */

import { estimateDurationMs, prepareSpeech, renderSpeech } from "../normalize";
import type {
  ProviderStatus,
  SpeechProvider,
  SpeechVoice,
  SynthesizeRequest,
  SynthesizeResult,
} from "./types";
import { SpeechProviderError } from "./types";

const ENV_URL = "AMHARICAI_TTS_URL";

const config = () => ({
  url: (process.env[ENV_URL]?.trim() || "").replace(/\/+$/, ""),
  token: process.env.AMHARICAI_TTS_TOKEN?.trim() || "",
  path: process.env.AMHARICAI_TTS_PATH?.trim() || "",
  voice: process.env.AMHARICAI_TTS_VOICE?.trim() || "amharicai-native-f",
  voiceAlt: process.env.AMHARICAI_TTS_VOICE_ALT?.trim() || "amharicai-native-m",
  format: (process.env.AMHARICAI_TTS_FORMAT?.trim() || "wav").toLowerCase(),
  sampleRate: Number(process.env.AMHARICAI_TTS_SAMPLE_RATE?.trim() || 24000),
});

function voices(): SpeechVoice[] {
  const c = config();
  return [
    {
      id: c.voice,
      label: "AmharicAI native — female",
      gender: "female",
      locale: "am-ET",
      preview: true,
    },
    {
      id: c.voiceAlt,
      label: "AmharicAI native — male",
      gender: "male",
      locale: "am-ET",
      preview: true,
    },
  ];
}

function status(): ProviderStatus {
  const c = config();
  return {
    id: "amharicai",
    label: "AmharicAI native voice",
    configured: Boolean(c.url),
    missingEnv: c.url ? [] : [ENV_URL],
    supportsSynthesis: true,
    // The LoRA is a synthesis model. Recognition stays with a vendor.
    supportsRecognition: false,
    voices: voices(),
    notes:
      "Our own LoRA over african-low-resource/omnivoice-amharic, served host-agnostically (Hugging Face Inference Endpoints by default). Marked preview until an eval run against native listeners exists.",
  };
}

/** Learner pace as a numeric rate. 0.7 is the floor — below roughly 0.65 a
 * neural voice smears Amharic ejectives into plain stops, which teaches the
 * wrong sound. */
function rateFor(mode: "native" | "slow" | "syllable"): number {
  return mode === "native" ? 1 : mode === "slow" ? 0.7 : 0.6;
}

async function synthesize(request: SynthesizeRequest): Promise<SynthesizeResult> {
  const c = config();
  if (!c.url) {
    throw new SpeechProviderError(
      `AmharicAI native voice is not configured. Set ${ENV_URL} to the inference endpoint.`,
      "amharicai",
    );
  }

  const voice = request.voice ?? c.voice;
  const prepared = prepareSpeech(request.text, { mode: request.mode });
  // The model was trained on plain normalized text — no SSML dialect. The same
  // normalization runs trainer-side in `tts/qa/normalize_am.py`, held to this
  // pipeline byte-for-byte by `tts/qa/test_parity.py`.
  const input = renderSpeech(prepared, "plain", voice);

  const response = await fetch(`${c.url}${c.path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(c.token ? { Authorization: `Bearer ${c.token}` } : {}),
    },
    body: JSON.stringify({
      // `inputs`/`parameters` is the Hugging Face convention; `text` is echoed
      // for plain container deployments that expect it.
      inputs: input,
      text: input,
      parameters: {
        voice,
        language: "am",
        speed: rateFor(prepared.mode),
        format: c.format,
        sample_rate: c.sampleRate,
      },
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new SpeechProviderError(
      `AmharicAI synthesis failed (${response.status}): ${detail}`.trim(),
      "amharicai",
    );
  }

  const contentType = response.headers.get("content-type") ?? "";
  let audio: Uint8Array;
  let mimeType = c.format === "mp3" ? "audio/mpeg" : "audio/wav";

  if (contentType.includes("application/json")) {
    const body = (await response.json()) as {
      audio?: string;
      audio_base64?: string;
      mime_type?: string;
      error?: string;
    };
    if (body.error) throw new SpeechProviderError(`AmharicAI: ${body.error}`, "amharicai");
    const b64 = body.audio ?? body.audio_base64;
    if (!b64) throw new SpeechProviderError("AmharicAI returned no audio.", "amharicai");
    audio = Uint8Array.from(Buffer.from(b64, "base64"));
    if (body.mime_type) mimeType = body.mime_type;
  } else {
    audio = new Uint8Array(await response.arrayBuffer());
    if (contentType.startsWith("audio/")) mimeType = contentType.split(";")[0];
  }

  if (!audio.length) {
    throw new SpeechProviderError("AmharicAI returned an empty clip.", "amharicai");
  }

  return {
    audio,
    mimeType,
    provider: "amharicai",
    voice,
    mode: prepared.mode,
    normalized: prepared.normalized,
    estimatedMs: estimateDurationMs(prepared),
  };
}

export const amharicaiProvider: SpeechProvider = {
  id: "amharicai",
  label: "AmharicAI native voice",
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
};
