r"""
Hugging Face Inference Endpoints entry point.

HF calls `EndpointHandler.__call__(data)` directly — no HTTP server of its own.
This is a thin shim over the exact same normalization and synthesis code path as
`server.py`, so the two hosts cannot drift apart: one contract, one normalizer,
one place where audio is produced.

Deploy: put this file, `requirements.txt` and the trained `adapter/` at the repo
root of the HF model repo, then point `AMHARICAI_TTS_URL` at the endpoint URL.

UNRUN IN THIS SANDBOX — no GPU, no adapter weights.
"""

from __future__ import annotations

import base64
import os
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "qa"))

import normalize_am as N  # noqa: E402


class EndpointHandler:
    def __init__(self, path: str = ""):
        # HF hands the repo checkout in `path`; the adapter is expected beside
        # this file unless AMHARICAI_ADAPTER overrides it.
        adapter = os.environ.get("AMHARICAI_ADAPTER") or str(Path(path or ".") / "adapter")
        if not Path(adapter, "adapter_config.json").exists():
            # Serving the base model unannounced would be worse than failing:
            # the app would report a "native voice" that was never fine-tuned.
            adapter = None
        os.environ.setdefault("AMHARICAI_ADAPTER", adapter or "")
        os.environ.setdefault("AMHARICAI_DEVICE", "cuda")

        import server  # noqa: PLC0415  — imported after env is set

        self._server = server
        self.adapter = adapter

    def __call__(self, data: dict[str, Any]) -> dict[str, Any]:
        params = data.get("parameters") or {}
        raw = data.get("inputs") or data.get("text") or ""
        if not isinstance(raw, str) or not raw.strip():
            return {"error": "empty input"}

        normalized = N.prepare_for_training(raw)
        sample_rate = int(params.get("sample_rate") or self._server.SAMPLE_RATE)
        voice = params.get("voice") or self._server.DEFAULT_VOICE
        speed = float(params.get("speed") or 1.0)

        try:
            wav = self._server.synthesize(normalized, voice, speed, sample_rate)
        except Exception as exc:  # noqa: BLE001
            return {"error": f"{type(exc).__name__}: {exc}"}

        return {
            "audio": base64.b64encode(wav).decode("ascii"),
            "mime_type": "audio/wav",
            "normalized": normalized,
            "voice": voice,
            "is_finetuned": bool(self.adapter),
            "duration_ms": int(len(wav) / 2 / sample_rate * 1000),
        }
