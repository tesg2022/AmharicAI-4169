# AmharicAI native-speaker TTS pipeline

Tooling for training and serving AmharicAI's own Amharic voice, and for gating
the data that goes into it.

This directory sits **outside `packages/`** on purpose. It is an ML pipeline,
not app runtime — nothing here is imported by the Bun/Vite/Expo app, and the
whole folder can be lifted onto a GPU box or into Colab unchanged. The only
contract between the two sides is an HTTP one (`tts/serving/server.py` ⇄
`packages/web/src/api/speech/providers/amharicai.ts`).

---

## The gate

```
RAW DATA
   │
   ▼
  QA ──┬── CLEAN    → trainable
       ├── REVIEW   → a human decides
       └── REJECT   → kept on disk, never silently dropped
   │
   ▼ (clean only)
speaker-disjoint split → tokenization → training → evaluation → serving
```

**Nothing trains until QA emits a non-empty clean manifest.** Every downstream
script re-checks this itself rather than trusting the caller, so the gate cannot
be skipped by running a script directly. Rejected and dropped rows are always
written to disk — in QA (`reject_manifest.jsonl`) and in tokenization
(`<split>.dropped.jsonl`) — never deleted.

---

## Layout

| Path | What it does | Status |
|---|---|---|
| `qa/normalize_am.py` | Python port of the app's text normalization | **run**, 382/382 parity |
| `qa/make_parity_vectors.ts` | Emits golden vectors from the app's TypeScript | **run** |
| `qa/parity_vectors.json` | 382 golden vectors | **generated** |
| `qa/test_parity.py` | Holds the Python port to the vectors | **run, PASS** |
| `qa/dataset_qa.py` | The gate: manifest ⇄ audio, text, alignment, speakers | **run on the real data — FAILED** |
| `recording/build_recording_script.py` | Course-domain recording script from the course JSON | **run**, 426 phrases |
| `training/prepare_split.py` | Speaker-disjoint train/dev/test | written, correctly refused |
| `training/tokenize_dataset.py` | Normalize + tokenize at 25 Hz | written, correctly refused |
| `training/dataset.py` | Dataset + token-budget batching | written, imports clean |
| `training/train_lora.py` | LoRA fine-tune | written, **GPU path unrun** |
| `training/evaluate.py` | CER, ejective recall, listening pack | written, **unrun** |
| `serving/server.py` | FastAPI inference server | written, **unrun** |
| `serving/handler.py` | Hugging Face `EndpointHandler` shim | written, **unrun** |

There is no GPU in this sandbox, so anything that needs torch on a device is
written and guarded but has never executed. That is stated here rather than
implied.

---

## Why normalization is duplicated, and why that is safe

The app normalizes Amharic text before synthesis (`packages/web/src/api/speech/`).
Training must normalize it **identically**, or the model learns one input
distribution and receives another at inference. That failure is invisible in a
loss curve — it shows up as a voice that mispronounces numbers in production.

So `qa/normalize_am.py` is a port, and `qa/test_parity.py` holds it to golden
vectors generated from the TypeScript itself:

```bash
bun run tts/qa/make_parity_vectors.ts > tts/qa/parity_vectors.json
python3 tts/qa/test_parity.py          # 382/382
```

Traps that were actually hit during the port, all documented in the module
docstring: JS `\b` and `\d` are ASCII-only while Python's are Unicode (without
`re.ASCII`, `ከ947` never matches); JS `\s` includes U+FEFF; `፻` multiplies while
`፼` flushes; `አስራ N` vs `TENS N`; bare `መቶ` for 100 but `አንድ ሺህ` for 1000.

Re-run the parity test after **any** change to the app's speech text pipeline.

---

## Running the gate

```bash
python3 tts/qa/dataset_qa.py \
  --manifest /path/to/train.jsonl \
  --manifest /path/to/dev.jsonl \
  --audio-dir /path/to/clips \
  --config tts/training/training_config.json \
  --out-dir tts/qa/out \
  --align
```

`--align` transcribes each clip and compares it to the manifest text (CER, with
homophone series folded — ሀ/ሃ spelling variance is not a data error). It is the
slow part; ASR results are cached in `asr_cache.json`.

Outputs, all three preserved: `clean_manifest.jsonl`, `review_manifest.jsonl`,
`reject_manifest.jsonl`, `qa_report.json`.

### Result on the currently supplied data

```
rows 4   audio 5 files   58.79s (0.0163 h)
buckets  clean 0   review 4   reject 0
bands    {'long_form': 4}
align    mean CER 16.6%   max 24.5%   n=4
speakers 0 distinct, 4 rows unlabelled
issues   tokens_estimated×4, no_speaker_id×4, register_long_form×4,
         raw_digits×2, alignment_drift×2
GATE: FAILED — do not train.
```

What that means, concretely:

- **The 5 h dataset is not here.** 69.33 s of audio arrived across 5 clips —
  0.39% of 5 hours. `train.jsonl` and `dev.jsonl` are the *same* clips re-split,
  not a sample of a larger corpus. `shard-000003` is missing from the shard
  sequence and there is no `test.jsonl`.
- **The LoRA adapter is not here either.** The bundle contains
  `training_config.json` and `README.md` only; `adapter_config.json` and
  `adapter_model.safetensors` are listed as expected and absent. The config
  reports `status: "validation_candidate"`.
- **No `speaker_id` on any row.** Split manifest keys are exactly
  `['audio_path','id','language_id','text']`. The speaker-disjoint split the
  bundle's own README requires is therefore impossible to build *or verify*.
  This is the single highest-value fix — add speaker labels at recording and
  segmentation time.
- `clip_a7af820c3d9c` is orphan audio: present on disk, in neither split.
- **Raw Arabic digits in training text** (`947`, `1`, `9`, `834`, `40`) teach an
  unstable digit→speech mapping. QA now attaches the `expandNumbers()` rewrite
  to each flagged row as `proposed`.
- **Register mismatch:** all five clips are 10–20 s ENA-style broadcast copy.
  The app teaches 1–3 s conversational phrases.

What is genuinely good and should not be changed: audio is spec-perfect
(24 kHz, mono, 16-bit `pcm_s16le`, duration drift 0.0000 s against the
manifest), text is NFC with zero Latin contamination and 92.66–100% Fidel, and
the token rate is a consistent 25.01–25.06 tok/s, exactly a 25 Hz tokenizer.

---

## The course-domain recording set

The 5 h news corpus is a **foundation, not the final voice** — keep it for
phonetics, Fidel coverage, speaker variation and prosody. Training only on it
produces a newsreader, and AmharicAI needs a teacher.

`recording/build_recording_script.py` walks
`packages/web/src/api/content/amharic-course.json` — the same file the app seeds
from, so the recording set cannot drift from what the app actually teaches —
and emits a script across the ten target domains.

```bash
python3 tts/recording/build_recording_script.py
```

Current output (`recording/out/`):

```
426 phrases across 10 domains
  greetings 11 · introductions 7 · classroom_instructions 10
  fidel_pronunciation 26 · vocabulary 219 · questions_answers 98
  dialogues 3 · exercises 2 · tutor_feedback 12 · everyday_conversation 38

fidel characters covered: 183   families: 36
phrases with ejectives:   107
at 4 speakers ≈ 1704 clips, 1.18 h
```

Tutor-feedback and classroom phrases are hand-authored, because the course
content contains no tutor voice. `recording_script.csv` ships with a **blank
`speaker_id` column** — fill it at recording time; it is what makes the
speaker-disjoint split possible.

Record at 24 kHz / mono / 16-bit to match `training_config.json`, target 1–4 s
per clip, teacher register: warm, unhurried, no broadcast cadence.

---

## Training

```bash
python3 tts/training/prepare_split.py    --clean tts/qa/out/clean_manifest.jsonl --out-dir data/splits
python3 tts/training/tokenize_dataset.py --splits data/splits --out-dir data/tokens
python3 tts/training/train_lora.py       --config tts/training/training_config.json --plan-only
python3 tts/training/evaluate.py         --endpoint "$AMHARICAI_TTS_URL"
```

Notes on decisions worth keeping:

- The split is **hash-stable per speaker**, so adding speakers later does not
  reshuffle the existing assignment.
- `prepare_split.py` refuses on fewer than 3 speakers, any missing
  `speaker_id`, or any empty split, and asserts disjointness before writing.
- `train_lora.py` always writes `run_plan.json`, warns below 1 h of audio and on
  single-speaker corpora, and `--plan-only` exits before importing torch.
- `evaluate.py` deliberately does not report a loss number. It measures
  intelligibility CER, **ejective recall separately** (ጠ ቀ ጰ ጸ ጨ are the first
  thing a thin fine-tune smears, and an overall CER hides exactly that), and
  duration-ratio sanity — plus a `listening_pack.csv` for native raters. It
  calls the same HTTP contract as the app, so evaluation and production cannot
  disagree.

Batching is by **token budget**, not fixed batch size: utterance lengths here
span an order of magnitude, and fixed batches waste most of a 8192-token budget.

---

## Serving

`serving/server.py` runs anywhere; `serving/handler.py` is a thin shim over the
same `synthesize()` so a Hugging Face endpoint and a plain container cannot
drift apart.

```bash
pip install -r tts/serving/requirements.txt
uvicorn server:app --host 0.0.0.0 --port 8000   # from tts/serving
```

`GET /health` reports `model_loaded`, `load_error`, `adapter` and
**`is_finetuned`**. That last field exists because serving the base model
unannounced is worse than failing — the app would advertise a "native voice"
that was never fine-tuned.

`POST /` (aliases `/synthesize`, `/generate`) accepts both `inputs` (HF style)
and `text`, with a `parameters` object; returns WAV bytes, or base64 JSON when
`Accept: application/json`.

### Wiring it to the app

The app treats this as provider #1 with the commercial vendors kept as fallback,
so the app is never voiceless. Set in the root `.env`:

```
AMHARICAI_TTS_URL=https://…            # required; everything else optional
AMHARICAI_TTS_TOKEN=
AMHARICAI_TTS_PATH=
AMHARICAI_TTS_VOICE=
AMHARICAI_TTS_VOICE_ALT=
AMHARICAI_TTS_FORMAT=
AMHARICAI_TTS_SAMPLE_RATE=
```

Our voice **speaks but does not listen**, so speech recognition selects its
provider through a separate `activeRecognizer()` (honouring `SPEECH_RECOGNIZER`,
then `SPEECH_PROVIDER`, then the first configured provider that actually
supports recognition). Without that split, configuring the native endpoint would
have silently disabled the speaking loop.

---

## What is still needed from you

1. The **real 5 h dataset** and the **trained adapter weights** — or a pointer to
   where they live. The `/content/...` paths in every manifest say they were
   assembled in Colab.
2. **`speaker_id` on every row.** Without it the pipeline stops at the split.
3. `shard-000003`, and a `test.jsonl` if one exists.
4. The **course-domain recordings** from `recording/out/recording_script.csv`.
