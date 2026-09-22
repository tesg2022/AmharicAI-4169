import { Hono } from "hono";
import { asc, eq } from "drizzle-orm";
import { createAgentUIStreamResponse, safeValidateUIMessages } from "ai";
import { tutorAgent } from "../../agent";
import { db } from "../../database";
import * as s from "../../database/schema";
import { consume, peek } from "../../entitlements/usage";
import { ApiError, badRequest, ok, requestId } from "../http";
import { guard } from "../middleware";

/**
 * `/v1/tutor` — the AI tutor turn, and the transcript it belongs to.
 *
 * This is the most expensive endpoint in the product: one POST is one LLM
 * completion against the operator's key. Everything unusual about this file
 * follows from that.
 *
 * The turn streams, so it is the one `/v1` endpoint that does not answer with
 * the JSON envelope: the body is an AI SDK UI message stream, because a tutor
 * reply that arrives all at once after eight seconds is a worse product than
 * one that types. Failures *before* the stream opens are still the normal
 * envelope — a 402, 429 or 400 is JSON and machine-readable. Once bytes are
 * flowing the transport is the stream's, and that is unavoidable rather than
 * a design preference.
 */

export const tutorRoutes = new Hono();

/**
 * Stream a tutor turn.
 *
 * Order: validate, then meter, then call the model. Validating first is not
 * cosmetic — the stream helper validates again internally and throws, and if
 * that happened after `consume()` the caller would have been charged a tutor
 * turn for a request that never reached the model.
 */
tutorRoutes.post("/messages", async (c) => {
  const caller = guard(c, { scope: "tutor:write", tier: "ai" });

  const body = (await c.req.json().catch(() => null)) as { messages?: unknown } | null;
  const messages = body?.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    throw badRequest("`messages` must be a non-empty array of UI messages.");
  }

  // The cast is type-only: the tutor's tools have specific input schemas and
  // the validator's `tools` parameter is invariant in that input type, so a
  // concrete tool set is not assignable to it. The value passed is unchanged.
  const validated = await safeValidateUIMessages({
    messages,
    tools: tutorAgent.tools as Parameters<typeof safeValidateUIMessages>[0]["tools"],
  });
  if (!validated.success) {
    throw badRequest("`messages` must be UIMessage objects with an `id` and a `parts` array.", {
      detail: validated.error.message,
    });
  }

  const spend = await consume(caller.subject, caller.plan, "tutor_turn");
  if (!spend.consumed) {
    throw new ApiError(
      "quota_exceeded",
      caller.userId
        ? "You have used this period's tutor allowance."
        : `Anonymous callers get ${spend.limit} tutor questions. Authenticate for the free plan's monthly allowance.`,
      {
        meter: "tutor_turn",
        limit: spend.limit,
        used: spend.used,
        remaining: spend.remaining,
        resets_at: spend.resets_at,
        plan: caller.plan,
        /** True when the ceiling is fair-use rather than the advertised number. */
        fair_use: spend.fair_use,
      },
    );
  }

  const response = await createAgentUIStreamResponse({
    agent: tutorAgent,
    uiMessages: validated.data,
  });
  // The stream carries the request id too, so a support report about a bad
  // answer can be matched to its log line like any other call.
  response.headers.set("X-Request-Id", requestId(c));
  return response;
});

/** The stored transcript, oldest first — how a conversation survives a restart. */
tutorRoutes.get("/history", async (c) => {
  const caller = guard(c, { identity: "user", scope: "tutor:read" });
  const raw = Number(c.req.query("limit") ?? 60);
  const limit = Number.isFinite(raw) ? Math.max(10, Math.min(200, Math.floor(raw))) : 60;

  const rows = await db
    .select()
    .from(s.tutorMessages)
    .where(eq(s.tutorMessages.userId, caller.userId!))
    .orderBy(asc(s.tutorMessages.createdAt))
    .limit(limit);

  return ok(c, {
    messages: rows.map((r) => ({
      id: r.id,
      role: r.role,
      content: r.content,
      lesson_id: r.lessonId,
      created_at: r.createdAt.toISOString(),
    })),
    limit,
  });
});

/**
 * Append one message to the transcript.
 *
 * Storing a turn is not the same act as generating one and is deliberately
 * unmetered: the client streams a reply from `/messages` and then persists
 * both halves, and charging a second unit for writing down what was already
 * paid for would be double billing.
 */
tutorRoutes.post("/history", async (c) => {
  const caller = guard(c, { identity: "user", scope: "tutor:write" });
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) throw badRequest('Send a JSON body: { "role": "user", "content": "…" }.');

  const role = body.role;
  if (role !== "user" && role !== "assistant") {
    throw badRequest('`role` must be "user" or "assistant".');
  }
  const content = typeof body.content === "string" ? body.content : "";
  if (!content.trim()) throw badRequest("`content` is required.");
  if (content.length > 20_000) {
    throw new ApiError("payload_too_large", "`content` must be at most 20000 characters.");
  }

  const [row] = await db
    .insert(s.tutorMessages)
    .values({
      id: crypto.randomUUID(),
      userId: caller.userId!,
      role,
      content,
      lessonId: typeof body.lesson_id === "string" ? body.lesson_id : null,
    })
    .returning();

  return ok(
    c,
    {
      message: {
        id: row!.id,
        role: row!.role,
        content: row!.content,
        lesson_id: row!.lessonId,
        created_at: row!.createdAt.toISOString(),
      },
    },
    201,
  );
});

/** Delete the caller's own transcript. Their data, their call. */
tutorRoutes.delete("/history", async (c) => {
  const caller = guard(c, { identity: "user", scope: "tutor:write" });
  await db.delete(s.tutorMessages).where(eq(s.tutorMessages.userId, caller.userId!));
  return ok(c, { cleared: true });
});

/** Remaining tutor allowance, spending none of it. */
tutorRoutes.get("/usage", async (c) => {
  const caller = guard(c, { scope: "tutor:read" });
  return ok(c, {
    plan: caller.plan,
    meter: await peek(caller.subject, caller.plan, "tutor_turn"),
  });
});
