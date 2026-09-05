/**
 * Provider registry — AmharicAI only.
 *
 * There is deliberately exactly one speech provider: our own native-speaker
 * voice, served from `tts/serving/`. The Azure, Google and Addis adapters were
 * removed on purpose. They existed so the app was never voiceless while the
 * LoRA was being trained, but a commercial fallback means the product can ship
 * sounding like a hyperscaler locale while claiming a native Amharic voice.
 * Failing honestly is the better failure: when our endpoint is down the clients
 * fall back to a device am-ET voice if one is installed, and otherwise stay
 * silent and say why.
 *
 * Selection is still by env, so dropping `AMHARICAI_TTS_URL` into the root
 * `.env` remains the entire act of turning native Amharic audio on.
 */

import { amharicaiProvider } from "./amharicai";
import type { ProviderStatus, SpeechProvider } from "./types";

export * from "./types";
export { amharicaiProvider };

export const PROVIDERS: SpeechProvider[] = [amharicaiProvider];

export function allStatuses(): ProviderStatus[] {
  return PROVIDERS.map((p) => p.status());
}

/** The provider that will actually be used, or null when no key is present. */
export function activeProvider(): SpeechProvider | null {
  const pinned = process.env.SPEECH_PROVIDER?.trim();
  if (pinned) {
    const match = PROVIDERS.find((p) => p.id === pinned);
    return match?.status().configured ? match : null;
  }
  return PROVIDERS.find((p) => p.status().configured) ?? null;
}

/**
 * The provider that will actually transcribe a learner's take.
 *
 * Today this always returns null, and that is a stated consequence rather than
 * an oversight: the AmharicAI backend synthesizes but does not listen, and it is
 * now the only provider. Every caller already handles a null recognizer — the
 * speaking loop falls back to the deterministic typed self-check, scored by the
 * same Levenshtein rules — so the loop keeps working and the UI says plainly
 * that no recognizer is configured.
 *
 * The function stays because the seam is the point: give `amharicaiProvider` a
 * `recognize` implementation (or add an Amharic ASR provider) and recognition
 * turns back on with no changes at the call sites.
 */
export function activeRecognizer(): SpeechProvider | null {
  const pinned = process.env.SPEECH_RECOGNIZER?.trim() || process.env.SPEECH_PROVIDER?.trim();
  if (pinned) {
    const match = PROVIDERS.find((p) => p.id === pinned);
    if (match?.recognize && match.status().configured) return match;
  }
  return PROVIDERS.find((p) => p.recognize && p.status().configured) ?? null;
}

export function providerById(id: string): SpeechProvider | null {
  return PROVIDERS.find((p) => p.id === id) ?? null;
}

/**
 * Whether any native am-ET voice is reachable from the server.
 *
 * When this is false the clients must not substitute an English voice reading
 * a transliteration — they fall back to a device am-ET voice if one is
 * installed, and otherwise stay silent and say so.
 */
export function nativeAudioAvailable(): boolean {
  return activeProvider() !== null;
}
