r"""
Step 4 — evaluate the trained voice on the held-out, speaker-disjoint test split.

Deliberately not a loss number. Loss says the model predicts its own training
distribution; it says nothing about whether an Amharic learner hears the right
sound. So this harness measures the three things that actually decide whether
the voice is usable in the course:

  1. Intelligibility — synthesize the test text, transcribe it back, score
     character error rate against the reference. Homophone-folded, because
     ሀ/ሃ-series spelling variance in ASR output is a spelling choice, not a
     pronunciation error.
  2. Ejective preservation — Amharic's ጠ ቀ ጰ ጸ ጨ are the sounds an
     English-phonetic rendering destroys, and the first thing a thin fine-tune
     smears into plain stops. Scored separately from overall CER, because an
     overall number hides it.
  3. Duration sanity — synthesized length against reference length. A model
     that has collapsed produces clips that are far too short.

It also emits a listening pack: the raw wavs plus a CSV, for native speakers to
rate. No automatic metric replaces that, and the model stays marked `preview`
in the app until it exists.

UNRUN IN THIS SANDBOX — synthesis needs the trained adapter and a GPU. The
scoring functions themselves are the same parity-tested code the QA gate uses.

Run:
    python3 tts/training/evaluate.py \
        --test tts/training/data/test.jsonl \
        --endpoint http://localhost:8000 \
        --out-dir tts/training/runs/lora-01/eval
"""

from __future__ import annotations

import argparse
import base64
import csv
import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "qa"))

import normalize_am as N  # noqa: E402
from dataset_qa import cer, ffprobe  # noqa: E402


def synthesize(endpoint: str, text: str, voice: str, token: str | None, out: Path) -> bool:
    """Call the same HTTP contract the app's `amharicai` provider uses — if eval
    and production disagree about the contract, eval is measuring nothing."""
    import urllib.error
    import urllib.request

    body = json.dumps({
        "inputs": text,
        "text": text,
        "parameters": {"voice": voice, "language": "am", "speed": 1.0,
                       "format": "wav", "sample_rate": 24000},
    }).encode("utf-8")
    req = urllib.request.Request(endpoint, data=body, method="POST",
                                 headers={"Content-Type": "application/json"})
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            payload = resp.read()
            if (resp.headers.get("content-type") or "").startswith("application/json"):
                data = json.loads(payload)
                b64 = data.get("audio") or data.get("audio_base64")
                if not b64:
                    return False
                payload = base64.b64decode(b64)
            out.write_bytes(payload)
            return True
    except urllib.error.URLError as exc:
        print(f"  synthesis failed: {exc}")
        return False


def ejective_recall(reference: str, hypothesis: str) -> float | None:
    """Share of the reference's ejectives that survive into the transcription."""
    ref = [c for c in N.fold_homophones(reference) if N.is_ejective(c)]
    if not ref:
        return None
    hyp = [c for c in N.fold_homophones(hypothesis) if N.is_ejective(c)]
    from collections import Counter

    have, want = Counter(hyp), Counter(ref)
    matched = sum(min(want[c], have[c]) for c in want)
    return matched / len(ref)


def main() -> int:
    p = argparse.ArgumentParser(description="Evaluate the AmharicAI native voice")
    p.add_argument("--test", type=Path, default=Path("tts/training/data/test.jsonl"))
    p.add_argument("--endpoint", required=True)
    p.add_argument("--token", default=None)
    p.add_argument("--voice", default="amharicai-native-f")
    p.add_argument("--out-dir", type=Path, required=True)
    p.add_argument("--limit", type=int, default=100)
    args = p.parse_args()

    if not args.test.exists():
        print(f"REFUSING TO RUN: {args.test} missing. Run prepare_split.py first.")
        return 2

    rows = [json.loads(l) for l in args.test.read_text(encoding="utf-8").splitlines() if l.strip()]
    rows = rows[: args.limit]
    if not rows:
        print("REFUSING TO RUN: test split is empty — there is nothing held out to measure.")
        return 2

    clips = args.out_dir / "clips"
    clips.mkdir(parents=True, exist_ok=True)
    results = []

    for i, row in enumerate(rows, 1):
        text = N.prepare_for_training(row.get("text", ""))
        wav = clips / f"{row.get('id', i)}.wav"
        print(f"[{i}/{len(rows)}] {row.get('id')}")
        if not synthesize(args.endpoint, text, args.voice, args.token, wav):
            results.append({"id": row.get("id"), "ok": False})
            continue

        probe = ffprobe(wav)
        asr = subprocess.run(["transcribe", str(wav)], capture_output=True, text=True, check=False)
        hyp = asr.stdout.strip() if asr.returncode == 0 else ""
        ref_dur = float(row.get("audio_duration") or 0.0)
        got_dur = float(probe.get("duration") or 0.0)

        results.append({
            "id": row.get("id"),
            "ok": True,
            "text": text,
            "asr_text": hyp,
            "cer": round(cer(text, hyp), 4) if hyp else None,
            "ejective_recall": ejective_recall(text, hyp) if hyp else None,
            "ref_duration": ref_dur,
            "gen_duration": round(got_dur, 3),
            "duration_ratio": round(got_dur / ref_dur, 3) if ref_dur else None,
            "clip": str(wav),
        })

    scored = [r for r in results if r.get("cer") is not None]
    ej = [r["ejective_recall"] for r in results if r.get("ejective_recall") is not None]
    ratios = [r["duration_ratio"] for r in results if r.get("duration_ratio")]

    report = {
        "test_manifest": str(args.test),
        "endpoint": args.endpoint,
        "voice": args.voice,
        "rows": len(rows),
        "synthesized": sum(1 for r in results if r["ok"]),
        "intelligibility": {
            "scored": len(scored),
            "mean_cer": round(sum(r["cer"] for r in scored) / len(scored), 4) if scored else None,
            "worst_cer": max((r["cer"] for r in scored), default=None),
        },
        "ejective_recall": {
            "scored": len(ej),
            "mean": round(sum(ej) / len(ej), 4) if ej else None,
        },
        "duration_ratio": {
            "mean": round(sum(ratios) / len(ratios), 3) if ratios else None,
        },
        "caveat": "Automatic metrics only. The voice stays marked preview in the app until "
                  "native speakers have rated the listening pack below.",
        "listening_pack": str(args.out_dir / "listening_pack.csv"),
    }

    (args.out_dir / "eval_report.json").write_text(
        json.dumps({"summary": report, "rows": results}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    with (args.out_dir / "listening_pack.csv").open("w", encoding="utf-8", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["id", "clip", "text", "rating_1_5", "sounds_native_y_n", "notes"])
        for r in results:
            if r.get("ok"):
                w.writerow([r["id"], r["clip"], r["text"], "", "", ""])

    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
