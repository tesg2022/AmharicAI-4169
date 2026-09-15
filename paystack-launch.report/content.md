# AmharicAI — Paystack Purchase Flows: Verification Report

**Date:** 14 September 2026
**Scope:** Basic and Premium purchase flows on the AmharicAI website, Paystack Test Mode
**Status:** All four paid configurations verified working end-to-end in Test Mode.

---

## Executive Summary

All four paid options — Basic Monthly R89, Premium Monthly R179, Premium Annual R1,399 and Premium Lifetime R2,599 — are live on the website, priced from a single source of truth, and mapped to real Paystack Test Mode identifiers. Each was taken through a real hosted Paystack checkout with a real test-mode card and each produced a correct server-side entitlement grant. Hono remains the only entitlement authority: access is written only after a Paystack verification confirms the transaction.

**One item blocks the switch to production:** the webhook URL is not registered in the Paystack dashboard, so Paystack itself has never delivered an event to this deployment. The endpoint is proven correct (correctly signed deliveries are accepted, replays are no-ops, tampered bodies are rejected 401), but registration is a dashboard-only action that cannot be done through the API. Until it is registered, fulfilment depends entirely on the customer completing the browser redirect.

The "Not available yet" state is gone from all four options. Premium's custom Amharic voice and microphone speaking feedback remain explicitly marked "coming soon" — they are not implemented and nothing paid switches them on. Units 7–20 remain locked for every plan, including Premium.

---

## Key Findings

- **Four live options, all purchasable.** The catalogue API reports `checkout_available: true` and `sellable: true` for all four, with `blockers: []`. Verified in the browser and at the API.
- **Two full browser checkouts completed on the public domain**, covering both fulfilment paths: a subscription (`basic_monthly`, fulfilled by webhook) and a one-off (`premium_lifetime`, fulfilled by the redirect callback). Both produced correct grants.
- **The webhook endpoint is correct but unregistered.** A correctly signed `charge.success` delivered over the public internet returned `200 {"outcome":"granted:basic_monthly"}`. Paystack's own delivery has never fired — zero events in `paystack_events` prior to the manual test.
- **Three real bugs were found and fixed during verification**, including one entitlement-resolution bug that mis-reported a lifetime buyer's expiry date, and one display bug that rendered prices as `≈5.51` with no currency symbol.
- **114 automated checks pass** across two suites (59 billing, 55 entitlement), with `tsc --noEmit` clean.

---

## 1. Paystack Identifiers

Confirmed against a live `GET /plan` on the test account. These are real Paystack objects, not internal ids.

| Internal option id | Paystack identifier | Type | Amount | Interval |
| --- | --- | --- | --- | --- |
| `basic_monthly` | `PLN_rfkigrvjzuvpxzv` | Plan | ZAR 8900 (R89) | monthly |
| `premium_monthly` | `PLN_01y3nctomyvt54i` | Plan | ZAR 17900 (R179) | monthly |
| `premium_annual` | `PLN_l4goo7hde74z3oh` | Plan | ZAR 139900 (R1,399) | annually |
| `premium_lifetime` | *(none — by design)* | One-off transaction | ZAR 259900 (R2,599) | no renewal |

`premium_lifetime` deliberately has no Paystack Plan. A Plan implies a renewal interval, and a lifetime purchase has none, so the amount is sent with the charge itself and the grant is written with `recurring: false` and `until: null`. This is handled in `src/api/billing/config.ts`, which maps option ids to plan codes through environment variables rather than hardcoding them — so the same code works against live-mode plan codes without a code change.

Amounts are stated in subunits (cents) because that is what Paystack charges in, and every amount was checked against the subunit value rather than the display string.

---

## 2. Live Test Mode Verification

### 2.1 Browser checkouts (public domain, same-origin)

Both runs were real: a real hosted Paystack checkout page, the test-mode card simulator set to "Success", and a real redirect back.

| | Run A | Run B |
| --- | --- | --- |
| Option | `basic_monthly` | `premium_lifetime` |
| Amount on Paystack's page | ZAR 89 | ZAR 2,599 |
| Reference | `amh-basic_monthly-HG3nXqb3-abd387431290` | `amh-premium_lifetime-7CSlmzoO-a2727ace1ec2` |
| Paystack `transaction/verify` | `success`, 8900 ZAR, card, plan `PLN_rfkigrvjzuvpxzv` | `success`, 259900 ZAR, card |
| Fulfilled by | Webhook (`charge.success`) | Redirect callback |
| Grant written | `basic_monthly`, active, until 2026-10-14 | `premium_lifetime`, active, `until: null` |
| Plan page after | "Basic — Verified — Until Oct 14, 2026 · 30 days left" | "Premium — Verified"; receipts show "Premium (lifetime)" |

The callback URL came back clean — `https://amharic-zoinof5-preview-4200.runable.site/billing/callback?trxref=…&reference=…` — with no double slash, and the page rendered correctly with the right copy for a one-off purchase: *"That was a single payment — nothing renews and nothing expires."*

Transaction metadata carries `app_user_id`, `option_id`, `plan` and `term`, which is what ties a Paystack payment back to an account rather than to a browser.

### 2.2 Script checkouts (all four options)

`scripts/paystack-live-e2e.ts` drove all four options against real Paystack Test Mode in an earlier run: references `e2e-basic_monthly-1789403404752`, `e2e-premium_monthly-1789403406048`, `e2e-premium_annual-1789403406518`, `e2e-premium_lifetime-1789403407027`. All returned `status=success` with correct subunit amounts (8900 / 17900 / 139900 / 259900) and correct grants. This is what covers `premium_monthly` and `premium_annual`, which were not re-driven through the browser.

### 2.3 Webhook verification

| Test | Request | Result |
| --- | --- | --- |
| Unsigned body | `POST` with no signature header | `401 {"error":"bad_signature"}` |
| Correctly signed `charge.success` | HMAC-SHA512 over raw bytes with the live secret key | `200 {"ok":true,"event":"charge.success","outcome":"granted:basic_monthly"}` |
| Replay of identical bytes | same body, same signature | `200 {"ok":true,"duplicate":true}` — no second grant |
| Tampered body, original signature | amount changed 8900 → 999900 | `401 {"error":"bad_signature"}` |

All four were delivered over the public internet to `https://amharic-zoinof5-preview-4200.runable.site/api/webhooks/paystack`. The signed delivery settled the pending checkout, wrote the payment receipt and wrote the grant — the full fulfilment path, not a partial acknowledgement.

The design holds two properties worth stating because they are what make the endpoint safe: the signature is computed over the **raw request bytes** (so the route sits outside oRPC, which would parse and destroy them), and a signature is treated as proof of authorship but not of truth — every handler re-reads the object from Paystack's API and writes from that answer, so a replayed or forged body cannot invent a status, a date or an amount.

**Gap:** `paystack_events` contained zero rows before the manual test, meaning Paystack has never delivered an event here of its own accord. The webhook URL must be registered in the Paystack dashboard (Settings → API Keys & Webhooks); there is no API for this.

---

## 3. Entitlements

Quotas are enforced server-side in Hono. The numbers below are asserted by automated test against the running code, not read off the pricing page.

| | Free | Basic | Premium |
| --- | --- | --- | --- |
| Course units | Fidel & Pronunciation + first 2 units | every published written unit | every published written unit |
| Tutor questions | 10 / month | 300 / month | 3,000 / month (fair-use ceiling) |
| Audio plays | 20 / day | 300 / day | unmetered |
| Translation | not included | 1,000 chars / request | 5,000 chars / request |

Verified behaviours:

- A Free account is genuinely stopped after its 10th tutor question, through real `consume()` calls rather than a config read.
- The same account read under Basic correctly shows a 300 ceiling with 290 remaining — usage carries across, the ceiling moves.
- Premium's 3,000 is surfaced as a fair-use ceiling written as a number, not advertised as "unlimited".
- An unknown meter **fails closed** to the Free ceiling rather than open.
- An anonymous caller cannot obtain a paid ceiling, including via the preview-plan parameter.

### Units 7–20 stay locked on every plan

The course model currently has 6 written units and 14 unwritten. `unitAccess()` checks `unit.status !== "written"` **before** any plan check, so no plan can open an unwritten unit. Ran across all 20 units for all three plans: Free opens exactly units 1–2 (`reason: "plan_required"` beyond), Basic and Premium open all 6 written units and none of the 14 unwritten ones, which return `reason: "not_written"` — a "not yet written" message, not a paywall.

### Coming-soon features

`custom_voice` and `speech_recognition` are the only two features marked `coming_soon`, and they read as `coming_soon` on Premium — confirmed on the plan page in the browser. Premium's tagline now reads *"Everything currently available, unmetered audio, long-form translation — plus the custom voice and speaking feedback when they ship."* The pricing page carries a dedicated "What no plan buys yet" block stating plainly that nothing paid today switches them on.

---

## 4. Bugs Found and Fixed

**1. Wrong grant chosen when several are live at once** (`src/api/entitlements/resolve.ts`)
The tier-selection loop only updated the expiry when a grant's tier was *strictly higher* than the current best. Among several grants at the same tier, only the first-seen one set the expiry — so a lifetime Premium grant (`until: null`) seen after a monthly one was skipped as "not higher", and a lifetime buyer was reported as expiring on a date. Fixed by comparing **coverage** separately from tier: `null` beats any date, and among dated grants the furthest-reaching wins. `payment_failed` is now read off the grant actually holding access open, not off whichever grant set the tier. Locked in with six new regression checks that were confirmed to fail against the old logic.

**2. Prices rendered without a currency symbol** (`src/api/content/plans.ts`)
`formatApproxUsd()` returned `≈5.51` instead of `≈US$5.51` — the dollar sign had been lost in a template literal. Caught only by looking at the rendered page. Now `≈US$5.51`, `≈US$11.08`, `≈US$86.57`, `≈US$160.83`.

**3. Stale USD prices presented as the charged amount** (`src/web/pages/faq.tsx`, `src/api/content/legal.ts`)
The FAQ and the Terms price table carried hardcoded dollar figures ($4.99, $9.99, $79.99, $149) from before the move to ZAR. Both now derive every price from `BILLING_OPTIONS` via `formatZar()`, so they cannot drift from what checkout charges. A new FAQ entry — "What currency will I be charged in?" — states that rand is the only currency that can be charged, that the dollar figure is a fixed-rate reference conversion and not the price, and that the buyer's bank sets its own rate and may add a fee.

A fourth item was investigated and found **not** to be a bug: the callback page reporting "you are signed out" after a successful payment. That was a cross-origin artifact of testing from `localhost` while the callback lands on the public domain — different origin, no cookie. Repeating the flow entirely on the public domain produced a correctly signed-in, correctly fulfilled callback. The page's signed-out state is itself well-designed: it tells the user the payment is recorded against the account, not the browser.

---

## 5. Files Changed

| File | Change |
| --- | --- |
| `src/api/entitlements/resolve.ts` | Fixed grant selection among simultaneous same-tier grants; added `coverageOf()` |
| `src/api/content/plans.ts` | Premium tagline → "Everything currently available…"; fixed `formatApproxUsd()` currency symbol |
| `src/api/content/legal.ts` | Terms price table generated from `BILLING_OPTIONS`; ZAR-only pricing prose |
| `src/web/pages/faq.tsx` | Prices pulled from the pricing source; new currency FAQ entry; Free quota corrected to include 20 audio plays/day |
| `scripts/billing-selftest.ts` | New section 8, "Overlapping grants on one account" (6 checks) |
| `scripts/entitlement-selftest.ts` | **New** — 55 runtime checks over quotas, meters, unit gating, coming-soon flags, pricing consistency |
| `scripts/paystack-live-e2e.ts` | Fixed `report()` reading camelCase fields off a snake_case row |
| `.env` | Added three plan codes; removed the trailing slash from `WEBSITE_URL` |

---

## 6. Environment Variables

Already set for Test Mode:

```
PAYSTACK_SECRET_KEY=sk_test_…
PAYSTACK_PUBLIC_KEY=pk_test_…
PAYSTACK_PLAN_BASIC_MONTHLY=PLN_rfkigrvjzuvpxzv
PAYSTACK_PLAN_PREMIUM_MONTHLY=PLN_01y3nctomyvt54i
PAYSTACK_PLAN_PREMIUM_ANNUAL=PLN_l4goo7hde74z3oh
WEBSITE_URL=https://amharic-zoinof5-preview-4200.runable.site
```

`WEBSITE_URL` is required — without it there is nowhere for Paystack to send the customer back to, and checkout refuses to start rather than sending a broken callback. Its trailing slash was removed this session: `checkoutCallbackUrl()` already stripped it, but `auth.ts` passes the value to Better Auth raw, so normalising at the source removes the whole class of problem. `premium_lifetime` needs no variable — it has no plan code.

Test mode is detected from the `sk_test_` prefix, and payments taken on a test key are stored with `test_mode: true` so they can never read as revenue.

---

## 7. Remaining Production Configuration

**Blocking:**

1. **Register the webhook URL in the Paystack dashboard** (Settings → API Keys & Webhooks) for both test and live mode: `https<your-domain>/api/webhooks/paystack`. This cannot be done via the API. Without it, a customer who closes the tab before the redirect completes pays and receives nothing until they revisit the plan page. Re-check `paystack_events` for a Paystack-originated row after registering.
2. **Create the three plans in live mode** and swap `PAYSTACK_PLAN_*` to the live `PLN_…` codes. Test-mode plan codes do not work against a live key.
3. **Swap to live keys** (`sk_live_`/`pk_live_`) once Paystack has approved the South African entity for live transactions.
4. **Point `WEBSITE_URL` at the production domain** (`amharicai.org`), since it determines the callback URL Paystack redirects to.

**Recommended before launch:**

5. Confirm which payment channels should be enabled. The one-off R2,599 checkout offered Card, Scan to Pay, SnapScan and EFT; the subscription checkouts offered card only, because recurring billing requires a re-chargeable instrument. Worth a deliberate decision rather than accepting the default.
6. Re-run one live-mode transaction per option after the key swap, with a real card and a real refund, before advertising the prices.

**Not blocking, worth knowing:**

7. Two capabilities are unrelated to billing but still unconfigured in this build and will read as "Not configured" on the plan page: the TTS host for Amharic audio, and the translation provider key. A paying Basic or Premium customer would find audio and translation unavailable despite having paid for the allowance. This should be resolved before taking real money, or the allowances should be presented as pending.

---

## 8. Test Suites

| Suite | Checks | Result | Command |
| --- | --- | --- | --- |
| `scripts/billing-selftest.ts` | 59 | pass | `DATABASE_URL="file:/tmp/billing-selftest.db" bun run --env-file=.env packages/web/scripts/billing-selftest.ts` |
| `scripts/entitlement-selftest.ts` | 55 | pass | `DATABASE_URL="file:/tmp/entitlement-selftest.db" bun run --env-file=.env packages/web/scripts/entitlement-selftest.ts` |
| `tsc --noEmit` | — | clean | `bunx tsc --noEmit -p tsconfig.json` |

Both suites refuse to run against anything but a local file database, so they cannot touch production data. `entitlement-selftest.ts` cleans up its own rows and is idempotent across reruns — confirmed by running it twice against the same database file with identical results. `entitlement-selftest.ts` needs a schema pushed first: `DATABASE_URL="file:/tmp/entitlement-selftest.db" bunx drizzle-kit push --force`.

The billing suite fakes the Paystack boundary and says so in its own output, listing what it cannot cover: that Paystack's real payloads match the faked shapes, the hosted checkout page, the redirect and browser callback, real webhook delivery and signature generation, and plan creation against a real account. Every one of those is covered by the live tests in section 2 — except Paystack-originated webhook delivery, which remains the open gap.

---

## Methodology & Limitations

Every claim here traces to a command run in this session or a prior one: live Paystack API calls (`GET /plan`, `GET /transaction/verify`), real browser sessions driven through the hosted checkout and card simulator, direct database queries against the application's own tables, and the two automated suites. No result was inferred from reading code alone — the entitlement fix, for instance, was validated by reverting it and confirming the new tests genuinely failed.

Limitations:

- **Paystack-originated webhook delivery is unproven.** The endpoint was tested with a correctly signed payload of our own construction. Whether Paystack's servers reach this deployment is unknown until the URL is registered.
- **`premium_monthly` and `premium_annual` were driven by script, not browser.** Their checkout and fulfilment are proven; their specific rendering of Paystack's hosted page is not.
- **Renewal has not been observed.** A monthly subscription renewing 30 days out cannot be tested inside a session. `invoice.create` / `invoice.update` / `invoice.payment_failed` handling is covered only by the faked-boundary suite.
- **Everything is test mode.** No real money has moved, and no live-mode plan exists yet.
