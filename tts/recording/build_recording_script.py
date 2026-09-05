r"""
Build the course-domain recording script.

Why this exists
---------------
The 5h news corpus is a *foundation*: it teaches the model Amharic phonetics,
Fidel coverage, speaker variation and general prosody. It is not the final
voice. Every sentence in it is broadcast register — 10-20s government and ENA
copy — while the course teaches 1-4s conversational phrases. Fine-tuning on the
foundation alone optimizes the model into a formal newsreader, and AmharicAI
needs a teacher.

So this walks the actual seeded course content and emits the phrases a native
speaker should record, bucketed into the ten course domains, with the coverage
gaps named. It reads `amharic-course.json` — the same source the app seeds from
— so the recording set cannot drift from what the app actually says.

Run:
    python3 tts/recording/build_recording_script.py \
        --course packages/web/src/api/content/amharic-course.json \
        --out-dir tts/recording/out
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "qa"))

import normalize_am as N  # noqa: E402

ETHIOPIC = re.compile("[ሀ-፿]")
LATIN = re.compile(r"[A-Za-z]")

#: The ten domains the final voice must cover. Order is the recording order —
#: greetings first because they are the shortest and let a speaker warm up.
DOMAINS = [
    "greetings",
    "introductions",
    "classroom_instructions",
    "fidel_pronunciation",
    "vocabulary",
    "questions_answers",
    "dialogues",
    "exercises",
    "tutor_feedback",
    "everyday_conversation",
]

#: Phrases the app speaks that exist nowhere in the course data — the tutor's
#: own voice. Without these the model has never heard encouragement, only facts.
TUTOR_FEEDBACK = [
    ("በጣም ጥሩ!", "Very good!"),
    ("ትክክል ነው።", "That's correct."),
    ("እንደገና ሞክር።", "Try again."),
    ("ቀስ ብለህ ተናገር።", "Speak slowly."),
    ("አሁን አንተ ተናገር።", "Now you say it."),
    ("አዳምጥ።", "Listen."),
    ("ድገመው።", "Repeat it."),
    ("ጎበዝ!", "Well done!"),
    ("ተቃርበሃል።", "You're close."),
    ("አትጨነቅ፤ እንደገና እንሞክር።", "Don't worry, let's try again."),
    ("ይህን ቃል በድጋሚ አዳምጥ።", "Listen to this word again."),
    ("ጥሩ አጠራር።", "Good pronunciation."),
]

CLASSROOM = [
    ("ክፈት።", "Open."),
    ("ዝጋ።", "Close."),
    ("ጻፍ።", "Write."),
    ("አንብብ።", "Read."),
    ("ተመልከት።", "Look."),
    ("ጠይቅ።", "Ask."),
    ("መልስ።", "Answer."),
    ("ቁጭ በል።", "Sit down."),
    ("ተነስ።", "Stand up."),
    ("ቀስ ብለህ አንብብ።", "Read slowly."),
]

GREETING_HINTS = ("ሰላም", "ጤና", "እንደምን", "ደህና", "አመሰግ", "እንኳን")
INTRO_HINTS = ("ስሜ", "ስምህ", "ስምሽ", "ከየት", "አገር", "ተማሪ")


def domain_for(text: str, path: list[str]) -> str:
    joined = " ".join(path).lower()
    if any(h in text for h in GREETING_HINTS):
        return "greetings"
    if any(h in text for h in INTRO_HINTS):
        return "introductions"
    if "lines" in joined or "dialogue" in joined:
        return "dialogues"
    if "question" in joined or text.rstrip().endswith("?"):
        return "questions_answers"
    if "exercise" in joined or "activit" in joined or "option" in joined or "answer" in joined:
        return "exercises"
    if "wa_combination" in joined or "special_consonant" in joined or "order" in joined:
        return "fidel_pronunciation"
    if "vocabulary" in joined or "kinship" in joined or "number" in joined or "ordinal" in joined:
        return "vocabulary"
    if "example" in joined or "form" in joined or "conjug" in joined:
        return "everyday_conversation"
    return "vocabulary"


def harvest(course: dict) -> list[dict]:
    """Pull every Amharic string out of the course, keeping its English gloss
    when the source stores the pair side by side."""
    out: list[dict] = []
    seen: set[str] = set()

    def add(am: str, en: str, path: list[str]) -> None:
        am = N.normalize_for_speech(am)
        # Strip parenthesised transliteration — the speaker reads Fidel, not
        # a Latin respelling, which is the whole point of this pipeline.
        am = re.sub(r"\s*\([^)]*[A-Za-z][^)]*\)", "", am).strip()
        if not am or not ETHIOPIC.search(am):
            return
        if len(am) > 120:
            return
        key = am
        if key in seen:
            return
        seen.add(key)
        out.append({
            "amharic": am,
            "english": (en or "").strip(),
            "domain": domain_for(am, path),
            "path": ".".join(path[-3:]),
        })

    def walk(node, path: list[str]) -> None:
        if isinstance(node, dict):
            am = node.get("amharic") or node.get("am") or node.get("text_am")
            en = node.get("english") or node.get("en") or node.get("meaning") or node.get("gloss")
            if isinstance(am, str):
                add(am, en if isinstance(en, str) else "", path)
            for k, v in node.items():
                walk(v, path + [str(k)])
        elif isinstance(node, list):
            # [amharic, english] pairs are the dominant shape in this course.
            strs = [x for x in node if isinstance(x, str)]
            if len(node) == len(strs) and 2 <= len(node) <= 3:
                eth = [s for s in strs if ETHIOPIC.search(s)]
                lat = [s for s in strs if LATIN.search(s) and not ETHIOPIC.search(s)]
                if eth:
                    add(eth[0], lat[0] if lat else "", path)
                    return
            for v in node:
                walk(v, path + ["[]"])
        elif isinstance(node, str) and ETHIOPIC.search(node):
            add(node, "", path)

    walk(course, [])
    return out


def main() -> int:
    p = argparse.ArgumentParser(description="Course-domain recording script")
    p.add_argument("--course", type=Path,
                   default=Path("packages/web/src/api/content/amharic-course.json"))
    p.add_argument("--out-dir", type=Path, default=Path("tts/recording/out"))
    p.add_argument("--speakers", type=int, default=4,
                   help="how many native speakers the set should be recorded by")
    args = p.parse_args()

    course = json.loads(args.course.read_text(encoding="utf-8"))
    items = harvest(course)

    # The two domains the course data cannot supply, because the app speaks them
    # rather than teaching them.
    for am, en in TUTOR_FEEDBACK:
        items.append({"amharic": am, "english": en, "domain": "tutor_feedback",
                      "path": "authored"})
    for am, en in CLASSROOM:
        items.append({"amharic": am, "english": en, "domain": "classroom_instructions",
                      "path": "authored"})

    by_domain: dict[str, list[dict]] = defaultdict(list)
    for it in items:
        by_domain[it["domain"]].append(it)

    # Fidel coverage: which of the 7 orders across the syllabary the set exercises.
    fidel_seen = {c for it in items for c in it["amharic"] if 0x1200 <= ord(c) <= 0x137F}
    families = {N.analyze_fidel(c)["family"] for c in fidel_seen}
    families.discard(None)
    ejective_items = sum(1 for it in items if N.count_ejectives(it["amharic"]))

    args.out_dir.mkdir(parents=True, exist_ok=True)
    rows = []
    for domain in DOMAINS:
        for i, it in enumerate(sorted(by_domain.get(domain, []), key=lambda x: len(x["amharic"])), 1):
            rows.append({
                "clip_id": f"{domain}_{i:04d}",
                "domain": domain,
                "amharic": it["amharic"],
                "english": it["english"],
                # Recorded once per speaker — this is the field whose absence
                # broke the existing corpus's speaker-disjoint split.
                "speaker_id": "",
                "target_seconds": "1-4",
                "register": "teacher, warm, unhurried",
                "ejectives": N.count_ejectives(it["amharic"]),
                "chars": len(it["amharic"]),
                "source": it["path"],
            })

    csv_path = args.out_dir / "recording_script.csv"
    with csv_path.open("w", encoding="utf-8", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)

    (args.out_dir / "recording_script.jsonl").write_text(
        "\n".join(json.dumps(r, ensure_ascii=False) for r in rows) + "\n", encoding="utf-8"
    )

    counts = Counter(r["domain"] for r in rows)
    est_seconds = len(rows) * 2.5 * args.speakers
    plan = {
        "source": str(args.course),
        "phrases": len(rows),
        "speakers_requested": args.speakers,
        "clips_if_all_speakers": len(rows) * args.speakers,
        "estimated_hours_at_2.5s": round(est_seconds / 3600, 2),
        "by_domain": {d: counts.get(d, 0) for d in DOMAINS},
        "empty_domains": [d for d in DOMAINS if not counts.get(d)],
        "fidel_characters_covered": len(fidel_seen),
        "fidel_families_covered": len(families),
        "phrases_containing_ejectives": ejective_items,
        "requirements": {
            "sample_rate": 24000,
            "channels": 1,
            "bit_depth": 16,
            "format": "wav",
            "speaker_id": "REQUIRED on every clip — the existing corpus has none, "
                          "which makes a speaker-disjoint split impossible",
            "text_normalization": "digits must be written as Amharic words, not numerals",
        },
    }
    (args.out_dir / "recording_plan.json").write_text(
        json.dumps(plan, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    print(f"{len(rows)} phrases across {len([d for d in DOMAINS if counts.get(d)])} domains")
    for d in DOMAINS:
        print(f"  {d:24s} {counts.get(d, 0):5d}")
    print(f"\nfidel characters covered: {len(fidel_seen)}   families: {len(families)}")
    print(f"phrases with ejectives:   {ejective_items}")
    print(f"at {args.speakers} speakers ≈ {len(rows) * args.speakers} clips, "
          f"{plan['estimated_hours_at_2.5s']:.2f} h")
    if plan["empty_domains"]:
        print(f"\nEMPTY DOMAINS (need authoring): {plan['empty_domains']}")
    print(f"\nwrote {csv_path} and recording_plan.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
