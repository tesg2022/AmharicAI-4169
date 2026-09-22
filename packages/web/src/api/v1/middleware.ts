import type { Context, MiddlewareHandler } from "hono";
import type { ApiScope } from "../database/schema";
import type { PlanId } from "../content/plans";
import { requestId } from "./http";
import { resolveCaller, requirePlan, requireScope, requireSession, requireUser, type Caller } from "./caller";
import { enforce, headersFor, type Tier } from "./ratelimit";

/**
 * The `/v1` request pipeline: identify, rate limit, log.
 *
 * It runs once per request, before any handler, so that three things are true
 * everywhere in `/v1` without a single route having to remember them:
 *
 *   - Every response carries a request id, and every log line is keyed by it.
 *   - Every caller is identified before any work happens, which is what makes
 *     the rate limit and the quota attributable rather than global.
 *   - Every request produces exactly one structured log line, including the
 *     ones that throw.
 *
 * Authorisation is *not* here. Scopes and plan tiers differ per route, so they
 * are declared at the route with `guard()` — a middleware that tried to infer
 * them from the path would be a second, silently-drifting copy of the routing
 * table.
 */

/**
 * What goes in the log, and what deliberately does not.
 *
 * Not logged: request bodies, query strings, transcripts, learner text, audio,
 * API keys, session tokens, raw IP addresses. Lesson text is the product and
 * learner speech is personal; neither belongs in an operational log, and a log
 * that contains them becomes a data-retention problem the privacy policy has to
 * answer for.
 *
 * Logged: the route, the outcome, how long it took, and who to bill — the
 * caller kind, the user id, the key prefix and the plan. That is enough to
 * answer "why is this slow", "who is hammering us" and "which key broke",
 * which is the entire job.
 */
interface LogLine {
  level: "info" | "warn" | "error";
  at: string;
  request_id: string;
  method: string;
  path: string;
  status: number;
  ms: number;
  caller: Caller["kind"];
  user_id: string | null;
  api_key: string | null;
  plan: PlanId | null;
}

function emit(line: LogLine): void {
  const json = JSON.stringify(line);
  if (line.level === "error") console.error(json);
  else if (line.level === "warn") console.warn(json);
  else console.log(json);
}

function level(status: number): LogLine["level"] {
  if (status >= 500) return "error";
  if (status >= 400) return "warn";
  return "info";
}

export const pipeline: MiddlewareHandler = async (c, next) => {
  const started = performance.now();
  const id = requestId(c);
  c.header("X-Request-Id", id);

  let caller: Caller | null = null;
  try {
    caller = await resolveCaller(c);
    c.set("caller", caller);

    // The general window. AI routes add their own tighter one in `guard()`.
    const state = enforce(caller, "default");
    for (const [k, v] of Object.entries(headersFor(state))) c.header(k, v);

    await next();
  } finally {
    emit({
      level: level(c.res.status),
      at: new Date().toISOString(),
      request_id: id,
      method: c.req.method,
      path: new URL(c.req.url).pathname,
      status: c.res.status,
      ms: Math.round(performance.now() - started),
      caller: caller?.kind ?? "anonymous",
      user_id: caller?.userId ?? null,
      // The prefix, never the key. It identifies the credential in support and
      // in an abuse investigation without being one.
      api_key: caller?.key?.prefix ?? null,
      plan: caller?.plan ?? null,
    });
  }
};

/**
 * Read the caller the pipeline resolved.
 *
 * Throws rather than re-resolving if it is missing, because a `/v1` route
 * mounted outside the pipeline would otherwise run unidentified, unmetered and
 * unlogged — exactly the failure this whole layer exists to make impossible.
 */
export function callerOf(c: Context): Caller {
  const caller = c.get("caller") as Caller | undefined;
  if (!caller) throw new Error("v1 route reached without the /v1 pipeline — mount it under mountV1().");
  return caller;
}

export interface GuardOptions {
  /** Scope an API key must hold. Sessions and anonymous callers hold them all. */
  scope?: ApiScope;
  /**
   * "user" accepts a session or a key; "session" rejects keys (key management);
   * omitted allows anonymous.
   */
  identity?: "user" | "session";
  /** Minimum plan tier. Raises 402 with `required_plan`, not a bare 403. */
  plan?: Exclude<PlanId, "free">;
  /** Count this request against the tighter AI window too. */
  tier?: Tier;
}

/**
 * Per-route authorisation, declared at the route.
 *
 * The order is not arbitrary: identity, then scope, then rate, then plan.
 * Identity first because every later check reads it. Scope before rate so a key
 * that could never succeed is told so immediately rather than being allowed to
 * consume its own allowance learning that. Plan last because it is the only
 * check whose answer can change by the caller paying — a 402 is the most useful
 * thing to be told, so it is not masked by a 429.
 */
export function guard(c: Context, options: GuardOptions = {}): Caller {
  const caller = callerOf(c);

  if (options.identity === "session") requireSession(caller);
  else if (options.identity === "user") requireUser(caller);

  if (options.scope) requireScope(caller, options.scope);

  if (options.tier && options.tier !== "default") {
    const state = enforce(caller, options.tier);
    for (const [k, v] of Object.entries(headersFor(state))) c.header(k, v);
  }

  if (options.plan) requirePlan(caller, options.plan);

  return caller;
}
