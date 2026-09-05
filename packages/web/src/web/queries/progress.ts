import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { orpc } from "../lib/api";

export function useMyProgress(enabled = true) {
  return useQuery({ ...orpc.progress.me.queryOptions(), enabled });
}

export function useLessonProgress(enabled = true) {
  return useQuery({ ...orpc.progress.lessons.queryOptions(), enabled });
}

export function useActivity(enabled = true, days = 30) {
  return useQuery({ ...orpc.progress.activity.queryOptions({ input: { days } }), enabled });
}

export function useLeaderboard(enabled = true) {
  return useQuery({ ...orpc.progress.leaderboard.queryOptions({ input: {} }), enabled });
}

export function useUpdateSettings() {
  const queryClient = useQueryClient();
  return useMutation(
    orpc.progress.updateSettings.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries({ queryKey: orpc.progress.key() }),
    }),
  );
}
