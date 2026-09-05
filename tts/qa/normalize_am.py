r"""
Trainer-side Amharic text normalization — a faithful port of the app's
TypeScript speech pipeline (`packages/web/src/api/speech/{fidel,numbers}.ts`).

Why this file exists
--------------------
Training data is prepared here (Python, Colab/GPU) and inference text is
normalized there (TypeScript, in the app). If the two normalizers disagree by
even one rule, the model learns one mapping and is served another. That failure
is invisible in loss curves and only shows up as a voice that mispronounces
numbers in production.

So this port is not trusted on inspection: `test_parity.py` holds every function
here to the golden vectors emitted from the TypeScript itself
(`parity_vectors.json`). Change the TypeScript, regenerate the vectors, then fix
this file until parity is green again. Never the other way around.

Porting notes (the traps, all of which cost real bugs):
  * JavaScript's `\b` and `\d` are ASCII-only. Python's are Unicode-aware, so
    `\b` between "ከ" and "947" *does not* exist in Python but *does* in JS.
    Every ported regex therefore carries `re.ASCII`.
  * JS `\s` includes U+FEFF; Python's `str.isspace()` does not.
  * `፻` multiplies the accumulator, `፼` flushes it — they are not digits.
  * 11-19 are "አስራ N"; 21+ are "TENS N". Exactly 100 is "መቶ", but 1000 keeps
    its "አንድ ሺህ".
"""

from __future__ import annotations

import re
import unicodedata

# --------------------------------------------------------------------------
# Fidel
# --------------------------------------------------------------------------

#: Ethiopic syllabary block plus the supplement/extended blocks.
ETHIOPIC_RANGES = (
    (0x1200, 0x137F),
    (0x1380, 0x139F),
    (0x2D80, 0x2DDF),
    (0xAB00, 0xAB2F),
)

#: JavaScript's `\s` set. Deliberately explicit — it is not Python's.
JS_WHITESPACE = (
    "\t\n\v\f\r           "
    "       　﻿"
)


def is_ethiopic(char: str) -> bool:
    code = ord(char)
    return any(lo <= code <= hi for lo, hi in ETHIOPIC_RANGES)


def is_amharic(text: str) -> bool:
    return any(is_ethiopic(c) for c in text)


def amharic_ratio(text: str) -> float:
    """Proportion of Ethiopic script, ignoring spaces, punctuation and digits."""
    letters = [
        c
        for c in text
        if c not in JS_WHITESPACE
        and not unicodedata.category(c).startswith(("P", "S"))
        and not ("0" <= c <= "9")
    ]
    if not letters:
        return 0.0
    return sum(1 for c in letters if is_ethiopic(c)) / len(letters)


_FOLD_ROWS = [
    # h-series: ሀ / ሐ / ኀ orders all collapse to the ሀ order.
    ["ሀ", "ሐ", "ኀ"],
    ["ሁ", "ሑ", "ኁ"],
    ["ሂ", "ሒ", "ኂ"],
    ["ሃ", "ሓ", "ኃ"],
    ["ሄ", "ሔ", "ኄ"],
    ["ህ", "ሕ", "ኅ"],
    ["ሆ", "ሖ", "ኆ"],
    # s-series: ሠ collapses to ሰ.
    ["ሰ", "ሠ"],
    ["ሱ", "ሡ"],
    ["ሲ", "ሢ"],
    ["ሳ", "ሣ"],
    ["ሴ", "ሤ"],
    ["ስ", "ሥ"],
    ["ሶ", "ሦ"],
    # ts'-series: ፀ collapses to ጸ.
    ["ጸ", "ፀ"],
    ["ጹ", "ፁ"],
    ["ጺ", "ፂ"],
    ["ጻ", "ፃ"],
    ["ጼ", "ፄ"],
    ["ጽ", "ፅ"],
    ["ጾ", "ፆ"],
    # glottal series: ዐ collapses to አ.
    ["አ", "ዐ"],
    ["ኡ", "ዑ"],
    ["ኢ", "ዒ"],
    ["ኣ", "ዓ"],
    ["ኤ", "ዔ"],
    ["እ", "ዕ"],
    ["ኦ", "ዖ"],
]

HOMOPHONE_FOLD = {v: row[0] for row in _FOLD_ROWS for v in row}


def fold_homophones(text: str) -> str:
    """Canonicalize homophonous Fidel. Matching and scoring only — never display,
    never TTS input."""
    return "".join(HOMOPHONE_FOLD.get(c, c) for c in text)


def modernize_wordspace(text: str) -> str:
    """The Ethiopic wordspace `፡` is archaic in running text; modern usage is a space."""
    return text.replace("፡", " ")


_ZERO_WIDTH = re.compile("[​-‍﻿]")
_DOUBLE_STOP = re.compile("።[" + JS_WHITESPACE + "]*።+")
_SPACES = re.compile(r"[ \t]+")
_NEWLINE = re.compile(r" ?\n ?")


def normalize_for_speech(text: str) -> str:
    """Repair encoding and spacing so a neural voice does not stumble.

    Deliberately conservative: it never rewrites the spelling of a word, because
    the spelling is the lesson content.
    """
    out = modernize_wordspace(text)
    out = unicodedata.normalize("NFC", out)
    out = out.replace(" ", " ")
    out = _ZERO_WIDTH.sub("", out)
    out = _DOUBLE_STOP.sub("።", out)
    out = _SPACES.sub(" ", out)
    out = _NEWLINE.sub("\n", out)
    return out.strip(JS_WHITESPACE)


#: The sounds that make Amharic sound Amharic — and that an English-phonetic
#: rendering destroys.
EJECTIVE_BASES = ("ጠ", "ቀ", "ጰ", "ጸ", "ጨ")

_EJECTIVE_RANGES = (
    (0x1320, 0x1327),  # ጠ order
    (0x1240, 0x1247),  # ቀ order
    (0x1330, 0x1337),  # ጰ order
    (0x1338, 0x133F),  # ጸ order
    (0x1328, 0x132F),  # ጨ order
)


def is_ejective(char: str) -> bool:
    if not char:
        return False
    code = ord(char[0])
    return any(lo <= code <= hi for lo, hi in _EJECTIVE_RANGES)


def count_ejectives(text: str) -> int:
    """Used to flag phrases worth extra drill time."""
    return sum(1 for c in text if is_ejective(c))


def analyze_fidel(char: str) -> dict:
    """A Fidel character decomposes into a consonant family and one of seven
    vowel orders. The block is laid out in rows of eight; the 8th slot is the
    labiovelar variant, not an order."""
    if not char or not is_ethiopic(char):
        return {"char": char, "order": None, "family": None, "is_ejective": False}
    code = ord(char)
    if code < 0x1200 or code > 0x135A:
        return {"char": char, "order": None, "family": None, "is_ejective": is_ejective(char)}
    offset = (code - 0x1200) % 8
    return {
        "char": char,
        "order": offset + 1 if offset < 7 else None,
        "family": chr(code - offset),
        "is_ejective": is_ejective(char),
    }


def fidel_family(char: str) -> list[str]:
    """The seven-order family for a Fidel character, e.g. ለ → ለ ሉ ሊ ላ ሌ ል ሎ."""
    family = analyze_fidel(char)["family"]
    if not family:
        return []
    base = ord(family)
    return [chr(base + i) for i in range(7)]


# --------------------------------------------------------------------------
# Numbers, times and dates
# --------------------------------------------------------------------------

ONES = ["", "አንድ", "ሁለት", "ሦስት", "አራት", "አምስት", "ስድስት", "ሰባት", "ስምንት", "ዘጠኝ"]
TENS = ["", "አስር", "ሃያ", "ሠላሳ", "አርባ", "ሃምሳ", "ስድሳ", "ሰባ", "ሰማንያ", "ዘጠና"]

#: Ethiopic numerals map onto values, not digits — ፻ is 100, ፼ is 10,000.
ETHIOPIC_DIGITS = {
    "፩": 1, "፪": 2, "፫": 3, "፬": 4, "፭": 5, "፮": 6, "፯": 7, "፰": 8, "፱": 9,
    "፲": 10, "፳": 20, "፴": 30, "፵": 40, "፶": 50, "፷": 60, "፸": 70, "፹": 80, "፺": 90,
    "፻": 100, "፼": 10000,
}


def ethiopic_to_number(text: str) -> int | None:
    """Convert a run of Ethiopic numerals to its integer value."""
    if not text or any(c not in ETHIOPIC_DIGITS for c in text):
        return None
    total = 0
    current = 0
    for c in text:
        v = ETHIOPIC_DIGITS[c]
        if v == 10000:
            total += (current or 1) * 10000
            current = 0
        elif v == 100:
            current = (current or 1) * 100
        else:
            current += v
    return total + current


def _js_number_str(value: float) -> str:
    """JavaScript's `String(number)` for the decimals this pipeline sees."""
    if value == int(value):
        return str(int(value))
    return repr(float(value))


_SCALES = ((1_000_000_000, "ቢሊዮን"), (1_000_000, "ሚሊዮን"), (1_000, "ሺህ"))


def number_to_amharic(value: float) -> str:
    """Spell an integer in Amharic words. Handles 0 … 999,999,999,999."""
    if value != value or value in (float("inf"), float("-inf")):
        return ""
    if value < 0:
        return f"ነጌቲቭ {number_to_amharic(-value)}"
    if value != int(value):
        whole, _, frac = _js_number_str(value).partition(".")
        digits = " ".join(ONES[int(d)] or "ዜሮ" for d in frac)
        return f"{number_to_amharic(int(whole))} ነጥብ {digits}"

    value = int(value)
    if value == 0:
        return "ዜሮ"

    parts: list[str] = []
    rest = value
    for scale, word in _SCALES:
        if rest >= scale:
            count = rest // scale
            # "አንድ ሺህ" is idiomatic; keep the አንድ.
            parts.append(f"{number_to_amharic(count)} {word}")
            rest %= scale

    if rest >= 100:
        hundreds = rest // 100
        parts.append("መቶ" if hundreds == 1 else f"{ONES[hundreds]} መቶ")
        rest %= 100

    if rest >= 10:
        tens, unit = divmod(rest, 10)
        # 11-19 are "አስራ አንድ" style; 21+ are "ሃያ አንድ".
        if tens == 1 and unit > 0:
            parts.append(f"አስራ {ONES[unit]}")
        else:
            parts.append(TENS[tens])
            if unit > 0:
                parts.append(ONES[unit])
    elif rest > 0:
        parts.append(ONES[rest])

    return " ".join(p for p in parts if p)


MONTHS = [
    "ጃንዋሪ", "ፌብሩዋሪ", "ማርች", "ኤፕሪል", "ሜይ", "ጁን",
    "ጁላይ", "ኦገስት", "ሴፕቴምበር", "ኦክቶበር", "ኖቬምበር", "ዲሴምበር",
]


def time_to_amharic(hour: int, minute: int) -> str:
    """`3:30` → "ሦስት ሰዓት ተኩል". Amharic states the hour, then the minutes."""
    h = number_to_amharic(hour)
    if minute == 0:
        return f"{h} ሰዓት"
    if minute == 30:
        return f"{h} ሰዓት ተኩል"
    return f"{h} ሰዓት ከ{number_to_amharic(minute)} ደቂቃ"


# `re.ASCII` on every one of these: JS `\b`/`\d` are ASCII-only, Python's are not.
_RE_ETHIOPIC_NUM = re.compile("[፩-፼]+")
_RE_TIME = re.compile(r"\b(\d{1,2}):(\d{2})\b", re.ASCII)
_RE_DATE = re.compile(r"\b(\d{4})-(\d{1,2})-(\d{1,2})\b", re.ASCII)
_RE_PERCENT = re.compile(r"\b(\d+(?:\.\d+)?)\s*%", re.ASCII)
_RE_INT = re.compile(r"\b\d[\d,]*(?:\.\d+)?\b", re.ASCII)


def expand_numbers(text: str) -> str:
    """Expand every number, time and date into Amharic words.

    Order matters: times and dates are matched before bare integers, otherwise
    "3:30" would be read as two separate numbers.
    """
    out = text

    def _ethiopic(m: re.Match[str]) -> str:
        n = ethiopic_to_number(m.group(0))
        return m.group(0) if n is None else number_to_amharic(n)

    out = _RE_ETHIOPIC_NUM.sub(_ethiopic, out)

    def _time(m: re.Match[str]) -> str:
        hour, minute = int(m.group(1)), int(m.group(2))
        if hour > 23 or minute > 59:
            return m.group(0)
        return time_to_amharic(hour, minute)

    out = _RE_TIME.sub(_time, out)

    def _date(m: re.Match[str]) -> str:
        idx = int(m.group(2)) - 1
        if idx < 0 or idx >= len(MONTHS):
            return m.group(0)
        return f"{MONTHS[idx]} {number_to_amharic(int(m.group(3)))} {number_to_amharic(int(m.group(1)))}"

    out = _RE_DATE.sub(_date, out)
    out = _RE_PERCENT.sub(lambda m: f"{number_to_amharic(float(m.group(1)))} በመቶ", out)
    out = _RE_INT.sub(lambda m: number_to_amharic(float(m.group(0).replace(",", ""))), out)
    return out


def prepare_for_training(text: str) -> str:
    """The exact text the model should be trained on.

    Digits are expanded *before* training, not only at inference. Raw Arabic
    numerals in the transcript teach an unstable digit→speech mapping: the
    speaker said "ዘጠኝ መቶ አርባ ሰባት" but the model saw "947".
    """
    return normalize_for_speech(expand_numbers(normalize_for_speech(text)))
