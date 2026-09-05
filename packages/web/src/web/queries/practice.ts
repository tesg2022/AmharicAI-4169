import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { orpc } from "../lib/api";

export function useQuiz(lessonId: string, limit = 10) {
  return useQuery({
    ...orpc.practice.quiz.queryOptions({ input: { lessonId, limit } }),
    enabled: Boolean(lessonId),
    // A fresh shuffle should only happen when the learner asks for one.
    staleTime: Infinity,
    refetchOnMount: false,
  });
}

export function useUnitExam(unitId: string) {
  return useQuery({
    ...orpc.practice.unitExam.queryOptions({ input: { unitId } }),
    enabled: Boolean(unitId),
    retry: false,
  });
}

export function useSubmitAnswer() {
  const queryClient = useQueryClient();
  return useMutation(
    orpc.practice.submit.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries({ queryKey: orpc.progress.key() }),
    }),
  );
}

export function useCompleteLesson() {
  const queryClient = useQueryClient();
  return useMutation(
    orpc.practice.completeLesson.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries({ queryKey: orpc.progress.key() }),
    }),
  );
}
