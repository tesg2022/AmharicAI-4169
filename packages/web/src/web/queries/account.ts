import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { orpc } from "../lib/api";

/**
 * Account self-service, including deletion.
 *
 * `account.me` is the authority on whether a deletion is already scheduled —
 * the client never infers it from a local flag, because the schedule survives
 * a sign-out on one device and must be visible from the next one.
 */
export function useAccount(enabled: boolean) {
  return useQuery({
    ...orpc.account.me.queryOptions(),
    enabled,
    // Short: a deletion scheduled on another device has to surface quickly.
    staleTime: 15_000,
  });
}

/** Schedule deletion after the grace window. Idempotent server-side. */
export function useRequestDeletion() {
  const queryClient = useQueryClient();
  return useMutation(
    orpc.account.requestDeletion.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: orpc.account.key() });
      },
    }),
  );
}

/** Back out during the grace window. */
export function useCancelDeletion() {
  const queryClient = useQueryClient();
  return useMutation(
    orpc.account.cancelDeletion.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: orpc.account.key() });
      },
    }),
  );
}

/**
 * Erase everything now, skipping the grace window.
 *
 * The session rows are deleted as part of the erasure, so after this resolves
 * the caller is already signed out on the server — the UI clears the cache and
 * sends them home rather than pretending there is still an account to show.
 */
export function useDeleteNow() {
  const queryClient = useQueryClient();
  return useMutation(
    orpc.account.deleteNow.mutationOptions({
      onSuccess: () => {
        queryClient.clear();
      },
    }),
  );
}
