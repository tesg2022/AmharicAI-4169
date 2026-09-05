/**
 * Provider registry.
 *
 * Composition only. Selection is by env, in a fixed preference order, so
 * dropping a key into the root `.env` is the entire act of turning native
 * Amharic audio on — no code change, no redeploy of the client.
 *
 * `SPEECH_PROVIDER` pins one explicitly when more than one key is present.
 */

import { addisProvider } from "./addis";
import { amharicaiProvider } from "./amharicai";
import { azureProvider } from "./azure";
import { googleProvider } from "./google";
import type { ProviderStatus, SpeechProvider } from "./types";

export * from "./types";
export { addisProvider, amharicaiProvider, azureProvider, googleProvider };

/**
 * Preference order when nothing is pinned.
 *
 * Our own native-speaker voice first: it is trained on Amharic recorded for
 * this course, so when the endpoint is up it should beat a hyperscaler locale.
 * Azure follows because it is the only vendor verified to have both a neural
 * am-ET voice pair and am-ET recognition — and recognition still comes from a
 * vendor regardless, since the LoRA only synthesizes.
 */
export const PROVIDERS: SpeechProvider[] = [
  amharicaiProvider,
  azureProvider,
  googleProvider,
  addisProvider,
];

export function allStatuses(): ProviderStatus[] {
  return PROVIDERS.map((p) => p.status());
}

/** The provider that will actually be used, or null when no key is present. */
export function activeProvider(): SpeechProvider | null {
  const pinned = process.env.SPEECH_PROVIDER?.trim();
  if (pinned) {
    const match = PROVIDERS.find((p) => p.id === pinned);
    if (match?.status().configured) return match;
  }
  return PROVIDERS.find((p) => p.status().configured) ?? null;
}

/**
 * The provider that will actually transcribe a learner's take.
 *
 * Deliberately *not* `activeProvider()`. Our own voice sits first in the
 * preference order but only synthesizes, so selecting a recognizer by the
 * synthesis order would silently disable the speaking loop the moment the
 * native voice endpoint is configured. Recognition falls through to the first
 * configured vendor that actually listens.
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
