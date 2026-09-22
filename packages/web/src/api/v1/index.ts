import { Hono } from "hono";
import { ApiError, ok, onError } from "./http";
import { pipeline } from "./middleware";
import { authRoutes } from "./routes/auth";
import { lessonRoutes } from "./routes/lessons";
import { progressRoutes } from "./routes/progress";
import { speechRoutes } from "./routes/speech";
import { subscriptionRoutes } from "./routes/subscriptions";
import { translateRoutes } from "./routes/translate";
import { tutorRoutes } from "./routes/tutor";

/**
 * The versioned REST surface, mounted on the app's existing Hono server.
 *
 * This is one versioned view over the same procedures the first-party clients
 * already call — not a second backend. The oRPC router at `/api/rpc` stays
 * exactly as it is and stays the typed path the web, Expo and Electron clients
 * use; this is the plain-HTTP path for anything that cannot speak oRPC. Both
 * call the same functions underneath (`speech/serve.ts`, `translate/`,
 * `progress/service.ts`, `entitlements/`), so there is no second
 * implementation of metering, entitlement or provider selection to drift.
 *
 * Why a version prefix on day one, when today's only consumers are ours: the
 * cost of `v1` now is one path segment, and the cost of adding it later is a
 * breaking change to every integration that exists by then. The routes are
 * shaped for an external developer — API key auth, scopes, per-key rate
 * limits, stable error codes — but nothing here requires opening them up. That
 * stays a policy decision (who gets issued keys), not a rewrite.
 *
 * Mount topology, deliberately flat:
 *
 *   /api/v1/auth/*                   keys, scopes, whoami
 *   /api/v1/tts, /api/v1/transcribe  speech, both directions
 *   /api/v1/translate/*              text translation
 *   /api/v1/tutor/*                  the streaming tutor turn and its history
 *   /api/v1/lessons/*                course content, gated by plan
 *   /api/v1/progress/*               the caller's XP, streak, mastery, rank
 *   /api/v1/subscriptions/*          entitlement and the price list, read-only
 *
 * The base is `/api/v1` rather than a bare `/v1`, and that is a deployment
 * fact rather than a taste: both front doors — the Vite dev middleware and the
 * production Bun server — hand exactly `/api*` to this Hono app and serve
 * everything else as the single-page app. A bare `/v1` would answer with the
 * index HTML, and changing that means editing two template-managed entrypoints
 * that a platform update can overwrite — breakage that would surface as every
 * integration suddenly parsing an HTML page. `/v1` is registered below as an
 * alias anyway, so the day the front door does forward it, it already works.
 *
 * Speech sits at the version base rather than under a `/speech` segment
 * because `tts` and `transcribe` are what a client thinks in; that one provider
 * registry serves both is our implementation detail, not a URL anyone should
 * have to know.
 */

export function mountV1(app: Hono): void {
  const v1 = new Hono();

  // The pipeline runs first on every request here: request id, caller
  // resolution, rate limit, one structured log line. Registered before any
  // route so there is no way to add an endpoint that skips it.
  v1.use("*", pipeline);

  // Every throw below this line becomes the documented error envelope. A
  // mounted sub-app carries its error handler with it, so these failures never
  // fall through to the framework's default text response.
  v1.onError(onError);

  v1.route("/auth", authRoutes);
  v1.route("/", speechRoutes);
  v1.route("/translate", translateRoutes);
  v1.route("/tutor", tutorRoutes);
  v1.route("/lessons", lessonRoutes);
  v1.route("/progress", progressRoutes);
  v1.route("/subscriptions", subscriptionRoutes);

  /**
   * Discovery. A developer handed a key and a base URL types this first, so it
   * answers with the route list rather than a 404.
   */
  v1.get("/", (c) =>
    ok(c, {
      version: "v1",
      /** Paths below are relative to this base — prepend it, don't guess it. */
      base_url: `${new URL(c.req.url).origin}/api/v1`,
      endpoints: {
        auth: [
          "GET /auth/me",
          "GET /auth/scopes",
          "GET /auth/keys",
          "POST /auth/keys",
          "DELETE /auth/keys/:id",
        ],
        speech: ["POST /tts", "GET /tts", "GET /tts/usage", "POST /transcribe"],
        translate: ["POST /translate", "GET /translate/status"],
        tutor: [
          "POST /tutor/messages",
          "GET /tutor/history",
          "POST /tutor/history",
          "DELETE /tutor/history",
          "GET /tutor/usage",
        ],
        lessons: ["GET /lessons", "GET /lessons/flags", "GET /lessons/:id"],
        progress: [
          "GET /progress",
          "GET /progress/lessons",
          "GET /progress/activity",
          "GET /progress/leaderboard",
          "PATCH /progress/settings",
        ],
        subscriptions: [
          "GET /subscriptions",
          "GET /subscriptions/plans",
          "GET /subscriptions/usage",
        ],
      },
    }),
  );

  /**
   * Unknown paths get the same envelope as every other failure.
   *
   * A sub-app's own not-found handler is dropped when it is mounted, so this is
   * a catch-all route registered last instead. Handlers run in registration
   * order and a matched route returns before reaching it, so it only fires when
   * nothing above answered — which is exactly a 404, and far more useful to a
   * client's error handling than the server's default HTML.
   */
  v1.all("*", () => {
    throw new ApiError("not_found", "No such endpoint. GET /api/v1 lists what exists.");
  });

  // The canonical base, and the only one the front door reaches today.
  app.route("/api/v1", v1);
  // The alias, for the day something forwards a bare `/v1`. One routing entry
  // now against a breaking migration later.
  app.route("/v1", v1);
}
