import { z } from "zod";
import { ORPCError } from "@orpc/server";
import { and, desc, eq, gt, sql } from "drizzle-orm";
import { authed, withUser } from "../middleware/auth";
import { isAdminEmail } from "../middleware/admin";
import { db } from "../database";
import {
  accessCodeAttempts,
  accessCodeRedemptions,
  accessCodes,
} from "../database/schema";
import {
  hashCode,
  hashesEqual,
  isWellFormedCode,
  pepperConfig,
} from "../entitlements/codes";
import { resolvePlan } from "../entitlements/resolve";
import { entitlements, type PlanId } from "../content/plans";

/**
 * Access-code redemption and the signed-in entitlement surface.
 *
 * A six-digit code is a 10^6 keyspace. It is safe here only because every one
 * of these holds at once, and removing any single one breaks the others:
 *
 *   - redemption requires an authenticated session (no anonymous guessing)
 *   - a hard lockout after MAX_FAILURES failures in the window
 *   - one redemption per (code, user), enforced by a unique index
 *   - a global max_redemptions cap on the code
 *   - an admin-set absolute expiry on the code
 *   - the code is stored only as HMAC-SHA256(pepper, code)
 *
 * Residual risk, stated plainly: with ~200 live codes a single blind guess
 * lands with probability 200/10^6 = 0.02%. At five attempts per hour per
 * account that is a non-issue; without the lockout it would not be.
 */

/** Failed attempts allowed per account inside the window before lockout. */
const MAX_FAILURES = 5;
const WINDOW_MINUTES = 60;

function windowStart(): Date {
  return new Date(Date.now() - WINDOW_MINUTES * 60_000);
}

function newId(): string {
  return crypto.randomUUID();
}

/**
 * Every failure is recorded before the answer goes out, so a client that
 * hangs up early still pays for the attempt.
 */
async function recordAttempt(userId: string, succeeded: boolean): Promise<void> {
  await db
    .insert(accessCodeAttempts)
    .values({ id: newId(), userId, succeeded, createdAt: new Date() });
}

async function recentFailures(userId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)` })
    .from(accessCodeAttempts)
    .where(
      and(
        eq(accessCodeAttempts.userId, userId),
        eq(accessCodeAttempts.succeeded, false),
        gt(accessCodeAttempts.createdAt, windowStart()),
      ),
    );
  return Number(row?.n ?? 0);
}

export const access = {
  /**
   * The signed-in entitlement answer, and the anonymous preview answer for
   * everyone else. This is what every client should read — it is the only
   * place `plan_is_verified` can become true.
   */
  me: withUser
    .input(z.object({ plan: z.string().optional() }))
    .handler(async ({ context, input }) => {
      const resolved = await resolvePlan({
        userId: context.user?.id ?? null,
        previewPlan: input.plan,
      });
      return {
        ...entitlements(resolved.plan, {
          source: resolved.plan_source,
          verified: resolved.plan_is_verified,
        }),
        expires_at: resolved.expires_at,
        expired_notice: resolved.expired_notice,
        signed_in: Boolean(context.user),
        user: context.user
          ? { id: context.user.id, email: context.user.email, name: context.user.name }
          : null,
        /**
         * Whether this session's email is named in ADMIN_EMAILS. It rides
         * along here purely so a learner's own page never has to ask
         * `admin.status` — that call can only answer 401/403 for them, which
         * would put a permanent red herring in every learner's console. This
         * flag decides nothing: every privileged call is still gated by
         * `adminOnly` on the server.
         */
        is_admin: isAdminEmail(context.user?.email),
      };
    }),

  /** The codes this account has redeemed, live or lapsed. */
  redemptions: authed.handler(async ({ context }) => {
    const rows = await db
      .select({
        id: accessCodeRedemptions.id,
        granted_plan: accessCodeRedemptions.grantedPlan,
        redeemed_at: accessCodeRedemptions.redeemedAt,
        grants_until: accessCodeRedemptions.grantsUntil,
        revoked_at: accessCodeRedemptions.revokedAt,
        hint: accessCodes.hint,
        note: accessCodes.note,
      })
      .from(accessCodeRedemptions)
      .innerJoin(accessCodes, eq(accessCodes.id, accessCodeRedemptions.codeId))
      .where(eq(accessCodeRedemptions.userId, context.user.id))
      .orderBy(desc(accessCodeRedemptions.redeemedAt));

    const now = Date.now();
    return rows.map((r) => ({
      ...r,
      redeemed_at: r.redeemed_at.toISOString(),
      grants_until: r.grants_until.toISOString(),
      revoked_at: r.revoked_at ? r.revoked_at.toISOString() : null,
      status: r.revoked_at
        ? ("revoked" as const)
        : r.grants_until.getTime() > now
          ? ("active" as const)
          : ("expired" as const),
    }));
  }),

  /**
   * Redeem a six-digit comp code against the caller's own account.
   *
   * The account is taken from the verified session and can never be passed in:
   * a redeem endpoint that accepts a user id is an account-takeover primitive.
   */
  redeem: authed
    .input(z.object({ code: z.string().trim() }))
    .handler(async ({ context, input }) => {
      const pepper = pepperConfig();
      if (!pepper.configured) {
        throw new ORPCError("SERVICE_UNAVAILABLE", {
          message:
            "Access codes are not configured in this deployment, so no code can be redeemed. Set ACCESS_CODE_PEPPER (or BETTER_AUTH_SECRET) to enable them.",
          data: { reason: "access_codes_not_configured" },
        });
      }

      const userId = context.user.id;

      // Lockout first: it must apply to malformed guesses too, or an attacker
      // just probes with junk to learn the shape of the validation.
      const failures = await recentFailures(userId);
      if (failures >= MAX_FAILURES) {
        throw new ORPCError("TOO_MANY_REQUESTS", {
          message: `Too many incorrect codes. Try again in up to ${WINDOW_MINUTES} minutes.`,
          data: { reason: "too_many_attempts", retry_after_minutes: WINDOW_MINUTES },
        });
      }

      if (!isWellFormedCode(input.code)) {
        await recordAttempt(userId, false);
        throw new ORPCError("BAD_REQUEST", {
          message: "An access code is six digits.",
          data: { reason: "code_malformed", attempts_remaining: MAX_FAILURES - failures - 1 },
        });
      }

      const digest = hashCode(input.code, pepper.pepper);
      const [code] = await db
        .select()
        .from(accessCodes)
        .where(eq(accessCodes.codeHash, digest))
        .limit(1);

      // One message for "no such code" and every rejected state below that
      // would otherwise confirm a code exists — an attacker must not be able
      // to use the error text as an oracle.
      const reject = async (
        reason: string,
        message: string,
        status: "NOT_FOUND" | "CONFLICT" = "NOT_FOUND",
      ): Promise<never> => {
        await recordAttempt(userId, false);
        throw new ORPCError(status, {
          message,
          data: { reason, attempts_remaining: MAX_FAILURES - failures - 1 },
        });
      };

      if (!code || !hashesEqual(code.codeHash, digest)) {
        await reject("code_invalid", "That code is not valid.");
      }

      // Checked BEFORE the state checks below. Someone re-entering a code they
      // already used is not an attacker: they must get the truthful answer
      // rather than "exhausted" (which is what a one-seat code they filled
      // themselves would otherwise report), and it must not burn a lockout
      // attempt. It leaks nothing — they already hold this redemption.
      const [existing] = await db
        .select()
        .from(accessCodeRedemptions)
        .where(
          and(
            eq(accessCodeRedemptions.codeId, code.id),
            eq(accessCodeRedemptions.userId, userId),
          ),
        )
        .limit(1);
      if (existing) {
        throw new ORPCError("CONFLICT", {
          message: existing.revokedAt
            ? "This code was redeemed on your account and has since been revoked by an administrator."
            : "You have already redeemed this code.",
          data: {
            reason: "already_redeemed",
            grants_until: existing.grantsUntil.toISOString(),
            revoked: Boolean(existing.revokedAt),
          },
        });
      }

      const now = new Date();
      if (code.status === "revoked") {
        await reject("code_invalid", "That code is not valid.");
      }
      if (code.expiresAt.getTime() <= now.getTime()) {
        await reject("code_expired", "That code has expired.");
      }
      if (code.redemptionCount >= code.maxRedemptions) {
        await reject("code_exhausted", "That code has already been fully used.");
      }

      const grantsUntil = new Date(now.getTime() + code.durationDays * 86_400_000);

      // The conditional UPDATE is the real cap: two concurrent redemptions of
      // the last seat both pass the check above, and only one can win here.
      const claimed = await db
        .update(accessCodes)
        .set({ redemptionCount: sql`${accessCodes.redemptionCount} + 1` })
        .where(
          and(
            eq(accessCodes.id, code.id),
            eq(accessCodes.status, "active"),
            sql`${accessCodes.redemptionCount} < ${code.maxRedemptions}`,
          ),
        )
        .returning({ count: accessCodes.redemptionCount });

      if (claimed.length === 0) {
        await reject("code_exhausted", "That code has already been fully used.");
      }

      try {
        await db.insert(accessCodeRedemptions).values({
          id: newId(),
          codeId: code.id,
          userId,
          grantedPlan: code.plan,
          grantedFeatures: code.features ?? null,
          redeemedAt: now,
          grantsUntil,
        });
      } catch (error) {
        // Give the seat back rather than burning it on a failed write.
        await db
          .update(accessCodes)
          .set({ redemptionCount: sql`${accessCodes.redemptionCount} - 1` })
          .where(eq(accessCodes.id, code.id));
        throw error;
      }

      // Mark exhausted so the admin list reads true without recomputing.
      const used = claimed[0]?.count ?? code.redemptionCount + 1;
      if (used >= code.maxRedemptions) {
        await db
          .update(accessCodes)
          .set({ status: "exhausted" })
          .where(eq(accessCodes.id, code.id));
      }

      await recordAttempt(userId, true);

      return {
        granted_plan: code.plan as PlanId,
        grants_until: grantsUntil.toISOString(),
        duration_days: code.durationDays,
      };
    }),
};
