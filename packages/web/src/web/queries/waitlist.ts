import { useMutation } from "@tanstack/react-query";
import { orpc } from "../lib/api";

/**
 * The Android launch list.
 *
 * Deliberately unauthenticated: asking someone to create an account before you
 * will tell them the app exists is backwards, and the whole point of this form
 * is to reach people who have not signed up yet. The server treats a repeat
 * address as a success rather than an error, so someone who forgets they
 * already signed up is never shown a failure for it.
 */
export function useJoinWaitlist() {
  return useMutation(orpc.waitlist.join.mutationOptions());
}
