import { Hono } from "hono";
import { consume, peek, refund } from "../../entitlements/usage";
import { activeTranslator, translateStatuses } from "../../translate";
import { ApiError, badRequest, ok } from "../http";
import { guard } from "../middleware";

/**
 * `/v1/translate` — free-text Amharic ⇄ English.
 *
 * Basic and above, matching the oRPC procedure the app uses, because this is
 * the endpoint that turns the product into a general translation service. The
 * lesson content stays free to read; translating arbitrary text a learner
 * pastes in is the paid part, and gating it here rather than in the client is
 * what makes that real.
 *
 * Every call goes through the provider registry in `api/translate/`. When no
 * provider is configured this answers 503 and says which environment variable
 * is missing — it never falls back to echoing the input, which is the failure
 * mode that makes a translation API look like it works while returning
 * nothing of the kind.
 */

export const translateRoutes = new Hono();

const DIRECTIONS = ["en2am", "am2en"] as const;
type Direction = (typeof DIRECTIONS)[number];
const MAX_CHARS = 2000;

translateRoutes.post("/", async (c) => {
  const caller = guard(c, { identity: "user", scope: "translate", plan: "basic", tier: "ai" });

  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) {
    throw badRequest('Send a JSON body: { "text": "…", "direction": "en2am" }.');
  }

  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) throw badRequest("`text` is required.");
  if (text.length > MAX_CHARS) {
    throw new ApiError("payload_too_large", `\`text\` must be at most ${MAX_CHARS} characters.`, {
      limit: MAX_CHARS,
      received: text.length,
    });
  }

  const direction = body.direction;
  if (typeof direction !== "string" || !DIRECTIONS.includes(direction as Direction)) {
    throw badRequest('`direction` must be "en2am" or "am2en".', { allowed: [...DIRECTIONS] });
  }

  const translator = activeTranslator();
  if (!translator) {
    throw new ApiError(
      "not_configured",
      "No translation provider is configured on this deployment. Set AMHARICAI_TRANSLATE_URL to enable it.",
      { reason: "translation_not_configured", providers: translateStatuses() },
    );
  }

  /**
   * Metered before the call and refunded on failure, the same order and for
   * the same reason as synthesis: quota taken first is the only ordering that
   * caps spend under concurrency, and a refund is the only way a vendor
   * timeout does not cost the caller a unit.
   */
  const spend = await consume(caller.subject, caller.plan, "translate_request");
  if (!spend.consumed) {
    throw new ApiError(
      "quota_exceeded",
      "You have used this period's translation allowance.",
      {
        meter: "translate_request",
        limit: spend.limit,
        used: spend.used,
        remaining: spend.remaining,
        resets_at: spend.resets_at,
        plan: caller.plan,
      },
    );
  }

  try {
    const result = await translator.translate({ text, direction: direction as Direction });
    return ok(c, {
      translation: result.translation,
      direction: result.direction,
      provider: result.provider,
      source: "provider",
    });
  } catch (error) {
    await refund(caller.subject, "translate_request").catch(() => undefined);
    throw new ApiError(
      "upstream_failed",
      error instanceof Error ? error.message : "The translation provider did not return a translation.",
      { reason: "translation_failed" },
    );
  }
});

/** Provider availability and the caller's remaining allowance, spending none. */
translateRoutes.get("/status", async (c) => {
  const caller = guard(c, { scope: "translate" });
  return ok(c, {
    available: activeTranslator() !== null,
    providers: translateStatuses(),
    directions: [...DIRECTIONS],
    max_characters: MAX_CHARS,
    plan: caller.plan,
    meter: caller.userId ? await peek(caller.subject, caller.plan, "translate_request") : null,
  });
});
