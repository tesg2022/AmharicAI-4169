import { authClient } from "@/lib/auth";

/**
 * Current learner session. `isSignedIn` gates every progress-bearing screen —
 * anonymous learners can still read lessons and browse ፊደል, they just get
 * graded feedback without anything being stored.
 */
export function useSession() {
  const { data, isPending, refetch } = authClient.useSession();
  return {
    session: data ?? null,
    user: data?.user ?? null,
    isSignedIn: Boolean(data?.user),
    isPending,
    refetch,
  };
}
