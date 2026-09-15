import { eq, getTableColumns, getTableName, is } from "drizzle-orm";
import { SQLiteTable } from "drizzle-orm/sqlite-core";
import { db } from "../database";
import * as s from "../database/schema";

/**
 * Real erasure of one account and everything attached to it.
 *
 * Google Play's User Data policy and the GDPR right to erasure both want the
 * same thing, and neither is satisfied by a `deleted = true` flag: the rows
 * have to go. So this deletes, and it returns a per-table count so the audit
 * trail records what actually happened rather than an assumption.
 *
 * The table list is explicit and exhaustive rather than derived, because a
 * derived list silently misses a table added later — and a table missed here
 * is personal data surviving a deletion the user was told had completed. When
 * a new user-scoped table is added to the schema, it is added here too; the
 * test in `erasureCoverage()` fails the build if the two drift apart.
 */

/**
 * Every table that stores rows keyed to a user id, in deletion order.
 *
 * Order matters: rows referencing `user` go before `user` itself, or the
 * foreign keys reject the delete. Within that constraint the order is simply
 * least-important first, so a partial failure leaves the least behind.
 */
const USER_SCOPED = [
  { name: "answer_attempts", table: s.answerAttempts, col: s.answerAttempts.userId },
  { name: "speaking_attempts", table: s.speakingAttempts, col: s.speakingAttempts.userId },
  { name: "tutor_messages", table: s.tutorMessages, col: s.tutorMessages.userId },
  { name: "srs_cards", table: s.srsCards, col: s.srsCards.userId },
  { name: "xp_events", table: s.xpEvents, col: s.xpEvents.userId },
  { name: "user_progress", table: s.userProgress, col: s.userProgress.userId },
  { name: "user_stats", table: s.userStats, col: s.userStats.userId },
  { name: "speech_sessions", table: s.speechSessions, col: s.speechSessions.userId },
  { name: "usage_counters", table: s.usageCounters, col: s.usageCounters.subject },
  { name: "access_code_attempts", table: s.accessCodeAttempts, col: s.accessCodeAttempts.userId },
  {
    name: "access_code_redemptions",
    table: s.accessCodeRedemptions,
    col: s.accessCodeRedemptions.userId,
  },
  { name: "session", table: s.session, col: s.session.userId },
  { name: "account", table: s.account, col: s.account.userId },
] as const;

/**
 * Tables deliberately NOT deleted, and why. Kept in code so the decision is
 * reviewable instead of being an omission somebody has to reverse-engineer.
 */
export const ERASURE_EXCLUSIONS: { name: string; reason: string }[] = [
  {
    name: "speech_audio",
    reason:
      "Synthesized course audio, cached by text hash and shared across all learners. It contains no personal data and is not keyed to a user; deleting it would only make the next learner re-pay for the same synthesis.",
  },
  {
    name: "access_codes",
    reason:
      "Administrator-issued codes. Owned by the operator, not the learner — the learner's redemption row is deleted, the code itself stays valid for its other seats.",
  },
  {
    name: "account_deletions",
    reason:
      "The audit trail of this deletion. Holds the opaque user id and row counts only, no personal data, and deleting it would erase the evidence that the erasure happened.",
  },
];

export interface ErasureResult {
  purged: Record<string, number>;
  /** True when the `user` row itself was removed. */
  userRowDeleted: boolean;
}

/**
 * Delete everything belonging to `userId`.
 *
 * Not wrapped in a transaction: libsql over HTTP does not give us one that
 * spans this many statements reliably, and a half-finished erasure that can be
 * retried is better than one that rolls back and leaves the user believing
 * their data is gone. Every statement is idempotent, so re-running finishes
 * the job rather than erroring.
 */
export async function eraseUser(userId: string): Promise<ErasureResult> {
  const purged: Record<string, number> = {};

  // Read the email before the user row goes: Better Auth's `verification`
  // table is keyed by email identifier rather than user id, so it is invisible
  // to a userId sweep and would otherwise leave the address behind after a
  // deletion the user was told had completed.
  const [owner] = await db
    .select({ email: s.user.email })
    .from(s.user)
    .where(eq(s.user.id, userId))
    .limit(1);

  for (const entry of USER_SCOPED) {
    const rows = await db
      .delete(entry.table)
      .where(eq(entry.col, userId))
      .returning({ id: entry.col });
    purged[entry.name] = rows.length;
  }

  if (owner?.email) {
    const rows = await db
      .delete(s.verification)
      .where(eq(s.verification.identifier, owner.email))
      .returning({ id: s.verification.id });
    purged["verification"] = rows.length;
  } else {
    purged["verification"] = 0;
  }

  const userRows = await db
    .delete(s.user)
    .where(eq(s.user.id, userId))
    .returning({ id: s.user.id });
  purged["user"] = userRows.length;

  return { purged, userRowDeleted: userRows.length > 0 };
}

/**
 * Guard against the schema growing a user-scoped table that erasure forgets.
 *
 * Returns the table names that carry a `user_id` column but appear in neither
 * the deletion list nor the documented exclusions. Anything it returns is a
 * privacy bug, so the entitlement test suite asserts this is empty.
 */
export function erasureCoverage(): string[] {
  const handled = new Set<string>([
    ...USER_SCOPED.map((e) => e.name),
    ...ERASURE_EXCLUSIONS.map((e) => e.name),
    "user",
    // Deleted in eraseUser by email rather than by user id.
    "verification",
  ]);

  // Drizzle's public introspection, not the `._` internals: those are not a
  // stable shape, and reading them returned an empty list silently — a guard
  // that passes because it inspects nothing is worse than no guard.
  const userScopedInSchema: string[] = [];
  for (const value of Object.values(s)) {
    if (!is(value, SQLiteTable)) continue;
    const columns = Object.keys(getTableColumns(value));
    // `identifier` catches Better Auth's verification table, which holds an
    // email address and no user id — personal data a userId-only sweep misses.
    if (
      columns.includes("userId") ||
      columns.includes("subject") ||
      columns.includes("identifier")
    ) {
      userScopedInSchema.push(getTableName(value));
    }
  }

  return userScopedInSchema.filter((name) => !handled.has(name)).sort();
}

/**
 * The inverse guard: names listed for deletion that no longer exist in the
 * schema. A stale entry means a rename happened and erasure is now deleting
 * from a table that is not the one holding the data.
 */
export function erasureStaleEntries(): string[] {
  const live = new Set<string>();
  for (const value of Object.values(s)) {
    if (is(value, SQLiteTable)) live.add(getTableName(value));
  }
  return [...USER_SCOPED.map((e) => e.name), ...ERASURE_EXCLUSIONS.map((e) => e.name)]
    .filter((name) => !live.has(name))
    .sort();
}
