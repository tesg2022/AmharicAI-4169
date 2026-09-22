import { amharicaiTranslator } from "./amharicai";
import type { TranslateProvider, TranslateProviderStatus } from "./types";

/**
 * Translation provider registry.
 *
 * The same pattern as `speech/providers/index.ts`, and for the same reason:
 * translation used to be a `fetch` inline in a route, which meant the route
 * knew the vendor's request shape, the vendor's error shape and the vendor's
 * env var names. Moving the model to a GPU service then meant editing a route
 * handler — the thing most likely to also be carrying business rules.
 *
 * With a registry, moving translation onto a GPU box is setting
 * `AMHARICAI_TRANSLATE_URL`. Adding a second engine (a research model beside
 * the production one, say) is a file here and an entry in `TRANSLATORS`. The
 * routes and every client stay untouched in both cases.
 */

export * from "./types";
export { amharicaiTranslator };
export { translateConfig } from "./amharicai";

export const TRANSLATORS: TranslateProvider[] = [amharicaiTranslator];

export function translateStatuses(): TranslateProviderStatus[] {
  return TRANSLATORS.map((t) => t.status());
}

/**
 * The translator that will actually be used, or null when none is configured.
 *
 * `TRANSLATE_PROVIDER` pins one by id. A pinned provider that is not configured
 * returns null rather than falling through to another — if an operator named a
 * provider, quietly using a different one is worse than not translating, since
 * the whole point of pinning is to know which model produced the output.
 */
export function activeTranslator(): TranslateProvider | null {
  const pinned = process.env["TRANSLATE_PROVIDER"]?.trim();
  if (pinned) {
    const match = TRANSLATORS.find((t) => t.id === pinned);
    return match?.status().configured ? match : null;
  }
  return TRANSLATORS.find((t) => t.status().configured) ?? null;
}

export function translationAvailable(): boolean {
  return activeTranslator() !== null;
}
