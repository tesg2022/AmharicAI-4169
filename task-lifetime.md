# Remove the Lifetime plan — subscription-only pricing

User asked to delete "R2,599 once", "One payment. Pays for itself against annual in
under two years.", and every reference to Lifetime / Lifetime Premium / one-time
payment / pay once / lifetime access / no recurring fees. Pricing becomes Premium
monthly + annual (and Basic monthly), all recurring.

## Checked first
- `premium_lifetime` rows in the DB: 2, both test accounts
  (`paystack-e2e@example.com`, `callback-test-1789@example.com`) from test-mode
  verification. No real customer holds lifetime access, so nothing needs
  grandfathering and no data migration is owed to anyone.

## Scope
Remove from everything that sells or describes it:
- [ ] `api/content/plans.ts` — drop the `premium_lifetime` option + `"lifetime"` term
- [ ] `api/content/legal.ts` — term labels, renewal clause
- [ ] `api/billing/config.ts`, `paypal-config.ts` — the lifetime carve-outs
- [ ] `api/billing/store.ts`, `fulfil.ts`, `webhook.ts` — one-off purchase path
- [ ] `api/entitlements/resolve.ts`, `supersede.ts` — null-until / lifetime coverage
- [ ] `api/billing/paystack.ts`, `paypal-store.ts` — comments + one-off charge path
- [ ] `web/pages/pricing.tsx` — term tab, "Pay once" heading, comparison row
- [ ] `web/pages/faq.tsx` — the Annual/Lifetime question, cancel answer, meta
- [ ] `web/pages/subscription.tsx` — lifetime branches and copy
- [ ] `web/pages/admin.tsx` — the manual Lifetime grant option
- [ ] `web/pages/billing-callback.tsx` — comment
- [ ] `mobile/components/paid-plans.tsx`, `queries/*`, `hooks/use-buy-plan.ts`
- [ ] typecheck + billing/entitlement selftests
- [ ] retired-id guard so a direct POST of `premium_lifetime` is refused

## Not touched
- `paystack-launch.report/content.md` and `task-*.md` — history, not live copy.
  They record what was verified in September and should keep saying so.
