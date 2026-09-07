import { createHmac, randomInt, timingSafeEqual } from "node:crypto";

/**
 * Six-digit comp code primitives.
 *
 * The honest framing of the threat: six digits is a keyspace of 1,000,000.
 * Unthrottled, that is minutes of guessing. This module therefore never treats
 * secrecy of the code as the only defence — it exists alongside single-use
 * redemption, an admin-set expiry, a global redemption cap, binding to an
 * already-authenticated account, and a hard lockout (see `routes/access.ts`).
 *
 * At rest the code is HMAC-SHA256(pepper, code), not a bare hash. A bare
 * SHA-256 over 10^6 candidates is reversed offline in milliseconds by anyone
 * who can read the table, so it would protect nobody. The pepper lives in the
 * environment, not the database, which means a database leak alone does not
 * yield the codes. HMAC is deterministic, so redemption stays one indexed
 * lookup rather than a scan.
 */

/** Digits in an issued code. Not configurable — the UI and the copy say six. */
export const CODE_LENGTH = 6;

export interface PepperConfig {
  pepper: string;
  configured: boolean;
  /** Which env var supplied it — surfaced to admins, never the value. */
  source: "ACCESS_CODE_PEPPER" | "BETTER_AUTH_SECRET" | "none";
}

/**
 * Read at request time, not at module load, so a key added to the environment
 * takes effect on a restart of the process rather than needing a rebuild —
 * the same pattern the translation and TTS config already use.
 *
 * `BETTER_AUTH_SECRET` is a documented fallback because auth cannot work
 * without it, so it is guaranteed present wherever codes could be redeemed.
 * If neither exists we refuse: silently deriving a pepper from a constant
 * would look like it worked and protect nothing.
 */
export function pepperConfig(): PepperConfig {
  const dedicated = process.env["ACCESS_CODE_PEPPER"]?.trim() ?? "";
  if (dedicated) {
    return { pepper: dedicated, configured: true, source: "ACCESS_CODE_PEPPER" };
  }
  const fallback = process.env["BETTER_AUTH_SECRET"]?.trim() ?? "";
  if (fallback) {
    return { pepper: fallback, configured: true, source: "BETTER_AUTH_SECRET" };
  }
  return { pepper: "", configured: false, source: "none" };
}

/** HMAC-SHA256(pepper, code) as hex. Throws if no pepper is configured. */
export function hashCode(code: string, pepper: string): string {
  if (!pepper) throw new Error("access codes are not configured");
  return createHmac("sha256", pepper).update(code).digest("hex");
}

/**
 * A uniformly random six-digit code, leading zeros included.
 *
 * `randomInt` is the CSPRNG, not `Math.random`: a predictable generator would
 * make every other control here decorative, because an attacker who can guess
 * the next code does not need to brute-force anything.
 */
export function generateCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(CODE_LENGTH, "0");
}

/** The only part of a code we ever show again: its last two digits. */
export function codeHint(code: string): string {
  return code.slice(-2);
}

export function isWellFormedCode(value: string): boolean {
  return new RegExp(`^\\d{${CODE_LENGTH}}$`).test(value);
}

/**
 * Constant-time comparison of two hex digests.
 *
 * The database lookup is already an equality match, so this guards the final
 * confirmation only — but a timing-variable compare on a 10^6 space is exactly
 * the kind of leak that turns a brute force from impractical into cheap.
 */
export function hashesEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  if (left.length !== right.length || left.length === 0) return false;
  return timingSafeEqual(left, right);
}
