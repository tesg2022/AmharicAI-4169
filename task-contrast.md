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
- [ ] Amharic punctuation sweep of pre-existing i18n strings (። ፣)
- [ ] gates: nuxt build+smoke, mobile typecheck, root lint+build, mobile smoke
- [ ] commit both, regenerate + tree-verify patch, deliver

## Vercel (connected this round)
Plugin inventory is only List / Create / Cancel Deployment. Create Deployment requires
name + team + project + branch and deploys **from the GitHub repo** — so it would ship
`origin/main`, i.e. the pre-audit code, and needs a Vercel project that does not exist
yet. Not usable until the user imports the repo AND the deploy key lands. Do not fire it.
