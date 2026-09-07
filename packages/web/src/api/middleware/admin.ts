import { ORPCError } from "@orpc/server";
import { authed } from "./auth";

/**
 * Administrator identity.
 *
 * Admins are named in `ADMIN_EMAILS` (comma-separated) and checked on the
 * server on every privileged call. There is deliberately no admin role stored
 * in the database and no UI that can grant one: the only way to become an
 * administrator is to have deploy access to the environment. That removes the
 * whole class of privilege-escalation bugs where a writable role column is the
 * thing standing between a user and issuing themselves free Premium codes.
 *
 * The comparison is on the *verified session's* email, not on anything the
 * client sends.
 */
export function adminEmails(): string[] {
  return (process.env["ADMIN_EMAILS"] ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return adminEmails().includes(email.toLowerCase());
}

/**
 * Admin-only procedures. Builds on `authed`, so an unauthenticated caller gets
 * UNAUTHORIZED and a signed-in non-admin gets FORBIDDEN — the two are kept
 * distinct because they mean different things to the client, and neither
 * reveals whether any particular email is an administrator.
 */
export const adminOnly = authed.use(async ({ context, next }) => {
  if (adminEmails().length === 0) {
    throw new ORPCError("SERVICE_UNAVAILABLE", {
      message:
        "No administrators are configured in this deployment. Set ADMIN_EMAILS to a comma-separated list of admin account emails.",
      data: { reason: "admins_not_configured" },
    });
  }
  if (!isAdminEmail(context.user.email)) {
    throw new ORPCError("FORBIDDEN", {
      message: "This action is restricted to AmharicAI administrators.",
      data: { reason: "not_an_admin" },
    });
  }
  return next({ context });
});
