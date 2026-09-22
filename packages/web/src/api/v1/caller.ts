import type { Context } from "hono";
import { auth } from "../auth";
import { clientAddress } from "../entitlements/request";
import { resolvePlan } from "../entitlements/resolve";
import type { PlanId } from "../content/plans";
import type { Subject } from "../entitlements/usage";
import type { ApiKeyRow, ApiScope } from "../database/schema";
import { looksLikeApiKey, permits, verify } from "./keys";
import { ApiError, forbidden, unauthorized } from "./http";

/**
 * Who is calling `/v1`, and what are they entitled to.
 *
 * Three kinds of caller, resolved in this order:
 *
 *   1. An API key (`Authorization: Bearer ak_live_…` or `X-API-Key`). Acts as
 *      the key's owning user and is limited to the key's scopes.
 *   2. A Better Auth session (cookie, or the bearer token the mobile client
 *      holds). This is what the first-party web, Expo and Electron clients use
 *      today, unchanged.
 *   3. Anonymous. Allowed on the read and try-it endpoints, metered by hashed
 *      address, refused on anything that needs an account.
 *
 * The plan always comes from `resolvePlan()` against the resolved user — never
 * from the key, never from a header, never from a query parameter. That is the
 * one rule that keeps `/v1` from becoming a way to self-upgrade: a caller can
 * choose how they authenticate and cannot choose what they are entitled to.
 *
 * A malformed or dead key is a 401, deliberately, rather than a silent fall
 * through to anonymous. Falling through would answer a broken integration with
 * a 200 and a mysteriously tiny quota, and the developer would spend an
 * afternoon on it.
 */

export type CallerKind = "key" | "session" | "anonymous";

export interface Caller {
  kind: CallerKind;
  userId: string | null;
  plan: PlanId;
  /** Metering identity — the same `Subject` the oRPC and plain routes use. */
  subject: Subject;
  /** Scopes in force. A session caller holds the full set. */
  scopes: ApiScope[];
  /** Set when `kind` is "key". Used by the rate limiter and the request log. */
  key: { id: string; prefix: string; rateLimitPerMinute: number | null } | null;
  /** Verified entitlement, i.e. paid or code-granted rather than defaulted. */
  planVerified: boolean;
}

/** Full authority. A first-party session is not scope-limited. */
const ALL: ApiScope[] = ["*"];

export async function resolveCaller(c: Context): Promise<Caller> {
  const presented = c.req.header("x-api-key") ?? c.req.header("authorization") ?? null;

  if (looksLikeApiKey(presented)) {
    const row = await verify(presented!);
    if (!row) {
      throw new ApiError(
        "unauthorized",
        "That API key is not valid. It may have been revoked, expired, or mistyped.",
        { reason: "invalid_api_key" },
      );
    }
    return fromKey(row);
  }

  const session = await auth.api.getSession({ headers: c.req.raw.headers }).catch(() => null);
  if (session?.user) {
    const resolved = await resolvePlan({ userId: session.user.id });
    return {
      kind: "session",
      userId: session.user.id,
      plan: resolved.plan,
      subject: { userId: session.user.id, address: null },
      scopes: ALL,
      key: null,
      planVerified: resolved.plan_is_verified,
    };
  }

  // Anonymous. The address is only ever a metering key and is HMAC'd before it
  // reaches the database — see `anonSubject` in entitlements/usage.ts.
  return {
    kind: "anonymous",
    userId: null,
    plan: "free",
    subject: { userId: null, address: clientAddress(c) },
    scopes: ALL,
    key: null,
    planVerified: false,
  };
}

async function fromKey(row: ApiKeyRow): Promise<Caller> {
  const resolved = await resolvePlan({ userId: row.userId });
  return {
    kind: "key",
    userId: row.userId,
    plan: resolved.plan,
    subject: { userId: row.userId, address: null },
    scopes: row.scopes,
    key: { id: row.id, prefix: row.prefix, rateLimitPerMinute: row.rateLimitPerMinute },
    planVerified: resolved.plan_is_verified,
  };
}

/**
 * Require an account.
 *
 * The message names the two ways to get one rather than saying "unauthorized",
 * because a 401 with no instructions is the single most common reason an
 * integration stalls.
 */
export function requireUser(caller: Caller): string {
  if (caller.userId) return caller.userId;
  throw unauthorized(
    "This endpoint needs an account. Sign in, or send an API key as `Authorization: Bearer ak_live_…`.",
    { reason: "authentication_required" },
  );
}

/** Require a session specifically — used where a key must not be sufficient. */
export function requireSession(caller: Caller): string {
  if (caller.kind === "session" && caller.userId) return caller.userId;
  if (caller.kind === "key") {
    throw forbidden(
      "API keys cannot manage API keys. Sign in to issue or revoke a key.",
      { reason: "session_required" },
    );
  }
  throw unauthorized("Sign in to manage API keys.", { reason: "authentication_required" });
}

/** Require a scope. No-op for sessions and anonymous callers, which hold `*`. */
export function requireScope(caller: Caller, scope: ApiScope): void {
  if (permits(caller.scopes, scope)) return;
  throw forbidden(`This API key does not have the \`${scope}\` scope.`, {
    reason: "missing_scope",
    required_scope: scope,
    scopes: caller.scopes,
  });
}

/**
 * Require a plan tier.
 *
 * 402 rather than 403: the request is well-formed and the caller is who they
 * say they are — what is missing is a payment. `detail.required_plan` is what
 * a client renders an upgrade prompt from, so it is always present.
 */
export function requirePlan(caller: Caller, minimum: Exclude<PlanId, "free">): void {
  const order: PlanId[] = ["free", "basic", "premium"];
  if (order.indexOf(caller.plan) >= order.indexOf(minimum)) return;
  throw new ApiError(
    "plan_required",
    `This endpoint is included from the ${minimum} plan.`,
    { reason: "plan_required", required_plan: minimum, current_plan: caller.plan },
  );
}
