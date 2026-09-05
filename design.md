# AmharicAI — Design System

**Tagline:** Learn Amharic • ፊደል • Speak • Read • Write

Ethiopian-rooted, modern learning UI. Warm ivory paper canvas, deep highland green as the
dominant color, gold as the reward/accent color, red-clay for streaks and destructive states.
No purple gradients, no generic rounded-card grid.

## Color tokens

| Token | Light | Dark | Use |
|---|---|---|---|
| background | `#FBF7EF` (warm ivory) | `#0E1512` | app canvas |
| foreground | `#14201B` | `#F3EFE6` | body text |
| card | `#FFFFFF` | `#16211C` | raised surfaces |
| primary | `#0B6E4F` (highland green) | `#12A171` | primary actions, unit path |
| primaryForeground | `#FBF7EF` | `#06110C` | text on primary |
| secondary | `#EFE7D7` | `#1D2A24` | quiet fills |
| accent / gold | `#F0B323` | `#F5C449` | XP, streaks, mastery, highlights |
| destructive / clay | `#C1272D` | `#E0484E` | wrong answers, sign-out |
| success | `#2F9E44` | `#3FBF57` | correct answers |
| muted | `#EFE7D7` | `#1D2A24` | chips, skeletons |
| mutedForeground | `#6B7B72` | `#93A79C` | captions, transliteration |
| border | `#E1D7C4` | `#26332C` | hairlines |

Semantic extras: `fidel` (script surfaces) uses `#0B6E4F` at 8% over ivory; `sky` `#1D6F9E` is
reserved for the AI Tutor surfaces so AI feels distinct from course content.

## Typography

- **Display / headings:** Sora (600/700). Tight tracking, large steps.
- **Body / UI:** Manrope (400/500/700).
- **Amharic script:** Noto Sans Ethiopic (400/700) — always used for `ፊደል`, vocabulary,
  dialogue lines and any Ge'ez script. Never render Amharic in the Latin body font.
- **Transliteration:** Manrope italic, `mutedForeground`, one step smaller than the Amharic.

Scale: 34/28/22/18/16/14/12. Line height 1.45 body, 1.15 display. Amharic gets extra line
height (1.6) — the script has tall vowel marks.

## Layout

- 20px screen gutters on mobile, 8px spacing grid.
- The unit path is a vertical, alternating-offset trail (not a card list) — lesson nodes step
  left/right down the screen, connected by a dotted line.
- Web is a two-column reader: sticky course outline rail + wide lesson canvas.
- Radius: 14 for cards, 20 for sheets, 999 for chips/pills. Shadows are soft and warm
  (`rgba(20,32,27,0.08)`), never neutral gray.

## Motifs

- Woven Ethiopian *tibeb* border pattern as a subtle repeating chevron rule under section
  headers (SVG, `border` color at 40%).
- ፊደል glyphs used as oversized watermark decoration at 6% opacity behind unit headers.
- Progress rings in gold over green tracks.

## Motion

- One orchestrated screen-load stagger (60ms increments, fade + 8px rise).
- Answer feedback: 120ms scale pop on the chosen option, then color settle.
- `useNativeDriver: false` everywhere (Expo web preview).

## Content rendering rules

- Every lesson section renders from `lesson_sections.body` by `section_type` — the source JSON
  is preserved verbatim, so renderers must degrade gracefully to a labelled key/value block for
  unknown types.
- Source provenance (`source_page` / `source_pages`) is **kept in the database and in API
  responses** but is **never rendered**. Learners see no "Source p. 12" chips anywhere — this
  reverses the earlier rule, on explicit instruction (the page references read as clutter to a
  learner). Traceability stays available to authors through the data, not through the UI.
  `SourceValue` filters `source_page(s)` keys out of any verbatim body it renders, so provenance
  cannot leak back in through a generic nested map.
- Never auto-correct source content in the UI; QA flags render as an amber note.
