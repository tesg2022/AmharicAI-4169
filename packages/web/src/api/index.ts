import type { RouterClient } from "@orpc/server";
import { createAgentUIStreamResponse, safeValidateUIMessages } from "ai";
import { createApp } from "./__core/app";
import { hearSpeech, serveSpeech, type ResponseBody } from "./speech/serve";
import { VOICE_MODES, type VoiceMode } from "./speech/ssml";
import { tutorAgent } from "./agent";
import { auth } from "./auth";
import { paystackWebhook } from "./billing/webhook";
import { identify, type RequestIdentity } from "./entitlements/request";
import { consume, refusalMessage } from "./entitlements/usage";
import { mountV1 } from "./v1";
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
 * The versioned REST surface. Its own pipeline (request id, caller, rate limit,
 * structured log) and its own error envelope live under `./v1`, so nothing in
 * this file has to know about them. See `v1/index.ts` for why it exists
 * alongside the oRPC router rather than replacing it.
 */
mountV1(app);

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

/*
 * There is deliberately no PayPal webhook route here. Checkout is Paystack in
 * rand, and the dollar-priced PayPal path — router, webhook, fulfilment and
 * plan-id price verification — is parked on the `usd-paypal-pricing` branch
 * rather than mounted. Nothing dollar-priced can be sold while that is true,
 * which is the point: one currency, one provider, one price per plan.
 *
 * The read side stays: `billing/paypal-store.ts` and the grant merge still
 * resolve any PayPal grant already recorded, so no past access can vanish
 * because the sales path was withdrawn.
 */

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

  /**
   * Cache-then-quota-then-provider now lives in `speech/serve.ts`, shared with
   * `POST /v1/tts`. The identity lookup is passed as a thunk so a cache hit
   * still costs no session read — the property the old inline version had by
   * statement order alone.
   *
   * The response shapes below are unchanged on purpose: existing web, Expo
   * and Electron builds parse these exact keys, and a shared implementation
   * is not a licence to break a shipped client.
   */
  let identified: Awaited<ReturnType<typeof identify>> | null = null;
  const served = await serveSpeech(
    {
      text,
      mode,
      voice: c.req.query("voice"),
      kind: c.req.query("kind"),
      refId: c.req.query("refId"),
    },
    async () => {
      identified = await identify(c);
      return { subject: identified.subject, plan: identified.plan };
    },
  );

  if (served.outcome === "audio") {
    return new Response(served.audio as unknown as ResponseBody, {
      status: 200,
      headers: {
        "Content-Type": served.mimeType,
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Speech-Source": served.source,
      },
    });
  }

  if (served.outcome === "not_configured") {
    return c.json(
      {
        error: "no_native_voice",
        message:
          "No Amharic speech provider is configured on the server. Add a provider key to enable native audio.",
        normalized: served.normalized,
        estimatedMs: served.estimatedMs,
      },
      503,
    );
  }

  if (served.outcome === "quota") {
    // The cast is load-bearing: `identified` is only ever assigned inside the
    // thunk above, which TypeScript's control flow does not follow, so it
    // narrows the variable to `null` here and makes every field access an
    // error. The runtime value is set whenever the spender ran — which a
    // `quota` outcome proves it did.
    const who = identified as RequestIdentity | null;
    return c.json(
      {
        error: "quota_exceeded",
        message: who?.userId
          ? refusalMessage(served.spend, who.plan)
          : "Anonymous playback is limited. Sign in for the full free allowance.",
        limit: served.spend.limit,
        used: served.spend.used,
        resets_at: served.spend.resets_at,
        normalized: served.normalized,
      },
      429,
    );
  }

  return c.json({ error: "synthesis_failed", message: served.message }, 502);
});

/**
 * am-ET speech recognition. Takes the raw recorded audio body and returns a
 * transcript, which the client then sends to `speaking.score` — recognition
 * and scoring stay separate so the scorer remains deterministic.
 */
app.post("/api/speech/recognize", async (c) => {
  const heard = await hearSpeech({
    audio: new Uint8Array(await c.req.arrayBuffer()),
    mimeType: c.req.header("content-type") || "audio/webm",
    expected: c.req.query("expected") || undefined,
  });

  if (heard.outcome === "transcript") {
    const { transcript, confidence, provider } = heard;
    return c.json({ transcript, confidence, provider }, 200);
  }
  if (heard.outcome === "empty") return c.json({ error: "empty audio" }, 400);
  if (heard.outcome === "failed") {
    return c.json({ error: "recognition_failed", message: heard.message }, 502);
  }
  return c.json(
    {
      error: "no_recognizer",
      message: "No Amharic speech recognizer is configured on the server.",
    },
    503,
  );
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
