import { paystackLiveGrants, type LiveGrant } from "./store";
import { paypalLiveGrants } from "./paypal-store";
import { billingConfigured } from "./config";
import { paypalConfigured } from "./paypal-config";

/**
 * The one place Paystack and PayPal become a single answer.
 *
 * Above this file there is no such thing as "a Paystack subscriber" or "a
 * PayPal subscriber" — there are only paid grants. `resolve.ts` reads this and
 * nothing else, which is what keeps the entitlement rules from growing a
 * provider branch: adding a third provider means adding a reader here and
 * changing no gating logic anywhere.
 *
 * Both readers hit local mirror tables, never a provider API. That is
 * deliberate and was learned the hard way under Autumn: making entitlement
 * depend on a provider's uptime meant a timeout could demote a paying learner
 * to Free mid-lesson. A provider outage must be able to break *buying*, never
 * *having bought*.
 */

/**
 * Every live paid entitlement for a user, from every provider.
 *
 * Read order is not significance order — callers must not treat the first
 * element as "the" subscription. `resolve.ts` merges by plan rank precisely
 * because somebody can legitimately hold two grants at once: a learner who
 * bought Basic on Paystack and later upgraded to Premium through PayPal has
 * both until the first one lapses, and they are owed Premium in the meantime.
 *
 * One provider failing to read is not allowed to silently halve the answer.
 * These are local database reads, so a rejection here means the database is
 * unreachable, and the honest response to "I cannot tell what you paid for" is
 * to fail the request rather than to serve a confident Free.
 */
export async function liveGrants(userId: string): Promise<LiveGrant[]> {
  /**
   * Skipping an unconfigured provider is a cost and noise decision, not a
   * correctness one: a deployment with no PayPal credentials cannot have
   * PayPal rows, so querying for them only burns a round trip. The guards are
   * cheap env checks — crucially NOT provider API pings, which would put a
   * network call back on the entitlement path.
   */
  const readers: Promise<LiveGrant[]>[] = [];
  if (billingConfigured()) readers.push(paystackLiveGrants(userId));
  if (paypalConfigured()) readers.push(paypalLiveGrants(userId));

  if (readers.length === 0) return [];

  const results = await Promise.all(readers);
  return results.flat();
}

/**
 * True when at least one provider can take money.
 *
 * The UI uses this to decide whether to show pricing at all. Either provider
 * alone is enough — a deployment selling only through Paystack is a working
 * deployment, and hiding the pricing page because PayPal is unconfigured would
 * be wrong.
 */
export function anyProviderConfigured(): boolean {
  return billingConfigured() || paypalConfigured();
}
