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
import { amharicaiRecognizer } from "./amharicai-asr";
import type { ProviderStatus, SpeechProvider } from "./types";

export * from "./types";
export { amharicaiProvider, amharicaiRecognizer };

/**
 * Both halves of the same GPU service: one speaks, one listens.
 *
 * They are separate entries rather than one provider with two methods because
 * they are separately configured and separately deployable — a box can serve
 * `AMHARICAI_TTS_URL` with no ASR, or the reverse, and each must report its own
 * missing env var instead of hiding behind the other's.
 */
export const PROVIDERS: SpeechProvider[] = [amharicaiProvider, amharicaiRecognizer];

export function allStatuses(): ProviderStatus[] {
  return PROVIDERS.map((p) => p.status());
}

/**
 * The provider that will actually be used, or null when no key is present.
 *
 * `supportsSynthesis` is part of the test, not decoration: the registry now
 * holds a listen-only entry, and without that filter a configured recognizer
 * sitting earlier in the array would be handed every audio request and reject
 * it. A pinned id that cannot synthesize returns null rather than silently
 * falling through to another provider — if someone pinned it, they should be
 * told it is the wrong half.
 */
export function activeProvider(): SpeechProvider | null {
  const usable = (p: SpeechProvider) => {
    const s = p.status();
    return s.configured && s.supportsSynthesis;
  };
  const pinned = process.env.SPEECH_PROVIDER?.trim();
  if (pinned) {
    const match = PROVIDERS.find((p) => p.id === pinned);
    return match && usable(match) ? match : null;
  }
  return PROVIDERS.find(usable) ?? null;
}

/**
 * The provider that will actually transcribe a learner's take.
 *
 * This returns null until `AMHARICAI_ASR_URL` is set, and that is a stated
 * consequence rather than an oversight: the registry now contains a real ASR
 * adapter, but an unconfigured one reports itself unconfigured instead of
 * pretending. Every caller already handles a null recognizer — the speaking
 * loop falls back to the deterministic typed self-check, scored by the same
 * Levenshtein rules — so the loop keeps working and the UI says plainly that
 * no recognizer is configured.
 *
 * Turning recognition on is therefore one environment variable and no code
 * change, which is why the seam was kept rather than deleted.
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
