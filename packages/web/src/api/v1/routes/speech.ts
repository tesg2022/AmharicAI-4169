import { Hono, type Context } from "hono";
import { VOICE_MODES, type VoiceMode } from "../../speech/ssml";
import { hearSpeech, serveSpeech, type ResponseBody } from "../../speech/serve";
import { peek } from "../../entitlements/usage";
import { ApiError, badRequest, ok, requestId } from "../http";
import { guard } from "../middleware";

/**
 * `/v1/tts` and `/v1/transcribe` — the two audio endpoints.
 *
 * Both return the media itself rather than a URL or base64. An API that hands
 * back a link makes the caller do a second round trip for a file we already
 * have in memory, and base64 inflates a lesson line by a third for no benefit
 * to anyone who is going to play or save the bytes anyway.
 *
 * The behaviour behind them is `speech/serve.ts`, shared byte-for-byte with
 * the legacy `/api/speech/*` routes the first-party clients use. That is the
 * point of this layer: `/v1` is a second door onto one implementation, not a
 * second implementation.
 */

export const speechRoutes = new Hono();

const MAX_TTS_CHARS = 2000;
/** 25 MB. A take is seconds of speech; anything larger is a mistake or abuse. */
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

function modeOf(raw: string | undefined | null): VoiceMode {
  return raw && (VOICE_MODES as readonly string[]).includes(raw) ? (raw as VoiceMode) : "native";
}

/**
 * Synthesis. POST because it can spend allowance and create a cache row;
 * `GET /v1/tts` exists alongside it purely so an audio element can be pointed
 * at a URL, which is the one case a POST cannot serve.
 */
interface SynthesisInput {
  text: string;
  mode: VoiceMode;
  voice: string | null;
  kind: string | null;
  refId: string | null;
}

async function synthesize(c: Context, input: SynthesisInput) {
  const caller = guard(c, { scope: "tts:synthesize", tier: "ai" });

  if (!input.text) throw badRequest("`text` is required.");
  if (input.text.length > MAX_TTS_CHARS) {
    throw new ApiError(
      "payload_too_large",
      `\`text\` must be at most ${MAX_TTS_CHARS} characters. Split longer passages into lines — which is also how they should be played to a learner.`,
      { limit: MAX_TTS_CHARS, received: input.text.length },
    );
  }

  const served = await serveSpeech(input, async () => ({
    subject: caller.subject,
    plan: caller.plan,
  }));

  if (served.outcome === "audio") {
    /**
     * The metadata rides in headers because the body is the audio. A caller
     * that wants the normalized text — to display what was actually spoken —
     * reads `X-Speech-Normalized`; one that just wants sound ignores all of
     * it and plays the response.
     */
    return new Response(served.audio as unknown as ResponseBody, {
      status: 200,
      headers: {
        "Content-Type": served.mimeType,
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Request-Id": requestId(c),
        "X-Speech-Source": served.source,
        "X-Speech-Provider": served.provider,
        "X-Speech-Voice": served.voice,
        "X-Speech-Mode": served.mode,
        "X-Speech-Estimated-Ms": String(served.estimatedMs),
        // Header values must be latin-1 safe, and the normalized text is
        // Ethiopic — so it is percent-encoded rather than dropped.
        "X-Speech-Normalized": encodeURIComponent(served.normalized),
      },
    });
  }

  if (served.outcome === "not_configured") {
    throw new ApiError(
      "not_configured",
      "This deployment has no Amharic voice configured, so it will not return audio. It deliberately does not substitute an English voice reading a transliteration.",
      {
        reason: "no_native_voice",
        normalized: served.normalized,
        estimated_ms: served.estimatedMs,
      },
    );
  }

  if (served.outcome === "quota") {
    throw new ApiError(
      "quota_exceeded",
      caller.userId
        ? "You have used this period's speech allowance."
        : "Anonymous playback is limited. Authenticate for the full free allowance.",
      {
        meter: "tts_synthesis",
        limit: served.spend.limit,
        used: served.spend.used,
        remaining: served.spend.remaining,
        resets_at: served.spend.resets_at,
        plan: caller.plan,
      },
      { "Retry-After": String(retryAfter(served.spend.resets_at)) },
    );
  }

  throw new ApiError(
    "upstream_failed",
    "The speech provider did not return audio. Your allowance was not charged.",
    { reason: "synthesis_failed", detail: served.message },
  );
}

function retryAfter(resetsAt: string): number {
  const seconds = Math.ceil((new Date(resetsAt).getTime() - Date.now()) / 1000);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : 60;
}

speechRoutes.post("/tts", async (c) => {
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) throw badRequest("Send a JSON body: { \"text\": \"…\", \"mode\": \"native\" }.");
  return synthesize(c, {
    text: typeof body.text === "string" ? body.text.trim() : "",
    mode: modeOf(typeof body.mode === "string" ? body.mode : null),
    voice: typeof body.voice === "string" ? body.voice : null,
    kind: typeof body.kind === "string" ? body.kind : null,
    refId: typeof body.ref_id === "string" ? body.ref_id : null,
  });
});

/** Same synthesis, as a URL, for `<audio src>` and native players. */
speechRoutes.get("/tts", (c) =>
  synthesize(c, {
    text: c.req.query("text")?.trim() ?? "",
    mode: modeOf(c.req.query("mode")),
    voice: c.req.query("voice") ?? null,
    kind: c.req.query("kind") ?? null,
    refId: c.req.query("ref_id") ?? null,
  }),
);

/** What the caller has left, so a client can show it without spending any. */
speechRoutes.get("/tts/usage", async (c) => {
  const caller = guard(c, { scope: "tts:read" });
  return ok(c, {
    plan: caller.plan,
    meter: await peek(caller.subject, caller.plan, "tts_synthesis"),
  });
});

/**
 * Transcription.
 *
 * The audio is the request body, with its own Content-Type — no multipart, no
 * JSON wrapper, no base64. `expected` is a query parameter because it is a
 * decoding hint for the lesson line being attempted, and recognizers that
 * accept one score materially better with it.
 *
 * Scoring is deliberately somewhere else (`speaking.score`): recognition is a
 * model, scoring is deterministic, and keeping them apart is what lets the
 * speaking loop keep working — on the typed self-check — when no recognizer
 * is configured at all.
 */
speechRoutes.post("/transcribe", async (c) => {
  guard(c, { scope: "asr:transcribe", tier: "ai" });

  const declared = Number(c.req.header("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > MAX_AUDIO_BYTES) {
    throw new ApiError("payload_too_large", "Audio must be under 25 MB. Send one take, not a session.", {
      limit_bytes: MAX_AUDIO_BYTES,
    });
  }

  const audio = new Uint8Array(await c.req.arrayBuffer());
  if (audio.byteLength > MAX_AUDIO_BYTES) {
    throw new ApiError("payload_too_large", "Audio must be under 25 MB. Send one take, not a session.", {
      limit_bytes: MAX_AUDIO_BYTES,
      received_bytes: audio.byteLength,
    });
  }

  const heard = await hearSpeech({
    audio,
    mimeType: c.req.header("content-type") || "audio/webm",
    expected: c.req.query("expected") || undefined,
  });

  if (heard.outcome === "transcript") {
    return ok(c, {
      transcript: heard.transcript,
      confidence: heard.confidence,
      provider: heard.provider,
    });
  }
  if (heard.outcome === "empty") {
    throw badRequest("The request body was empty. POST the recorded audio bytes with their Content-Type.");
  }
  if (heard.outcome === "failed") {
    throw new ApiError("upstream_failed", "The recognizer did not return a transcript.", {
      reason: "recognition_failed",
      detail: heard.message,
    });
  }
  throw new ApiError(
    "not_configured",
    "This deployment has no Amharic speech recognizer configured. Set AMHARICAI_ASR_URL to enable it.",
    { reason: "no_recognizer" },
  );
});
