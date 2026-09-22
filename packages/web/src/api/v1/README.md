# `/api/v1` — the versioned REST surface

One versioned view over the procedures the first-party clients already call. It is
not a second backend: the oRPC router at `/api/rpc` is untouched and stays the typed
path for web, Expo and Electron, while this is the plain-HTTP path for anything that
cannot speak oRPC. Both call the same functions underneath — `speech/serve.ts`,
`translate/`, `progress/service.ts`, `entitlements/` — so metering, entitlement and
provider selection exist once and cannot drift.

Mounted from `api/index.ts` via `mountV1(app)`.

## Base URL

```
/api/v1
```

`/v1` is registered as an alias on the same instance, but **only `/api/v1` is
reachable today**. Both front doors — the Vite dev middleware
(`vite/__plugins/hono-dev-plugin.ts`) and the production Bun server
(`src/__server.ts`) — forward only `/api*` to Hono and serve everything else as the
SPA. A bare `/v1` would answer with index HTML. Both entrypoints are
template-managed, so they are not edited to fix that; the alias is there for the day
the front door forwards it.

`GET /api/v1` returns the live endpoint list. That is the discovery document — read
it instead of trusting this file to stay current.

## Authentication

Three caller kinds, resolved in `caller.ts`:

| Kind | How | Notes |
| --- | --- | --- |
| `key` | `Authorization: Bearer ak_live_…` or `X-API-Key: ak_live_…` | Scoped. Cannot manage keys. |
| `session` | The normal better-auth cookie | Full scopes. The only kind that may issue or revoke keys. |
| `anonymous` | Nothing presented | Reduced rate limit, `free` entitlements, read-only endpoints only. |

A key carries **no entitlement of its own**. It names a user, and the plan is
resolved from that user on every request (`resolvePlan()`), so a key can never be a
cheaper or unmetered side door.

Keys are stored as SHA-256 only. `issue()` is the one function that ever sees the
plaintext and it returns it once. Revoked, expired and never-existed all fail
identically: one 401 with the same body.

### Scopes

`*`, `tts:read`, `tts:synthesize`, `asr:transcribe`, `translate`, `tutor:read`,
`tutor:write`, `lessons:read`, `progress:read`, `progress:write`,
`subscriptions:read`. `GET /api/v1/auth/scopes` returns the list.

## Response shape

Success puts the payload at the top level beside a `request_id`:

```json
{ "plan": "basic", "quotas": { … }, "request_id": "5f3c…" }
```

Failure is one nested `error` object beside the same `request_id`:

```json
{ "error": { "code": "forbidden", "message": "…", "detail": { … } }, "request_id": "5f3c…" }
```

There is no `data` envelope on success — a client checks for `error`. Every response
carries `x-request-id` (an inbound `x-request-id` is honoured, sanitised and
length-capped, so a trace spanning the app and the API keeps one id), plus
`ratelimit-limit`, `ratelimit-remaining` and `ratelimit-reset`.

The one exception is `POST /tutor/messages`, which streams an AI SDK UI message
stream. Failures *before* the stream opens are still the JSON envelope; once bytes
are flowing the transport is the stream's.

Error codes and their statuses (`http.ts`): `bad_request` 400, `unauthorized` 401,
`plan_required` 402, `forbidden` 403, `not_found` 404, `method_not_allowed` 405,
`payload_too_large` 413, `unsupported_media_type` 415, `quota_exceeded` 429,
`rate_limited` 429, `upstream_failed` 502, `not_configured` 503, `internal` 500.

## Rate limits

Per-minute fixed windows, keyed by API key id, then user id, then hashed address
(`ratelimit.ts`). Defaults: anonymous 30, free 60, basic 180, premium 600. Write
endpoints that reach a model run on a separate `ai` tier at half the caller's limit.
A key's own `rate_limit_per_minute` only ever lowers the ceiling.

## What is deliberately not here

- **Checkout, cancel and resume.** Payment is a hosted redirect flow, so it cannot
  be driven over a REST API. `GET /subscriptions/plans` says so explicitly in its
  `checkout` field. Those stay on the oRPC `billing` / `billing-paypal` procedures.
- **Anything that writes lesson content.** Authoring is an admin surface, not an API.

## Environment

All four AI surfaces follow the same pattern: an endpoint URL in an env var, and the
surface reports itself unconfigured until that URL is set. Nothing else in the app
changes when a surface moves to a GPU box — no code, no redeploy of the clients.
Each surface degrades independently: TTS configured with no ASR is a valid
deployment, and so is the reverse.

### Text to speech — `POST /api/v1/tts`

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `AMHARICAI_TTS_URL` | yes | — | Full endpoint URL. Unset disables synthesis (`503 not_configured`). |
| `AMHARICAI_TTS_TOKEN` | no | — | Bearer token for the endpoint. |
| `AMHARICAI_TTS_PATH` | no | — | Path appended to the URL. |
| `AMHARICAI_TTS_VOICE` | no | `amharicai-native-f` | Default voice id. |
| `AMHARICAI_TTS_VOICE_ALT` | no | `amharicai-native-m` | Second speaker, dialogue mode. |
| `AMHARICAI_TTS_FORMAT` | no | `wav` | `wav` or `mp3`. |
| `AMHARICAI_TTS_SAMPLE_RATE` | no | `24000` | Matches `training_config.audio.sample_rate`. |

### Speech recognition — `POST /api/v1/transcribe`

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `AMHARICAI_ASR_URL` | yes | — | Full endpoint URL. Unset falls back to the deterministic typed self-check. |
| `AMHARICAI_ASR_TOKEN` | no | — | Bearer token. |
| `AMHARICAI_ASR_PATH` | no | — | Path appended to the URL. |
| `AMHARICAI_ASR_MODEL` | no | — | Model id, sent as a query parameter. |
| `AMHARICAI_ASR_TIMEOUT_MS` | no | `30000` | Upstream timeout. |

### Translation — `POST /api/v1/translate`

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `AMHARICAI_TRANSLATE_URL` | yes | — | Full endpoint URL. Unset disables free-text translation. |
| `AMHARICAI_TRANSLATE_KEY` | yes | — | Bearer token. |
| `AMHARICAI_TRANSLATE_MODEL` | no | — | Passed through as `model`. |
| `AMHARICAI_TRANSLATE_TIMEOUT_MS` | no | `20000` | Upstream timeout. |

### Tutor — `POST /api/v1/tutor/messages`

Runs through the AI gateway rather than a bespoke registry, so its endpoint var is
the shared one:

| Variable | Required | Purpose |
| --- | --- | --- |
| `AI_GATEWAY_BASE_URL` | yes | Point at a self-hosted OpenAI-compatible gateway to move the tutor off the managed one. |
| `AI_GATEWAY_API_KEY` | yes | Gateway credential. |

### Provider pinning and limits

| Variable | Purpose |
| --- | --- |
| `SPEECH_PROVIDER` | Pin the TTS provider by id. A pinned provider that is not configured stays unconfigured — it does not silently fall back. |
| `SPEECH_RECOGNIZER` | Pin the ASR provider by id. Falls back to `SPEECH_PROVIDER` when unset. |
| `TRANSLATE_PROVIDER` | Pin the translation provider by id, same semantics. |
| `V1_RATE_LIMIT` | Override the per-minute default-tier limit for every caller. |
| `V1_RATE_LIMIT_AI` | Override the per-minute `ai`-tier limit. Without it, the AI tier is half the default tier. |

`GET /api/v1/translate/status` and `GET /api/v1/tts` report which providers are
configured and, for the ones that are not, exactly which variables are missing. Use
those rather than reading env on the server.

## Files

| File | Holds |
| --- | --- |
| `index.ts` | `mountV1()` — mount order, discovery endpoint, 404 catch-all. |
| `http.ts` | `ApiError`, the envelope helpers, `onError`, the code-to-status table. |
| `middleware.ts` | `pipeline` (request id, caller resolution, rate limit, log line), `guard()`. |
| `caller.ts` | `resolveCaller()` and the `Caller` shape; the require* assertions. |
| `keys.ts` | Issue, list, revoke, verify. The only place plaintext keys exist. |
| `ratelimit.ts` | Windows, tiers, the `RateLimit-*` headers. |
| `routes/` | One file per surface. No business logic — they validate, guard, and delegate. |
