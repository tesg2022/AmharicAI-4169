import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { orpc } from "@/lib/api";

export function useDueCards(enabled = true) {
  return useQuery({ ...orpc.srs.due.queryOptions({ input: {} }), enabled });
}

export function useSrsSummary(enabled = true) {
  return useQuery({ ...orpc.srs.summary.queryOptions(), enabled });
}

export function useReviewCard() {
  const queryClient = useQueryClient();
  return useMutation(
    orpc.srs.review.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: orpc.srs.key() });
        queryClient.invalidateQueries({ queryKey: orpc.progress.key() });
      },
    }),
  );
}

export function useAddLessonToDeck() {
  const queryClient = useQueryClient();
  return useMutation(
    orpc.srs.addLesson.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries({ queryKey: orpc.srs.key() }),
    }),
  );
}
