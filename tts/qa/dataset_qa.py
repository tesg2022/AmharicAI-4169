r"""
AmharicAI dataset QA — the gate that must pass before any training run.

    RAW DATA → QA ├── CLEAN ├── REVIEW └── REJECT → speaker-disjoint split
                                                  → tokenization → training

Nothing is ever deleted. Every row lands in exactly one of three manifests and
the reasons travel with it, so a human can re-cut the review bucket instead of
re-recording it.

What it actually verifies (all measured, none assumed):
  * manifest ↔ audio existence, in both directions (orphan audio AND dead rows)
  * sample rate / channels / bit depth / codec against `training_config.json`
  * `audio_duration` drift against the real decoded file
  * `num_tokens` inside [min_sample_tokens, max_sample_tokens], recomputed at
    the tokenizer's 25 Hz frame rate when the field is absent
  * text hygiene: NFC, Latin contamination, Fidel ratio, raw digits
  * `speaker_id` presence — a speaker-disjoint split is *unverifiable* without
    it, so its absence hard-fails the gate rather than passing quietly
  * audio↔text alignment by transcribing the clip and comparing character error
    rate against the transcript, with homophone folding applied (ሀ/ሃ series
    variance is an ASR spelling choice, not a data error — scoring unfolded
    would reject good clips)
  * utterance-length banding, to show how much of the corpus is news-register
    long-form versus the 1-4s conversational register the course needs

Usage
-----
    python3 tts/qa/dataset_qa.py \
        --manifest /path/to/train.jsonl --manifest /path/to/dev.jsonl \
        --audio-dir /path/to/clips \
        --config /path/to/training_config.json \
        --out-dir tts/qa/out \
        --align                     # transcribe every clip (slow, no GPU needed)

Outputs `clean_manifest.jsonl`, `review_manifest.jsonl`,
`reject_manifest.jsonl` and `qa_report.json` in --out-dir.
Exit code 0 only when the gate passes.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import unicodedata
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import normalize_am as N  # noqa: E402

# --------------------------------------------------------------------------
# thresholds — every one of these is a judgement call, so it is named and
# overridable from the CLI rather than buried in a condition.
# --------------------------------------------------------------------------

DEFAULTS = {
    "duration_drift_s": 0.05,      # manifest vs decoded file
    "min_duration_s": 0.4,         # shorter than this is a clipped segment
    "max_duration_s": 30.0,        # longer blows the token budget
    "min_fidel_ratio": 0.80,       # below this the row is not really Amharic
    "cer_review": 0.15,            # transcript disagrees enough to eyeball
    "cer_reject": 0.35,            # transcript disagrees enough to distrust
    "course_band_s": (1.0, 6.0),   # the conversational register the app teaches
    "token_rate_hz": 25.0,         # HiggsAudioV2 audio tokenizer frame rate
}

LATIN = re.compile(r"[A-Za-z]")
ARABIC_DIGITS = re.compile(r"[0-9]")
ETHIOPIC_DIGITS = re.compile(r"[፩-፼]")


# --------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------


def original_stem(path: str | Path) -> str:
    """Recover the original clip stem.

    Uploaded attachments arrive with an injected suffix — `clip_ed303272f2f4.wav`
    becomes `clip_ed303272f2f4_ChdzgJ.wav` — while the manifests still reference
    the original name. Without this the entire corpus looks like missing audio.
    """
    stem = Path(path).stem
    head, sep, tail = stem.rpartition("_")
    if sep and re.fullmatch(r"[A-Za-z0-9]{6}", tail) and head:
        return head
    return stem


def levenshtein(a: str, b: str) -> int:
    if a == b:
        return 0
    if not a:
        return len(b)
    if not b:
        return len(a)
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def cer(reference: str, hypothesis: str) -> float:
    """Character error rate on homophone-folded, whitespace-collapsed text."""
    def prep(s: str) -> str:
        s = N.fold_homophones(N.normalize_for_speech(s))
        s = re.sub(r"[፡።፣፤፥፦፧፨\s\.,!\?;:]+", "", s)
        return s

    ref, hyp = prep(reference), prep(hypothesis)
    if not ref:
        return 1.0 if hyp else 0.0
    return levenshtein(ref, hyp) / len(ref)


def ffprobe(path: Path) -> dict:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "a:0", "-show_streams",
         "-show_format", "-of", "json", str(path)],
        capture_output=True, text=True, check=False,
    )
    if out.returncode != 0:
        return {"error": out.stderr.strip()[:400]}
    data = json.loads(out.stdout or "{}")
    streams = data.get("streams") or []
    if not streams:
        return {"error": "no audio stream"}
    s = streams[0]
    return {
        "codec": s.get("codec_name"),
        "sample_rate": int(s.get("sample_rate", 0) or 0),
        "channels": int(s.get("channels", 0) or 0),
        "bits_per_sample": int(s.get("bits_per_raw_sample") or s.get("bits_per_sample") or 0),
        "duration": float(s.get("duration") or data.get("format", {}).get("duration") or 0.0),
    }


def transcribe(path: Path, cache: dict[str, str]) -> str | None:
    """Transcribe with the sandbox `transcribe` command. Cached — it is slow and
    deterministic enough that re-running on every QA pass is pure waste."""
    key = path.name
    if key in cache:
        return cache[key]
    out = subprocess.run(["transcribe", str(path)], capture_output=True, text=True, check=False)
    if out.returncode != 0:
        return None
    text = out.stdout.strip()
    cache[key] = text
    return text


# --------------------------------------------------------------------------
# per-row QA
# --------------------------------------------------------------------------


def qa_row(row: dict, audio: Path | None, cfg: dict, th: dict, hyp: str | None) -> dict:
    """Return the row annotated with `qa` — bucket plus every reason."""
    issues: list[dict] = []

    def add(code: str, severity: str, detail: str, **extra):
        issues.append({"code": code, "severity": severity, "detail": detail, **extra})

    text = row.get("text") or ""
    want_sr = int(cfg.get("audio", {}).get("sample_rate") or cfg.get("sample_rate") or 24000)
    want_ch = int(cfg.get("audio", {}).get("channels") or 1)
    tr = cfg.get("training", {})
    min_tok = int(tr.get("min_sample_tokens") or 0)
    max_tok = int(tr.get("max_sample_tokens") or 10**9)

    # --- audio ---
    probe: dict = {}
    if audio is None or not audio.exists():
        add("audio_missing", "reject", f"no file for {row.get('audio_path')!r}")
    else:
        probe = ffprobe(audio)
        if "error" in probe:
            add("audio_unreadable", "reject", probe["error"])
        else:
            if probe["sample_rate"] != want_sr:
                add("sample_rate", "reject",
                    f"{probe['sample_rate']} Hz, config wants {want_sr} Hz")
            if probe["channels"] != want_ch:
                add("channels", "reject", f"{probe['channels']}ch, config wants {want_ch}ch")
            if probe["bits_per_sample"] and probe["bits_per_sample"] != 16:
                add("bit_depth", "review", f"{probe['bits_per_sample']}-bit, expected 16-bit")
            if probe["codec"] != "pcm_s16le":
                add("codec", "review", f"codec {probe['codec']}, expected pcm_s16le")

            dur = probe["duration"]
            stated = row.get("audio_duration")
            if isinstance(stated, (int, float)):
                drift = abs(float(stated) - dur)
                if drift > th["duration_drift_s"]:
                    add("duration_drift", "review", f"manifest {stated:.4f}s vs file {dur:.4f}s")
            if dur < th["min_duration_s"]:
                add("too_short", "reject", f"{dur:.2f}s")
            elif dur > th["max_duration_s"]:
                add("too_long", "reject", f"{dur:.2f}s")

    # --- tokens ---
    dur = probe.get("duration", 0.0)
    tokens = row.get("num_tokens")
    estimated = False
    if not isinstance(tokens, (int, float)) and dur:
        tokens = round(dur * th["token_rate_hz"])
        estimated = True
    if isinstance(tokens, (int, float)):
        if tokens < min_tok:
            add("tokens_under", "reject", f"{int(tokens)} < min_sample_tokens {min_tok}")
        elif tokens > max_tok:
            add("tokens_over", "reject", f"{int(tokens)} > max_sample_tokens {max_tok}")
        if estimated:
            add("tokens_estimated", "info",
                f"num_tokens absent; estimated {int(tokens)} at {th['token_rate_hz']} Hz")

    # --- text ---
    if not text.strip():
        add("text_empty", "reject", "no transcript")
    else:
        if unicodedata.normalize("NFC", text) != text:
            add("not_nfc", "review", "text is not NFC-normalized (auto-fixable)")
        latin = LATIN.findall(text)
        if latin:
            add("latin_contamination", "review", f"{len(latin)} Latin chars: {''.join(latin[:20])!r}")
        ratio = N.amharic_ratio(text)
        if ratio < th["min_fidel_ratio"]:
            add("low_fidel_ratio", "review", f"{ratio:.2%} Ethiopic")
        digits = ARABIC_DIGITS.findall(text) + ETHIOPIC_DIGITS.findall(text)
        if digits:
            add("raw_digits", "review",
                "raw numerals in training text teach an unstable digit→speech mapping; "
                "expand before tokenization",
                proposed=N.prepare_for_training(text))

    # --- audio ↔ text alignment ---
    align = None
    if hyp is not None and text.strip():
        rate = cer(text, hyp)
        align = {"cer": round(rate, 4), "asr_text": hyp}
        if rate > th["cer_reject"]:
            add("misaligned", "reject", f"CER {rate:.1%} against ASR transcript")
        elif rate > th["cer_review"]:
            add("alignment_drift", "review", f"CER {rate:.1%} against ASR transcript")

    # --- speaker ---
    if not row.get("speaker_id"):
        add("no_speaker_id", "review",
            "row carries no speaker_id — a speaker-disjoint split cannot be verified")

    # --- register (informational, drives the recording plan, never rejects) ---
    lo, hi = th["course_band_s"]
    band = "unknown"
    if dur:
        band = "short" if dur < lo else "course" if dur <= hi else "long_form"
        if band == "long_form":
            add("register_long_form", "info",
                f"{dur:.1f}s broadcast-length utterance; the course teaches {lo:g}-{hi:g}s phrases")

    severities = {i["severity"] for i in issues}
    bucket = "reject" if "reject" in severities else "review" if "review" in severities else "clean"

    out = dict(row)
    out["qa"] = {
        "bucket": bucket,
        "issues": issues,
        "audio": probe,
        "text_stats": {
            "chars": len(text),
            "fidel_ratio": round(N.amharic_ratio(text), 4),
            "ejectives": N.count_ejectives(text),
            "normalized_for_training": N.prepare_for_training(text) if text.strip() else "",
        },
        "duration_band": band,
        "alignment": align,
    }
    return out


# --------------------------------------------------------------------------
# main
# --------------------------------------------------------------------------


def load_manifest(path: Path) -> list[dict]:
    rows = []
    for n, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        line = line.strip()
        if not line:
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError as exc:
            rows.append({"id": f"{path.name}:{n}", "_parse_error": str(exc)})
            continue
        row["_source_manifest"] = path.name
        rows.append(row)
    return rows


def main() -> int:
    p = argparse.ArgumentParser(description="AmharicAI dataset QA gate")
    p.add_argument("--manifest", action="append", required=True, type=Path)
    p.add_argument("--audio-dir", action="append", required=True, type=Path)
    p.add_argument("--config", type=Path, required=True)
    p.add_argument("--out-dir", type=Path, default=Path("tts/qa/out"))
    p.add_argument("--align", action="store_true",
                   help="transcribe every clip and score audio↔text alignment")
    p.add_argument("--cer-review", type=float, default=DEFAULTS["cer_review"])
    p.add_argument("--cer-reject", type=float, default=DEFAULTS["cer_reject"])
    p.add_argument("--min-duration", type=float, default=DEFAULTS["min_duration_s"])
    p.add_argument("--max-duration", type=float, default=DEFAULTS["max_duration_s"])
    args = p.parse_args()

    th = dict(DEFAULTS)
    th.update({
        "cer_review": args.cer_review,
        "cer_reject": args.cer_reject,
        "min_duration_s": args.min_duration,
        "max_duration_s": args.max_duration,
    })

    cfg = json.loads(args.config.read_text(encoding="utf-8"))
    args.out_dir.mkdir(parents=True, exist_ok=True)

    # index every audio file by its recovered stem
    audio_index: dict[str, Path] = {}
    for d in args.audio_dir:
        for f in sorted(d.glob("*.wav")):
            audio_index.setdefault(original_stem(f), f)

    rows: list[dict] = []
    for m in args.manifest:
        rows.extend(load_manifest(m))

    # de-duplicate on id, keeping the first sighting but recording the collision
    seen: dict[str, dict] = {}
    duplicates: list[str] = []
    for r in rows:
        rid = str(r.get("id") or r.get("audio_path") or len(seen))
        if rid in seen:
            duplicates.append(rid)
            continue
        seen[rid] = r

    cache_path = args.out_dir / "asr_cache.json"
    cache: dict[str, str] = {}
    if cache_path.exists():
        cache = json.loads(cache_path.read_text(encoding="utf-8"))

    results: list[dict] = []
    used_stems: set[str] = set()
    for r in seen.values():
        stem = original_stem(r.get("audio_path", "")) if r.get("audio_path") else ""
        audio = audio_index.get(stem)
        if audio:
            used_stems.add(stem)
        hyp = transcribe(audio, cache) if (args.align and audio and audio.exists()) else None
        results.append(qa_row(r, audio, cfg, th, hyp))

    if args.align:
        cache_path.write_text(json.dumps(cache, ensure_ascii=False, indent=2), encoding="utf-8")

    orphan_audio = sorted(set(audio_index) - used_stems)

    buckets = {"clean": [], "review": [], "reject": []}
    for r in results:
        buckets[r["qa"]["bucket"]].append(r)

    for name, key in (("clean_manifest.jsonl", "clean"),
                      ("review_manifest.jsonl", "review"),
                      ("reject_manifest.jsonl", "reject")):
        with (args.out_dir / name).open("w", encoding="utf-8") as fh:
            for r in buckets[key]:
                fh.write(json.dumps(r, ensure_ascii=False) + "\n")

    # ---- corpus-level facts ----
    durations = [r["qa"]["audio"].get("duration", 0.0) for r in results if r["qa"]["audio"]]
    total_s = sum(durations)
    speakers = {r.get("speaker_id") for r in results if r.get("speaker_id")}
    issue_counts = Counter(i["code"] for r in results for i in r["qa"]["issues"])
    bands = Counter(r["qa"]["duration_band"] for r in results)
    cers = [r["qa"]["alignment"]["cer"] for r in results if r["qa"].get("alignment")]

    # The gate. Speaker labels are not a nicety: the README requires a
    # speaker-disjoint split, and without speaker_id that requirement cannot be
    # satisfied or even checked. It fails loudly here rather than silently in
    # training.
    blockers: list[str] = []
    if not speakers:
        blockers.append(
            "no speaker_id on any row — the speaker-disjoint split the training "
            "README requires cannot be produced or verified"
        )
    if not buckets["clean"]:
        blockers.append("clean bucket is empty — nothing is trainable")
    if orphan_audio:
        blockers.append(f"{len(orphan_audio)} audio file(s) have no manifest row: {orphan_audio}")
    if duplicates:
        blockers.append(f"{len(duplicates)} duplicate id(s): {duplicates[:10]}")

    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "config": str(args.config),
        "manifests": [str(m) for m in args.manifest],
        "audio_dirs": [str(d) for d in args.audio_dir],
        "thresholds": {k: v for k, v in th.items()},
        "alignment_enabled": args.align,
        "totals": {
            "rows": len(results),
            "audio_files_found": len(audio_index),
            "orphan_audio": orphan_audio,
            "duplicate_ids": duplicates,
            "audio_seconds": round(total_s, 3),
            "audio_hours": round(total_s / 3600, 5),
        },
        "buckets": {k: len(v) for k, v in buckets.items()},
        "duration_bands": dict(bands),
        "issue_counts": dict(issue_counts.most_common()),
        "speakers": {
            "distinct": len(speakers),
            "ids": sorted(speakers),
            "rows_without_speaker_id": sum(1 for r in results if not r.get("speaker_id")),
        },
        "alignment": {
            "scored": len(cers),
            "mean_cer": round(sum(cers) / len(cers), 4) if cers else None,
            "max_cer": max(cers) if cers else None,
        },
        "gate": {
            "passed": not blockers,
            "blockers": blockers,
        },
        "outputs": {
            "clean": str(args.out_dir / "clean_manifest.jsonl"),
            "review": str(args.out_dir / "review_manifest.jsonl"),
            "reject": str(args.out_dir / "reject_manifest.jsonl"),
        },
    }
    (args.out_dir / "qa_report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    # ---- human summary ----
    print(f"rows {len(results)}   audio {len(audio_index)} files   "
          f"{total_s:.2f}s ({total_s/3600:.4f} h)")
    print(f"buckets  clean {len(buckets['clean'])}   review {len(buckets['review'])}   "
          f"reject {len(buckets['reject'])}")
    print(f"bands    {dict(bands)}")
    if cers:
        print(f"align    mean CER {sum(cers)/len(cers):.1%}   max {max(cers):.1%}   n={len(cers)}")
    print(f"speakers {len(speakers)} distinct, "
          f"{report['speakers']['rows_without_speaker_id']} rows unlabelled")
    if issue_counts:
        print("issues   " + ", ".join(f"{c}×{n}" for c, n in issue_counts.most_common()))
    print()
    if blockers:
        print("GATE: FAILED — do not train.")
        for b in blockers:
            print(f"  · {b}")
    else:
        print("GATE: PASSED — clean_manifest.jsonl is safe to split and tokenize.")
    print(f"\nwrote {args.out_dir}/{{clean,review,reject}}_manifest.jsonl and qa_report.json")
    return 0 if not blockers else 1


if __name__ == "__main__":
    raise SystemExit(main())
