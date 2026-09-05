import { useQuery } from "@tanstack/react-query";
import { orpc } from "@/lib/api";

export function useOutline() {
  return useQuery(orpc.content.outline.queryOptions());
}

export function useUnit(unitId: string) {
  return useQuery(orpc.content.unit.queryOptions({ input: { unitId } }));
}

export function useLesson(lessonId: string) {
  return useQuery({
    ...orpc.content.lesson.queryOptions({ input: { lessonId } }),
    enabled: Boolean(lessonId),
  });
}

export function useFidel() {
  return useQuery(orpc.content.fidel.queryOptions());
}

export function useVocabulary(unitId?: string) {
  return useQuery(orpc.content.vocabulary.queryOptions({ input: { unitId } }));
}

export function useDialogues() {
  return useQuery(orpc.content.dialogues.queryOptions());
}

export function useCourseStats() {
  return useQuery(orpc.content.stats.queryOptions());
}
