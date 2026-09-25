# PayPal alongside Paystack — build log (PARKED, NOT LIVE)

## Status: reverted and parked

This whole line of work is switched off. Nothing below is in the product.

Customer-facing billing is Paystack in ZAR, exactly as it was before this
build: R89 basic monthly, R179 premium monthly, R1 399 premium annual,
checkout open to new customers, the two existing subscribers untouched on
their existing plan codes.

What was taken out of `main` when this was parked:

- PayPal *sales* path — `routes/billing-paypal.ts`, `paypal-checkout/verify/
  fulfil/webhook`, the `/api/webhooks/paypal` mount, `/billing/callback/paypal`,
  both web and mobile PayPal buttons and their queries, `scripts/paypal-setup.ts`
  and `scripts/paypal-selftest.ts`.
- USD pricing — `price_usd`, `formatUsd`, the monthly-equivalent sub-line, and
  every dollar figure in customer-facing copy and the Terms price table.
- The "PayPal is not configured" banner, along with the flow it sat in.

What deliberately stayed, and must keep working:

- The PayPal *read* side — `billing/paypal.ts`, `paypal-config.ts`,
  `paypal-store.ts`, `database/paypal-schema.ts`, the two-provider merge in
  `billing/grants.ts`, provider dispatch in `entitlements/resolve.ts` and
  `supersede.ts`, and the PayPal branches in `routes/billing.ts` and the
  subscription page. No PayPal payment was ever taken, so there is nothing to
  read back — but if a row ever existed it still resolves to access rather
  than vanishing.

Recovery: branch `usd-paypal-pricing` holds the complete USD/PayPal state,
including the two gitignored scripts under `packages/web/scripts/`. Diff any
file with `git diff main usd-paypal-pricing -- <path>`.

Why it was parked rather than finished: Paystack cannot charge USD on this
account and PayPal was never configured, so the dollar price list was a page
quoting a price no checkout could take. Details in the comment block at the
bottom of `packages/web/src/api/content/plans.ts`.

---

Everything from here down is the original build log, kept as history.

Decision: PayPal is a SECOND provider. Paystack is not replaced, not refactored.
Paystack keeps ZAR + cards/local. PayPal takes USD + PayPal balance/international.
Both write grants that feed ONE entitlement resolver.

USD is now the canonical customer-facing currency, and the price list in
`packages/web/src/api/content/plans.ts` is the only place it is written down:
basic_monthly $4.99, basic_annual $49.99, premium_monthly $9.99,
premium_annual $79.99. Do not copy those figures anywhere else — read them.
Every checkout path re-reads the PayPal plan by id and refuses the sale on any
currency, amount, interval or status disagreement (`billing/paypal-verify.ts`),
so the displayed price cannot drift from the charged one.

Paystack stays exactly as it was: ZAR, its own plan codes, closed to new sales
(`paystackOpenToNewSales()` is false) and still serving its existing
subscribers at the rand price they agreed to.

premium_lifetime: NOT sold on PayPal (needs Orders API). Schema leaves room for it.

## Order of work

- [x] plans.ts: `price_usd` on BillingOption + `formatUsd`
- [x] database/paypal-schema.ts + re-export from schema.ts
- [x] billing/paypal.ts — HTTP client (OAuth, products, plans, subscriptions, webhook verify)
- [x] billing/paypal-config.ts — env plan-id map, status, sellability
- [x] billing/paypal-store.ts — mirror reads/writes, `paypalLiveGrants`, event idempotency
- [x] billing/paypal-fulfil.ts — never grant without re-fetching from PayPal
- [x] billing/paypal-webhook.ts — signature verified via PayPal's own API
- [x] billing/grants.ts — merges both providers into one `liveGrants`
- [x] store.ts: `provider` on LiveGrant
- [x] resolve.ts: import merged liveGrants (single-line change, re-export unchanged)
- [x] supersede.ts: dispatch cancellation per provider
- [x] routes/billing-paypal.ts — preflight/checkout/verify/cancel/resume
- [x] routes/billing.ts: holdings + invoices carry both providers
- [x] index.ts: mount router key + /api/webhooks/paypal
- [x] scripts/paypal-setup.ts — idempotent product/plan creation
- [x] web UI: dual buttons on /subscription, /billing/callback/paypal page + route,
      queries/billing-paypal.ts, PayPal branch on the manage card (no resume, no card
      update — both impossible at PayPal), USD price on the public /pricing list
- [x] mobile: queries/billing-paypal.ts, buyWithPaypal in use-buy-plan, second button
      in paid-plans.tsx. No cancel UI exists on mobile for either provider, so none added.
- [x] scripts/paypal-selftest.ts — 102 local tests, all passing (fakes PayPal's HTTP API only),
      section 10 covering every branch of the displayed-price/charged-price check
- [x] typecheck / lint / build green; Paystack suite (59) and entitlement suite (55) still green
- [x] tsconfig.scripts.json — `scripts/` was never typechecked before; now covered by `tsc -b`
- [ ] db:push, real sandbox run  <- needs sandbox credentials from user

## Env vars

PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_ENV (sandbox|live, default sandbox),
PAYPAL_WEBHOOK_ID, PAYPAL_PRODUCT_ID,
PAYPAL_PLAN_BASIC_MONTHLY, PAYPAL_PLAN_BASIC_ANNUAL,
PAYPAL_PLAN_PREMIUM_MONTHLY, PAYPAL_PLAN_PREMIUM_ANNUAL

All four are unset in this deployment, so PayPal checkout is not open yet.

## Semantic gaps between the two providers (handled, not papered over)

- PayPal cancel is IMMEDIATE; Paystack's is end-of-cycle. So a PayPal cancel keeps
  `until` = the period already paid for and the row stays entitling until then.
  Same customer-visible behaviour, opposite provider behaviour.
- PayPal has no `non-renewing`. `CANCELLED` + future `until` IS cancel_pending here.
- PayPal `SUSPENDED` ~ Paystack `attention` (payment failed / retrying).
- A PayPal row with a null `until` is only ever a lifetime purchase, and the
  entitling query says so explicitly rather than trusting null to mean forever.
- PayPal has a real event id, so idempotency keys on it, not a body hash.
