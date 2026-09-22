import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

/**
 * The `/v1` wire contract: one error shape, one success shape, one request id.
 *
 * Every REST client that has ever had to special-case an API's fourth error
 * format is the argument for this file. A `/v1` failure is always:
 *
 *   { "error": { "code": "quota_exceeded", "message": "…", "detail": {…} },
 *     "request_id": "…" }
 *
 * `code` is machine-readable and stable — clients branch on it. `message` is
 * for a human and may be reworded at any time. `detail` carries whatever the
 * code implies (a reset date for a quota, the required plan for a paywall) and
 * is never a free-form string dump.
 *
 * The status codes are the obvious HTTP ones and are not negotiable per route,
 * because a client's retry logic is written against them: 401 re-authenticate,
 * 403 do not retry, 429 back off until `Retry-After`, 5xx retry with jitter.
 */

/** Stable, documented failure codes. Clients are expected to branch on these. */
export type ErrorCode =
  | "bad_request"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "method_not_allowed"
  | "payload_too_large"
  | "unsupported_media_type"
  | "quota_exceeded"
  | "rate_limited"
  | "plan_required"
  | "not_configured"
  | "upstream_failed"
  | "internal";

const STATUS: Record<ErrorCode, ContentfulStatusCode> = {
  bad_request: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  method_not_allowed: 405,
  payload_too_large: 413,
  unsupported_media_type: 415,
  plan_required: 402,
  quota_exceeded: 429,
  rate_limited: 429,
  not_configured: 503,
  upstream_failed: 502,
  internal: 500,
};

/**
 * A failure a handler raises on purpose.
 *
 * Throwing rather than returning is what lets a deep helper — the quota check,
 * the scope check, a provider adapter — refuse a request without every caller
 * in between having to forward an error value. `onError` below turns it into
 * the envelope.
 */
export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly detail?: Record<string, unknown>,
    /** Extra response headers, e.g. `Retry-After` on a 429. */
    readonly headers?: Record<string, string>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const badRequest = (message: string, detail?: Record<string, unknown>) =>
  new ApiError("bad_request", message, detail);

export const notFound = (message: string, detail?: Record<string, unknown>) =>
  new ApiError("not_found", message, detail);

export const unauthorized = (message: string, detail?: Record<string, unknown>) =>
  new ApiError("unauthorized", message, detail);

export const forbidden = (message: string, detail?: Record<string, unknown>) =>
  new ApiError("forbidden", message, detail);

/** Request id — echoed in every response and in the log line for that request. */
export function requestId(c: Context): string {
  const existing = c.get("requestId") as string | undefined;
  if (existing) return existing;
  // An inbound id is honoured so a trace spanning the app and the API keeps one
  // identifier. It is length-capped and stripped of anything that is not
  // id-shaped, because it lands in log lines and a header is attacker-supplied.
  const inbound = c.req.header("x-request-id")?.replace(/[^\w.-]/g, "").slice(0, 64);
  const id = inbound || crypto.randomUUID();
  c.set("requestId", id);
  return id;
}

/** Success envelope. Payload at the top level, meta alongside it. */
export function ok<T extends Record<string, unknown>>(
  c: Context,
  payload: T,
  status: ContentfulStatusCode = 200,
) {
  return c.json({ ...payload, request_id: requestId(c) }, status);
}

export function fail(c: Context, error: ApiError) {
  const body = {
    error: {
      code: error.code,
      message: error.message,
      ...(error.detail ? { detail: error.detail } : {}),
    },
    request_id: requestId(c),
  };
  const response = c.json(body, STATUS[error.code]);
  for (const [k, v] of Object.entries(error.headers ?? {})) response.headers.set(k, v);
  return response;
}

/**
 * The last line of defence.
 *
 * An unexpected throw becomes one 500 with a generic message and the request
 * id, and the actual error goes to the server log under that same id. This is
 * the difference between "tell support request 9f2c…" and leaking a database
 * error, a provider URL or a stack trace to whoever is probing the endpoint.
 */
export function onError(error: Error, c: Context) {
  if (error instanceof ApiError) return fail(c, error);

  const id = requestId(c);
  console.error(
    JSON.stringify({
      level: "error",
      at: new Date().toISOString(),
      request_id: id,
      method: c.req.method,
      path: new URL(c.req.url).pathname,
      message: error.message,
      stack: error.stack?.split("\n").slice(0, 6).join("\n"),
    }),
  );

  return fail(
    c,
    new ApiError(
      "internal",
      "The server failed to handle this request. Nothing was charged. Quote the request id if you report this.",
    ),
  );
}

/** JSON body, or a 400 that says the body was the problem. */
export async function jsonBody<T>(c: Context): Promise<T> {
  const type = c.req.header("content-type") ?? "";
  if (!type.includes("application/json")) {
    throw new ApiError("unsupported_media_type", "Send a JSON body with Content-Type: application/json.");
  }
  const parsed = await c.req.json().catch(() => null);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw badRequest("The request body must be a JSON object.");
  }
  return parsed as T;
}
