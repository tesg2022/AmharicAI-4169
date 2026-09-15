import type { Context } from "hono";
import { auth } from "../auth";
import { resolvePlan } from "./resolve";
import type { PlanId } from "../content/plans";
import type { Subject } from "./usage";

/**
 * Subject and plan resolution for the plain-HTTP routes.
 *
 * The oRPC procedures get this from `withUser`/`authed` middleware, but the
 * streaming tutor turn and the audio endpoint are plain Hono routes and have
 * no middleware chain. Without this helper they would run unauthenticated and
 * unmetered, which is exactly where an AI bill runs away — so both of them go
 * through here before touching a provider.
 */

export interface RequestIdentity {
  subject: Subject;
  plan: PlanId;
  userId: string | null;
}

/**
 * The client address, read from the proxy headers the deployment actually
 * sets. Used only as a rate-limiting key and hashed before storage — see
 * `anonSubject`. Falls back to a constant, which buckets every unknown caller
 * together: a blunt shared limit is the safe failure, not an open door.
 */
export function clientAddress(c: Context): string {
  const forwarded = c.req.header("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return (
    c.req.header("cf-connecting-ip") ??
    c.req.header("x-real-ip") ??
    "unknown"
  );
}

export async function identify(c: Context): Promise<RequestIdentity> {
  const session = await auth.api.getSession({ headers: c.req.raw.headers }).catch(() => null);
  const userId = session?.user?.id ?? null;

  // The preview switch is deliberately NOT read here. It is a UI affordance
  // for browsing the pricing page, and honouring it on a metered endpoint
  // would let any caller raise their own quota with a query parameter.
  const resolved = await resolvePlan({ userId });

  return {
    userId,
    plan: resolved.plan,
    subject: { userId, address: userId ? null : clientAddress(c) },
  };
}
