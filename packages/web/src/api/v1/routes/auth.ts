import { Hono } from "hono";
import { API_SCOPES, type ApiScope } from "../../database/schema";
import { badRequest, notFound, ok } from "../http";
import { isScope, issue, listFor, publicView, revoke } from "../keys";
import { guard } from "../middleware";

/**
 * `/v1/auth` — who am I, and the keys I call with.
 *
 * Note what is *not* here: no login, no signup, no password reset, no token
 * refresh. Authentication is Better Auth at `/api/auth/*`, and reimplementing
 * any of it behind a second URL would mean two code paths deciding who a
 * person is — which is how an auth bypass gets written. This surface reads the
 * session Better Auth already established and manages the credentials that
 * stand in for it on a server-to-server call.
 *
 * Issuing and revoking keys requires a *session*, never a key. A key that can
 * mint keys cannot be meaningfully revoked: whoever holds it issues a fresh
 * one the moment you kill it. So the escalation path is closed at the door,
 * and the error explains why rather than saying "forbidden".
 */

export const authRoutes = new Hono();

/**
 * Whoami. The endpoint an integrator calls first, so it answers the four
 * questions they are actually asking: did my credential work, who am I acting
 * as, what am I entitled to, and what may this credential do.
 */
authRoutes.get("/me", (c) => {
  const caller = guard(c);
  return ok(c, {
    authenticated: caller.kind !== "anonymous",
    /** "session", "key" or "anonymous" — which credential was accepted. */
    auth: caller.kind,
    user_id: caller.userId,
    plan: caller.plan,
    /** True when the plan is paid or code-granted rather than defaulted. */
    plan_is_verified: caller.planVerified,
    scopes: caller.scopes,
    api_key: caller.key ? { id: caller.key.id, prefix: caller.key.prefix } : null,
  });
});

/** The scope vocabulary, so a client is not writing scope strings from a doc. */
authRoutes.get("/scopes", (c) => {
  guard(c);
  return ok(c, { scopes: [...API_SCOPES] });
});

authRoutes.get("/keys", async (c) => {
  const caller = guard(c, { identity: "session" });
  return ok(c, { keys: await listFor(caller.userId!) });
});

/**
 * Issue a key.
 *
 * The secret is in this response and in no other, ever — only its SHA-256
 * hash is stored, so there is no endpoint and no support procedure that can
 * recover it. 201 says the same thing the body does, and `key` is named at
 * the top level so it is obvious that this is the one payload worth keeping.
 */
authRoutes.post("/keys", async (c) => {
  const caller = guard(c, { identity: "session" });
  const body = await c.req.json().catch(() => null);
  const raw = (body ?? {}) as Record<string, unknown>;

  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!name || name.length > 80) {
    throw badRequest("`name` is required and must be 1-80 characters — it is how you tell your keys apart.");
  }

  let scopes: ApiScope[] | undefined;
  if (raw.scopes !== undefined) {
    if (!Array.isArray(raw.scopes) || raw.scopes.some((s) => typeof s !== "string")) {
      throw badRequest("`scopes` must be an array of scope strings. GET /v1/auth/scopes lists them.");
    }
    const unknown = (raw.scopes as string[]).filter((s) => !isScope(s));
    if (unknown.length) {
      throw badRequest(`Unknown scope(s): ${unknown.join(", ")}. GET /v1/auth/scopes lists them.`, {
        unknown_scopes: unknown,
      });
    }
    scopes = raw.scopes as ApiScope[];
  }

  let expiresAt: Date | null = null;
  if (typeof raw.expires_at === "string" && raw.expires_at) {
    const parsed = new Date(raw.expires_at);
    if (Number.isNaN(parsed.getTime())) throw badRequest("`expires_at` must be an ISO 8601 timestamp.");
    if (parsed.getTime() <= Date.now()) throw badRequest("`expires_at` must be in the future.");
    expiresAt = parsed;
  }

  const rateLimit =
    typeof raw.rate_limit_per_minute === "number" && Number.isFinite(raw.rate_limit_per_minute)
      ? Math.max(1, Math.min(6000, Math.floor(raw.rate_limit_per_minute)))
      : null;

  const issued = await issue({
    userId: caller.userId!,
    name,
    scopes,
    expiresAt,
    rateLimitPerMinute: rateLimit,
    testMode: raw.test_mode === true,
  });

  return ok(
    c,
    {
      /** Shown once. Store it now; it cannot be retrieved or reset later. */
      key: issued.key,
      warning: "This is the only time the key is returned. Store it now — only its hash is kept.",
      api_key: publicView(issued.row),
    },
    201,
  );
});

/**
 * Revoke a key. Idempotent — revoking an already-revoked key answers 200
 * rather than an error, because a retried cleanup script should not have to
 * distinguish "I revoked it" from "it was already gone".
 */
authRoutes.delete("/keys/:id", async (c) => {
  const caller = guard(c, { identity: "session" });
  const existed = await revoke({ userId: caller.userId!, id: c.req.param("id") });
  if (!existed) throw notFound("No API key with that id on this account.");
  return ok(c, { revoked: true, id: c.req.param("id") });
});
