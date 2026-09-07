import { z } from "zod";
import { ORPCError } from "@orpc/server";
import { desc, eq, sql } from "drizzle-orm";
import { adminOnly } from "../middleware/admin";
import { db } from "../database";
import { accessCodeRedemptions, accessCodes } from "../database/schema";
import {
  codeHint,
  generateCode,
  hashCode,
  pepperConfig,
} from "../entitlements/codes";
import { billingConfigured, billingStatus } from "../entitlements/resolve";
import { FEATURES, PLAN_ORDER } from "../content/plans";

/**
 * Administrator surface: issue comp codes, and see what has been granted.
 *
 * Every procedure here is behind `adminOnly`, which reads the verified
 * session's email against ADMIN_EMAILS. Nothing in this file trusts a client
 * assertion of who the caller is.
 */

const planEnum = z.enum(["free", "learner", "premium"]);

/** Insert retries on the unique index rather than pre-checking for a collision. */
const MAX_GENERATION_ATTEMPTS = 8;

export const admin = {
  /** Whether this deployment can actually issue and redeem codes, and bill. */
  status: adminOnly.handler(({ context }) => {
    const pepper = pepperConfig();
    return {
      admin: { id: context.user.id, email: context.user.email },
      access_codes: {
        configured: pepper.configured,
        pepper_source: pepper.source,
        note: pepper.configured
          ? null
          : "Set ACCESS_CODE_PEPPER (or BETTER_AUTH_SECRET) before issuing codes.",
      },
      billing: {
        ...billingStatus(),
        note: billingConfigured()
          ? null
          : "Paid plans cannot be sold in this deployment, so an administrator-issued access code is the only way to grant a plan.",
      },
      plans: PLAN_ORDER,
      features: FEATURES.map((f) => ({ id: f.id, label_en: f.label_en })),
    };
  }),

  /**
   * Issue a code. The plaintext is returned exactly once, right here, and is
   * unrecoverable afterwards because only its HMAC is stored — the admin UI
   * has to say so, or an admin will close the dialog and lose the code.
   */
  issueCode: adminOnly
    .input(
      z.object({
        plan: planEnum,
        /** Days of access each redeemer gets, counted from their redemption. */
        durationDays: z.number().int().min(1).max(3650),
        /** Days until the code itself stops being redeemable. */
        expiresInDays: z.number().int().min(1).max(365),
        maxRedemptions: z.number().int().min(1).max(1000).default(1),
        /** Narrows the granted plan to these feature ids. Never widens it. */
        features: z.array(z.string()).nullable().default(null),
        note: z.string().max(500).nullable().default(null),
      }),
    )
    .handler(async ({ context, input }) => {
      const pepper = pepperConfig();
      if (!pepper.configured) {
        throw new ORPCError("SERVICE_UNAVAILABLE", {
          message:
            "Access codes are not configured in this deployment. Set ACCESS_CODE_PEPPER (or BETTER_AUTH_SECRET) first.",
          data: { reason: "access_codes_not_configured" },
        });
      }

      if (input.features) {
        const known = new Set(FEATURES.map((f) => f.id));
        const unknown = input.features.filter((f) => !known.has(f));
        if (unknown.length > 0) {
          throw new ORPCError("BAD_REQUEST", {
            message: `Unknown feature ids: ${unknown.join(", ")}.`,
            data: { reason: "unknown_features", unknown },
          });
        }
      }

      const now = new Date();
      const expiresAt = new Date(now.getTime() + input.expiresInDays * 86_400_000);

      for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt++) {
        const code = generateCode();
        const id = crypto.randomUUID();
        try {
          await db.insert(accessCodes).values({
            id,
            codeHash: hashCode(code, pepper.pepper),
            hint: codeHint(code),
            plan: input.plan,
            durationDays: input.durationDays,
            expiresAt,
            maxRedemptions: input.maxRedemptions,
            redemptionCount: 0,
            features: input.features,
            status: "active",
            note: input.note,
            createdBy: context.user.id,
            createdAt: now,
          });
          return {
            id,
            /** Shown once. Not stored, not recoverable, not logged. */
            code,
            plan: input.plan,
            duration_days: input.durationDays,
            expires_at: expiresAt.toISOString(),
            max_redemptions: input.maxRedemptions,
            features: input.features,
            warning:
              "This is the only time the code is shown. It is stored as a keyed hash and cannot be recovered — copy it now.",
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : "";
          // Unique index on code_hash: a collision means we drew a code that
          // already exists, so draw again rather than overwriting anything.
          if (!/UNIQUE|constraint/i.test(message)) throw error;
        }
      }

      throw new ORPCError("INTERNAL_SERVER_ERROR", {
        message: "Could not generate an unused code. Revoke some old codes and try again.",
        data: { reason: "code_space_exhausted" },
      });
    }),

  /** Every issued code with its live status and redemption count. */
  listCodes: adminOnly
    .input(z.object({ limit: z.number().int().min(1).max(200).default(100) }))
    .handler(async ({ input }) => {
      const rows = await db
        .select()
        .from(accessCodes)
        .orderBy(desc(accessCodes.createdAt))
        .limit(input.limit);

      const now = Date.now();
      return rows.map((r) => ({
        id: r.id,
        /** Last two digits only — the code itself is unrecoverable. */
        hint: r.hint,
        plan: r.plan,
        duration_days: r.durationDays,
        expires_at: r.expiresAt.toISOString(),
        max_redemptions: r.maxRedemptions,
        redemption_count: r.redemptionCount,
        features: r.features,
        note: r.note,
        created_by: r.createdBy,
        created_at: r.createdAt.toISOString(),
        revoked_at: r.revokedAt ? r.revokedAt.toISOString() : null,
        status:
          r.status === "revoked"
            ? ("revoked" as const)
            : r.redemptionCount >= r.maxRedemptions
              ? ("exhausted" as const)
              : r.expiresAt.getTime() <= now
                ? ("expired" as const)
                : ("active" as const),
      }));
    }),

  /**
   * Revoke a code. This stops further redemptions; it does not by itself take
   * access away from people who already redeemed it — `revokeRedemption` does
   * that, and the two are separate because they are different decisions.
   */
  revokeCode: adminOnly
    .input(z.object({ codeId: z.string() }))
    .handler(async ({ context, input }) => {
      const updated = await db
        .update(accessCodes)
        .set({ status: "revoked", revokedBy: context.user.id, revokedAt: new Date() })
        .where(eq(accessCodes.id, input.codeId))
        .returning({ id: accessCodes.id });
      if (updated.length === 0) {
        throw new ORPCError("NOT_FOUND", {
          message: "No such code.",
          data: { reason: "code_not_found" },
        });
      }
      return { id: input.codeId, status: "revoked" as const };
    }),

  /**
   * Who currently has what, and where it came from. This is the "view and
   * manage subscriptions" surface — with no billing configured, every row in
   * it is an access-code grant, and it says so rather than implying revenue.
   */
  grants: adminOnly
    .input(z.object({ limit: z.number().int().min(1).max(500).default(200) }))
    .handler(async ({ input }) => {
      const rows = await db
        .select({
          id: accessCodeRedemptions.id,
          user_id: accessCodeRedemptions.userId,
          granted_plan: accessCodeRedemptions.grantedPlan,
          redeemed_at: accessCodeRedemptions.redeemedAt,
          grants_until: accessCodeRedemptions.grantsUntil,
          revoked_at: accessCodeRedemptions.revokedAt,
          code_id: accessCodes.id,
          hint: accessCodes.hint,
          note: accessCodes.note,
          created_by: accessCodes.createdBy,
        })
        .from(accessCodeRedemptions)
        .innerJoin(accessCodes, eq(accessCodes.id, accessCodeRedemptions.codeId))
        .orderBy(desc(accessCodeRedemptions.redeemedAt))
        .limit(input.limit);

      const now = Date.now();
      return {
        source: "access_code" as const,
        billing_configured: billingConfigured(),
        note: billingConfigured()
          ? null
          : "No payment provider is configured, so there are no paid subscriptions to show. Every grant below is an administrator-issued comp code.",
        grants: rows.map((r) => ({
          ...r,
          redeemed_at: r.redeemed_at.toISOString(),
          grants_until: r.grants_until.toISOString(),
          revoked_at: r.revoked_at ? r.revoked_at.toISOString() : null,
          status: r.revoked_at
            ? ("revoked" as const)
            : r.grants_until.getTime() > now
              ? ("active" as const)
              : ("expired" as const),
        })),
      };
    }),

  /** Take an already-granted entitlement away immediately. */
  revokeGrant: adminOnly
    .input(z.object({ redemptionId: z.string() }))
    .handler(async ({ context, input }) => {
      const updated = await db
        .update(accessCodeRedemptions)
        .set({ revokedBy: context.user.id, revokedAt: new Date() })
        .where(eq(accessCodeRedemptions.id, input.redemptionId))
        .returning({ id: accessCodeRedemptions.id });
      if (updated.length === 0) {
        throw new ORPCError("NOT_FOUND", {
          message: "No such grant.",
          data: { reason: "grant_not_found" },
        });
      }
      return { id: input.redemptionId, status: "revoked" as const };
    }),

  /** Headline counts for the admin dashboard. */
  summary: adminOnly.handler(async () => {
    const [codes] = await db
      .select({
        total: sql<number>`count(*)`,
        active: sql<number>`sum(case when ${accessCodes.status} = 'active' and ${accessCodes.expiresAt} > unixepoch() and ${accessCodes.redemptionCount} < ${accessCodes.maxRedemptions} then 1 else 0 end)`,
      })
      .from(accessCodes);
    const [grants] = await db
      .select({
        total: sql<number>`count(*)`,
        live: sql<number>`sum(case when ${accessCodeRedemptions.revokedAt} is null and ${accessCodeRedemptions.grantsUntil} > unixepoch() then 1 else 0 end)`,
      })
      .from(accessCodeRedemptions);
    return {
      codes_total: Number(codes?.total ?? 0),
      codes_active: Number(codes?.active ?? 0),
      grants_total: Number(grants?.total ?? 0),
      grants_live: Number(grants?.live ?? 0),
      billing_configured: billingConfigured(),
    };
  }),
};
