import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { orpc } from "../lib/api";

export function useTutorHistory(enabled = true) {
  return useQuery({
    ...orpc.tutor.history.queryOptions({ input: {} }),
    enabled,
    staleTime: Infinity,
  });
}

export function useSaveTutorMessage() {
  return useMutation(orpc.tutor.save.mutationOptions());
}

export function useClearTutor() {
  const queryClient = useQueryClient();
  return useMutation(
    orpc.tutor.clear.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries({ queryKey: orpc.tutor.key() }),
    }),
  );
}
