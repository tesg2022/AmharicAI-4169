/**
 * The provider-agnostic speech contract.
 *
 * Everything above this line (text processing, prosody, SSML, caching, the
 * lesson loop) is ours and works with no key. Everything below it is a vendor
 * that can be swapped without touching a screen — which is the whole reason
 * this interface exists rather than calling a vendor SDK from a route.
 */

import type { SsmlDialect } from "../normalize";
import type { VoiceMode } from "../ssml";

/** A real `am-ET` voice offered by a provider. */
export type SpeechVoice = {
  /** Provider-native voice identifier, sent verbatim on synthesis. */
  id: string;
  /** Human label for the voice picker. */
  label: string;
  gender: "female" | "male" | "unspecified";
  locale: string;
  /** Set when the vendor still calls this voice preview/experimental. */
  preview?: boolean;
};

export type SynthesizeRequest = {
  /** Raw Amharic text. The provider runs it through the shared pipeline. */
  text: string;
  /** Provider-native voice id. Falls back to the provider's default voice. */
  voice?: string;
  mode?: VoiceMode;
};

export type SynthesizeResult = {
  audio: Uint8Array;
  mimeType: string;
  provider: string;
  voice: string;
  mode: VoiceMode;
  /** Text actually sent to the engine, after normalization. */
  normalized: string;
  /** Pre-synthesis estimate, used for UI before the clip is measured. */
  estimatedMs: number;
};

export type RecognizeRequest = {
  audio: Uint8Array;
  /** Content type of `audio`, e.g. `audio/webm`, `audio/wav`. */
  mimeType: string;
  /** Expected phrase. Providers that accept a hint score better with it. */
  expected?: string;
};

export type RecognizeResult = {
  transcript: string;
  /** 0-1 where the provider reports one, otherwise null. */
  confidence: number | null;
  provider: string;
};

/** Why a provider is unusable, surfaced to the UI verbatim. */
export type ProviderStatus = {
  id: string;
  label: string;
  configured: boolean;
  /** Missing env var names, so the UI can name exactly what to supply. */
  missingEnv: string[];
  supportsSynthesis: boolean;
  supportsRecognition: boolean;
  voices: SpeechVoice[];
  notes: string;
};

export type SpeechProvider = {
  id: string;
  label: string;
  /** SSML dialect this vendor honours. */
  dialect: SsmlDialect;
  voices: SpeechVoice[];
  defaultVoice: string | null;
  /** Second voice for two-speaker dialogue playback, when the vendor has one. */
  secondVoice: string | null;
  status: () => ProviderStatus;
  synthesize: (request: SynthesizeRequest) => Promise<SynthesizeResult>;
  recognize?: (request: RecognizeRequest) => Promise<RecognizeResult>;
};

export class SpeechProviderError extends Error {
  constructor(
    message: string,
    readonly provider: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "SpeechProviderError";
  }
}
