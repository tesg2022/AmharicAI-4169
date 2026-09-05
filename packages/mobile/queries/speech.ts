import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { orpc } from "@/lib/api";

/**
 * Whether native am-ET audio is actually reachable, and which env vars are
 * missing if it is not. The UI reads this instead of guessing — with no
 * provider key configured we stay silent rather than mispronounce Amharic
 * with an English voice.
 */
export function useSpeechStatus() {
  return useQuery({
    ...orpc.speech.status.queryOptions(),
    staleTime: 60_000,
  });
}

/** Casts a dialogue into alternating voices for conversation mode. */
export function useDialogueSpeech(dialogueId: string | null, mode: "native" | "slow" | "syllable") {
  return useQuery({
    ...orpc.speech.dialogue.queryOptions({
      input: { dialogueId: dialogueId ?? "", mode },
    }),
    enabled: Boolean(dialogueId),
  });
}

/** Recent READ → LISTEN → REPEAT → SPEAK → FEEDBACK loops. */
export function useSpeechSessions(limit = 10) {
  return useQuery(orpc.speech.sessions.queryOptions({ input: { limit } }));
}

export function useStartSpeechSession() {
  return useMutation(orpc.speech.startSession.mutationOptions());
}

export function useAdvanceSpeechSession() {
  const queryClient = useQueryClient();
  return useMutation(
    orpc.speech.advanceSession.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: orpc.speech.key() });
      },
    }),
  );
}
