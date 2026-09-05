import { useQuery } from "@tanstack/react-query";
import { orpc } from "@/lib/api";

export function usePronunciationGuide() {
  return useQuery(orpc.pronunciation.guide.queryOptions());
}

export function usePronunciationPairs() {
  return useQuery(orpc.pronunciation.pairs.queryOptions());
}

export function usePronunciationDrills() {
  return useQuery(orpc.pronunciation.drills.queryOptions());
}
