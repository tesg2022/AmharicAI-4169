r"""
Dataset and collator for the LoRA run.

Batching is by *token budget*, not by row count. `training_config.batch_tokens`
is 8192 with `max_batch_size` 16, and utterance lengths in this corpus vary by
an order of magnitude (1s course phrases next to 20s news reads). Fixed-size
batches would either waste most of the budget on short rows or OOM on long ones.

UNRUN IN THIS SANDBOX (no GPU, base model not downloaded).
"""

from __future__ import annotations

import json
from pathlib import Path

try:  # torch is absent on CPU-only machines; the module still imports for tooling
    import torch
    from torch.utils.data import Dataset
except ImportError:  # pragma: no cover
    torch = None  # type: ignore

    class Dataset:  # type: ignore
        pass


class TokenizedSpeechDataset(Dataset):
    """Rows written by `tokenize_dataset.py`.

    `text` is already normalized by `tts/qa/normalize_am.py` — do not normalize
    again here, and never fall back to `text_raw`, which still contains raw
    digits. `text_raw` is kept only so a human can see what changed.
    """

    def __init__(self, path: str | Path, tokenizer, max_text_tokens: int = 512):
        self.rows = [
            json.loads(line)
            for line in Path(path).read_text(encoding="utf-8").splitlines()
            if line.strip()
        ]
        self.tokenizer = tokenizer
        self.max_text_tokens = max_text_tokens

    def __len__(self) -> int:
        return len(self.rows)

    def __getitem__(self, idx: int) -> dict:
        row = self.rows[idx]
        text_ids = self.tokenizer(
            row["text"],
            truncation=True,
            max_length=self.max_text_tokens,
            return_tensors="pt",
        )["input_ids"][0]
        audio_ids = torch.tensor(row["audio_tokens"], dtype=torch.long).flatten()
        return {
            "id": row.get("id"),
            "speaker_id": row.get("speaker_id"),
            "text_ids": text_ids,
            "audio_ids": audio_ids,
            "num_tokens": int(row["num_tokens"]),
        }


def batch_by_tokens(rows: list[dict], batch_tokens: int, max_batch_size: int) -> list[list[int]]:
    """Group row indices so each batch stays inside the token budget.

    Sorted by length first, so a batch is padded against similar-length rows
    rather than against the longest utterance in the corpus.
    """
    order = sorted(range(len(rows)), key=lambda i: rows[i]["num_tokens"])
    batches: list[list[int]] = []
    current: list[int] = []
    longest = 0
    for i in order:
        n = rows[i]["num_tokens"]
        candidate_longest = max(longest, n)
        if current and (
            candidate_longest * (len(current) + 1) > batch_tokens
            or len(current) + 1 > max_batch_size
        ):
            batches.append(current)
            current, longest = [i], n
        else:
            current.append(i)
            longest = candidate_longest
    if current:
        batches.append(current)
    return batches


def collate_batch(items: list[dict]) -> dict:
    """Right-pad text and audio streams; -100 masks padding out of the loss."""
    text_len = max(len(i["text_ids"]) for i in items)
    audio_len = max(len(i["audio_ids"]) for i in items)

    def pad(seq, length, value):
        out = torch.full((length,), value, dtype=torch.long)
        out[: len(seq)] = seq
        return out

    return {
        "input_ids": torch.stack([pad(i["text_ids"], text_len, 0) for i in items]),
        "attention_mask": torch.stack([
            pad(torch.ones(len(i["text_ids"]), dtype=torch.long), text_len, 0) for i in items
        ]),
        "audio_ids": torch.stack([pad(i["audio_ids"], audio_len, -100) for i in items]),
        "labels": torch.stack([pad(i["audio_ids"], audio_len, -100) for i in items]),
    }
