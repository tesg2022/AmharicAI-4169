# Round: polish + honesty audit (Sep 7, 2026) — COMPLETE

## Done, both surfaces, verified
- Four-state capability model (`available` / `preview` / `coming_soon` / `not_configured`)
  plus resolved `plan_gated`, with `STATE_LABELS` (en+am) living in the model so the
  website and app cannot word a state differently.
  - Nuxt: `server/utils/plans.ts` + useEntitlements/pricing/dashboard/index/lesson pages
  - App:  `packages/web/src/api/content/plans.ts` + `packages/mobile/app/pricing.tsx`
  - Precedence is deliberate: `coming_soon` beats `plan_gated`. Do not reorder.
  - `usable()` stays strict (`granted && available`). UI gates on `usable`, never `grants`.
- Reclassified: tutor_limited -> preview; custom_voice, speech_recognition -> coming_soon.
- Amharic caveats (`caveat_am`) written for all five caveat-bearing features.
- "Even on a higher plan:" prefix so a plan-gated feature keeps its capability caveat
  instead of implying an upgrade fixes it. (Real bug found in smoke.)
- Curriculum copy: "Not yet written" -> "Coming soon" everywhere; unwritten units render
  as coming soon, never as a paywall.
- Progress honesty: Nuxt dashboard already clean; managed web progress screen is genuinely
  DB-backed (leave it); mobile course tab gained a "Progress is not tracked" card.
- `/profile` counts contradiction labelled on screen (seeded practice set vs generated
  course). NOT resolved — needs the user's call. See handover §9.
- Accessibility: `lang` paired with every Amharic-marked node (Nuxt); role + accessible
  name + 44pt targets on every touchable (mobile). Ethiopic is never an accessible name.

## Gates (all green)
Nuxt build PASS · Nuxt smoke 11 rows no console errors · mobile typecheck PASS ·
root lint 36 files 0 errors · root build PASS · mobile smoke 7 routes clean ·
mobile /pricing capability chips checked on all 3 plans via Playwright.

## Commits
- Nuxt `/home/user/gh/AmharicAI` @ `ad1abda` on `fix/nuxt-structure-and-tts`, 4 ahead of origin/main
- App  `/home/user/amharicai` @ `c5d63d5` on `main`
- Patch `/home/user/gh/amharicai-nuxt-fix.patch` regenerated (900,525 B, 4 patches) and
  verified by tree hash: applied tree == HEAD tree (a5936289).

## Blocked
- GitHub push: deploy key still not registered (`ssh -T git@github.com` -> permission
  denied). PATs are read-only. User must add the pubkey with "Allow write access".
- Publishing (Vercel / Expo builds) is the user's to run, not mine.

## Optional next polish
Contrast measurement (gold #c07f16 on #f6f3ec first) · Ethiopic line-height on `.am` /
`.fidel` · punctuation sweep of pre-existing i18n strings (። ፣).
