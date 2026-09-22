import {
  TranslateProviderError,
  type TranslateProvider,
  type TranslateProviderStatus,
  type TranslateRequest,
  type TranslateResult,
} from "./types";

/**
 * AmharicAI translation adapter — host-agnostic, env-configured.
 *
 * The request shape is the same one `speech/providers/amharicai.ts` speaks, so
 * a single GPU service can serve synthesis, recognition and translation behind
 * three URLs (or one URL and three paths) without the app learning anything
 * about where it runs:
 *
 *   POST <url>   { "text": "…", "source": "en", "target": "am", "model": "…" }
 *   → { "translation": "…" }   (also accepts `output` or `text`)
 *
 * Env:
 *   AMHARICAI_TRANSLATE_URL     required — full endpoint URL
 *   AMHARICAI_TRANSLATE_KEY     required — bearer token
 *   AMHARICAI_TRANSLATE_MODEL   optional — passed through as `model`
 *   AMHARICAI_TRANSLATE_TIMEOUT_MS  optional, default 20000
 *
 * Read at request time rather than at import, so changing the URL is a restart
 * of the process and not a rebuild of the bundle — and so a deployment that
 * has not configured translation reports that fact instead of crashing at boot.
 */

const ENV_URL = "AMHARICAI_TRANSLATE_URL";
const ENV_KEY = "AMHARICAI_TRANSLATE_KEY";

export function translateConfig() {
  const url = process.env[ENV_URL]?.trim() ?? "";
  const key = process.env[ENV_KEY]?.trim() ?? "";
  const model = process.env["AMHARICAI_TRANSLATE_MODEL"]?.trim() ?? "";
  const timeoutMs = Number(process.env["AMHARICAI_TRANSLATE_TIMEOUT_MS"]?.trim() || 20_000);
  return { url, key, model, timeoutMs, configured: Boolean(url && key) };
}

function status(): TranslateProviderStatus {
  const c = translateConfig();
  const missing: string[] = [];
  if (!c.url) missing.push(ENV_URL);
  if (!c.key) missing.push(ENV_KEY);
  return {
    id: "amharicai",
    label: "AmharicAI translation",
    configured: c.configured,
    missingEnv: missing,
    notes:
      "Our own Amharic translation endpoint, served host-agnostically. Point AMHARICAI_TRANSLATE_URL at a container, a Hugging Face endpoint or a GPU box; no other change is needed anywhere in the app.",
  };
}

async function translate(request: TranslateRequest): Promise<TranslateResult> {
  const c = translateConfig();
  if (!c.configured) {
    throw new TranslateProviderError(
      `Translation is not configured. Set ${ENV_URL} and ${ENV_KEY}.`,
      "amharicai",
      false,
    );
  }

  /**
   * A timeout, because a translation request sits in front of a learner
   * waiting for a sentence. Without it a stalled GPU cold start holds the
   * connection until the platform's own timeout kills it, and the learner gets
   * a blank screen instead of "try again in a moment".
   */
  const response = await fetch(c.url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${c.key}`,
    },
    body: JSON.stringify({
      model: c.model || undefined,
      text: request.text,
      source: request.direction === "en2am" ? "en" : "am",
      target: request.direction === "en2am" ? "am" : "en",
    }),
    signal: AbortSignal.timeout(c.timeoutMs),
  }).catch((error: unknown) => {
    throw new TranslateProviderError(
      `The translation service did not respond (${error instanceof Error ? error.message : "unknown"}).`,
      "amharicai",
    );
  });

  if (!response.ok) {
    throw new TranslateProviderError(
      `The translation service answered HTTP ${response.status}.`,
      "amharicai",
    );
  }

  const body = (await response.json().catch(() => null)) as
    | { translation?: string; text?: string; output?: string; model?: string }
    | null;

  const translation = body?.translation ?? body?.output ?? body?.text ?? "";

  /**
   * An empty answer is an error, not an empty translation.
   *
   * This is the same rule the old inline implementation held and it is worth
   * restating: never echo the input back as though it were translated. A
   * learner cannot tell a passthrough from a translation, and one wrong
   * sentence taught confidently is worse than a visible failure.
   */
  if (!translation.trim()) {
    throw new TranslateProviderError(
      "The translation service returned an empty translation.",
      "amharicai",
    );
  }

  return {
    translation,
    direction: request.direction,
    provider: "amharicai",
    model: body?.model ?? (c.model || null),
  };
}

export const amharicaiTranslator: TranslateProvider = {
  id: "amharicai",
  label: "AmharicAI translation",
  status,
  translate,
};
