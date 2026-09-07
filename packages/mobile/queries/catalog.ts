import { useMutation, useQuery } from "@tanstack/react-query";
import { orpc } from "@/lib/api";
import { usePreview } from "@/lib/preview-plan";

/**
 * The generated 20-unit course, plans and translation.
 *
 * Every hook passes the client's preview `plan` as an input: gating is resolved
 * server-side so ungranted lesson bodies never reach the device. The plan is
 * still only a preview switch (see lib/preview-plan.tsx) — it is not an
 * entitlement and never authorises a charge.
 */

export type TranslateDirection = "en2am" | "am2en";

export function useEntitlements() {
  const { plan } = usePreview();
  return useQuery(orpc.catalog.me.queryOptions({ input: { plan } }));
}

export function useCourseMap() {
  const { plan } = usePreview();
  return useQuery(orpc.catalog.course.queryOptions({ input: { plan } }));
}

export function useCourseLesson(lessonId: string) {
  const { plan } = usePreview();
  return useQuery({
    ...orpc.catalog.lesson.queryOptions({ input: { lessonId, plan } }),
    enabled: Boolean(lessonId),
    // A gate or a missing lesson is a final answer, not a transient failure.
    retry: false,
  });
}

export function useCourseFlags() {
  return useQuery(orpc.catalog.flags.queryOptions());
}

/**
 * Free-text translation. Fails with a reason when no provider is configured —
 * it never echoes the input back as if it had been translated.
 */
export function useTranslate() {
  const { plan } = usePreview();
  const mutation = useMutation({
    ...orpc.catalog.translate.mutationOptions(),
    retry: false,
  });
  return {
    ...mutation,
    run: (text: string, direction: TranslateDirection) =>
      mutation.mutate({ text, direction, plan }),
  };
}

/** Always refuses: there are no payment keys and no account store. */
export function useCheckout() {
  return useMutation({ ...orpc.catalog.checkout.mutationOptions(), retry: false });
}

/** Pulls the machine-readable reason out of an oRPC error, if there is one. */
export function failureReason(error: unknown): string | null {
  const data = (error as { data?: { reason?: unknown } } | null)?.data;
  return typeof data?.reason === "string" ? data.reason : null;
}

export function failureBlockers(error: unknown): string[] {
  const data = (error as { data?: { blockers?: unknown } } | null)?.data;
  return Array.isArray(data?.blockers) ? (data.blockers as string[]) : [];
}

export function failureMessage(error: unknown): string {
  const message = (error as { message?: unknown } | null)?.message;
  return typeof message === "string" && message ? message : "Something went wrong.";
}
