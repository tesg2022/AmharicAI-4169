r"""
Step 2 of training — tokenize the speaker-disjoint splits.

Text is normalized with `tts/qa/normalize_am.py`, the same rules the app applies
at inference (held byte-for-byte by `tts/qa/test_parity.py`). That is the whole
point: digits become Amharic words *before* the tokenizer sees them, so the
model never learns a mapping from "947" that inference will never send it.

Audio is tokenized at the base model's 25 Hz frame rate and every sample is
re-checked against `training_config.training.{min,max}_sample_tokens` — QA
estimated the count from duration, this measures it.

UNRUN IN THIS SANDBOX. There is no GPU here and the base model is not
downloaded. This is the script to run on the GPU box; its behaviour is
unverified beyond the text path, which the parity test does cover.

Run:
    python3 tts/training/tokenize_dataset.py \
        --data-dir tts/training/data \
        --config tts/training/training_config.json \
        --out-dir tts/training/tokenized
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "qa"))

import normalize_am as N  # noqa: E402


def load_audio_tokenizer(cfg: dict):
    """Import lazily so `--dry-run` works on a machine with no torch."""
    from boson_multimodal.audio_processing.higgs_audio_tokenizer import (  # type: ignore
        load_higgs_audio_tokenizer,
    )

    return load_higgs_audio_tokenizer(
        cfg.get("audio_tokenizer", "bosonai/higgs-audio-v2-tokenizer"),
        device=cfg.get("device", "cuda"),
    )


def main() -> int:
    p = argparse.ArgumentParser(description="Tokenize splits for LoRA training")
    p.add_argument("--data-dir", type=Path, default=Path("tts/training/data"))
    p.add_argument("--config", type=Path, required=True)
    p.add_argument("--out-dir", type=Path, default=Path("tts/training/tokenized"))
    p.add_argument("--dry-run", action="store_true",
                   help="normalize text and report token budgets without loading the model")
    args = p.parse_args()

    cfg = json.loads(args.config.read_text(encoding="utf-8"))
    tr = cfg.get("training", {})
    min_tok = int(tr.get("min_sample_tokens", 50))
    max_tok = int(tr.get("max_sample_tokens", 2000))
    want_sr = int(cfg.get("audio", {}).get("sample_rate", 24000))
    rate_hz = 25.0

    splits = ["train", "dev", "test"]
    missing = [s for s in splits if not (args.data_dir / f"{s}.jsonl").exists()]
    if missing:
        print(f"REFUSING TO RUN: missing split(s) {missing} in {args.data_dir}.")
        print("Run tts/training/prepare_split.py first.")
        return 2

    tokenizer = None if args.dry_run else load_audio_tokenizer(cfg)
    args.out_dir.mkdir(parents=True, exist_ok=True)
    summary: dict[str, dict] = {}

    for split in splits:
        rows = [
            json.loads(l)
            for l in (args.data_dir / f"{split}.jsonl").read_text(encoding="utf-8").splitlines()
            if l.strip()
        ]
        kept, dropped = [], []
        for r in rows:
            text = r.get("text", "")
            # The single most important line in this file: training text and
            # inference text go through identical normalization.
            normalized = N.prepare_for_training(text)

            duration = float(r.get("audio_duration") or 0.0)
            n_tokens = int(round(duration * rate_hz))
            audio_tokens = None

            if tokenizer is not None:
                audio_tokens = tokenizer.encode(r["audio_path"], sr=want_sr)
                n_tokens = int(getattr(audio_tokens, "shape", [0, len(audio_tokens)])[-1])

            if n_tokens < min_tok or n_tokens > max_tok:
                dropped.append({**r, "num_tokens": n_tokens,
                                "reason": f"tokens {n_tokens} outside [{min_tok}, {max_tok}]"})
                continue

            kept.append({
                "id": r.get("id"),
                "speaker_id": r.get("speaker_id"),
                "audio_path": r.get("audio_path"),
                "language_id": r.get("language_id", "am"),
                "text_raw": text,
                "text": normalized,
                "num_tokens": n_tokens,
                "audio_duration": duration,
                "audio_tokens": (audio_tokens.tolist() if hasattr(audio_tokens, "tolist")
                                 else audio_tokens),
            })

        out = args.out_dir / f"{split}.jsonl"
        with out.open("w", encoding="utf-8") as fh:
            for r in kept:
                fh.write(json.dumps(r, ensure_ascii=False) + "\n")
        # Dropped rows are written, never discarded — same rule as QA.
        if dropped:
            with (args.out_dir / f"{split}.dropped.jsonl").open("w", encoding="utf-8") as fh:
                for r in dropped:
                    fh.write(json.dumps(r, ensure_ascii=False) + "\n")

        rewritten = sum(1 for r in kept if r["text"] != r["text_raw"])
        summary[split] = {
            "rows_in": len(rows),
            "kept": len(kept),
            "dropped": len(dropped),
            "text_rewritten_by_normalization": rewritten,
            "tokens_total": sum(r["num_tokens"] for r in kept),
            "hours": round(sum(r["audio_duration"] for r in kept) / 3600, 4),
        }
        print(f"{split:5s} kept {len(kept):6d}  dropped {len(dropped):4d}  "
              f"normalized-rewrites {rewritten:4d}  {summary[split]['hours']:.3f} h")

    summary["_meta"] = {
        "dry_run": args.dry_run,
        "sample_rate": want_sr,
        "token_rate_hz": rate_hz,
        "token_budget": [min_tok, max_tok],
        "normalizer": "tts/qa/normalize_am.py (parity-tested against the app pipeline)",
    }
    (args.out_dir / "tokenize_report.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    if args.dry_run:
        print("\nDRY RUN — token counts are estimates from duration at 25 Hz, "
              "not measured by the audio tokenizer.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
