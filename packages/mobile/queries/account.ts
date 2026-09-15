import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { orpc } from "@/lib/api";

/**
 * Account self-service, including the in-app deletion Play requires.
 *
 * The pending-deletion state is read from the server, never kept on the
 * device: a deletion scheduled on the web has to be visible here, and
 * cancellable here.
 */
export function useAccount(enabled: boolean) {
  return useQuery({ ...orpc.account.me.queryOptions(), enabled, staleTime: 15_000 });
}

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
 * Erase everything now. The server destroys the session rows as part of the
 * erasure, so the caller is signed out server-side by the time this resolves —
 * the screen clears the cache and the stored token rather than pretending
 * there is still an account.
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
