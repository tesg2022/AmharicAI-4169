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
these are actually seen. Nothing here is smaller than that.
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

TITLE = "AmharicAI – Learn Amharic with AI"
SUBLINE = "The syllabary first, then the sounds English does not have, then a written beginner course."
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


def render(title: str) -> Image.Image:
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

    # The headline. The brand token leads it in green and the rest is ink, so
    # the card reads as the title without needing a separate wordmark.
    pad = 58
    measure = FOLD - pad - 40
    head_font = weighted(sora, 62, 700)
    brand_font = weighted(sora, 62, 800)

    # Split on the dash, whichever kind the title uses. The token before it is
    # the brand; everything after is the claim.
    dash = next((d for d in ("–", "—", "-") if d in title), None)
    if dash:
        brand, rest = (part.strip() for part in title.split(dash, 1))
    else:
        brand, rest = title.strip(), ""

    head_lines: list[tuple[str, ImageFont.FreeTypeFont, str]] = [
        (f"{brand} {dash}" if dash else brand, brand_font, GREEN)
    ]
    head_lines += [(line, head_font, INK) for line in wrap(draw, rest, head_font, measure)]

    sub_font = weighted(manrope, 29, 500)
    sub_lines = wrap(draw, SUBLINE, sub_font, measure)

    # The stack is measured before anything is drawn, then centred in the space
    # above a reserved footer zone.
    #
    # This is the part worth keeping: laying it out by stepping a cursor down
    # from a hand-picked start meant a title one line longer silently pushed
    # the subline through the footer, and the only way to notice was to look at
    # the PNG. Measure first and the overlap cannot happen — a longer title
    # eats the slack, and if there is none left the guard below says so instead
    # of writing a broken card.
    HEAD_LEADING = 76
    SUB_LEADING = 40
    RULE_GAP, RULE_BAND, SUB_GAP = 22, 24, 26
    FOOTER_ZONE = 104

    stack_h = (
        len(head_lines) * HEAD_LEADING
        + RULE_GAP
        + RULE_BAND
        + SUB_GAP
        + len(sub_lines) * SUB_LEADING
    )
    top, bottom = 44, H - FOOTER_ZONE
    if stack_h > bottom - top:
        raise SystemExit(
            f"Title {title!r} needs {stack_h}px of a {bottom - top}px column. "
            "Shorten it, or drop the headline size in render()."
        )

    y = top + (bottom - top - stack_h) // 2
    for text, font, colour in head_lines:
        draw.text((pad, y), text, font=font, fill=colour)
        y += HEAD_LEADING

    y += RULE_GAP
    zigzag(draw, pad, y + RULE_BAND // 2, 148, 7, 18, AMBER)
    y += RULE_BAND + SUB_GAP

    for line in sub_lines:
        draw.text((pad, y), line, font=sub_font, fill=MUTED)
        y += SUB_LEADING

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
    ap.add_argument("--title", default=TITLE, help="Headline; should match og:title.")
    ap.add_argument("--out", default=str(OUT), help="Where to write the PNG.")
    ap.add_argument(
        "--check",
        action="store_true",
        help="Re-render and compare against the file on disk instead of writing.",
    )
    args = ap.parse_args()

    img = render(args.title)
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
            f"{'matches' if same else 'does not match'} title {args.title!r}"
        )
        return 0 if same else 1

    out.parent.mkdir(parents=True, exist_ok=True)
    img.save(out, "PNG", optimize=True)
    print(json.dumps({"wrote": str(out), "size": out.stat().st_size, "title": args.title}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
