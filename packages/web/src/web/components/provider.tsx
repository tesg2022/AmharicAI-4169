import { useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { authClient } from "../lib/auth";

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1 } },
});

interface ProviderProps {
  children: React.ReactNode;
}

// App-level providers — add theme/context providers here, wrapping children.
// QueryClientProvider must stay (all API calls run through TanStack Query).
export function Provider({ children }: ProviderProps) {
  // Completes a managed sign-in that came back as a top-level redirect.
  useEffect(() => {
    void authClient.managedAuth.handleRedirect();
  }, []);

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
