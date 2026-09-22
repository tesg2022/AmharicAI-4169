import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * Credentials for the versioned REST surface (`/v1`).
 *
 * The `/v1` routes are internal today — the website, the Expo app and the
 * Electron build all call them with the same Better Auth session they already
 * hold, and nothing about that changes. This table exists so that opening the
 * surface to an external developer later is a row in a database rather than a
 * second authentication design bolted onto live routes: the key check is
 * already on every `/v1` handler, already scoped, already rate limited, and
 * already the thing the logs are keyed by.
 *
 * What is deliberately NOT here:
 *
 *   - The key itself. Only a SHA-256 hash is stored, so a dump of this table
 *     cannot be replayed against the API. The plaintext is returned exactly
 *     once, at creation, and is unrecoverable afterwards — the same bargain
 *     every credible API makes, and the only one that survives a leaked backup.
 *   - A plan column. Entitlement stays in `resolvePlan()`, read from the
 *     owning user on every request. A plan frozen onto a key would keep
 *     granting Premium after the subscription lapsed, which is a billing hole
 *     dressed up as a cache.
 */

const now = sql`(unixepoch())`;

/**
 * What a key is allowed to do. Checked per route, not per table, because the
 * unit a developer reasons about is "can this key speak" rather than "can this
 * key write speech_audio".
 *
 * `*` is the full set and is what an internal first-party key gets. Anything
 * issued to a third party should name its scopes explicitly, so a leaked
 * read-only key cannot spend the operator's AI budget.
 */
export const API_SCOPES = [
  "*",
  "tts:read",
  "tts:synthesize",
  "asr:transcribe",
  "translate",
  "tutor:read",
  "tutor:write",
  "lessons:read",
  "progress:read",
  "progress:write",
  "subscriptions:read",
] as const;
export type ApiScope = (typeof API_SCOPES)[number];

export const apiKeys = sqliteTable(
  "api_keys",
  {
    id: text("id").primaryKey(),
    /**
     * The user the key acts as. Every metered call a key makes is billed to
     * this account's quota and resolved against this account's plan, which is
     * what stops a key from being an unmetered side door into the AI budget.
     */
    userId: text("user_id").notNull(),
    /** Human label, shown in the key list. Never part of the credential. */
    name: text("name").notNull(),
    /**
     * The non-secret leading segment (`ak_live_7f2a…`), stored so the UI and
     * the logs can name a key without holding one. Unique because it is what a
     * support conversation identifies a key by.
     */
    prefix: text("prefix").notNull(),
    /** SHA-256 of the full presented key, hex. The only copy we keep. */
    keyHash: text("key_hash").notNull(),
    scopes: text("scopes", { mode: "json" }).$type<ApiScope[]>().notNull(),
    /**
     * Per-key ceiling, requests per minute. Null means the caller's plan
     * default applies — see `v1/ratelimit.ts`. A number here only ever lowers
     * it in practice, which is how a noisy integration gets contained without
     * touching anyone else.
     */
    rateLimitPerMinute: integer("rate_limit_per_minute"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(now),
    /** Optional expiry. An expired key fails exactly like a revoked one. */
    expiresAt: integer("expires_at", { mode: "timestamp" }),
    revokedAt: integer("revoked_at", { mode: "timestamp" }),
    /**
     * Last successful use, written best-effort and at most once a minute per
     * key. It is an operational hint for "is this key still in use", not an
     * audit log — the request log is the audit trail.
     */
    lastUsedAt: integer("last_used_at", { mode: "timestamp" }),
  },
  (t) => [
    uniqueIndex("api_key_hash").on(t.keyHash),
    uniqueIndex("api_key_prefix").on(t.prefix),
    index("idx_api_key_user").on(t.userId),
  ],
);

export type ApiKeyRow = typeof apiKeys.$inferSelect;
