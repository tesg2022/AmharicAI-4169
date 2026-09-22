import type { PlanId } from "../content/plans";
import { consume, refund, type ConsumeResult, type Subject } from "../entitlements/usage";
import { cacheKey, readCache, writeCache } from "./cache";
import { estimateDurationMs, prepareSpeech } from "./normalize";
import { activeProvider, activeRecognizer } from "./providers";
import type { VoiceMode } from "./ssml";

/**
 * Serving speech, once, for every transport that asks for it.
 *
 * `GET /api/speech/audio` (what `<audio src>` and the mobile player use) and
 * `POST /v1/tts` (the REST surface) are two wire formats over one behaviour:
 * cache first, quota second, provider third, refund on failure. That ordering
 * is the whole safety story of the endpoint — get it wrong in one of two
 * copies and either the bill runs away or learners are charged for audio a
 * vendor never delivered.
 *
 * So the ordering lives here and the routes only translate. Each returns its
 * own envelope (the legacy route's ad-hoc JSON, `/v1`'s documented error
 * shape) from the same discriminated result, which is the one thing that
 * genuinely differs between them.
 */

export interface SpeechAsk {
  /** Raw Amharic text, exactly as the caller sent it. */
  text: string;
  mode: VoiceMode;
  /** Provider-native voice id. Falls back to the provider's default. */
  voice?: string | null;
  /** Cache provenance, e.g. "lesson_line" — stored, never used for gating. */
  kind?: string | null;
  refId?: string | null;
}

/** Who pays for the call. */
export interface Spender {
  subject: Subject;
  plan: PlanId;
}

/**
 * Who pays, resolved only if someone has to.
 *
 * A thunk rather than a value because identifying the caller costs a session
 * lookup and a plan resolution, and a cache hit — the majority of requests on
 * this endpoint — spends nothing and therefore needs neither. The legacy
 * route had this property by accident, from the order its statements happened
 * to be in; here it is explicit and cannot be lost in a refactor.
 */
export type SpenderSource = () => Promise<Spender>;

/**
 * What `new Response()` accepts here, derived rather than named.
 *
 * `audio` below is a `Uint8Array` — a perfectly good response body at runtime,
 * but not assignable to the constructor's parameter type under every `lib`
 * this repo compiles with, so both audio routes have to cast. The obvious cast
 * target is `BodyInit`, and that is a DOM lib name: the `app` project loads
 * DOM and the `node` project gets it transitively, but the `scripts` project
 * loads neither, so any script that transitively imports an audio route fails
 * to compile on a name that has nothing to do with it. Deriving the type from
 * the constructor is the same type without the dependency on which lib is in
 * scope.
 */
export type ResponseBody = ConstructorParameters<typeof Response>[0];

export type ServedSpeech =
  | {
      outcome: "audio";
      audio: Uint8Array;
      mimeType: string;
      /** "cache" costs nothing and is not metered; "synthesized" spent a unit. */
      source: "cache" | "synthesized";
      provider: string;
      voice: string;
      mode: VoiceMode;
      normalized: string;
      estimatedMs: number;
    }
  | { outcome: "not_configured"; normalized: string; estimatedMs: number }
  | { outcome: "quota"; spend: ConsumeResult; normalized: string }
  | { outcome: "failed"; message: string; normalized: string };

/**
 * Cache, quota, provider — in that order, for the reasons in each branch.
 */
export async function serveSpeech(
  ask: SpeechAsk,
  spender: SpenderSource,
): Promise<ServedSpeech> {
  const prepared = prepareSpeech(ask.text, { mode: ask.mode });
  const provider = activeProvider();
  const voice = ask.voice?.trim() || provider?.defaultVoice || "";

  /**
   * The cache read happens before the quota check, not after, and that is a
   * product decision rather than an optimisation: replaying a lesson line is
   * the single most common thing a learner does, it costs the operator
   * nothing, and metering it would make repetition — the entire mechanism of
   * language learning — something users have to ration.
   */
  if (provider) {
    const id = cacheKey({
      provider: provider.id,
      voice,
      mode: ask.mode,
      normalizedText: prepared.normalized,
    });
    const cached = await readCache(id).catch(() => null);
    if (cached) {
      return {
        outcome: "audio",
        audio: cached.audio,
        mimeType: cached.mimeType,
        source: "cache",
        provider: provider.id,
        voice,
        mode: ask.mode,
        normalized: prepared.normalized,
        estimatedMs: cached.durationMsEstimate ?? estimateDurationMs(prepared),
      };
    }
  }

  /**
   * No provider: say so, and say it with the normalized text attached. The
   * clients use that to drive a device am-ET voice if one is installed — and
   * must never substitute an English voice reading a transliteration, which
   * is why this is a refusal and not a fallback.
   */
  if (!provider) {
    return {
      outcome: "not_configured",
      normalized: prepared.normalized,
      estimatedMs: estimateDurationMs(prepared),
    };
  }

  /**
   * Cache missed, so this call will reach the provider and cost money. Quota
   * is taken before the call because that is the only order that caps spend
   * under concurrency; the refund below pays back the cases where the vendor
   * then failed to deliver.
   */
  const who = await spender();
  const spend = await consume(who.subject, who.plan, "tts_synthesis");
  if (!spend.consumed) {
    return { outcome: "quota", spend, normalized: prepared.normalized };
  }

  try {
    const result = await provider.synthesize({ text: ask.text, voice, mode: ask.mode });

    // Best-effort: a cache write that fails must not fail playback the caller
    // has already paid for.
    await writeCache({
      provider: result.provider,
      voice: result.voice,
      mode: result.mode,
      normalizedText: result.normalized,
      sourceText: ask.text,
      mimeType: result.mimeType,
      audio: result.audio,
      durationMsEstimate: result.estimatedMs,
      kind: ask.kind || "ad_hoc",
      refId: ask.refId || null,
    }).catch(() => undefined);

    return {
      outcome: "audio",
      audio: result.audio,
      mimeType: result.mimeType,
      source: "synthesized",
      provider: result.provider,
      voice: result.voice,
      mode: result.mode,
      normalized: result.normalized,
      estimatedMs: result.estimatedMs,
    };
  } catch (error) {
    // No audio was produced and no vendor money was spent, so the unit goes
    // back. Charging for a 502 is how a paying learner ends up out of
    // allowance because of an outage on our side.
    await refund(who.subject, "tts_synthesis").catch(() => undefined);
    return {
      outcome: "failed",
      message: error instanceof Error ? error.message : "unknown",
      normalized: prepared.normalized,
    };
  }
}

export type Heard =
  | { outcome: "transcript"; transcript: string; confidence: number | null; provider: string }
  | { outcome: "not_configured" }
  | { outcome: "empty" }
  | { outcome: "failed"; message: string };

/**
 * Transcribe a take.
 *
 * Unmetered, deliberately: recognition runs on our own box rather than a
 * per-call vendor, the speaking loop sends one take per attempt, and the
 * `/v1` rate limiter already caps abuse. If ASR ever moves to a metered
 * vendor this is the one function that has to learn about quota.
 *
 * Scoring is not here and must not be — the scorer stays deterministic and
 * offline, so a recognizer outage degrades speaking practice to the typed
 * self-check instead of breaking it.
 */
export async function hearSpeech(input: {
  audio: Uint8Array;
  mimeType: string;
  expected?: string;
}): Promise<Heard> {
  const provider = activeRecognizer();
  if (!provider?.recognize) return { outcome: "not_configured" };
  if (input.audio.byteLength === 0) return { outcome: "empty" };

  try {
    const result = await provider.recognize({
      audio: input.audio,
      mimeType: input.mimeType,
      expected: input.expected,
    });
    return {
      outcome: "transcript",
      transcript: result.transcript,
      confidence: result.confidence,
      provider: result.provider,
    };
  } catch (error) {
    return { outcome: "failed", message: error instanceof Error ? error.message : "unknown" };
  }
}
