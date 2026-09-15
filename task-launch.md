# Production launch round — scope agreed 2026-09-12

## Confirmed by user
- Pricing → Free / Basic $4.99 / Premium $9.99 / Annual $79.99 / Lifetime $149
- Build ALL store-readiness gaps: privacy, terms, about/contact, account deletion,
  free-tier server quotas, Android package id, icon+splash, error handling pass
- Marketing site → new pages inside the existing Vite/React web app
- Autumn billing → wire it now
- 5h corpus → user will deliver audio; custom_voice stays `coming_soon`
- Extras: env/config verify, security audit, entitlement testing, DB migration check,
  mobile release check, AI cost controls, a11y/responsive pass, analytics+crash
  reporting, Play Store readiness audit

## Pricing architecture decision
Entitlement tier and billing term are separate axes.
- `PlanId` = free | basic | premium   (what you can DO)
- `BillingTerm` = monthly | annual | lifetime  (how you PAY for premium)
Annual $79.99 and Lifetime $149 are premium billing terms, not extra tiers.
Legacy `learner` maps to `basic` on read (existing access codes keep working).

## Stages
- [x] S1 plans.ts rewrite + legacy mapping
- [x] S2 usage quotas (schema + enforcement + AI cost control)
- [x] S3 account deletion (server-side, real)
- [x] S4 legal/about pages content module
- [x] S5 Autumn billing wiring
- [x] S6 web: marketing pages + legal routes + subscription rewrite
- [x] S7 mobile: package id, icon, splash, legal links, delete account
- [x] S8 error handling + a11y pass
- [x] S9 audit report

## Blocked / not possible here
- errors_LtueeQ.jsonl still absent from disk — asked user to re-attach, not received
- No 5h audio → no custom voice → cannot test "Amharic voice quality"
- EAS build / Play Console / .aab signing — user's own dashboard, not this sandbox
- Autumn product IDs must be pushed by the user (`npx atmn push -y`) with their key
