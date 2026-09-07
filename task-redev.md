# AmharicAI redevelopment — round scratchpad

## Mandate (user answered all 5 scoping questions)
1. 20-unit map as the shell; units 1-6 filled with the real 32-lesson source content;
   units 7-20 marked "not yet written".
2. "Language translation options" = BOTH a free-text Translate page AND an
   English/Amharic UI language switcher.
3. Pricing page + full plan-gating logic, payment STUBBED until keys exist.
4. Both surfaces: Nuxt website + Expo mobile app updated to match.
5. Deliver by pushing to `redev/phase-1-content-spine` and opening a PR against `main`.

## GitHub — WRITES NOW WORK
- `github__pipedream` plugin is CONNECTED. Verified by really creating the branch:
  `refs/heads/redev/phase-1-content-spine` @ 78fc47339cf9a57866b0b0bdd7dd51b9a33c9d04 (from main).
- The PAT in /home/user/.gh/.env is READ-ONLY -> `git push` 403s. Do NOT retry it.
- Write path = `github-create-or-update-file-contents__pipedream` (raw text, do not
  base64 it yourself), then `github-create-pull-request__pipedream`.
- Ignore the plugin's `cliHint` about using gh/git: there is no gh CLI here and the
  credential is read-only.

## DONE and verified
- `scripts/build-course.mjs` -> 20 units (6 written / 14 planned), 32 lessons, 94 blocks,
  62 activities, 91 assessment questions, 458 speakables. Flags: 0 error, 3 warn, 3 info.
  The 3 warns = u5-l5/l6/l7 have no English title in the source (NOT invented).
  The 3 infos = shell title differs from spec title for u1/u2/u3 (both kept).
- Vendored inputs: `content/source/amharic_course_content_spec.json`,
  `content/source/course_shell_20_units.json` (UNITS/FIDEL/UNIT_PHRASES extracted from
  the attached builder .py by brace-matching + eval of those 3 literals only).
- Generated + committed to repo: `server/content/course.generated.json`, `course.flags.json`.
- `server/utils/course.ts` — typed access layer. `lessonLabel()` falls back title_en ->
  title_am -> id, never invents English.
- `server/utils/plans.ts` — grant vs capability kept as SEPARATE axes.
  `usable() = grants() AND capability === 'available'`. UI must call `usable`.
  `unitAccess()` checks status !== 'written' BEFORE the paywall.
- `i18n/messages.ts` — en/am dicts, `translateKey`, `missingKeys()`. No new dependency.
- Composables: `useLocale`, `useEntitlements`, `useCourse` (+`useLessonData`), `useTranslation`.
- API routes: `me.get`, `course/index.get`, `course/flags.get`, `course/lesson/[id].get`,
  `translate.post`, `billing/checkout.post`.
- `server/utils/translateConfig.ts` — `translateConfig()` + `billingConfig()`, both
  request-time env reads (same reason ttsConfig exists).

## NEXT
1. nuxt.config.ts: add AMHARICAI_TRANSLATE_* + STRIPE_* runtimeConfig keys. Update env.example.
2. app.vue: nav (Home/Course/Tutor/Translate/Pricing/Dashboard) + locale switcher + plan chip
   + global styles. Currently just `<NuxtPage/>`.
3. Pages: course/index.vue, course/[lessonId].vue, translate.vue, pricing.vue, dashboard.vue.
   Replace demo `composables/useLessons.ts` + make `pages/lessons/[id].vue` redirect to /course.
4. `npm run build` (needs `npm install-scripts approve esbuild` first), then headless-Chrome
   smoke every route.
5. Expo mobile parity in /home/user/amharicai/packages/mobile; deliver mobile at index 0,
   type mobile, port 4300.
6. Push Nuxt tree to redev/phase-1-content-spine via plugin, open PR against main.
7. Regenerate /home/user/gh/amharicai-nuxt-fix.patch and `git apply --check` it.

## Honesty requirements (non-negotiable)
- /api/translate with no key -> 503 `translation_not_configured`. Never echo or fake.
- /api/billing/checkout -> 503 `payment_not_configured`. Buttons must not look like they charge.
- Units 7-20 render as "not yet written", NEVER as locked-behind-paywall.
- tts_per_day cannot be durably enforced without a DB — if done in memory, label it non-durable.
- `custom_voice` and `speech_recognition` are `not_built` and say so in the product surface.

## Traps
- `edit` tool needs explicit `replace_all`. Never 2 edits on one file in one parallel batch.
- Nuxt repo: `npm install-scripts approve esbuild` before `npm run build`.
- tmux only for servers; `nohup &` -> signal: terminated. `pkill -f` can kill own shell.
- Live sessions: ttsrv(:8899), nuxt(:3000), web, mob.

---

## Round update — 2026-09-07 (website DONE + verified; GitHub push BLOCKED on credential)

### 1. SSR cookie bug — FIXED and VERIFIED
Root cause: Nuxt's plain `$fetch` does not forward the incoming request's headers during SSR,
so `/api/me` and `/api/course` arrived with no plan cookie, honestly resolved to `free`, and that
answer was serialised into the payload — a Learner saw Free gates for the whole session.

Fix: `useRequestFetch()` for every SSR-time read that depends on the cookie.
  - composables/useEntitlements.ts   (was already done)
  - composables/useCourse.ts         BOTH fetches (useCourseSummary + useLessonData)  <- done
  - pages/dashboard.vue              course-flags read                                <- done
Client-side user-initiated calls (useTranslation, useTTS, pricing checkout POST) intentionally
stay on plain `$fetch` — the browser attaches cookies itself.

`npm run build` PASSES (Σ 2.31 MB, 571 kB gzip). Built server restarted in tmux `nuxt` on :3000.
`/tmp/smoke.py` re-run: 12 rows, `CONSOLE_BAD: none` on every one. Pass condition met —
plan=learner now DIFFERS from plan=free:
  nav chip        free "Plan: Free"        | learner "Plan: Learner"
  /translate      free = Learner-plan gate | learner = translate form renders
  /course/u5-l5   —                        | learner = full lesson, grammar tables, examples, TTS
  /course/u3-l1   free = still gated (correct)
Non-bug ruled out: the `??` glyph in smoke output for the Free card's first feature row was a
text-extraction artifact of the harness. Served HTML has the correct `?` in all three cards
(checked via curl + regex over the SSR payload). No code change needed.

### 2. Commit + patch — DONE and VERIFIED
Committed on `fix/nuxt-structure-and-tts` as `6d126c5`. Branch is now 3 commits ahead of
origin/main (6e928b9, 9bf04c3, 6d126c5). 49 changed paths vs main.
Regenerated /home/user/gh/amharicai-nuxt-fix.patch (869,471 B, 3 patches in the mbox).
Verified TWICE, not just apply-check:
  - `git apply --check` against a pristine origin/main worktree -> PASS
  - applied it, `git write-tree` -> 31c25e5ec67d6fcf613030e4b9755c8b22456fea
    == `git rev-parse HEAD^{tree}` -> IDENTICAL. The patch reproduces the exact tested tree.
Verification worktree removed, `git worktree prune` run.

### 3. GitHub push — BLOCKED, do not retry blindly
`git push --dry-run` with the sandbox PAT -> `remote: Permission to tesg2022/AmharicAI.git
denied to tesg2022. / 403`. Token is fine-grained Contents:Read. CONFIRMED by real push attempt.

The plugin is NOT a workaround. `external_tool_search` on GitHub returned the full inventory:
there is **no delete-file action**. This commit requires 16 paths to DISAPPEAR:
  .github/workflows/nuxtjs.yml, .github/workflows/static.yml   (user asked these deleted)
  [id].vue, index.vue, tts.post.ts, useLessons.ts               (old misplaced root files)
  + 10 rename sources: download, AudioPlayer.vue, SecretsForm.vue, useSettings.ts, useTTS.ts,
    secrets.vue, tutor.vue, tts-secrets.post.ts, tts-test.post.ts, health.get.ts
A plugin-only push would add the 33 new files while leaving the old ones -> resurrected Pages
workflows + colliding Nuxt routes -> branch would not build. Deliberately NOT done.

Asked the user via ask_secrets for `GITHUB_WRITE_TOKEN` (Contents: Read and write), to be
written to /home/user/.gh/.env. WAITING ON USER.
When it arrives:
  git push "https://$GITHUB_WRITE_TOKEN@github.com/tesg2022/AmharicAI.git" \
      HEAD:refs/heads/redev/phase-1-content-spine
  then github-create-pull-request__pipedream  head=redev/phase-1-content-spine base=main
Remote branch `redev/phase-1-content-spine` already exists @ 78fc473 (cut from main, 0 new
commits). If the user declines the token, hand over the patch instead — it is fully verified.

### 4. STILL TO DO
- Expo mobile parity (/home/user/amharicai/packages/mobile): course browser off the same
  generated JSON, pricing/plan screen, translate screen, locale toggle, same honesty rules.
  Deliver mobile at index 0, type mobile, port 4300.
- Final writeup must state plainly: 20-unit scope is 6 real + 14 title-only; payment stubbed and
  NOT enableable by adding keys alone (no account store); translation/TTS 503 until configured;
  custom voice + speaking feedback do not exist and are marked not_built in the product surface;
  the plan is a preview cookie, not an entitlement.

### 5. Mobile parity — API layer DONE and VERIFIED (2026-09-07, later)
Ported the SAME generated course model into the managed app so mobile and web cannot drift:
  packages/web/src/api/content/course.generated.json   copied from Nuxt server/content/
  packages/web/src/api/content/course.flags.json       copied
  packages/web/src/api/content/plans.ts                ported (grant vs capability axes kept)
  packages/web/src/api/content/course-model.ts         ported access layer
  packages/web/src/api/routes/catalog.ts               NEW oRPC route
  packages/web/src/api/index.ts                        MODIFIED: `catalog` composed into router
Key adaptation: no cookie on mobile. The plan is an explicit `plan` INPUT (a client-side preview
switch) -> `plan_source: 'preview_client'`, `plan_is_verified: false`. Gating still resolved
SERVER-side so the client cannot render ungranted content. Never used to authorise a charge.
oRPC wire format is an envelope: POST /api/rpc/<path> with body {"json": {...}}.

`bun run build` PASSES (incl. `tsc --noEmit`). Verified at runtime on :4200:
  catalog/me       learner -> plan_source preview_client, plan_is_verified false
  catalog/course   free -> u1,u2 ok | u3-u6 plan_required->learner | u7-u20 not_written (14)
                   stats units_total 20 / written 6 / planned 14 / lessons 32; qa 0 err 3 warn
  catalog/lesson   u1-l1 free -> 200 'Amharic Alphabet Categories' 3 blocks
                   u3-l1 free -> FORBIDDEN plan_required learner
                   u3-l1 learner -> 200 | u5-l5 learner -> 200 (Amharic title, carries its 1 flag)
                   u7-l1 premium -> NOT_FOUND lesson_not_found  (NOT a paywall)
  catalog/translate free -> FORBIDDEN plan_required | learner -> 503 translation_not_configured
  catalog/checkout  learner -> 503 payment_not_configured + BOTH blockers | free -> 400 plan_is_free
tmux `web` restarted (old session predated these changes) -> dev server on :4200.

### 6. REMAINING
- Mobile SCREENS (not yet started): course browser, lesson view, pricing/plan, translate,
  locale toggle. Extend packages/mobile/app/_layout.tsx IN PLACE (ErrorBoundary +
  OneDollarStatsProvider imports must survive lint). bunx expo install for any new pkg.
  Then `bun run typecheck` in packages/mobile (that one is real), start mobile on 4300,
  deliver mobile at index 0 type mobile port 4300.
- GitHub push still BLOCKED on GITHUB_WRITE_TOKEN (see section 3).
