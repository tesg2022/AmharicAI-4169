r"""
Step 1 of training — speaker-disjoint train/dev/test split.

Refuses to run without `clean_manifest.jsonl`. That is the gate the whole
pipeline hangs off: QA decides what is trainable, training never re-decides.

Why speaker-disjoint matters here specifically
----------------------------------------------
A TTS model that has heard the dev speaker during training will score well on
dev and still sound wrong on a new voice. With a small corpus the temptation is
a random split — that leaks the same speaker into both sides and produces an
eval number that means nothing. So the split is by speaker, and if speaker
labels are missing it stops rather than pretending.

Run:
    python3 tts/training/prepare_split.py \
        --clean tts/qa/out/clean_manifest.jsonl \
        --out-dir tts/training/data \
        --dev-frac 0.05 --test-frac 0.05
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from collections import defaultdict
from pathlib import Path


def stable_frac(key: str) -> float:
    """Deterministic 0-1 from a speaker id. A seeded RNG would reshuffle every
    time a speaker is added; hashing keeps existing assignments stable, so an
    eval number stays comparable across corpus growth."""
    h = hashlib.sha256(key.encode("utf-8")).hexdigest()[:16]
    return int(h, 16) / float(1 << 64)


def main() -> int:
    p = argparse.ArgumentParser(description="Speaker-disjoint split")
    p.add_argument("--clean", type=Path, default=Path("tts/qa/out/clean_manifest.jsonl"))
    p.add_argument("--out-dir", type=Path, default=Path("tts/training/data"))
    p.add_argument("--dev-frac", type=float, default=0.05)
    p.add_argument("--test-frac", type=float, default=0.05)
    args = p.parse_args()

    if not args.clean.exists():
        print(f"REFUSING TO RUN: {args.clean} does not exist.")
        print("Run tts/qa/dataset_qa.py first — training consumes the clean bucket only.")
        return 2

    rows = [json.loads(l) for l in args.clean.read_text(encoding="utf-8").splitlines() if l.strip()]
    if not rows:
        print("REFUSING TO RUN: clean manifest is empty. Nothing is trainable.")
        return 2

    unlabelled = [r.get("id") for r in rows if not r.get("speaker_id")]
    if unlabelled:
        print(f"REFUSING TO RUN: {len(unlabelled)} row(s) have no speaker_id, e.g. {unlabelled[:5]}")
        print("A speaker-disjoint split cannot be produced — let alone verified — without them.")
        print("Add speaker labels at recording/segmentation time and re-run QA.")
        return 2

    by_speaker: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        by_speaker[str(r["speaker_id"])].append(r)

    if len(by_speaker) < 3:
        print(f"REFUSING TO RUN: {len(by_speaker)} speaker(s). A disjoint train/dev/test split "
              "needs at least 3, and realistically far more.")
        return 2

    splits: dict[str, list[dict]] = {"train": [], "dev": [], "test": []}
    assignment: dict[str, str] = {}
    for speaker, items in sorted(by_speaker.items()):
        f = stable_frac(speaker)
        if f < args.dev_frac:
            bucket = "dev"
        elif f < args.dev_frac + args.test_frac:
            bucket = "test"
        else:
            bucket = "train"
        assignment[speaker] = bucket
        splits[bucket].extend(items)

    # An empty eval side is a silent failure — the run would "succeed" with no
    # way to tell whether the voice got better.
    empty = [k for k, v in splits.items() if not v]
    if empty:
        print(f"REFUSING TO RUN: split(s) {empty} are empty at the requested fractions. "
              "Raise --dev-frac/--test-frac or add speakers.")
        return 2

    args.out_dir.mkdir(parents=True, exist_ok=True)
    for name, items in splits.items():
        path = args.out_dir / f"{name}.jsonl"
        with path.open("w", encoding="utf-8") as fh:
            for r in items:
                fh.write(json.dumps(r, ensure_ascii=False) + "\n")

    overlap = set()
    speakers = {k: {s for s, b in assignment.items() if b == k} for k in splits}
    for a in ("train", "dev", "test"):
        for b in ("train", "dev", "test"):
            if a < b:
                overlap |= speakers[a] & speakers[b]
    assert not overlap, f"split is not speaker-disjoint: {overlap}"

    (args.out_dir / "split_report.json").write_text(
        json.dumps(
            {
                "source": str(args.clean),
                "rows": {k: len(v) for k, v in splits.items()},
                "speakers": {k: sorted(v) for k, v in speakers.items()},
                "seconds": {
                    k: round(sum(float(r.get("audio_duration") or 0) for r in v), 2)
                    for k, v in splits.items()
                },
                "disjoint_verified": True,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    for k, v in splits.items():
        print(f"{k:5s} {len(v):6d} rows  {len(speakers[k]):3d} speakers  "
              f"{sum(float(r.get('audio_duration') or 0) for r in v)/3600:.3f} h")
    print(f"\nspeaker-disjoint verified. wrote {args.out_dir}/{{train,dev,test}}.jsonl")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
