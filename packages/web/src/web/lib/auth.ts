import { createAuthClient } from "better-auth/react";
import { managedAuthClient } from "@runablehq/managed-auth/client";

const applicationId = import.meta.env.VITE_APPLICATION_ID;
const issuer = import.meta.env.VITE_RUNABLE_AUTH_ISSUER;

// Missing either of these does not fail loudly — every sign-in just returns a
// network error that says nothing about the cause. Say it here instead.
if (!applicationId || !issuer) {
  console.error(
    "Auth is not configured: VITE_APPLICATION_ID and VITE_RUNABLE_AUTH_ISSUER must both be set.",
  );
}

const config = {
  applicationId: applicationId ?? "",
  issuer: issuer ?? "",
};

export const authClient = createAuthClient({
  baseURL: import.meta.env.VITE_WEBSITE_URL ?? window.location.origin,
  basePath: "/api/auth",
  plugins: [managedAuthClient(config)],
});
