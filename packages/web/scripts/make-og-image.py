#!/usr/bin/env python3
"""
Render public/og-image.png — the card every link to the site unfurls as.

Why this exists as a script rather than a one-off export: the OG image carries
the site title, and the site title changes. The previous card was a loose PNG
with no source, so "change the title" meant redrawing it by hand and hoping the
brand colours still matched. This keeps the card derived from the same palette
and the same typefaces as the app, so it stays in sync by construction.

It draws with Pillow rather than by screenshotting HTML. A headless-Chrome
render would pull in the whole app, and the card is a poster — a dozen text
runs at fixed positions — so the browser buys nothing and adds a dependency
that breaks in CI.

Fonts are the app's own: Sora for display, Manrope for body, Noto Sans Ethiopic
for the ፊደል. The first two are fetched from Google Fonts (the same source
styles.css imports) and cached; the Ethiopic one comes from the system, which
is where Debian's fonts-noto package puts it.

  python3 scripts/make-og-image.py
  python3 scripts/make-og-image.py --title "AmharicAI – Learn Amharic with AI"
  python3 scripts/make-og-image.py --check   # verify the PNG matches the title

Sizing note: 1200x630 is the size every scraper crops to, and text below about
28px renders illegibly in a Slack or iMessage thumbnail, which is where most of
these are actually seen. Nothing here is smaller than 27px, and the two
smallest lines are the two least important ones, so what a thumbnail softens
first is the detail rather than the name.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
import urllib.request
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

WEB = Path(__file__).resolve().parent.parent
OUT = WEB / "public" / "og-image.png"
CACHE = Path.home() / ".cache" / "amharicai-og-fonts"

# Straight from styles.css `:root`. Duplicated rather than parsed because the
# card is the one surface that must not change when the app's theme is being
# experimented with — but if the brand actually moves, these are the four
# values to move with it.
CREAM = "#fbf7ef"
INK = "#14201b"
GREEN = "#0b6e4f"
AMBER = "#f0b323"
MUTED = "#4b5a53"

W, H = 1200, 630
# The green panel's left edge. 0.53 puts the fold just right of centre, which
# leaves the headline a full measure without the panel looking like an
# afterthought.
FOLD = int(W * 0.53)

# The text, in the order it is read, largest first. Four runs and no more: a
# scraper thumbnail is about 260px wide in a Slack sidebar, and every line
# added past this takes size away from the brand rather than adding meaning.
TITLE = "AmharicAI"
SUBLINE = "Learn Amharic Online"
# Mixed Ethiopic and Latin on one line, which is the whole reason
# `draw_runs()` exists — see the note there.
SCRIPT_LINE = "አማርኛ • ፊደል • Speak • Read • Write"
OFFER_LINE = "Lessons • Dictionary • Translation • Practice"
FOOTER_URL = "amharicai.org"
FOOTER_NOTE = "Free to start"

# First-order ፊደል, in syllabary order. Twelve is what fills the panel in a
# 3x4 grid at a size that survives thumbnailing.
FIDEL = ["ሀ", "ለ", "ሐ", "መ", "ሠ", "ረ", "ሰ", "ሸ", "ቀ", "በ", "ተ", "ቸ"]

GOOGLE_FONTS = {
    "Sora.ttf": "https://raw.githubusercontent.com/google/fonts/main/ofl/sora/Sora%5Bwght%5D.ttf",
    "Manrope.ttf": "https://raw.githubusercontent.com/google/fonts/main/ofl/manrope/Manrope%5Bwght%5D.ttf",
}


def google_font(name: str) -> Path:
    """Fetch a variable font once, then reuse it."""
    CACHE.mkdir(parents=True, exist_ok=True)
    path = CACHE / name
    if not path.exists():
        print(f"  fetching {name}")
        with urllib.request.urlopen(GOOGLE_FONTS[name], timeout=60) as r:
            path.write_bytes(r.read())
    return path


def system_font(family: str) -> Path:
    """Locate a system font by family, for the one face not on Google Fonts."""
    out = subprocess.run(
        ["fc-match", "-f", "%{file}", family], capture_output=True, text=True, check=True
    )
    path = Path(out.stdout.strip())
    if not path.exists():
        raise SystemExit(f"No font file for {family!r}. Install fonts-noto-core.")
    return path


def weighted(path: Path, size: int, weight: int) -> ImageFont.FreeTypeFont:
    """
    One instance of a variable font at a given weight.

    Pillow needs the axis set on the font object itself, and an instance
    carries its own size, so every distinct size/weight pair is its own object
    rather than something mutated between draws — mutating it is a subtle way
    to have the last-set weight silently win everywhere.
    """
    font = ImageFont.truetype(str(path), size)
    try:
        font.set_variation_by_axes([weight])
    except OSError:
        # A static build of the same face. Nothing to set, and the weight it
        # ships with is the weight we get.
        pass
    return font


def text_width(draw: ImageDraw.ImageDraw, s: str, font: ImageFont.FreeTypeFont) -> int:
    return int(draw.textbbox((0, 0), s, font=font)[2])


def is_ethiopic(ch: str) -> bool:
    """Ethiopic block, plus its supplement and extended ranges."""
    return "ሀ" <= ch <= "፿" or "ᎀ" <= ch <= "᎟" or "ⶀ" <= ch <= "⷟"


def split_runs(s: str) -> list[tuple[str, bool]]:
    """Break a string into consecutive runs of Ethiopic / not-Ethiopic."""
    runs: list[tuple[str, bool]] = []
    for ch in s:
        eth = is_ethiopic(ch)
        if runs and runs[-1][1] == eth:
            runs[-1] = (runs[-1][0] + ch, eth)
        else:
            runs.append((ch, eth))
    return runs


def draw_runs(
    draw: ImageDraw.ImageDraw,
    xy: tuple[int, int],
    s: str,
    latin: ImageFont.FreeTypeFont,
    ethiopic: ImageFont.FreeTypeFont,
    colour: str,
    measure_only: bool = False,
) -> int:
    """
    Draw one line that mixes Amharic and Latin, and return its width.

    Pillow renders a whole string in a single font and does no fallback: a
    `ለ` drawn in Manrope comes out as a tofu box, silently, in a PNG nobody
    opens before it ships. So the line is split into script runs and each run
    is drawn in the face that actually has the glyphs, with the pen carried
    across by the measured width of what came before.

    The two faces are optically different sizes at the same nominal px —
    Ethiopic sits larger — so the caller passes an already-shrunk Ethiopic
    instance rather than the same size as the Latin one. Baselines are shared
    by drawing both runs from the same y, which is what `anchor="ls"` gives.
    """
    x, y = xy
    for run, eth in split_runs(s):
        font = ethiopic if eth else latin
        if not measure_only:
            draw.text((x, y), run, font=font, fill=colour, anchor="ls")
        x += int(draw.textlength(run, font=font))
    return x - xy[0]


def fit_font(
    draw: ImageDraw.ImageDraw, s: str, path: Path, weight: int, limit: int, start: int
) -> ImageFont.FreeTypeFont:
    """
    The largest size at or below `start` that keeps `s` on one line.

    The brand word is the loudest thing on the card, so it is set as large as
    the measure allows rather than at a number picked by eye — and if the word
    is ever changed to a longer one, it shrinks to fit instead of running off
    the fold into the green panel.
    """
    for size in range(start, 23, -2):
        font = weighted(path, size, weight)
        if draw.textlength(s, font=font) <= limit:
            return font
    return weighted(path, 24, weight)


def wrap(
    draw: ImageDraw.ImageDraw, s: str, font: ImageFont.FreeTypeFont, limit: int
) -> list[str]:
    """
    Greedy wrap on measured width.

    Measured rather than by character count because the headline mixes a long
    brand token with short words, and a count-based wrap puts the break in a
    visibly wrong place at this size.
    """
    lines: list[str] = []
    current = ""
    for word in s.split():
        trial = f"{current} {word}".strip()
        if current and text_width(draw, trial, font) > limit:
            lines.append(current)
            current = word
        else:
            current = trial
    if current:
        lines.append(current)
    return lines


def zigzag(
    draw: ImageDraw.ImageDraw, x: int, y: int, width: int, amp: int, step: int, colour: str
) -> None:
    """The amber underline. A drawn zigzag, so it scales with the layout."""
    points = []
    n = max(2, width // step)
    for i in range(n + 1):
        points.append((x + i * step, y + (amp if i % 2 else -amp)))
    draw.line(points, fill=colour, width=5, joint="curve")


def render(title: str, subline: str = SUBLINE) -> Image.Image:
    sora = google_font("Sora.ttf")
    manrope = google_font("Manrope.ttf")
    ethiopic = system_font("Noto Sans Ethiopic")

    img = Image.new("RGB", (W, H), CREAM)
    draw = ImageDraw.Draw(img)

    # The green panel, and the fidel grid inside it.
    draw.rectangle([FOLD, 0, W, H], fill=GREEN)

    cols, rows = 3, 4
    cell, gap = 108, 18
    grid_w = cols * cell + (cols - 1) * gap
    grid_h = rows * cell + (rows - 1) * gap
    gx = FOLD + (W - FOLD - grid_w) // 2
    gy = (H - grid_h) // 2
    glyph_font = weighted(ethiopic, 58, 500)

    for i, ch in enumerate(FIDEL):
        r, c = divmod(i, cols)
        x = gx + c * (cell + gap)
        y = gy + r * (cell + gap)
        draw.rounded_rectangle(
            [x, y, x + cell, y + cell], radius=16, outline="#ffffff", width=2
        )
        bbox = draw.textbbox((0, 0), ch, font=glyph_font)
        draw.text(
            (
                x + (cell - (bbox[2] - bbox[0])) / 2 - bbox[0],
                y + (cell - (bbox[3] - bbox[1])) / 2 - bbox[1],
            ),
            ch,
            font=glyph_font,
            fill=AMBER,
        )

    # THE LEFT COLUMN, IN FOUR STEPS OF LOUDNESS
    #
    # The card has one job at thumbnail size: say who this is and what it is.
    # So the brand is set as large as the measure allows and everything under
    # it steps down hard — 100/42/28/27 rather than a gentle ramp, because a
    # gentle ramp at 260px wide reads as four lines of the same grey text and
    # the brand stops being the thing you see first.
    #
    #   AmharicAI                                    brand, green, as big as fits
    #   ~~~~~~                                       the amber rule
    #   Learn Amharic Online                         what it is, in ink
    #   አማርኛ • ፊደል • Speak • Read • Write            the languages and the skills
    #   Lessons • Dictionary • Translation • Practice what you get, muted
    pad = 58
    measure = FOLD - pad - 40

    brand = title.strip()
    brand_font = fit_font(draw, brand, sora, 800, measure, 100)
    sub_font = weighted(sora, 42, 700)
    script_latin = weighted(manrope, 28, 600)
    # Noto Sans Ethiopic runs optically larger than Manrope at the same px, so
    # it is set a touch smaller to make the two halves of the line match.
    script_eth = weighted(ethiopic, 27, 600)
    offer_font = weighted(manrope, 27, 500)

    sub_lines = wrap(draw, subline, sub_font, measure)

    # The stack is measured before anything is drawn, then centred in the space
    # above a reserved footer zone.
    #
    # This is the part worth keeping: laying it out by stepping a cursor down
    # from a hand-picked start meant one line more silently pushing the bottom
    # line through the footer, and the only way to notice was to look at the
    # PNG. Measure first and the overlap cannot happen — a longer subline eats
    # the slack, and if there is none left the guard below says so instead of
    # writing a broken card.
    BRAND_LEADING = brand_font.size + 16
    SUB_LEADING = 54
    RULE_GAP, RULE_BAND, SUB_GAP = 20, 24, 24
    SCRIPT_GAP, SCRIPT_LEADING = 26, 34
    OFFER_GAP, OFFER_LEADING = 20, 32
    FOOTER_ZONE = 104

    stack_h = (
        BRAND_LEADING
        + RULE_GAP
        + RULE_BAND
        + SUB_GAP
        + len(sub_lines) * SUB_LEADING
        + SCRIPT_GAP
        + SCRIPT_LEADING
        + OFFER_GAP
        + OFFER_LEADING
    )
    top, bottom = 44, H - FOOTER_ZONE
    if stack_h > bottom - top:
        raise SystemExit(
            f"The text needs {stack_h}px of a {bottom - top}px column. "
            "Shorten the subline, or drop a size in render()."
        )

    y = top + (bottom - top - stack_h) // 2

    draw.text((pad, y), brand, font=brand_font, fill=GREEN)
    y += BRAND_LEADING

    y += RULE_GAP
    zigzag(draw, pad, y + RULE_BAND // 2, 148, 7, 18, AMBER)
    y += RULE_BAND + SUB_GAP

    for line in sub_lines:
        draw.text((pad, y), line, font=sub_font, fill=INK)
        y += SUB_LEADING

    # Both of the bottom two lines are drawn from their baseline, which is what
    # keeps the Amharic and Latin runs of the script line sitting on the same
    # line rather than each on its own box's top edge.
    y += SCRIPT_GAP
    draw_runs(
        draw, (pad, y + SCRIPT_LEADING - 8), SCRIPT_LINE, script_latin, script_eth, GREEN
    )
    y += SCRIPT_LEADING

    y += OFFER_GAP
    draw.text((pad, y + OFFER_LEADING - 8), OFFER_LINE, font=offer_font, fill=MUTED, anchor="ls")
    y += OFFER_LEADING

    # Footer, pinned to the bottom rather than following the text, so it sits
    # in the same place whatever the title does to the block above it.
    url_font = weighted(manrope, 30, 700)
    note_font = weighted(manrope, 28, 500)
    fy = H - 76
    draw.text((pad, fy), FOOTER_URL, font=url_font, fill=GREEN)
    draw.text(
        (pad + text_width(draw, FOOTER_URL, url_font) + 22, fy + 2),
        f"· {FOOTER_NOTE}",
        font=note_font,
        fill=MUTED,
    )

    return img


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--title", default=TITLE, help="The brand word: the loudest line.")
    ap.add_argument("--subline", default=SUBLINE, help="What it is, under the brand.")
    ap.add_argument("--out", default=str(OUT), help="Where to write the PNG.")
    ap.add_argument(
        "--check",
        action="store_true",
        help="Re-render and compare against the file on disk instead of writing.",
    )
    args = ap.parse_args()

    img = render(args.title, args.subline)
    out = Path(args.out)

    if args.check:
        if not out.exists():
            print(f"FAIL  {out} does not exist")
            return 1
        fresh = img.tobytes()
        current = Image.open(out).convert("RGB").tobytes()
        same = hashlib.sha256(fresh).digest() == hashlib.sha256(current).digest()
        print(
            f"{'OK    ' if same else 'STALE '}{out.name} "
            f"{'matches' if same else 'does not match'} "
            f"{args.title!r} / {args.subline!r}"
        )
        return 0 if same else 1

    out.parent.mkdir(parents=True, exist_ok=True)
    img.save(out, "PNG", optimize=True)
    print(
        json.dumps(
            {
                "wrote": str(out),
                "size": out.stat().st_size,
                "title": args.title,
                "subline": args.subline,
            }
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
