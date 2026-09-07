# Round: accounts + entitlements + admin comp codes (Phase 2)

## Binding answers from the user
1. Authority for accounts + entitlements: the managed Hono + Drizzle + better-auth backend.
2. The 6-digit code is a comp/access code (admin issues, user redeems once for a plan without paying).
3. Full spec quoted in "Access code spec" below.
4. Scope: login + accounts + server-enforced entitlements end to end, real DB, plus admin code system.
   Payment still refuses honestly with `payment_not_configured`.
5. No provider keys this round. Build so keys drop in later; refuse honestly until then.
6. UI on all three surfaces: Nuxt website, mobile app, and an admin interface.

## Access code spec (user's own words, all mandatory)
- Admin-specified: plan, duration, expiration date, max redemptions, enabled features.
- Recipient must be logged in first, then redeems once.
- Audit: who created, who redeemed, when redeemed, status.
- Codes expire / become invalid after permitted use(s).
- Explicitly NOT an admin login password, NOT MFA, NOT passwordless sign-in.
- Backend is the sole authority for validating codes and granting entitlements.

## Security design (committed to the user; must hold)
6 digits = 10^6, brute-forceable without rate limiting. Safe only with ALL of:
- single-use per user + global `max_redemptions` cap
- short admin-set expiry
- bound to a specific logged-in account at redemption
- hashed at rest as `HMAC-SHA256(pepper, code)`; pepper from `ACCESS_CODE_PEPPER`,
  documented fallback to `BETTER_AUTH_SECRET`; refuse with `access_codes_not_configured`
  if neither is present (never degrade silently)
- hard lockout after a few failed attempts + per-account and global rate limiting
- generated with `crypto.randomInt`, unique constraint with retry on collision
- constant-time compare
Plaintext shown to the admin exactly ONCE at creation (HMAC is not reversible). Admin UI must say so.
Residual risk: ~200 live codes => 200/10^6 = 0.02% per random guess. Fine at 5 attempts/hour/account.

## NEW FINDING that reshapes the plan
`references/payments.md`: managed payments = Autumn (`autumn-js@1.2.28`, `atmn@1.1.8`),
via an `autumn()` better-auth plugin + `databaseHooks` creating the customer on sign-up.
Autumn owns customer, subscriptions[], balances{}. NOT Stripe-direct, NO webhook of mine.
=> Building my own `subscriptions` table would create a second source of truth for "is this
   person paid" once keys land. Asked the user which way to go before pushing schema.

Access codes are mine under every option: Autumn has no comp-code concept matching the spec.

## Staging
- Stage A: managed backend. Access-code tables + admin role + entitlement resolution from
  session (replaces the client preview switch as the source of `plan`). `bun run db:push`.
- Stage B: admin UI + mobile login/subscription/restore screens.
- Stage C: Nuxt BFF proxy (first-party cookie on amharicai.org, avoids third-party cookie
  blocking) + login/register/account/subscription pages, both locales.

## Honesty invariants not to break
- `grant` vs `capability` stay separate axes. UI calls `usable`, never `grants`.
- `featureState()` checks `coming_soon` BEFORE `plan_gated`. Do not reorder.
- `plan_source` becomes 'subscription' | 'access_code' | 'preview_cookie' | 'default_free';
  `plan_is_verified: true` only for subscription and access_code.
- `catalog.me/course/lesson` take `plan` as a client PREVIEW SWITCH today. Once accounts exist the
  session is authority for signed-in users; update the doc comment or it becomes a lie.
- Checkout refusal currently lists TWO blockers (no Stripe key, no account store). The second
  becomes obsolete once accounts land -> must be rewritten honestly.
- Units 7-20 = "Coming soon", never paywalled. Unwritten-unit lesson = NOT_FOUND, not 402/403.
- `tts_per_day` keeps its `not enforced yet` tag unless I actually enforce it.
- A login that does not gate anything is worse than no login. State any incomplete enforcement.

## Regression baseline (must still pass for anonymous/preview users)
catalog/me -> preview_client, unverified | course free -> u1,u2 ok, u3-u6 plan_required, u7-u20 not_written
lesson u1-l1 free 200 | u3-l1 free FORBIDDEN plan_required | u7-l1 premium NOT_FOUND lesson_not_found
translate free FORBIDDEN plan_required | learner SERVICE_UNAVAILABLE translation_not_configured
checkout learner SERVICE_UNAVAILABLE payment_not_configured | free BAD_REQUEST plan_is_free
oRPC wire: POST /api/rpc/<path> body {"json": {...}}

## Also uncommitted, flagged to user
`packages/mobile/app.json` iOS bundleIdentifier hand-edited
com.amharicai_zoin.runable -> com.amharicai_zoin.capetown (legal, not build-breaking; left alone).

## Stage A: DONE and verified (45/45 checks, /tmp/acc_verify.py)
Files: database/schema.ts (+3 tables), entitlements/codes.ts, entitlements/resolve.ts,
middleware/admin.ts, routes/access.ts, routes/admin.ts, content/plans.ts, routes/catalog.ts, index.ts.

KEY FINDING: AUTUMN_SECRET_KEY is already provisioned in .env by the platform, but there is no
autumn.config.ts, no autumn-js dependency and no autumn() plugin. So billing is genuinely NOT
wired and `billingStatus()` reports that precisely instead of keying off the env var's presence.
`integrationWired` is a hardcoded false that flips in the same commit that adds the integration.

BUG FOUND AND FIXED during verification: re-redeeming your own code returned `code_exhausted`
(the seat cap was checked before the own-redemption lookup) and burned a lockout attempt.
Own-redemption check now runs first -> 409 already_redeemed, no attempt consumed.

Verified: preview switch is IGNORED for signed-in users; gate really opens on redeem (u3-l1
403 -> 200) and really closes again on admin revoke; lockout at 5 failures blocks even a valid
code; listCodes never returns plaintext or hash; pepper falls back to BETTER_AUTH_SECRET.
