# AmharicAI — prototype → production platform

Written against measured state, not intentions. Every number here came from a command
in this repo, and anything unverified is labelled unverified.

---

## Where the two codebases stand

| | Nuxt repo (`tesg2022/AmharicAI`) | Managed app (`/home/user/amharicai`) |
|---|---|---|
| Role | the deployable product | reference build + TTS pipeline |
| Stack | Nuxt 3 SPA + Nitro server routes | Bun/Hono/oRPC + Drizzle, Expo mobile, React web |
| Content | 2 demo lessons, hardcoded | full course schema + `amharic-course.json` |
| Auth / progress | none | accounts, sessions, per-lesson progress |
| TTS | `/api/tts` → AmharicAI backend | `amharicai` provider → same backend |
| Status | structure fixed, sound verified end to end | 4/4 gates green |

The two are now consistent on the wire: both post to `/api/v1/tts` and both accept the
three upstream response shapes. That is the seam to keep stable while everything else moves.

---

## What is actually blocking "production-ready"

Ranked by what would embarrass you first in front of a real learner.

### 1. There is no trained voice. — blocking, and not fixable here
The LoRA zip contains `training_config.json` and `README.md` only. `adapter_config.json`
and `adapter_model.safetensors` are listed as "Expected Adapter Files" and are absent;
the config says `status: "validation_candidate"`. Nothing has been trained yet.

The 5h corpus metadata arrived and is coherent — but **the waveforms did not**. All 1532
audio paths point at `/content/AmharicAI_5h_native_amharic/audio/` (Colab). Five clips
exist locally.

Until the audio lands, nobody can verify sample rate, channels, codec, or that any clip
matches its transcript. Training needs your GPU regardless.

**You do:** export the 1532 wavs out of Colab. **Then I do:** re-run QA with `--audio-dir`
(alignment scoring included), and `prepare_split → tokenize_dataset → train_lora --plan-only`
becomes runnable end to end.

### 2. The corpus teaches the wrong register. — blocking for quality
Measured across all 1532 rows: median clip **11.36s**, mean **19.3 words**, and
**1455 of 1532** clips are long-form broadcast news. Only **77** fall in the 1–4s
conversational band the course actually teaches. Six clips are under 3s.

Train the course voice on this alone and you get a tutor that reads greetings like an
ENA bulletin. The split I'd keep:

- **Foundation pass** — all 5h. Buys Fidel coverage, phonetics, ejectives, prosody.
- **Course voice pass** — a *separate*, short-form recording set in teaching register.
  `tts/recording/build_recording_script.py` already generates the script for this.

That second recording session is the single highest-leverage thing you can commission.
Rough size: 600–900 prompts, 1–4s each, one or two speakers, ~1.5–2h of audio.

### 3. Speaker coverage is thin and lopsided. — quality ceiling
15 speakers, but the top 11 hold 6.7–11.2% each and the bottom 4 hold 0.12–1.83%.
The duration-aware split now yields train 11 speakers / 3.06h, dev 2 / 0.66h,
test 2 / 0.41h — disjoint and verified, both eval sides above the 15-minute floor.
That works, but a 2-speaker dev set measures generalization weakly. More speakers beats
more hours from the same voices.

### 4. Recognition is now gone. — accepted consequence
You chose AmharicAI-only, so Azure/Google/Addis are removed. The AmharicAI backend
synthesizes but does not listen, so `activeRecognizer()` returns null and every speaking
take is scored by the deterministic typed self-check. The loop still works and the UI says
so plainly. Restoring recognition later means one provider with a `recognize` method — the
seam is preserved, no call sites change.

### 5. The Nuxt app has no course, no accounts, no progress. — the actual product gap
Two demo lessons, no persistence, no learner state. This is where "full rebuild" is
mostly going to be spent.

---

## The rebuild, in the order I'd do it

Each phase ends in something you can open and judge.

**Phase 1 — Content spine.**
Port the course model from the managed app into Nuxt: units → lessons → items, with
`amharic_course_content_spec.json` and the rewritten textbook as source. Real course
material replaces the two demo lessons. The Peace Corps manual is still unused and is the
best source for teaching-register dialogue.
*Ends with:* a browsable multi-unit course, still static.

**Phase 2 — Persistence and identity.**
Database, accounts, per-lesson progress, resumable sessions. Anonymous learners keep the
full loop — session writes stay best-effort, as in the managed app.
*Ends with:* progress that survives a refresh and a device change.

**Phase 3 — Practice loop.**
Listen → repeat → score, with the deterministic Levenshtein scoring and stage gating from
the managed build. Ejective recall (ጠ ቀ ጰ ጸ ጨ) scored separately from overall accuracy — an
aggregate CER hides exactly the degradation that matters for teaching.
*Ends with:* a lesson you can actually fail and retry.

**Phase 4 — Voice.**
Once the wavs exist: QA with audio → foundation pass → course-voice pass → eval.
Serve behind `/api/tts` with no fallback. Dev voice stays off by default and self-announcing.
*Ends with:* the app speaking in its own trained voice, or honestly silent.

**Phase 5 — Tutor.**
The AI tutor stream is written but untested end to end. Needs conversation state, grounding
in the learner's current unit, and a refusal path when it drifts outside the course.
*Ends with:* a tutor that teaches this course rather than improvising Amharic.

**Phase 6 — Hardening.**
Error surfaces, empty states, offline audio cache, mobile parity, deployment to a Node host.
GitHub Pages can never host this — Pages is static and `/api/tts` must execute.

---

## Decisions carried forward

- One TTS provider. Failing honestly beats a fallback that misrepresents the voice.
- Nothing is deleted in QA. Every row lands in clean/review/reject with its reasons attached.
- A metadata-only QA pass can never report training readiness.
- The split is speaker-disjoint or it does not run.
- Slow mode is 0.7×, not lower — below ~0.65 neural voices smear ejectives.
- `foldHomophones` is scoring-only; it never touches display text or TTS input.
- Numbers are expanded before synthesis, never fed as digits.

---

## What I need from you

1. **The 1532 wav files.** Everything in phase 4 waits on this.
2. **A token with Contents: Write**, if you want branches pushed — the current one is still
   read-only (push returns 403).
3. **A decision on the course-voice recording session** — who records, and how many prompts.
4. **Which phase to start.** My recommendation is Phase 1: it is the largest visible gap,
   it needs nothing from anyone else, and every later phase hangs off the content model.
