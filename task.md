# AmharicAI — build scratchpad

## Constraint (from user)
Preserve the source course/content structure 1:1 during porting. Never simplify or
drop fields to fit the managed stack. Keep backend/DB modular so it can migrate to
Postgres/FastAPI later.

## Stack / infra
- App root: `/home/user/amharicai`
- Ports (fixed): website **4200**, mobile **4300**
- DB: remote Turso (libsql) via Drizzle — seeding persists to production
- Never edit `expo.extra` / `expo.scheme` in `packages/mobile/app.json`
- Mobile deps: always `bunx expo install`, never `bun add`

## Done ✅
- [x] `design.md` — palette, typography (Sora/Manrope/Noto Sans Ethiopic), unit-path layout,
      content-rendering rules (render by `section_type`, never auto-correct source, QA flags
      render as amber notes; source page references are stored but never rendered)
- [x] Dependencies installed (web + mobile)
- [x] `schema.ts` — 1:1 Postgres→SQLite port, pushed to Turso
- [x] Content ingestion (`seed.ts`, `fidel-data.ts`) — **seeded**:
      6 units, 32 lessons, 90 sections, 152 vocab, 16 grammar, 21 verbs, 68 conjugations,
      2 dialogues, 9 dialogue lines, 62 activities, 2 assessments, 370 questions,
      1180 options, 238 fidel rows
- [x] API complete + `bun run typecheck` clean:
      auth, middleware, gamification, routes {content, practice, srs, progress, speaking, tutor},
      agent (tutorAgent + lookup tools), `/api/agent/messages` streaming route
- [x] Auth clients (web + mobile), shared bearer token store
- [x] Mobile foundations: `app.json`, `constants/theme.ts`, `app/_layout.tsx` (fonts + Stack),
      `lib/{auth,api,speech}.ts`, `queries/{content,practice,srs,progress,speaking}.ts`

## In progress 🔨 — mobile screens
- [x] `components/ui.tsx` — Am/Title/Body/Translit, Card, Chip, QaNote, Button,
      SpeakButton, ProgressBar, ScreenHeader, TibebRule, Loading/Empty/Error, SignInPrompt
- [x] `hooks/use-session.ts`
- [x] `queries/tutor.ts`
- [x] `lib/recognition.ts` — Web Speech API where available, honest fallback elsewhere
- [x] `app/(tabs)/_layout.tsx` — Learn / Practice / Tutor / Profile
- [x] `app/(tabs)/index.tsx` — streak/XP header + alternating unit path
- [x] `app/(tabs)/practice.tsx` — flashcards, ፊደል, quiz, speaking, word lookup
- [x] `app/(tabs)/tutor.tsx` — useChat + DefaultChatTransport, transcript persisted
- [x] `app/(tabs)/profile.tsx`
- [x] `app/lesson/[id].tsx` — render sections by `section_type`, unknown-type fallback
- [x] `app/quiz/[lessonId].tsx` — also handles `unit-<unitId>` for source exams
- [x] `app/flashcards.tsx`
- [x] `app/fidel.tsx`
- [x] `app/speaking/[lessonId].tsx`
- [x] `app/sign-in.tsx`
- [x] delete `app/(tabs)/explore.tsx`
- [x] `packages/mobile` typecheck clean

## Then — web companion 🔨
- [x] `styles.css` design tokens + Sora/Manrope/Noto Sans Ethiopic
- [x] `components/provider.tsx` — managedAuth.handleRedirect() on startup
- [x] `queries/{content,practice,srs,progress,tutor,speaking}.ts`
- [x] `lib/speech.ts`, `components/ui/kit.tsx`, `components/source-value.tsx`
- [x] `hooks/use-session.ts`, `components/protected-route.tsx`, `components/layout.tsx`
- [x] pages: course browser, lesson reader (sticky outline rail), ፊደል, practice,
      flashcards, quiz, tutor, progress, sign-in + routes in `app.tsx` (Layout-wrapped,
      9 routes + 404 fallback)
- [x] Verify: `typecheck` (web + mobile) clean, root `bun run build` clean,
      `bun run lint` 0 errors. Fixed: Google-Fonts `@import` moved above
      `@import "tailwindcss"` (it must precede all rules), useless regex escapes,
      missing `aria-label`s, a no-unused-expressions ternary in quiz.tsx
- [ ] Deliver: mobile at index 0 (port 4300), website second (port 4200)

## Decisions
- Source ids reused as primary keys for traceability
- Unmapped lesson keys survive verbatim in `lesson_sections.body`
- `qa_flag` separates generated drills from source-as-written questions;
  `practice.quiz` serves only generated, `practice.unitExam` serves the source bank
- Fidel `category` left null where the source doesn't state it
- Speaking scored deterministically (Levenshtein), not by an LLM
- Unit exams routed through `quiz/[lessonId]` with a `unit-` prefix (one dynamic route)

## Round 2 — textbook, pronunciation curriculum, provenance chips

- [x] Extract the 100-page DOCX textbook programmatically
      (`packages/web/scripts/extract-textbook.py` -> `api/content/textbook.json`):
      14 units (7-20), 9 pronouns, 18 high-value verbs, 7 vowel cues, 7 practice-plan rows,
      9 performance tasks. Units 1-6 deliberately NOT re-ingested — `amharic-course.json`
      is the authoritative 1:1 source for those.
- [x] Seed the new material (`api/content/seed-extra.ts`, wired into `seed.ts`): units
      `u7`-`u20` plus an appendix unit; unmapped tables survive verbatim in
      `lesson_sections.body`. Verified: 21 units, 47 lessons, 250 vocabulary, 566 questions.
- [x] Pronunciation curriculum for English speakers
      ("Amharic Pronunciation for English Speakers / ለእንግሊዝኛ ተናጋሪዎች የአማርኛ አነባበብ"):
      `api/content/pronunciation-data.ts` — 20 sounds, each with English approximation, IPA,
      mouth/throat description, example Fidel characters and example words; 10 contrast rows
      (7 true syllable minimal pairs + 3 word-level contrast examples, labelled as such);
      6 listen-and-repeat drills. Ejectives (ጠ ቀ ጰ ጸ ጨ) carry an explicit warning that they
      are separate consonants, not accented ተ/ከ/ፐ.
- [x] Tables `pronunciation_sounds`, `minimal_pairs`, `pronunciation_drills`; pushed + seeded.
- [x] `api/routes/pronunciation.ts` — `guide` / `sound` / `pairs` / `drills`.
- [x] Web `/pronunciation` screen + nav entry; mobile `app/pronunciation.tsx` + Practice tile.
- [x] Remove every "Source p. N" chip from both UIs (data and API untouched); `SourceValue`
      now filters provenance keys out of verbatim bodies. `design.md` records the reversal.

### Not done / known gaps
- `Amharic_Peace_Corps_Language_Manual-2024.pdf` is still unused — nothing in the app draws
  from it.
- Google sign-in and the AI tutor stream have not been exercised end to end; both need a real
  authenticated session, which the headless smoke test cannot provide.

## Round 3 — native Amharic speech layer

Goal (user): "make the AI speak Amharic much more naturally than simply converting
Amharic text into English-style phonetics." All seven requested features, provider-agnostic,
no key supplied yet.

- [x] Text pipeline (`api/speech/`): `fidel.ts`, `numbers.ts`, `segment.ts`, `ssml.ts`,
      `normalize.ts`. Deterministic, key-free, verified by `scripts/speech-pipeline-check.ts`.
- [x] Provider adapters (`api/speech/providers/`): Azure, Google, Addis AI behind one
      interface; `SPEECH_PROVIDER` pins one. Addis request shape UNVERIFIED (env-configurable).
- [x] Cache (`api/speech/cache.ts`) + tables `speech_audio`, `speech_sessions` (db:push done).
- [x] API: `speech.status/prepare/dialogue/startSession/advanceSession/sessions`, plus plain
      HTTP `GET /api/speech/audio` and `POST /api/speech/recognize`.
- [x] Clients: English-phonetics fallback DELETED. Ladder is server audio -> device am-ET
      voice -> silence with an honest reason.
- [x] Native / Slow / Repeat modes; `SpeakButton`, `VoiceModeToggle`, `RepeatButton` on both.
- [x] Real am-ET STT replaces the typed self-check (typed kept as fallback, same scorer).
- [x] Pre-generation script `scripts/pregenerate-audio.ts` — dry run: 335 phrases,
      670 clips, 3,132 characters total. Trivially cheap on any free tier.
- [x] Conversation mode: `components/dialogue-player.tsx` on both platforms, wired into the
      lesson dialogue block. Cast fetched lazily on first play; active turn highlighted.
- [x] Speech status surfaced honestly: `components/speech-status.tsx` on both platforms
      (web `/progress`, mobile Profile) — names the exact missing env vars.
- [x] READ -> LISTEN -> REPEAT -> SPEAK -> FEEDBACK loop wired to startSession/advanceSession
      on both platforms (mobile `app/speaking/[lessonId].tsx`, web `pages/practice.tsx`).
      Stages gate the UI: no audio button during READ, no mic until after REPEAT.
      Session calls are best-effort — anonymous learners still get the full loop.
- [x] Final gates: root build PASS, root lint 0/0, mobile typecheck PASS.

### Blocker to report plainly
NO AUDIO HAS BEEN HEARD. No provider key exists, so every synthesis path is built but
unproven. Needs AZURE_SPEECH_KEY+AZURE_SPEECH_REGION, GOOGLE_SPEECH_API_KEY, or
ADDIS_AI_API_KEY. Android + Azure STT is expected to fail (Android cannot record WAV;
Azure rejects AMR-WB) — prefer Google for Android, or add a server-side transcode.

### Decisions this round
- `foldHomophones` is scoring-only; folding for display would erase spelling the course teaches.
- `normalizeForSpeech` never rewrites word spelling — only encoding/spacing repair.
- Numbers/dates/times expanded to Amharic words before TTS (engines read digits in English).
- Slow mode is 0.7x, not lower: below ~0.65 neural voices smear ejectives into plain stops.
- Audio served over plain HTTP, not oRPC — `<audio src>` and the mobile player need a URL.
- Cache key hashes NORMALIZED text, so changing the pipeline invalidates stale clips.
- Audio cached base64 in SQLite; `storageKey` is the hook for object storage later (no S3 creds).


## Round 4 — native-speaker TTS / LoRA pipeline (`tts/`)

The user's own voice model becomes provider #1; Azure/Google/Addis stay as fallback so the
app is never voiceless. Full pipeline map and commands in `tts/README.md`.

Gate, enforced by every script independently (cannot be skipped by calling a script direct):
`RAW -> QA {clean|review|reject} -> speaker-disjoint split -> tokenize -> train -> eval -> serve`

- [x] Text-normalization parity: `qa/make_parity_vectors.ts` emits 382 golden vectors from
      the app's TypeScript; `qa/normalize_am.py` is held to them by `qa/test_parity.py`.
      382/382 PASS. Re-run after ANY change to `api/speech/`.
- [x] `qa/dataset_qa.py` RUN on the real attachments. GATE FAILED, correctly:
      4 rows / 58.79s / clean 0 / review 4 / reject 0, mean CER 16.6%, 0 speaker labels.
- [x] `recording/build_recording_script.py` RUN: 426 phrases across all 10 domains,
      183 Fidel chars, 107 with ejectives, ~1.18h at 4 speakers. Blank speaker_id column.
- [x] Training scripts written; all three refusals verified on real data.
- [x] Serving (`serving/server.py`, `handler.py`) + app adapter
      `api/speech/providers/amharicai.ts`. `activeRecognizer()` split from `activeProvider()`
      because our voice speaks but does not listen.
- [ ] BLOCKED: cannot train or run inference — no GPU here, no weights, no 5h dataset.

### What the attachments actually contained
- LoRA adapter absent (config + README only, `status: validation_candidate`).
- 69.33s of audio, not 5h (0.39%). train/dev are the SAME clips re-split.
- `shard-000003` missing; no `test.jsonl`; `clip_a7af820c3d9c` is orphan audio.
- NO `speaker_id` anywhere -> the README's own speaker-disjoint split is impossible.
- Raw Arabic digits in training text (947, 1, 9, 834, 40).
- Good: audio spec-perfect (24k/mono/16-bit, 0.0000s drift), NFC, zero Latin, 25Hz tokens.

### Decisions this round
- `tts/` lives OUTSIDE `packages/` — ML tooling is not app runtime, and it stays portable
  for the eventual migration to production infra.
- Normalization duplicated in Python but pinned by golden vectors: silent drift between
  training and inference text is invisible in a loss curve and only shows in production.
- Rejected/dropped rows always written to disk, never deleted (explicit user instruction).
- 5h news corpus = foundation (phonetics, Fidel coverage, prosody); course-domain
  recordings = register. Training only on the news set yields a newsreader, not a teacher.
- `is_finetuned` on serving health: serving the base model unannounced is worse than failing.
- `evaluate.py` scores ejective recall SEPARATELY — an overall CER hides ጠ ቀ ጰ ጸ ጨ smearing,
  which is the exact degradation that matters for teaching.

### Verified end-to-end (headless Chrome, 2026-09-05)
- 11 web routes render with ZERO console/page errors, no "Source p. N" chips leaked.
- Practice loop driven on `u2-l1`: audio control absent at READ / present from LISTEN,
  mic present ONLY at SPEAK, correct answer scores 100%, FEEDBACK offers
  "Hear it again" + "Try again", "Next phrase" resets the loop to READ.
- Gates: root `bun run build` PASS, root `bun run lint` 0 errors, mobile typecheck PASS.
- NOTE: u1-l1..u1-l4 have no speaking prompts in the source material; u2 onward do.
  The empty-state copy already says this. Not a bug.
- Caught + fixed: the long-running Vite dev server held a STALE module graph and reported
  a phantom missing export (`micSupported`) that `tsc` proved present. Restart cleared it.
  If a smoke test fails on every route with one import error, restart the dev server first.

### Open / blocked
- [ ] BLOCKED ON USER: provider key. `ask_secrets` form sent for AZURE_SPEECH_KEY+REGION /
      GOOGLE_SPEECH_API_KEY / ADDIS_AI_API_KEY / AMHARICAI_TTS_URL. Until one lands,
      NO AUDIO HAS EVER BEEN HEARD and every synthesis path stays unproven.
- [ ] BLOCKED ON USER: real 5h dataset + adapter weights + `speaker_id` labels.
      Pipeline stops at the speaker-disjoint split without them.
- [ ] Peace Corps PDF (`Amharic_Peace_Corps_Language_Manual-2024`) still UNUSED.
- [ ] Google sign-in and the AI tutor stream still untested end-to-end (need a real
      authenticated session).
- [ ] Optional: surface `status.recognizer` in both `speech-status.tsx` cards — the API
      already returns it and the cards claim "speaks/listens".
