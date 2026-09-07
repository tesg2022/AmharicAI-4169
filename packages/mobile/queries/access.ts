import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { orpc } from "@/lib/api";

/**
 * The signed-in entitlement surface on mobile.
 *
 * `access.me` is the ONLY thing a screen should read to decide what a person
 * holds. It resolves the plan from the *session* on the server, so:
 *
 *   - for a signed-in learner the client's preview switch is ignored entirely
 *   - `plan_is_verified` is the difference between a real holding and a
 *     preview, and only the server can set it true
 *   - `expires_at` and `expired_notice` come back with it, so a lapsed grant
 *     is stated rather than silently becoming Free
 *
 * `is_admin` also rides along, computed server-side from the verified session
 * email. It decides nothing — every privileged call is gated on the server —
 * it only keeps a learner's own screen from having to ask `admin.status`,
 * which for them can only answer 401 or 403.
 */
export function useAccess() {
  return useQuery({
    ...orpc.access.me.queryOptions({ input: {} }),
    // Short, not zero: a redemption or an admin revoke has to show up quickly.
    staleTime: 15_000,
  });
}

/** Codes this account has redeemed, live or lapsed. Requires a session. */
export function useMyRedemptions(enabled: boolean) {
  return useQuery({
    ...orpc.access.redemptions.queryOptions(),
    enabled,
  });
}

/**
 * Redeem a six-digit access code.
 *
 * On success every entitlement-bearing query is invalidated, so the plan that
 * appears next comes back from the server. This mutation never decides locally
 * that the learner is now on a paid plan — that would be the client deciding
 * an entitlement, which is the one thing the whole design forbids.
 */
export function useRedeemCode() {
  const queryClient = useQueryClient();
  return useMutation({
    ...orpc.access.redeem.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: orpc.access.key() });
        queryClient.invalidateQueries({ queryKey: orpc.catalog.key() });
        queryClient.invalidateQueries({ queryKey: orpc.content.key() });
      },
    }),
    // A rejected code is a final answer, not a transient failure. Retrying
    // would also burn the learner's lockout budget for them.
    retry: false,
  });
}
