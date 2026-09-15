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

## Stage B (in progress) — web admin + account UI

Done so far, all in `packages/web/src/web/`:
- `queries/access.ts`  — useAccess (access.me), useMyRedemptions, useRedeemCode
                         (invalidates access/catalog/content on success), useCheckout
- `queries/admin.ts`   — status/summary/listCodes/grants + issueCode/revokeCode/revokeGrant,
                         all `retry: false` so a 403 for a non-admin resolves immediately
- `pages/subscription.tsx` — resolved plan + source + expires_at + `expired_notice` banner
                         ("Your access code has expired"), feature rows gated on `usable`
                         (never `granted`), plan-gated rows keep the "Even on a higher plan:"
                         caveat prefix, redeem form (6 digits, server error text verbatim),
                         redemption history, paid plans with the honest checkout refusal
                         rendering `blockers` verbatim, `tts_per_day` keeps "not enforced yet"
- `pages/admin.tsx`    — renders the 403 honestly for non-admins (naming ADMIN_EMAILS rather
                         than showing a blank page); deployment status incl. billing blockers
                         verbatim; 4 counters; issue form (plan/durationDays/expiresInDays/
                         maxRedemptions/features/note); plaintext shown ONCE with the server's
                         `warning` + copy button; code list (hint only) with Revoke code;
                         grants list with Revoke access; explicit note that the two revokes
                         are different decisions
- `app.tsx`            — routes `/subscription`, `/admin`
- `components/layout.tsx` — nav item "Plan" -> /subscription. Admin link appears on the
                         subscription page only when `admin.status` succeeds (cosmetic only).

Gates: root `bun run lint` clean (40 files), root `bun run build` clean (tsc --noEmit + vite).

## Stage B web — VERIFIED and complete

Browser suite `/tmp/ui_verify.py`: **32/32**, three states (anonymous / signed-in non-admin /
admin). Backend gate `/tmp/acc_verify.py` still **45/45**. Lint and build clean.

Two things the suite caught, both worth keeping in mind:

1. FALSE ALARM — "redemption history row missing". The panel rendered fine; the heading is
   CSS-`uppercase`d, so a case-sensitive assertion could never match. Fixed the *test*, not
   the page. Third text-extraction false alarm in this project: verify with a DOM dump before
   "fixing" a suspected bug.

2. REAL — `/subscription` was calling `admin.status`, which for a learner can only ever answer
   401 or 403. That put a permanent red herring in every learner's console. Passing
   `enabled: isSignedIn` only silenced the anonymous 401; signed-in non-admins still 403'd.
   Proper fix: `access.me` now returns `is_admin` (computed server-side from the *verified*
   session email vs ADMIN_EMAILS), and the subscription page reads that. `/subscription` now
   makes no privileged call at all, and the suite asserts that as its own check.
   The flag decides nothing — every privileged call is still gated by `adminOnly` server-side.

The console check is now attributed by phase rather than blanket: it allows the three console
errors this suite deliberately provokes (checkout that cannot charge -> 503, wrong code -> 404,
non-admin explicitly opening /admin -> 403) and fails on anything else, so a stray call on a
page that had no business making it still breaks the build.

Next: mobile (packages/mobile) — login, subscription screen reading `access.me`, redeem-code
screen, Restore Purchases affordance; replace `lib/preview-plan.tsx` usage (do NOT persist it).
Then Stage C, the Nuxt BFF integration.

## Stage B mobile — VERIFIED and complete

Files: `queries/access.ts` (new), `app/subscription.tsx` (new), `app/(tabs)/profile.tsx`
(plan card now server-resolved, links to /subscription), `app/pricing.tsx` (corrected).

Gates, all green:

- `packages/mobile` `bun run typecheck` clean. Two real errors fixed on the way: an
  `Ionicons` name that does not exist (`badge-outline` -> `ribbon-outline`), and an implicit
  `any` in `src/api/middleware/admin.ts` — the mobile tsconfig typechecks the web API types it
  imports, so a web-side annotation gap surfaces here rather than in the web build.
- root `bun run lint` clean (40 files), root `bun run build` clean.
- `/tmp/acc_verify.py` **45/45** (backend unchanged, re-run as the gate).
- `/tmp/mob_sub.py` **21/21** — anonymous and signed-in, /subscription /pricing /profile.
- `/tmp/mob_redeem.py` **11/11** — the redeem HAPPY path on the device: a real
  admin-issued code, gate demonstrably CLOSED on `u3-l1` (403 "Included from the Learner
  plan"), redeem, plan becomes **Premium / Verified / "Access code" / 30 days left**, history
  shows `····85` and never the plaintext, then the gate demonstrably OPEN on the same lesson.
  So the mobile surface is not just wired — the entitlement it draws is enforced.

### `app/pricing.tsx` — two corrections, both honesty bugs

1. It still carried the dead blocker "there is no payment key in this build and no account
   store to record a subscription against". The second half stopped being true the moment
   Stage A landed. Replaced with the Autumn truth: the integration is not wired, so nothing
   can be bought, and the button will say exactly what is missing. A stale honesty notice is
   just another false statement.
2. It offered "Preview as {plan}" buttons to *signed-in* learners, for whom the server ignores
   the preview switch entirely — the buttons silently did nothing. They are now hidden when
   signed in, replaced by a link to `/subscription`, and the copy says the switch is ignored.
   The capability heading also stops calling a signed-in learner's real plan a "preview".

### Two more false alarms from my own assertions (fourth and fifth in this project)

Both on `/profile` anonymous, both my test's fault, neither a code bug. The screen shows the
SignInPrompt for the *progress* half and still renders the plan card below it, and the chip
reads lower-case `free · preview`. A case-sensitive `"Free" in t` and then a `"Plan" not in t`
both failed against a page that was correct. Dumped the DOM, fixed the assertions. The rule
stands: dump before diagnosing.

The console check in both mobile suites is phase-attributed, like the web one. `mob_redeem`
allows exactly one error — the 403 from the gate it deliberately closes — and nothing else.

### Deliberate, not oversights

- The new mobile screens are **English-only**; no keys were added to `i18n/messages.ts`.
  This follows `app/sign-in.tsx`, already English-only. Machine-translating billing and
  security copy into Amharic is worse than leaving it in English until a native reviewer
  writes it. (The rule still holds for anything that *is* added there: both locales or the
  key renders as a visible bug.)
- `lib/preview-plan.tsx` stays, is still **never persisted**, and still owns
  `locale`/`toggleLocale`. Only its `plan` reads shrank.
- `queries/catalog.ts` `useEntitlements()` still reads `catalog.me` with the preview plan, so
  the anonymous preview switch keeps working. `/subscription` and the profile plan card read
  `access.me` directly. For a signed-in caller both resolve identically, because the server
  ignores the preview switch — verified by the suites above.
- The iOS **code-redemption screen is an App Review risk** and stays on the record: Apple has
  its own Offer Codes mechanism, and custom redemption granting paid content can read as
  circumventing IAP.
- Mobile purchase flow is still not buildable here: IAP needs a development build, and running
  EAS in this sandbox would kill it. Restore Purchases exists and says plainly that there is
  no purchase mechanism to restore from yet.

Next: Stage C, the Nuxt BFF integration (`/home/user/gh/AmharicAI`).

## User manual (documentation round)

Written to `/home/user/amharicai-manual.report/content.md` (~3,780 words, 6-8 pages), Markdown per
the report skill ("user manual" is a document, not DOCX/PDF).

Audience split: learners (sign in, plan page, redeem, refusal reference) + administrator
(ADMIN_EMAILS/ACCESS_CODE_PEPPER prerequisites, status cards, issue form field-by-field,
revoke-code vs revoke-grant, the 0.02% residual-risk figure, the iOS App Review risk).

Sources: repo code + driving the live servers. No web research (the repos are authoritative).
12 real Playwright screenshots in `images/`, captured 2026-09-08 against :4200 / :4300 / :3000,
9 of them referenced by absolute path. The capture ran a genuine end-to-end flow: admin issued a
Premium code (852939) -> fresh learner `manual1788833374@amharicai.test` redeemed it -> Premium /
Verified / 30 days left -> same grant visible on mobile with no second redemption -> that learner
opening /admin gets the honest "Not an administrator" page naming ADMIN_EMAILS.

Recaptured the admin page as clipped sections: the full-page shot was 5802px tall, dominated by
~30 leftover smoke-test codes, so the issue form and the once-only plaintext were an unreadable
sliver. `web-admin-status.png` (viewport) + `web-admin-issue-form.png` (section clip) replace it.
A second code (336073, learner/60d/5 redemptions) was issued for that shot and is live in the
local DB.

The Note field in `web-admin-issue-form.png` shows its grey placeholder, not typed text - the fill
did not take. Not captioned as filled.

Two follow-ups noticed while writing, both recorded in the manual's closing section, neither fixed:
1. `packages/web/src/api/content/plans.ts` header comment still claims the active plan is "a
   client-side preview switch, not an entitlement" - untrue since Stage A.
2. Nuxt `server/api/billing/checkout.post.ts` still emits the dead "there is no account store yet"
   blocker (already fixed on web and mobile). Belongs to Stage C item 7.

Stage C remains untouched: `server/utils/managed.ts` is still the single uncommitted, uncompiled
file in /home/user/gh/AmharicAI.
