import type { RouterClient } from "@orpc/server";
import { createAgentUIStreamResponse, safeValidateUIMessages } from "ai";
import { createApp } from "./__core/app";
import { cacheKey, readCache, writeCache } from "./speech/cache";
import { estimateDurationMs, prepareSpeech } from "./speech/normalize";
import { activeProvider, activeRecognizer } from "./speech/providers";
import { VOICE_MODES, type VoiceMode } from "./speech/ssml";
import { tutorAgent } from "./agent";
import { auth } from "./auth";
import { paystackWebhook } from "./billing/webhook";
import { identify } from "./entitlements/request";
import { consume, refund, refusalMessage } from "./entitlements/usage";
import { account } from "./routes/account";
import { billing } from "./routes/billing";
import { usage } from "./routes/usage";
import { waitlist } from "./routes/waitlist";
import { access } from "./routes/access";
import { admin } from "./routes/admin";
import { catalog } from "./routes/catalog";
import { content } from "./routes/content";
import { legal } from "./routes/legal";
import { ping } from "./routes/ping";
import { practice } from "./routes/practice";
import { progress } from "./routes/progress";
import { speech } from "./routes/speech";
import { pronunciation } from "./routes/pronunciation";
import { speaking } from "./routes/speaking";
import { srs } from "./routes/srs";
import { tutor } from "./routes/tutor";

// API features are oRPC procedures, one file per feature in ./routes/,
// composed into this router — typed end-to-end via the clients
// (web: src/web/lib/api.ts, mobile: lib/api.ts).
// Keep each routes/ file under 500 lines (`bun run lint` enforces this);
// split into more feature files as they grow.
// Patterns and examples: skills/app/references/api.md
export const router = {
  ping,
  access,
  account,
  admin,
  billing,
  catalog,
  content,
  legal,
  practice,
  pronunciation,
  srs,
  progress,
  speaking,
  speech,
  tutor,
  usage,
  waitlist,
};

export type AppRouter = typeof router;
/** Typed client for the router — used by the web and mobile api clients. */
export type AppRouterClient = RouterClient<AppRouter>;

const app = createApp(router);
// Rare plain-HTTP endpoints (webhooks, streaming, the Better Auth handler)
// register here with full paths, e.g. app.post("/api/webhooks/example", ...)
app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));

/**
 * Paystack webhooks — renewals, failed cards, cancellations.
 *
 * A plain route, and it has to be: the signature is an HMAC over the raw
 * request bytes, so a body parsed by oRPC before the handler sees it cannot
 * be verified. The handler reads `c.req.text()` itself and nothing else
 * touches the body first.
 *
 * This URL goes in Paystack Dashboard → Settings → API Keys & Webhooks, in
 * both test and live mode.
 */
app.post("/api/webhooks/paystack", (c) => paystackWebhook(c));

/**
 * Native Amharic audio. A plain route because `<audio src>` and the mobile
 * player need a URL, not an RPC payload.
 *
 * Cache first, provider second. When no provider key is configured this
 * answers 503 with a machine-readable reason so the client can fall back to a
 * device am-ET voice — never to an English voice reading transliteration.
 */
app.get("/api/speech/audio", async (c) => {
  const text = c.req.query("text")?.trim();
  if (!text) return c.json({ error: "text is required" }, 400);

  const requested = c.req.query("mode") as VoiceMode | undefined;
  const mode: VoiceMode = requested && VOICE_MODES.includes(requested) ? requested : "native";

  const provider = activeProvider();

  // Quota is checked before synthesis but AFTER the cache read below would
  // have been free — so the cache lookup happens first and only a real
  // provider call spends allowance. A replayed lesson line costs nothing.
  const prepared = prepareSpeech(text, { mode });
  const voice = c.req.query("voice") || provider?.defaultVoice || "";

  if (provider) {
    const id = cacheKey({ provider: provider.id, voice, mode, normalizedText: prepared.normalized });
    const cached = await readCache(id).catch(() => null);
    if (cached) {
      return new Response(cached.audio as unknown as BodyInit, {
        status: 200,
        headers: {
          "Content-Type": cached.mimeType,
          "Cache-Control": "public, max-age=31536000, immutable",
          "X-Speech-Source": "cache",
        },
      });
    }
  }

  if (!provider) {
    return c.json(
      {
        error: "no_native_voice",
        message:
          "No Amharic speech provider is configured on the server. Add a provider key to enable native audio.",
        normalized: prepared.normalized,
        estimatedMs: estimateDurationMs(prepared),
      },
      503,
    );
  }

  // Cache missed: this call will reach the provider and cost money, so it is
  // metered. Anonymous callers are metered by hashed address, which is what
  // stops the free tier being bypassed by signing out.
  const who = await identify(c);
  const spend = await consume(who.subject, who.plan, "tts_synthesis");
  if (!spend.consumed) {
    return c.json(
      {
        error: "quota_exceeded",
        message: who.userId
          ? refusalMessage(spend, who.plan)
          : "Anonymous playback is limited. Sign in for the full free allowance.",
        limit: spend.limit,
        used: spend.used,
        resets_at: spend.resets_at,
        normalized: prepared.normalized,
      },
      429,
    );
  }

  try {
    const result = await provider.synthesize({ text, voice, mode });
    await writeCache({
      provider: result.provider,
      voice: result.voice,
      mode: result.mode,
      normalizedText: result.normalized,
      sourceText: text,
      mimeType: result.mimeType,
      audio: result.audio,
      durationMsEstimate: result.estimatedMs,
      kind: c.req.query("kind") || "ad_hoc",
      refId: c.req.query("refId") || null,
    }).catch(() => undefined);

    return new Response(result.audio as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": result.mimeType,
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Speech-Source": "synthesized",
      },
    });
  } catch (error) {
    // The provider failed, so no audio was produced and no money was spent.
    // Hand the unit back rather than charging for a 502.
    await refund(who.subject, "tts_synthesis").catch(() => undefined);
    return c.json(
      { error: "synthesis_failed", message: error instanceof Error ? error.message : "unknown" },
      502,
    );
  }
});

/**
 * am-ET speech recognition. Takes the raw recorded audio body and returns a
 * transcript, which the client then sends to `speaking.score` — recognition
 * and scoring stay separate so the scorer remains deterministic.
 */
app.post("/api/speech/recognize", async (c) => {
  // Recognizer, not the synthesis provider: our own native voice ranks first
  // for speaking but does not listen.
  const provider = activeRecognizer();
  if (!provider?.recognize) {
    return c.json(
      {
        error: "no_recognizer",
        message: "No Amharic speech recognizer is configured on the server.",
      },
      503,
    );
  }

  const mimeType = c.req.header("content-type") || "audio/webm";
  const audio = new Uint8Array(await c.req.arrayBuffer());
  if (audio.byteLength === 0) return c.json({ error: "empty audio" }, 400);

  try {
    const result = await provider.recognize({
      audio,
      mimeType,
      expected: c.req.query("expected") || undefined,
    });
    return c.json(result, 200);
  } catch (error) {
    return c.json(
      { error: "recognition_failed", message: error instanceof Error ? error.message : "unknown" },
      502,
    );
  }
});

/**
 * Streaming AI tutor turn — streaming responses cannot be oRPC procedures.
 *
 * This is the single most expensive endpoint in the product: one POST is one
 * LLM completion against the operator's key. It is therefore metered before
 * the model is reached, for signed-in and anonymous callers alike, and the
 * refusal is a 429 with the reset date rather than a silent empty stream.
 */
app.post("/api/agent/messages", async (c) => {
  const body = await c.req.json().catch(() => null);
  const messages = body?.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return c.json({ error: "bad_request", message: "messages[] is required." }, 400);
  }

  // Validate the transcript *before* spending quota. The stream helper
  // validates again internally and throws on a bad shape; if that happened
  // after `consume()` the caller would be charged a tutor turn for a request
  // that never reached the model.
  // The cast is type-only: the tutor's tools have specific input schemas, and
  // the validator's `tools` parameter is invariant in that input type, so a
  // concrete tool set is not assignable to it. Mobile's stricter tsconfig
  // rejects it without this; the value passed is unchanged.
  const validated = await safeValidateUIMessages({
    messages,
    tools: tutorAgent.tools as Parameters<typeof safeValidateUIMessages>[0]["tools"],
  });
  if (!validated.success) {
    return c.json(
      {
        error: "bad_request",
        message:
          "messages[] must be UIMessage objects with an `id` and a `parts` array.",
        detail: validated.error.message,
      },
      400,
    );
  }

  const who = await identify(c);
  const spend = await consume(who.subject, who.plan, "tutor_turn");
  if (!spend.consumed) {
    return c.json(
      {
        error: "quota_exceeded",
        message: who.userId
          ? refusalMessage(spend, who.plan)
          : `Anonymous visitors get ${spend.limit} tutor questions. Sign in for the free plan's monthly allowance.`,
        limit: spend.limit,
        used: spend.used,
        remaining: spend.remaining,
        resets_at: spend.resets_at,
        plan: who.plan,
        signed_in: Boolean(who.userId),
      },
      429,
    );
  }

  return createAgentUIStreamResponse({ agent: tutorAgent, uiMessages: validated.data });
});

export default app;
