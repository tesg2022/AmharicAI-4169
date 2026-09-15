import { z } from "zod";
import { withUser } from "../middleware/auth";
import { resolvePlan } from "../entitlements/resolve";
import { peek } from "../entitlements/usage";
import { METERS, type Meter } from "../database/schema";
import { quotasFor, tutorAllowanceLabel } from "../content/plans";

/**
 * Read-only view of the caller's own meters.
 *
 * Read-only on purpose: nothing here can spend, grant or reset allowance. The
 * counters move only on the endpoints that actually call a provider, so this
 * procedure cannot become a way to manipulate a quota from the client.
 *
 * Anonymous callers get their real anonymous ceilings rather than an error —
 * the tutor screen needs a number to show before anyone signs in, and showing
 * the free plan's monthly figure to someone who will be cut off after three
 * questions would be a lie by omission.
 */
export const usage = {
  mine: withUser
    .input(z.object({ meters: z.array(z.enum(METERS)).optional() }).optional())
    .handler(async ({ context, input }) => {
      const resolved = await resolvePlan({ userId: context.user?.id ?? null });
      const wanted: Meter[] = input?.meters ?? [...METERS];

      const subject = {
        userId: context.user?.id ?? null,
        // oRPC procedures have no direct socket handle; an anonymous caller is
        // bucketed under a single shared key here. That is deliberate: this is
        // a display endpoint, and the authoritative per-address metering
        // happens on the plain-HTTP routes that actually spend money.
        address: "rpc",
      };

      const states = await Promise.all(wanted.map((m) => peek(subject, resolved.plan, m)));

      return {
        plan: resolved.plan,
        plan_is_verified: resolved.plan_is_verified,
        signed_in: Boolean(context.user),
        quotas: quotasFor(resolved.plan),
        tutor_allowance_label: tutorAllowanceLabel(resolved.plan),
        meters: states,
      };
    }),
};
