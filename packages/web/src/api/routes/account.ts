import { z } from "zod";
import { ORPCError } from "@orpc/server";
import { and, desc, eq } from "drizzle-orm";
import { db } from "../database";
import { accountDeletions } from "../database/schema";
import { authed } from "../middleware/auth";
import { eraseUser, ERASURE_EXCLUSIONS } from "../entitlements/erasure";
import { resolvePlan } from "../entitlements/resolve";

/**
 * Account self-service, including real deletion.
 *
 * Google Play requires an in-app path to delete the account and its data, and
 * requires the same path to be reachable from the web without installing the
 * app. Both surfaces call these procedures.
 *
 * The deletion is genuine — see `entitlements/erasure.ts`. What it is not is
 * instant: an irreversible action taken in one tap is how support tickets
 * about lost progress are made. A grace window of GRACE_DAYS gives the user a
 * way back, and signing in during the window offers to cancel.
 */

const GRACE_DAYS = 7;

/** The confirmation phrase. Typed, not tapped — deliberate friction. */
const CONFIRM_PHRASE = "DELETE";

async function pendingFor(userId: string) {
  const [row] = await db
    .select()
    .from(accountDeletions)
    .where(
      and(eq(accountDeletions.userId, userId), eq(accountDeletions.status, "pending")),
    )
    .orderBy(desc(accountDeletions.requestedAt))
    .limit(1);
  return row ?? null;
}

export const account = {
  /**
   * Everything the account screen needs: who you are, what you are on, and
   * whether a deletion is already scheduled.
   */
  me: authed.handler(async ({ context }) => {
    const [resolved, pending] = await Promise.all([
      resolvePlan({ userId: context.user.id }),
      pendingFor(context.user.id),
    ]);

    return {
      user: {
        id: context.user.id,
        email: context.user.email,
        name: context.user.name,
        created_at:
          context.user.createdAt instanceof Date
            ? context.user.createdAt.toISOString()
            : null,
      },
      plan: resolved.plan,
      plan_source: resolved.plan_source,
      plan_is_verified: resolved.plan_is_verified,
      expires_at: resolved.expires_at,
      deletion: pending
        ? {
            requested_at: pending.requestedAt.toISOString(),
            execute_after: pending.executeAfter.toISOString(),
            cancellable: true,
          }
        : null,
      /** Shown verbatim on the deletion screen so consent is informed. */
      deletion_policy: {
        grace_days: GRACE_DAYS,
        confirm_phrase: CONFIRM_PHRASE,
        erased: [
          "Your account and sign-in credentials",
          "All lesson progress, XP, streaks and review cards",
          "Every answer and speaking attempt you have recorded",
          "Your entire AI tutor conversation history",
          "Your usage counters and any redeemed access codes",
        ],
        retained: ERASURE_EXCLUSIONS.map((e) => ({ what: e.name, why: e.reason })),
      },
    };
  }),

  /**
   * Schedule deletion. Idempotent: asking twice returns the existing request
   * rather than stacking two, so a double tap cannot shorten the grace window.
   */
  requestDeletion: authed
    .input(
      z.object({
        confirm: z.string(),
        reason: z.string().max(500).optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      if (input.confirm.trim().toUpperCase() !== CONFIRM_PHRASE) {
        throw new ORPCError("BAD_REQUEST", {
          message: `Type ${CONFIRM_PHRASE} to confirm. Nothing has been deleted.`,
          data: { reason: "confirm_phrase_mismatch" },
        });
      }

      const existing = await pendingFor(context.user.id);
      if (existing) {
        return {
          scheduled: true,
          already_pending: true,
          execute_after: existing.executeAfter.toISOString(),
        };
      }

      const executeAfter = new Date(Date.now() + GRACE_DAYS * 86_400_000);
      await db.insert(accountDeletions).values({
        id: crypto.randomUUID(),
        userId: context.user.id,
        status: "pending",
        reason: input.reason ?? null,
        executeAfter,
      });

      return {
        scheduled: true,
        already_pending: false,
        execute_after: executeAfter.toISOString(),
      };
    }),

  /** Back out during the grace window. */
  cancelDeletion: authed.handler(async ({ context }) => {
    const existing = await pendingFor(context.user.id);
    if (!existing) {
      throw new ORPCError("NOT_FOUND", {
        message: "There is no deletion scheduled on this account.",
        data: { reason: "no_pending_deletion" },
      });
    }

    await db
      .update(accountDeletions)
      .set({ status: "cancelled", cancelledAt: new Date() })
      .where(eq(accountDeletions.id, existing.id));

    return { cancelled: true };
  }),

  /**
   * Delete now, skipping the grace window.
   *
   * Play's policy allows a grace period but a user who says "no, now" must be
   * obeyed, so this exists and does the full erasure synchronously. It takes
   * the confirmation phrase again rather than trusting the earlier request:
   * the irreversible step re-asks.
   *
   * Returns the audit counts. The caller's session rows are deleted as part of
   * the erasure, so the client is signed out by the next request regardless of
   * what it does with this response.
   */
  deleteNow: authed
    .input(z.object({ confirm: z.string() }))
    .handler(async ({ context, input }) => {
      if (input.confirm.trim().toUpperCase() !== CONFIRM_PHRASE) {
        throw new ORPCError("BAD_REQUEST", {
          message: `Type ${CONFIRM_PHRASE} to confirm. Nothing has been deleted.`,
          data: { reason: "confirm_phrase_mismatch" },
        });
      }

      const userId = context.user.id;

      const pending = await pendingFor(userId);
      const id = pending?.id ?? crypto.randomUUID();
      if (!pending) {
        await db.insert(accountDeletions).values({
          id,
          userId,
          status: "pending",
          executeAfter: new Date(),
        });
      }

      const result = await eraseUser(userId);

      await db
        .update(accountDeletions)
        .set({
          status: "completed",
          completedAt: new Date(),
          purged: result.purged,
        })
        .where(eq(accountDeletions.id, id));

      return {
        deleted: result.userRowDeleted,
        purged: result.purged,
      };
    }),
};
