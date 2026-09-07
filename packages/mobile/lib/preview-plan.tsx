import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

/**
 * The active plan and UI language, held in memory on the client.
 *
 * IMPORTANT: `plan` is a PREVIEW SWITCH, not an entitlement. This build has no
 * account store, so there is nothing to verify a subscription against. The
 * value is sent to the server as an input and the server resolves gating from
 * it — which keeps ungranted content off the client — but it is never used to
 * authorise a charge, and every surface that shows it must label it "preview".
 *
 * It is deliberately NOT persisted: persisting it would make it look like a
 * saved account state. It resets to Free on reload.
 */

export type PreviewPlan = "free" | "learner" | "premium";
export type Locale = "en" | "am";

interface PreviewState {
  plan: PreviewPlan;
  setPlan: (plan: PreviewPlan) => void;
  locale: Locale;
  setLocale: (locale: Locale) => void;
  toggleLocale: () => void;
}

const PreviewContext = createContext<PreviewState | null>(null);

export function PreviewProvider({ children }: { children: ReactNode }) {
  const [plan, setPlan] = useState<PreviewPlan>("free");
  const [locale, setLocale] = useState<Locale>("en");

  const value = useMemo<PreviewState>(
    () => ({
      plan,
      setPlan,
      locale,
      setLocale,
      toggleLocale: () => setLocale((l) => (l === "en" ? "am" : "en")),
    }),
    [plan, locale],
  );

  return <PreviewContext.Provider value={value}>{children}</PreviewContext.Provider>;
}

export function usePreview(): PreviewState {
  const ctx = useContext(PreviewContext);
  if (!ctx) throw new Error("usePreview must be used inside <PreviewProvider>");
  return ctx;
}
