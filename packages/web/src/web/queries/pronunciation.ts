import { useQuery } from "@tanstack/react-query";
import { orpc } from "../lib/api";

/** The pronunciation curriculum is static per deploy — cache it hard. */
const STATIC = { staleTime: 10 * 60_000 };

export function usePronunciationGuide() {
  return useQuery({ ...orpc.pronunciation.guide.queryOptions(), ...STATIC });
}

export function usePronunciationPairs() {
  return useQuery({ ...orpc.pronunciation.pairs.queryOptions(), ...STATIC });
}

export function usePronunciationDrills() {
  return useQuery({ ...orpc.pronunciation.drills.queryOptions(), ...STATIC });
}
