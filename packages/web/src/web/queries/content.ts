import { useQuery } from "@tanstack/react-query";
import { orpc } from "../lib/api";

/** Course content is static per deploy — cache it hard so navigation feels instant. */
const STATIC = { staleTime: 10 * 60_000 };

export function useOutline() {
  return useQuery({ ...orpc.content.outline.queryOptions(), ...STATIC });
}

export function useUnit(unitId: string) {
  return useQuery({
    ...orpc.content.unit.queryOptions({ input: { unitId } }),
    ...STATIC,
    enabled: Boolean(unitId),
  });
}

export function useLesson(lessonId: string) {
  return useQuery({
    ...orpc.content.lesson.queryOptions({ input: { lessonId } }),
    ...STATIC,
    enabled: Boolean(lessonId),
  });
}

export function useFidel() {
  return useQuery({ ...orpc.content.fidel.queryOptions(), ...STATIC });
}

export function useVocabulary(unitId?: string) {
  return useQuery({ ...orpc.content.vocabulary.queryOptions({ input: { unitId } }), ...STATIC });
}

export function useDialogues() {
  return useQuery({ ...orpc.content.dialogues.queryOptions(), ...STATIC });
}

export function useCourseStats() {
  return useQuery({ ...orpc.content.stats.queryOptions(), ...STATIC });
}

export function useSearch(query: string) {
  return useQuery({
    ...orpc.content.search.queryOptions({ input: { query } }),
    enabled: query.trim().length > 1,
  });
}
