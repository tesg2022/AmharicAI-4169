import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { expo } from "@better-auth/expo";
import { runableManagedAuth } from "@runablehq/managed-auth/server";
import { db } from "./database";

export const auth = betterAuth({
  basePath: "/api/auth",
  baseURL: process.env.WEBSITE_URL,
  database: drizzleAdapter(db, { provider: "sqlite" }),
  emailAndPassword: { enabled: true },
  secret: process.env.BETTER_AUTH_SECRET,
  trustedOrigins: (request) => {
    const origin = request?.headers.get("origin");
    return origin ? [origin] : ["*"];
  },
  plugins: [
    ...runableManagedAuth({
      applicationId: process.env.APPLICATION_ID!,
      issuer: process.env.VITE_RUNABLE_AUTH_ISSUER!,
    }),
    expo(),
  ],
  /**
   * No billing plugin, and no billing hook on sign-up.
   *
   * The previous provider needed both: a plugin mounting its own routes under
   * /api/auth/*, and a `user.create` hook mirroring every new account into the
   * provider so a free tier could be applied to it. Paystack needs neither.
   * Its customers are created on the first checkout (`ensureCustomer` in
   * billing/store.ts), the free tier is the absence of a paid grant rather
   * than a product someone is enrolled in, and checkout is driven from the
   * server, so the browser has no billing SDK to authenticate.
   *
   * The practical win: sign-up no longer depends on a billing provider being
   * reachable, so it cannot half-succeed — which is what the old hook's
   * swallowed error produced, an account with no customer record and a
   * checkout that failed weeks later for a reason nobody could see.
   */
});
