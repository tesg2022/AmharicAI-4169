import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { orpc } from "../lib/api";

/**
 * Administrator queries. Every one of these is refused server-side unless the
 * session's email is in ADMIN_EMAILS — nothing here is a client-side gate, and
 * hiding the nav link is cosmetic, not security.
 */

/**
 * `enabled` should be the caller's signed-in flag: asking the server whether
 * an anonymous visitor is an administrator can only ever 401, and doing it on
 * a page every learner visits puts a red herring in their console.
 */
export function useAdminStatus(enabled = true) {
  return useQuery({ ...orpc.admin.status.queryOptions(), enabled, retry: false });
}

export function useAdminSummary(enabled: boolean) {
  return useQuery({ ...orpc.admin.summary.queryOptions(), enabled, retry: false });
}

export function useAdminCodes(enabled: boolean) {
  return useQuery({
    ...orpc.admin.listCodes.queryOptions({ input: {} }),
    enabled,
    retry: false,
  });
}

export function useAdminGrants(enabled: boolean) {
  return useQuery({
    ...orpc.admin.grants.queryOptions({ input: {} }),
    enabled,
    retry: false,
  });
}

/**
 * Issue a code. The response contains the plaintext — the only time it ever
 * exists outside the admin's clipboard — so the caller MUST display it.
 */
export function useIssueCode() {
  const queryClient = useQueryClient();
  return useMutation(
    orpc.admin.issueCode.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries({ queryKey: orpc.admin.key() }),
    }),
  );
}

/** Stops further redemptions of a code. Does not touch existing grants. */
export function useRevokeCode() {
  const queryClient = useQueryClient();
  return useMutation(
    orpc.admin.revokeCode.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries({ queryKey: orpc.admin.key() }),
    }),
  );
}

/** Takes access away from somebody who already redeemed. A separate decision. */
export function useRevokeGrant() {
  const queryClient = useQueryClient();
  return useMutation(
    orpc.admin.revokeGrant.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: orpc.admin.key() });
        queryClient.invalidateQueries({ queryKey: orpc.access.key() });
      },
    }),
  );
}
