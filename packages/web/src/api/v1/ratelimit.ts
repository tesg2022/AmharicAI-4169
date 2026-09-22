import { anonSubject } from "../entitlements/usage";
import type { PlanId } from "../content/plans";
import { ApiError } from "./http";
import type { Caller } from "./caller";

/**
 * Request-rate limiting for `/v1`.
 *
 * This is NOT the quota system and does not replace it. The quotas in
 * `entitlements/usage.ts` cap what a plan may consume over a day or a month and
 * live in the database because they are billing. This caps how fast anyone may
 * call, over a sixty-second window, and lives in memory because it is abuse
 * control: the worst case of losing the state is that a burst gets through,
 * whereas the worst case of a database round trip on every request is that the
 * rate limiter becomes the bottleneck it was meant to prevent.
 *
 * Consequence, stated rather than hidden: the window is per process. A
 * multi-instance deployment gives each instance its own allowance, so the
 * effective ceiling is `limit x instances`. The numbers below are chosen so
 * that is acceptable — they exist to stop a runaway script and a scraper, and
 * the money is already protected by the per-subject quota, which is atomic and
 * shared. If `/v1` is ever opened to paying third parties, this moves behind a
 * shared store and nothing else has to change.
 *
 * Keying matches the quota system on purpose: signed-in callers by user id,
 * key callers by key id, anonymous callers by hashed address. An anonymous
 * caller cannot escape their bucket by clearing cookies, and a signed-in one
 * cannot multiply it by opening tabs.
 */

interface Window {
  count: number;
  /** ms since epoch when this window ends. */
  resetAt: number;
}

const windows = new Map<string, Window>();

/** Requests a minute, by plan, for session and anonymous callers. */
const PLAN_LIMITS: Record<PlanId, number> = {
  free: 60,
  basic: 180,
  premium: 600,
};

/**
 * Anonymous callers get a fraction of Free.
 *
 * One address can be a whole school, but it can equally be a script, and an
 * anonymous caller has nothing at stake. Generous enough that a class browsing
 * lessons never notices; small enough that scripting the tutor from a fresh
 * incognito window is pointless.
 */
const ANON_LIMIT = 30;

/**
 * The write endpoints cost more than the read ones, so they get their own
 * smaller window on top of the general one. A caller can read the course all
 * day and still only reach the model at a sane rate.
 */
export type Tier = "default" | "ai";

const AI_SHARE = 0.5;

function envOverride(name: string): number | null {
  const raw = process.env[name]?.trim();
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
}

export function limitFor(caller: Caller, tier: Tier): number {
  const override = envOverride(tier === "ai" ? "V1_RATE_LIMIT_AI" : "V1_RATE_LIMIT");
  const base =
    caller.key?.rateLimitPerMinute ??
    override ??
    (caller.kind === "anonymous" ? ANON_LIMIT : PLAN_LIMITS[caller.plan]);
  return tier === "ai" ? Math.max(1, Math.floor(base * AI_SHARE)) : base;
}

function keyFor(caller: Caller, tier: Tier): string {
  const who =
    caller.key?.id ??
    caller.userId ??
    anonSubject(caller.subject.address);
  return `${tier}:${who}`;
}

export interface RateState {
  limit: number;
  remaining: number;
  /** Seconds until the window rolls over. */
  resetSeconds: number;
}

/**
 * Count one request against the caller's window, or throw a 429.
 *
 * `Retry-After` and the `RateLimit-*` headers are always set, on the refusal
 * and on the success, so a well-behaved client can pace itself without ever
 * having to be refused first.
 */
export function enforce(caller: Caller, tier: Tier): RateState {
  const limit = limitFor(caller, tier);
  const key = keyFor(caller, tier);
  const nowMs = Date.now();

  let window = windows.get(key);
  if (!window || window.resetAt <= nowMs) {
    window = { count: 0, resetAt: nowMs + 60_000 };
    windows.set(key, window);
  }

  const resetSeconds = Math.max(1, Math.ceil((window.resetAt - nowMs) / 1000));

  if (window.count >= limit) {
    throw new ApiError(
      "rate_limited",
      `Too many requests. The limit is ${limit} a minute on this ${tier === "ai" ? "AI " : ""}endpoint group; it resets in ${resetSeconds}s.`,
      { reason: "rate_limited", limit, window_seconds: 60, retry_after_seconds: resetSeconds },
      {
        "Retry-After": String(resetSeconds),
        "RateLimit-Limit": String(limit),
        "RateLimit-Remaining": "0",
        "RateLimit-Reset": String(resetSeconds),
      },
    );
  }

  window.count += 1;
  sweep(nowMs);

  return { limit, remaining: Math.max(0, limit - window.count), resetSeconds };
}

/**
 * Drop expired windows so the map cannot grow without bound.
 *
 * Amortised rather than scheduled: an interval timer would keep the process
 * alive and would run in every test and every build that imports this module.
 * Sweeping at most once a minute, on a request that was already happening,
 * costs nothing measurable and needs no lifecycle.
 */
let sweptAt = 0;

function sweep(nowMs: number): void {
  if (nowMs - sweptAt < 60_000) return;
  sweptAt = nowMs;
  for (const [key, window] of windows) {
    if (window.resetAt <= nowMs) windows.delete(key);
  }
}

export function headersFor(state: RateState): Record<string, string> {
  return {
    "RateLimit-Limit": String(state.limit),
    "RateLimit-Remaining": String(state.remaining),
    "RateLimit-Reset": String(state.resetSeconds),
  };
}
