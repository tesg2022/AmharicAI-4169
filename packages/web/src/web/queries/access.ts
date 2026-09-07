import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { orpc } from "../lib/api";

/**
 * The signed-in entitlement surface.
 *
 * `access.me` is the ONLY thing a screen should read to decide what a person
 * holds. It carries `plan_source` and `plan_is_verified`, so the UI can tell
 * an anonymous preview apart from a real grant instead of treating them alike.
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
 * Redeem a six-digit code. On success every entitlement-bearing query is
 * invalidated — the plan the user now holds comes back from the server, never
 * from anything this mutation decides locally.
 */
export function useRedeemCode() {
  const queryClient = useQueryClient();
  return useMutation(
    orpc.access.redeem.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: orpc.access.key() });
        queryClient.invalidateQueries({ queryKey: orpc.catalog.key() });
        queryClient.invalidateQueries({ queryKey: orpc.content.key() });
      },
    }),
  );
}

/**
 * Attempt a checkout. It always fails in this build — billing is not wired —
 * and the failure carries the real blockers so the UI can name them instead
 * of showing a spinner that never resolves.
 */
export function useCheckout() {
  return useMutation(orpc.catalog.checkout.mutationOptions());
}
