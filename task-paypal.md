# PayPal alongside Paystack — build log

Decision: PayPal is a SECOND provider. Paystack is not replaced, not refactored.
Paystack keeps ZAR + cards/local. PayPal takes USD + PayPal balance/international.
Both write grants that feed ONE entitlement resolver.

USD prices (confirmed): basic_monthly $5.99, premium_monthly $11.99, premium_annual $89.99.
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
- [x] scripts/paypal-selftest.ts — 72 local tests, all passing (fakes PayPal's HTTP API only)
- [x] typecheck / lint / build green; Paystack suite (59) and entitlement suite (55) still green
- [x] tsconfig.scripts.json — `scripts/` was never typechecked before; now covered by `tsc -b`
- [ ] db:push, real sandbox run  <- needs sandbox credentials from user

## Env vars

PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_ENV (sandbox|live, default sandbox),
PAYPAL_WEBHOOK_ID, PAYPAL_PRODUCT_ID,
PAYPAL_PLAN_BASIC_MONTHLY, PAYPAL_PLAN_PREMIUM_MONTHLY, PAYPAL_PLAN_PREMIUM_ANNUAL

## Semantic gaps between the two providers (handled, not papered over)

- PayPal cancel is IMMEDIATE; Paystack's is end-of-cycle. So a PayPal cancel keeps
  `until` = the period already paid for and the row stays entitling until then.
  Same customer-visible behaviour, opposite provider behaviour.
- PayPal has no `non-renewing`. `CANCELLED` + future `until` IS cancel_pending here.
- PayPal `SUSPENDED` ~ Paystack `attention` (payment failed / retrying).
- A PayPal row with a null `until` is only ever a lifetime purchase, and the
  entitling query says so explicitly rather than trusting null to mean forever.
- PayPal has a real event id, so idempotency keys on it, not a body hash.
