import { useQuery } from "@tanstack/react-query";
import { orpc } from "../lib/api";
import type { LegalSlug } from "../../api/content/legal";

/**
 * The legal documents change only on deploy, so they are cached hard — but
 * never `Infinity`. A policy correction has to reach a long-lived tab within
 * the session, not only after a reload.
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
