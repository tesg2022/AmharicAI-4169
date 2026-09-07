import type { RouterClient } from "@orpc/server";
import { createAgentUIStreamResponse } from "ai";
import { createApp } from "./__core/app";
import { cacheKey, readCache, writeCache } from "./speech/cache";
import { estimateDurationMs, prepareSpeech } from "./speech/normalize";
import { activeProvider, activeRecognizer } from "./speech/providers";
import { VOICE_MODES, type VoiceMode } from "./speech/ssml";
import { tutorAgent } from "./agent";
import { auth } from "./auth";
import { access } from "./routes/access";
import { admin } from "./routes/admin";
import { catalog } from "./routes/catalog";
import { content } from "./routes/content";
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
  admin,
  catalog,
  content,
  practice,
  pronunciation,
  srs,
  progress,
  speaking,
  speech,
  tutor,
};

export type AppRouter = typeof router;
/** Typed client for the router — used by the web and mobile api clients. */
export type AppRouterClient = RouterClient<AppRouter>;

const app = createApp(router);
// Rare plain-HTTP endpoints (webhooks, streaming, the Better Auth handler)
// register here with full paths, e.g. app.post("/api/webhooks/example", ...)
app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));

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

/** Streaming AI tutor turn — streaming responses cannot be oRPC procedures. */
app.post("/api/agent/messages", async (c) => {
  const { messages } = await c.req.json();
  return createAgentUIStreamResponse({ agent: tutorAgent, uiMessages: messages });
});

export default app;
