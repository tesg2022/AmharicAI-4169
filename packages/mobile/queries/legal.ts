import { useQuery } from "@tanstack/react-query";
import { orpc } from "@/lib/api";
/**
 * Declared here rather than imported: the web package exports only its router
 * type, and the oRPC input type already rejects anything not in this union, so
 * a drift between the two is a compile error, not a runtime surprise.
 */
export type LegalSlug = "privacy" | "terms" | "about" | "contact";

/**
 * Policies are fetched, never bundled. Google Play requires the policy shown
 * in the app to match the one at the listing URL, and a store release takes
 * days to roll out — a bundled copy would be stale exactly when it matters.
 */
const POLICY = { staleTime: 10 * 60_000 };

export function useLegalIndex() {
  return useQuery({ ...orpc.legal.index.queryOptions(), ...POLICY });
}

export function useLegalDocument(slug: LegalSlug) {
  return useQuery({
    ...orpc.legal.document.queryOptions({ input: { slug } }),
    ...POLICY,
    enabled: Boolean(slug),
  });
}
