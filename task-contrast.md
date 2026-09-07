# Round 2 of polish: contrast + Ethiopic leading + punctuation

Continuation of the honesty/polish audit. Both surfaces in step.

## Measured, not eyeballed
Wrote WCAG relative-luminance checks (/tmp/contrast.py, /tmp/mobcontrast.py).
- Website: 6 failing pairs.
- Mobile light: 11 failing pairs. Mobile dark: 3.
Worst practical finding: mobile `warning` #D97706 at 2.98:1 — that is the colour of
every honesty notice (caveats, "Not configured", preview chips). The strings this
whole audit exists to make readable were the ones failing contrast.

## Replacement colours (all verified >= target, /tmp/verify.py -> ALL PASS)
| token | old | new | ratios | need |
|---|---|---|---|---|
| WEB `--ink-faint` | #7d8b83 | **#5e6963** | 5.15 / 5.62 / 4.55 | 4.5 |
| WEB `--gold-ink` (new) | — | **#8c5c10** | 5.19 / 5.65 / 4.53 | 4.5 |
| WEB `--rule-strong` (new) | — | **#8a8579** | 3.32 / 3.62 | 3.0 |
| MOB L `mutedForeground` | #6B7B72 | **#5D6B63** | 5.24 / 5.6 / 4.56 | 4.5 |
| MOB L `warning` | #D97706 | **#9E5606** | 5.19 / 5.54 | 4.5 |
| MOB L `accentInk` (new) | — | **#8A6309** | 5.08 / 5.43 | 4.5 |
| MOB L `borderStrong` (new) | — | **#9A7F4C** | 3.56 / 3.81 | 3.0 |
| MOB D `destructive` | #E0484E | **#E9686C** | 5.87 / 5.25 | 4.5 |
| MOB D `borderStrong` (new) | — | **#5C7A6A** | 3.92 / 3.51 | 3.0 |
| MOB D `accentInk` | — | **#F5C449** (accent already passes) | 11.35 / 10.15 | 4.5 |

## Design rule established (mirrors grant-vs-capability discipline)
`--gold` / `accent` are FILL-and-border tokens. They clear 3:1 for non-text but fail
4.5:1 for lettering. Gold **text** uses `--gold-ink` / `accentInk`. Do not collapse
these back into one token.
`--rule` / `border` stay decorative; interactive control boundaries use
`--rule-strong` / `borderStrong` (WCAG 1.4.11 — a button on --card over --paper is a
1.09:1 difference, so the border is the only thing identifying the control).

Left alone deliberately: `success` (#2F9E44, 3.22) is only ever a 20-42px icon —
non-text, needs 3:1, passes. Not broken in practice, so not touched.

## Ethiopic leading
`.am/.fidel` was line-height 1.5 against a body of 1.62 — backwards. Ethiopic has a
taller body and below-baseline marks, so it needs MORE leading. -> 1.75 (web),
`<Am>` size*1.5 -> size*1.75 (mobile).

## Progress
- [x] measure both palettes
- [x] pick + verify replacements
- [x] web: tokens, gold-ink/rule-strong comments, .am leading 1.5 -> 1.75
- [x] web: button + input/textarea/select -> --rule-strong
- [x] web: .eyebrow, .speaker, .unit-no -> --gold-ink (3 sites; border-left
      accents and the focus ring deliberately keep --gold)
- [x] mobile: theme.ts tokens (light mutedForeground+warning darkened, dark
      destructive lightened, accentInk + borderStrong added to both schemes)
- [x] mobile: <Am> leading size*1.5 -> size*1.75
- [x] mobile: accent -> accentInk at 10 text/icon sites; 15 fill sites keep accent
      (Chip `color` is the FOREGROUND, `background` is separate — that is why
      the XP chips were failing; ProgressBar `color` is the bar fill, kept)
- [x] mobile: border -> borderStrong at 16 interactive sites (classified by
      looking back for the owning <Pressable>/<TextInput>; decorative card
      edges, table rules and Card itself keep `border`)
- [x] mobile typecheck PASS after the token work
- [x] Amharic punctuation sweep of pre-existing i18n strings (። ፣) — 0 flagged on
      BOTH surfaces, via /tmp/punct.py (i18n files) + /tmp/punct2.py (inline Amharic
      in pages/components/composables/server-utils/app.vue and app/+components).
      Course content deliberately EXCLUDED — source-faithful, stays verbatim.
- [x] gates: nuxt build+smoke, mobile typecheck, root lint+build, mobile smoke — all PASS
- [x] served-CSS verification: new tokens present on /, /course, /course/u1-l1,
      /pricing, /dashboard; old #7d8b83 gone (0 hits); line-height:1.75 in .am,.fidel
- [x] computed-browser-style verification (/tmp/computed.py, /tmp/computed2.py):
      .eyebrow #8c5c10 @ 5.19 on paper; .unit-no #8c5c10 @ 4.53 on gold-soft (was 2.63);
      textarea/select/"Preview as..." buttons border #8a8579 @ 3.62 (was 1.26).
      Filled buttons (Translate, Choose) have border == background by design, ratio 1.00
      is expected there — the FILL against paper carries them, not the border.
- [x] commit both: nuxt ae15836, managed 3de04ce
- [x] patch regenerated (906,687 B, 5 patches) and tree-verified:
      applied tree == HEAD tree == 0529fd94d27a8304443762145f46356453a1d1fd

## Two things found during verification, both worth carrying forward

1. `.speaker` has ZERO render sites in the entire course. Only 2 dialogue blocks exist
   (u6-l1, u6-l5) and every line in them carries `speaker: null` — the real speaker name
   sits in `cells[0]` (ደምበኛ = customer, ባለሱቅ = shopkeeper), and `amharic` duplicates it.
   So the `.speaker` -> --gold-ink fix is correct in the CSS but currently unobservable.
   NOT "fixed" by rewriting the renderer or the data: that is source-faithful content.
   (An earlier note in this file claiming `speaker` was the string 'None' was MY harness
   artifact — Python `str(None)`. The API serves real `null`. No data bug.)

2. `packages/mobile/app.json` was found hand-edited in the working tree with two values
   that would fail an Expo build, and REVERTED so the commit stayed single-purpose:
     android.package  com.amharicai_zoin.runable -> "amharicai_2026"  (not legal
                      reverse-DNS; template-managed field I must not change)
     version          1.0.1 -> "Version: 1.0.0 Android versionCode: 1"  (a UI label
                      pasted into the version string)
   If a custom package really is wanted for store submission it must be reverse-DNS
   (e.g. org.amharicai.app), version a bare semver, and versionCode set in EAS — not
   concatenated into `version`.

## Vercel (connected this round)
Plugin inventory is only List / Create / Cancel Deployment. Create Deployment requires
name + team + project + branch and deploys **from the GitHub repo** — so it would ship
`origin/main`, i.e. the pre-audit code, and needs a Vercel project that does not exist
yet. Not usable until the user imports the repo AND the deploy key lands. Do not fire it.
