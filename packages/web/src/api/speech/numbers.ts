/**
 * Amharic verbalization of numbers, times and dates.
 *
 * A neural `am-ET` voice reads "1995" or "3:30" inconsistently — often in
 * English, or digit by digit. Expanding them to Amharic words *before*
 * synthesis is what makes the difference between a computer reading symbols and
 * a speaker saying a sentence.
 */

const ONES = [
  "",
  "አንድ",
  "ሁለት",
  "ሦስት",
  "አራት",
  "አምስት",
  "ስድስት",
  "ሰባት",
  "ስምንት",
  "ዘጠኝ",
];

const TENS = [
  "",
  "አስር",
  "ሃያ",
  "ሠላሳ",
  "አርባ",
  "ሃምሳ",
  "ስድሳ",
  "ሰባ",
  "ሰማንያ",
  "ዘጠና",
];

/** Ethiopic numerals map onto values, not digits — ፻ is 100, ፼ is 10,000. */
const ETHIOPIC_DIGITS: Record<string, number> = {
  "፩": 1, "፪": 2, "፫": 3, "፬": 4, "፭": 5, "፮": 6, "፯": 7, "፰": 8, "፱": 9,
  "፲": 10, "፳": 20, "፴": 30, "፵": 40, "፶": 50, "፷": 60, "፸": 70, "፹": 80, "፺": 90,
  "፻": 100, "፼": 10000,
};

/** Convert a run of Ethiopic numerals to its integer value. */
export function ethiopicToNumber(text: string): number | null {
  const chars = [...text];
  if (!chars.length || !chars.every((c) => c in ETHIOPIC_DIGITS)) return null;

  let total = 0;
  let current = 0;
  for (const c of chars) {
    const v = ETHIOPIC_DIGITS[c];
    if (v === 10000) {
      total += (current || 1) * 10000;
      current = 0;
    } else if (v === 100) {
      current = (current || 1) * 100;
    } else {
      current += v;
    }
  }
  return total + current;
}

/** Spell an integer in Amharic words. Handles 0 … 999,999,999,999. */
export function numberToAmharic(value: number): string {
  if (!Number.isFinite(value)) return "";
  if (value < 0) return `ነጌቲቭ ${numberToAmharic(-value)}`;
  if (!Number.isInteger(value)) {
    const [whole, frac] = String(value).split(".");
    const digits = [...frac].map((d) => ONES[Number(d)] || "ዜሮ").join(" ");
    return `${numberToAmharic(Number(whole))} ነጥብ ${digits}`;
  }
  if (value === 0) return "ዜሮ";

  const parts: string[] = [];

  const scales: [number, string][] = [
    [1_000_000_000, "ቢሊዮን"],
    [1_000_000, "ሚሊዮን"],
    [1_000, "ሺህ"],
  ];

  let rest = value;
  for (const [scale, word] of scales) {
    if (rest >= scale) {
      const count = Math.floor(rest / scale);
      // "አንድ ሺህ" is idiomatic; "አንድ መቶ" likewise — keep the አንድ.
      parts.push(`${numberToAmharic(count)} ${word}`);
      rest %= scale;
    }
  }

  if (rest >= 100) {
    const hundreds = Math.floor(rest / 100);
    parts.push(hundreds === 1 ? "መቶ" : `${ONES[hundreds]} መቶ`);
    rest %= 100;
  }

  if (rest >= 10) {
    const tens = Math.floor(rest / 10);
    const unit = rest % 10;
    // 11-19 are "አስራ አንድ" style; 21+ are "ሃያ አንድ".
    if (tens === 1 && unit > 0) parts.push(`አስራ ${ONES[unit]}`);
    else {
      parts.push(TENS[tens]);
      if (unit > 0) parts.push(ONES[unit]);
    }
  } else if (rest > 0) {
    parts.push(ONES[rest]);
  }

  return parts.filter(Boolean).join(" ");
}

const MONTHS = [
  "ጃንዋሪ", "ፌብሩዋሪ", "ማርች", "ኤፕሪል", "ሜይ", "ጁን",
  "ጁላይ", "ኦገስት", "ሴፕቴምበር", "ኦክቶበር", "ኖቬምበር", "ዲሴምበር",
];

/** `3:30` → "ሦስት ሰዓት ከሠላሳ ደቂቃ". Amharic states the hour then the minutes. */
export function timeToAmharic(hour: number, minute: number): string {
  const h = numberToAmharic(hour);
  if (minute === 0) return `${h} ሰዓት`;
  if (minute === 30) return `${h} ሰዓት ተኩል`;
  return `${h} ሰዓት ከ${numberToAmharic(minute)} ደቂቃ`;
}

/**
 * Expand every number, time and date in a string into Amharic words.
 *
 * Order matters: times and dates are matched before bare integers, otherwise
 * "3:30" would be read as two separate numbers.
 */
export function expandNumbers(text: string): string {
  let out = text;

  // Ethiopic numerals → words.
  out = out.replace(/[፩-፼]+/g, (m) => {
    const n = ethiopicToNumber(m);
    return n === null ? m : numberToAmharic(n);
  });

  // Times: 3:30, 14:05
  out = out.replace(/\b(\d{1,2}):(\d{2})\b/g, (m, h: string, mi: string) => {
    const hour = Number(h);
    const minute = Number(mi);
    if (hour > 23 || minute > 59) return m;
    return timeToAmharic(hour, minute);
  });

  // Dates: 2024-05-03 and 3/5/2024
  out = out.replace(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g, (m, y: string, mo: string, d: string) => {
    const month = MONTHS[Number(mo) - 1];
    if (!month) return m;
    return `${month} ${numberToAmharic(Number(d))} ${numberToAmharic(Number(y))}`;
  });

  // Percentages read as "በመቶ".
  out = out.replace(/\b(\d+(?:\.\d+)?)\s*%/g, (_m, n: string) => `${numberToAmharic(Number(n))} በመቶ`);

  // Bare integers and decimals, with thousands separators stripped.
  out = out.replace(/\b\d[\d,]*(?:\.\d+)?\b/g, (m) => {
    const n = Number(m.replace(/,/g, ""));
    return Number.isFinite(n) ? numberToAmharic(n) : m;
  });

  return out;
}
