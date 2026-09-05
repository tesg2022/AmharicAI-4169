r"""
Step 3 of training — LoRA fine-tune over `african-low-resource/omnivoice-amharic`.

Hyperparameters come from `training_config.json` and are not second-guessed
here: lr 1e-05, LoRA on, sdpa attention, 8192 batch tokens, max batch size 16,
20-step smoke test, 1000-step validation interval.

Two hard refusals, both deliberate:
  1. No `clean_manifest.jsonl` → no run. QA owns what is trainable.
  2. No `speaker_id` on the splits → no run. See prepare_split.py.

And one soft guard: a smoke run of `smoke_test_steps` happens first, always.
A 20-step run that crashes costs a minute; discovering the same crash 6 hours
into a real run costs a day.

UNRUN IN THIS SANDBOX — there is no GPU here. Nothing in this file has been
executed. Treat it as a reviewed starting point for the GPU box, not as a
verified script.

Run:
    python3 tts/training/train_lora.py \
        --tokenized tts/training/tokenized \
        --config tts/training/training_config.json \
        --out-dir tts/training/runs/lora-01 \
        --smoke        # then re-run without --smoke
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path


def require(condition: bool, message: str) -> None:
    if not condition:
        print(f"REFUSING TO RUN: {message}")
        raise SystemExit(2)


def build_model(cfg: dict, args):
    """Imported lazily so the guards above run on a CPU-only machine."""
    import torch  # type: ignore
    from peft import LoraConfig, get_peft_model  # type: ignore
    from transformers import AutoModelForCausalLM, AutoTokenizer  # type: ignore

    base = cfg["base_model"]
    tok = AutoTokenizer.from_pretrained(base, trust_remote_code=True)
    model = AutoModelForCausalLM.from_pretrained(
        base,
        torch_dtype=torch.bfloat16,
        attn_implementation=cfg["training"].get("attention_implementation", "sdpa"),
        trust_remote_code=True,
    )

    if cfg["training"].get("use_lora", True):
        model = get_peft_model(
            model,
            LoraConfig(
                r=args.lora_r,
                lora_alpha=args.lora_alpha,
                lora_dropout=args.lora_dropout,
                bias="none",
                task_type="CAUSAL_LM",
                target_modules=args.target_modules.split(","),
            ),
        )
        model.print_trainable_parameters()
    return model, tok


def main() -> int:
    p = argparse.ArgumentParser(description="LoRA fine-tune for the AmharicAI native voice")
    p.add_argument("--tokenized", type=Path, default=Path("tts/training/tokenized"))
    p.add_argument("--clean", type=Path, default=Path("tts/qa/out/clean_manifest.jsonl"))
    p.add_argument("--config", type=Path, required=True)
    p.add_argument("--out-dir", type=Path, required=True)
    p.add_argument("--smoke", action="store_true", help="run only smoke_test_steps and stop")
    p.add_argument("--max-steps", type=int, default=None)
    p.add_argument("--lora-r", type=int, default=16)
    p.add_argument("--lora-alpha", type=int, default=32)
    p.add_argument("--lora-dropout", type=float, default=0.05)
    p.add_argument("--target-modules", default="q_proj,k_proj,v_proj,o_proj")
    p.add_argument("--plan-only", action="store_true",
                   help="print the resolved plan and exit without loading torch")
    args = p.parse_args()

    cfg = json.loads(args.config.read_text(encoding="utf-8"))
    tr = cfg["training"]

    # ---- the gate ----
    require(args.clean.exists(),
            f"{args.clean} missing. Run tts/qa/dataset_qa.py — training consumes the clean bucket only.")
    require(args.clean.stat().st_size > 0, "clean manifest is empty. Nothing is trainable.")

    for split in ("train", "dev"):
        require((args.tokenized / f"{split}.jsonl").exists(),
                f"{args.tokenized}/{split}.jsonl missing. Run tokenize_dataset.py first.")

    train_rows = [
        json.loads(l)
        for l in (args.tokenized / "train.jsonl").read_text(encoding="utf-8").splitlines()
        if l.strip()
    ]
    require(bool(train_rows), "tokenized train split is empty.")
    require(all(r.get("speaker_id") for r in train_rows),
            "tokenized rows lack speaker_id — the speaker-disjoint guarantee cannot hold.")

    steps = args.max_steps or (int(tr["smoke_test_steps"]) if args.smoke else None)
    plan = {
        "base_model": cfg["base_model"],
        "use_lora": tr.get("use_lora", True),
        "lora": {"r": args.lora_r, "alpha": args.lora_alpha, "dropout": args.lora_dropout,
                 "target_modules": args.target_modules.split(",")},
        "learning_rate": tr["learning_rate"],
        "attention": tr.get("attention_implementation", "sdpa"),
        "batch_tokens": tr["batch_tokens"],
        "max_batch_size": tr["max_batch_size"],
        "validation_steps": tr["validation_steps"],
        "max_steps": steps,
        "smoke": args.smoke,
        "train_rows": len(train_rows),
        "train_hours": round(sum(float(r.get("audio_duration") or 0) for r in train_rows) / 3600, 4),
        "speakers": len({r["speaker_id"] for r in train_rows}),
        "sample_rate": cfg["audio"]["sample_rate"],
        "out_dir": str(args.out_dir),
        "resolved_at": datetime.now(timezone.utc).isoformat(),
    }

    args.out_dir.mkdir(parents=True, exist_ok=True)
    (args.out_dir / "run_plan.json").write_text(
        json.dumps(plan, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(plan, ensure_ascii=False, indent=2))

    # A corpus this thin does not produce a usable voice, and saying so before
    # burning GPU hours is cheaper than saying it after.
    if plan["train_hours"] < 1.0:
        print(f"\nWARNING: {plan['train_hours']:.3f} h of training audio. A LoRA over a "
              "low-resource base typically needs several hours of clean speech per target "
              "voice before it stops sounding like the base model.")
    if plan["speakers"] < 2:
        print("WARNING: a single training speaker. The model will not generalize to a second voice.")

    if args.plan_only:
        print("\n--plan-only: stopping before torch import.")
        return 0

    if not os.environ.get("CUDA_VISIBLE_DEVICES") and not Path("/proc/driver/nvidia").exists():
        print("\nNo NVIDIA driver visible. Run this on the GPU box; the plan above is written "
              f"to {args.out_dir}/run_plan.json.")
        return 3

    import torch  # type: ignore
    from transformers import Trainer, TrainingArguments  # type: ignore

    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from dataset import TokenizedSpeechDataset, collate_batch  # type: ignore  # noqa: F401

    model, tok = build_model(cfg, args)
    train_ds = TokenizedSpeechDataset(args.tokenized / "train.jsonl", tok)
    dev_ds = TokenizedSpeechDataset(args.tokenized / "dev.jsonl", tok)

    targs = TrainingArguments(
        output_dir=str(args.out_dir),
        learning_rate=float(tr["learning_rate"]),
        per_device_train_batch_size=int(tr["max_batch_size"]),
        max_steps=steps if steps else -1,
        eval_strategy="steps",
        eval_steps=int(tr["validation_steps"]),
        save_steps=int(tr["validation_steps"]),
        logging_steps=10,
        bf16=torch.cuda.is_available(),
        report_to=[],
    )

    trainer = Trainer(model=model, args=targs, train_dataset=train_ds,
                      eval_dataset=dev_ds, data_collator=collate_batch)
    trainer.train()

    # LoRA only — the adapter is what gets shipped to the inference endpoint.
    model.save_pretrained(args.out_dir / "adapter")
    tok.save_pretrained(args.out_dir / "adapter")
    print(f"\nwrote adapter to {args.out_dir}/adapter "
          "(adapter_config.json + adapter_model.safetensors)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
