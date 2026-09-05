r"""
Host-agnostic inference server for the AmharicAI native voice.

One HTTP contract, three deployment shapes — Hugging Face Inference Endpoints
(via `handler.py`), a plain container, or a laptop. The app's provider adapter
(`packages/web/src/api/speech/providers/amharicai.ts`) speaks exactly this and
nothing else, so moving hosts is an env var change, not a code change.

Contract
--------
POST /            (and /synthesize, /generate, /api/v1/tts — aliases for host
                   conventions; /api/v1/tts is what the Nuxt app posts to)
    { "inputs": "<amharic text>",              # HF convention
      "text":   "<amharic text>",              # plain-container convention
      "parameters": { "voice", "language", "speed", "format", "sample_rate" } }

    → 200 audio/wav bytes, or with Accept: application/json
      { "audio": "<base64>", "mime_type": "audio/wav",
        "normalized": "...", "voice": "...", "duration_ms": 1234 }

GET /health → { "ok": true, "model_loaded": bool, "adapter": str|null, ... }

Text normalization
------------------
The server normalizes with `tts/qa/normalize_am.py` — the same rules the app
applies before it ever calls out, and the same rules the training data went
through. Normalizing twice is harmless (the pipeline is idempotent); normalizing
*differently* on either side is the bug this guards against.

UNRUN IN THIS SANDBOX. There is no GPU here and no adapter weights exist yet, so
model loading and synthesis are untested. The HTTP contract, the normalization
path and the health endpoint are the parts worth reviewing.

Run:
    pip install -r tts/serving/requirements.txt
    AMHARICAI_ADAPTER=/path/to/adapter uvicorn tts.serving.server:app --port 8000
"""

from __future__ import annotations

import base64
import io
import os
import sys
import wave
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "qa"))

import normalize_am as N  # noqa: E402

BASE_MODEL = os.environ.get("AMHARICAI_BASE_MODEL", "african-low-resource/omnivoice-amharic")
ADAPTER = os.environ.get("AMHARICAI_ADAPTER")  # None → base model, no fine-tune
DEVICE = os.environ.get("AMHARICAI_DEVICE", "cuda")
SAMPLE_RATE = int(os.environ.get("AMHARICAI_SAMPLE_RATE", "24000"))
DEFAULT_VOICE = os.environ.get("AMHARICAI_VOICE", "amharicai-native-f")

# Off by default, and loud when on. This synthesizes an obviously-synthetic
# placeholder tone so the full HTTP chain (app → /api/tts → this server →
# playable audio) can be exercised without a GPU or adapter weights. It is NOT
# speech and must never be mistakable for the trained native voice: serving
# something unannounced is worse than failing honestly.
DEV_VOICE = os.environ.get("AMHARICAI_DEV_VOICE", "").strip().lower() in {"1", "true", "yes", "on"}

app = FastAPI(title="AmharicAI native voice")

_model: Any = None
_load_error: str | None = None


def load_model() -> Any:
    """Lazy, and failures are remembered rather than raised on every request —
    a dead endpoint should report *why* on /health, not just 500."""
    global _model, _load_error
    if _model is not None or _load_error is not None:
        return _model
    try:
        import torch  # type: ignore
        from transformers import AutoModelForCausalLM, AutoProcessor  # type: ignore

        processor = AutoProcessor.from_pretrained(BASE_MODEL, trust_remote_code=True)
        model = AutoModelForCausalLM.from_pretrained(
            BASE_MODEL,
            torch_dtype=torch.bfloat16 if DEVICE.startswith("cuda") else torch.float32,
            attn_implementation="sdpa",
            trust_remote_code=True,
        )
        if ADAPTER:
            from peft import PeftModel  # type: ignore

            model = PeftModel.from_pretrained(model, ADAPTER)
        model = model.to(DEVICE).eval()
        _model = {"model": model, "processor": processor}
    except Exception as exc:  # noqa: BLE001
        _load_error = f"{type(exc).__name__}: {exc}"
    return _model


def to_wav(samples, sample_rate: int) -> bytes:
    """Float32 [-1, 1] → 16-bit PCM WAV, matching training_config.audio."""
    import numpy as np  # type: ignore

    pcm = np.clip(np.asarray(samples, dtype="float32"), -1.0, 1.0)
    pcm = (pcm * 32767.0).astype("<i2")
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sample_rate)
        w.writeframes(pcm.tobytes())
    return buf.getvalue()


def dev_voice_wav(text: str, speed: float, sample_rate: int) -> bytes:
    """An obviously-synthetic placeholder: one short beep per token, pitched by
    character. Deliberately does not resemble speech — its only job is to prove
    that bytes travel end to end. Never enabled unless AMHARICAI_DEV_VOICE=1."""
    import math

    tokens = [t for t in text.split() if t] or ["x"]
    tokens = tokens[:24]
    samples: list[float] = []
    per = max(0.08, min(0.22, 0.16 / max(speed, 0.1)))
    for tok in tokens:
        freq = 220.0 + (sum(ord(c) for c in tok) % 12) * 40.0
        n = int(per * sample_rate)
        for i in range(n):
            # short fade in/out so the beeps do not click
            env = min(1.0, i / 240.0, (n - i) / 240.0) * 0.25
            samples.append(env * math.sin(2 * math.pi * freq * (i / sample_rate)))
        samples.extend([0.0] * int(0.04 * sample_rate))
    return to_wav(samples, sample_rate)


def synthesize(text: str, voice: str, speed: float, sample_rate: int) -> bytes:
    if DEV_VOICE:
        return dev_voice_wav(text, speed, sample_rate)
    bundle = load_model()
    if bundle is None:
        raise RuntimeError(_load_error or "model not loaded")
    import torch  # type: ignore

    processor, model = bundle["processor"], bundle["model"]
    inputs = processor(text=text, voice=voice, language="am", return_tensors="pt").to(DEVICE)
    with torch.inference_mode():
        audio = model.generate(**inputs, speed=speed)
    waveform = audio[0].detach().float().cpu().numpy().squeeze()
    return to_wav(waveform, sample_rate)


@app.get("/health")
def health() -> dict:
    loaded = False if DEV_VOICE else (load_model() is not None)
    return {
        "ok": True,
        "model_loaded": loaded,
        "load_error": _load_error,
        "base_model": BASE_MODEL,
        "adapter": ADAPTER,
        # Honest by default: with no adapter this is the *base* model, not the
        # native voice the course was recorded for.
        "is_finetuned": bool(ADAPTER) and not DEV_VOICE,
        # Loud on purpose. If this is true the audio is placeholder beeps, not
        # Amharic speech, and nothing downstream should treat it as a voice.
        "dev_voice": DEV_VOICE,
        "synthetic": DEV_VOICE,
        "warning": (
            "AMHARICAI_DEV_VOICE is on: responses are synthetic placeholder tones, not speech."
            if DEV_VOICE
            else None
        ),
        "sample_rate": SAMPLE_RATE,
        "default_voice": DEFAULT_VOICE,
        "device": DEVICE,
    }


@app.post("/")
@app.post("/synthesize")
@app.post("/generate")
@app.post("/api/v1/tts")
async def handle(request: Request) -> Response:
    body = await request.json()
    params = body.get("parameters") or {}
    raw = body.get("inputs") or body.get("text") or ""
    if not isinstance(raw, str) or not raw.strip():
        return JSONResponse({"error": "empty input"}, status_code=400)

    normalized = N.prepare_for_training(raw)
    voice = params.get("voice") or DEFAULT_VOICE
    speed = float(params.get("speed") or 1.0)
    sample_rate = int(params.get("sample_rate") or SAMPLE_RATE)

    try:
        wav = synthesize(normalized, voice, speed, sample_rate)
    except Exception as exc:  # noqa: BLE001
        return JSONResponse({"error": f"{type(exc).__name__}: {exc}"}, status_code=503)

    duration_ms = int(len(wav) / 2 / sample_rate * 1000)
    if "application/json" in (request.headers.get("accept") or ""):
        return JSONResponse({
            "audio": base64.b64encode(wav).decode("ascii"),
            "mime_type": "audio/wav",
            "normalized": normalized,
            "voice": voice,
            "duration_ms": duration_ms,
            "is_finetuned": bool(ADAPTER) and not DEV_VOICE,
            "synthetic": DEV_VOICE,
        })
    headers = {"x-amharicai-voice": voice, "x-amharicai-duration-ms": str(duration_ms)}
    if DEV_VOICE:
        headers["x-amharicai-synthetic"] = "true"
    return Response(content=wav, media_type="audio/wav", headers=headers)
