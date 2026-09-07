# Polish + honesty audit — round scratchpad (2026-09-07)

User picked: "Polish + honesty audit", **both surfaces in step**, plus their 4 additions:
1. Curriculum integrity (units 1-6 source-faithful; 7-20 clearly "Coming soon / Not yet written";
   consistent numbering/objectives/phrases/exercises/progression)
2. Real progress tracking (no fake completed/in-progress/score/streak)
3. Capability-state system (available / coming soon / preview / plan-gated) esp. TTS, ASR, tutor, translation
4. Accessibility + language quality (Amharic rendering, font sizes, contrast, button labels,
   punctuation ። ፣, en/am consistency, pronunciation guidance)

GitHub push still blocked: deploy key not registered. Work lands in both repos locally.

## Status

### 3. Capability-state system — CORE DONE, consumers pending
- [x] `server/utils/plans.ts` (Nuxt): CapabilityStatus = available | preview | coming_soon | not_configured
      (`not_built` renamed -> `coming_soon`); added `FeatureState = CapabilityStatus | 'plan_gated'`,
      `STATE_LABELS` (en+am), `featureState(plan,id)`, `caveat_am` on all 5 caveats.
      Reclassified: tutor_limited not_configured -> **preview**; custom_voice + speech_recognition -> **coming_soon**.
      `entitlements()` now emits `state` + `state_label` per feature and `state_labels`.
- [x] `packages/web/src/api/content/plans.ts` (managed): mirrored exactly. mobile typecheck PASSES.
- [ ] Nuxt consumers: composables/useEntitlements.ts (type), pages/pricing.vue, pages/dashboard.vue,
      pages/course/[lessonId].vue (status.not_built tag), i18n/messages.ts status.* keys
- [ ] Mobile consumers: app/pricing.tsx (CapabilityRow union type + chips), i18n/messages.ts

**Precedence decided:** `coming_soon` is reported BEFORE `plan_gated` — same principle as
`unitAccess` checking `not_written` before the paywall. Never invite an upgrade for something
that does not exist. `usable()` stays strict (`available` only) — `preview` is not a promise.

### 2. Real progress tracking — AUDITED, mostly already honest
- Nuxt: `pages/dashboard.vue` shows no streaks/percentages, prints `dashboard.progress_empty`. OK.
- Managed web `pages/progress.tsx`: streak/XP/mastery are **real** — `authed` oRPC handlers over
  Drizzle tables (`xpEvents`, `userProgress`, `lessons`), behind `ProtectedRoute`. Genuine, keep.
- Mobile: no progress UI at all. **TODO:** say so on the course screen so silence isn't read as 0%.

### 1. Curriculum integrity — pending
- [ ] Unify "Coming soon / Not yet written" copy across both surfaces (currently mobile says
      "Not yet written", Nuxt uses its own phrasing)
- [ ] Numbering/objectives consistency check in build-course.mjs QA

### 4. A11y + language quality — pending
- [ ] Nuxt: `lang="am"` on Ethiopic spans (screen-reader voice switch), contrast, button labels
- [ ] Mobile: accessibilityLabel/accessibilityRole on touchables, 44pt targets
- [ ] Amharic punctuation sweep of both i18n files (። sentence end, ፣ list separator)

## Gates before delivering
- Nuxt: `npm run build` + /tmp/smoke.py (12 rows, CONSOLE_BAD none)
- Managed: `bun run --cwd packages/mobile typecheck`, root `bun run lint`, root `bun run build`,
  /tmp/mob_smoke.py
