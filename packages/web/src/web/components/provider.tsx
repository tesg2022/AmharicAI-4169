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

  /*
    No billing provider here any more.
    Billing used to need its own React context so a client SDK could talk to
    the provider from the browser. Paystack checkout is opened by the server
    (billing.checkout returns an authorization_url) and verified by the server,
    so the browser holds no billing credentials and needs no billing context —
    just the query client, like every other feature.
  */
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
