import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../database";
import { apiKeys, API_SCOPES, type ApiKeyRow, type ApiScope } from "../database/schema";

/**
 * API keys for `/v1`.
 *
 * Four properties this file exists to hold in one place:
 *
 *   1. The plaintext key is never stored and never logged. `issue()` is the
 *      only function that has ever seen it, and it hands it back once.
 *   2. Lookup is by hash, not by scan. The presented key hashes to a unique
 *      index, so verification is a single indexed read rather than "fetch all
 *      keys and compare", which is both slow and a timing oracle.
 *   3. Revocation and expiry fail identically. A caller must not be able to
 *      tell a revoked key from an expired one from a key that never existed —
 *      all three are one 401 with the same body.
 *   4. A key carries no entitlement of its own. It names a user; the plan is
 *      resolved from that user on every request.
 */

/** Live keys start `ak_live_`, test-mode ones `ak_test_`. */
const LIVE_PREFIX = "ak_live_";
const TEST_PREFIX = "ak_test_";

/** 32 bytes of CSPRNG, base64url. Sized so guessing is not a strategy. */
function secret(): string {
  return randomBytes(32).toString("base64url");
}

function hash(presented: string): string {
  return createHash("sha256").update(presented).digest("hex");
}

/**
 * Whether a header value even looks like one of our keys.
 *
 * Used to decide between the key path and the session path before touching the
 * database: an `Authorization: Bearer <better-auth-token>` must not turn into a
 * failed key lookup, and a malformed key must not turn into an anonymous
 * request that silently succeeds with a smaller quota.
 */
export function looksLikeApiKey(value: string | null | undefined): boolean {
  if (!value) return false;
  const raw = value.startsWith("Bearer ") ? value.slice(7).trim() : value.trim();
  return raw.startsWith(LIVE_PREFIX) || raw.startsWith(TEST_PREFIX);
}

export function stripBearer(value: string): string {
  return value.startsWith("Bearer ") ? value.slice(7).trim() : value.trim();
}

export interface IssuedKey {
  row: ApiKeyRow;
  /**
   * The only time the plaintext exists outside the caller's own storage.
   * Return it to the user once and do not write it anywhere.
   */
  key: string;
}

export function isScope(value: string): value is ApiScope {
  return (API_SCOPES as readonly string[]).includes(value);
}

/**
 * Mint a key for a user.
 *
 * `testMode` only changes the visible prefix. It is a label for the developer's
 * own benefit — this API has no sandbox that fakes responses, so a test key
 * spends real quota and the prefix is there to stop somebody shipping the wrong
 * one, not to make it harmless.
 */
export async function issue(opts: {
  userId: string;
  name: string;
  scopes?: ApiScope[];
  expiresAt?: Date | null;
  rateLimitPerMinute?: number | null;
  testMode?: boolean;
}): Promise<IssuedKey> {
  const body = secret();
  const key = `${opts.testMode ? TEST_PREFIX : LIVE_PREFIX}${body}`;

  const [row] = await db
    .insert(apiKeys)
    .values({
      id: crypto.randomUUID(),
      userId: opts.userId,
      name: opts.name,
      // Enough to identify the key in a list or a log line, far too little to
      // reconstruct it: 8 characters of a 43-character base64url secret.
      prefix: key.slice(0, key.indexOf("_", 3) + 1 + 8),
      keyHash: hash(key),
      scopes: opts.scopes?.length ? opts.scopes : ["*"],
      rateLimitPerMinute: opts.rateLimitPerMinute ?? null,
      expiresAt: opts.expiresAt ?? null,
    })
    .returning();

  return { row: row!, key };
}

/** Every key on an account, newest first. Hashes are not returned. */
export async function listFor(userId: string) {
  const rows = await db.select().from(apiKeys).where(eq(apiKeys.userId, userId));
  return rows
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .map((r) => publicView(r));
}

export function publicView(row: ApiKeyRow) {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    scopes: row.scopes,
    rate_limit_per_minute: row.rateLimitPerMinute,
    created_at: row.createdAt.toISOString(),
    expires_at: row.expiresAt?.toISOString() ?? null,
    revoked_at: row.revokedAt?.toISOString() ?? null,
    last_used_at: row.lastUsedAt?.toISOString() ?? null,
    status: keyState(row),
  };
}

function keyState(row: ApiKeyRow): "active" | "revoked" | "expired" {
  if (row.revokedAt) return "revoked";
  if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) return "expired";
  return "active";
}

/**
 * Revoke a key.
 *
 * Ownership is checked in the same statement that writes, so a caller holding
 * somebody else's key id changes nothing and is told the key does not exist.
 * Already-revoked is reported as success: the state the caller asked for is
 * true, and a 404 there would only invite a retry loop.
 */
export async function revoke(opts: { userId: string; id: string }): Promise<boolean> {
  const updated = await db
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiKeys.id, opts.id), eq(apiKeys.userId, opts.userId), isNull(apiKeys.revokedAt)))
    .returning({ id: apiKeys.id });
  if (updated.length > 0) return true;

  const [existing] = await db
    .select({ id: apiKeys.id })
    .from(apiKeys)
    .where(and(eq(apiKeys.id, opts.id), eq(apiKeys.userId, opts.userId)))
    .limit(1);
  return Boolean(existing);
}

/**
 * Resolve a presented key to its row, or null.
 *
 * The constant-time compare after the indexed lookup is belt and braces: the
 * hash column is unique so the query already decides the match, but comparing
 * the digests without `timingSafeEqual` would leave a byte-wise early exit in
 * the hot path for anyone who later changes the lookup.
 */
export async function verify(presented: string): Promise<ApiKeyRow | null> {
  const raw = stripBearer(presented);
  if (!raw.startsWith(LIVE_PREFIX) && !raw.startsWith(TEST_PREFIX)) return null;

  const digest = hash(raw);
  const [row] = await db.select().from(apiKeys).where(eq(apiKeys.keyHash, digest)).limit(1);
  if (!row) return null;

  const a = Buffer.from(row.keyHash, "hex");
  const b = Buffer.from(digest, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  if (keyState(row) !== "active") return null;

  touch(row).catch(() => undefined);
  return row;
}

/**
 * Best-effort `lastUsedAt`, throttled to once a minute per key.
 *
 * Without the throttle this is a write on every single API request, which
 * turns a read-only endpoint into a write-amplified one for a field nobody
 * reads more precisely than "today". It is intentionally not awaited by the
 * request path and its failure is intentionally ignored: losing this timestamp
 * is not worth failing a request over.
 */
const touched = new Map<string, number>();

async function touch(row: ApiKeyRow): Promise<void> {
  const last = touched.get(row.id) ?? 0;
  const nowMs = Date.now();
  if (nowMs - last < 60_000) return;
  touched.set(row.id, nowMs);
  await db.update(apiKeys).set({ lastUsedAt: new Date(nowMs) }).where(eq(apiKeys.id, row.id));
}

/**
 * Does this key's scope set permit `needed`?
 *
 * `*` permits everything. An unknown scope permits nothing — a typo in an
 * issued key's scope list must deny rather than accidentally widen, which is
 * why this is a membership test and never a prefix match.
 */
export function permits(scopes: ApiScope[] | null | undefined, needed: ApiScope): boolean {
  if (!scopes || scopes.length === 0) return false;
  return scopes.includes("*") || scopes.includes(needed);
}
