import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { orpc } from "../lib/api";

export function useSpeakingPrompts(lessonId: string) {
  return useQuery({
    ...orpc.speaking.prompts.queryOptions({ input: { lessonId } }),
    enabled: Boolean(lessonId),
  });
}

export function useScoreSpeech() {
  const queryClient = useQueryClient();
  return useMutation(
    orpc.speaking.score.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: orpc.speaking.key() });
        queryClient.invalidateQueries({ queryKey: orpc.progress.key() });
      },
    }),
  );
}
