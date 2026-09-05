# AmharicAI redevelopment — round scope

User answers (this round):
- Target: BOTH. Nuxt repo = deployable app; managed app = reference build.
- Meaning: full rebuild — architecture + UI + content.
- Data: run full QA on new metadata.jsonl + generate speaker-disjoint split.
- Push: ALLOWED now (token verified writable: ref-create probe returns 422 not 403). Deploy: NO.
- Commercial adapters (Azure/Google/Addis): RIP THEM OUT. AmharicAI backend only, fail honestly.
- Goal: prototype -> credible production-ready Amharic learning + AI tutor platform.

## New attachment: metadata_(2)_hj135r.jsonl
1532 rows, 18002.3s = 5.001h exactly. 15 speakers. speaker_id PRESENT (was the top gap).
gender m975/f557; region addis_ababa 507/amhara 399/null 300/oromia 176/other 150.
All 24000 Hz, am, CC-BY-4.0, snapwre/amharic-speech. 0 dup paths, 0 non-NFC, 18 dup texts.
AUDIO NOT PRESENT — every path is /content/... (Colab). Only the same 5 clips are local.

## Progress
1. [x] dataset_qa.py: FIELD_ALIASES + normalize_schema (audio->audio_path, duration->
       audio_duration, language->language_id); one gate now serves both manifest generations.
2. [x] dataset_qa.py: --metadata-only. Skips audio-dependent checks and REPORTS them as
       skipped (audio_verification block); gate.training_ready stays false so a metadata
       pass can never be mistaken for training readiness.
3. [x] QA run -> tts/qa/out5h/: clean 1266, review 266, reject 0
       bands long_form 1455 / course 77   speakers 15, 0 unlabelled
       issues: audio_unverified×1532, tokens_estimated×1532, register_long_form×1455,
               raw_digits×260, latin_contamination×6, low_fidel_ratio×1
4. [ ] speaker-disjoint split — RISK: prepare_split assigns by hash of speaker id, ignoring
       speaker SIZE. Top 11 speakers hold 6.7-11.2% each; bottom 4 hold 0.12-1.83%. A hash
       split can put a 2-clip speaker in dev = meaningless eval. Likely also refuses at
       dev-frac 0.05 (expected 0.75 speakers in dev -> empty). Make it duration-aware.
5. [ ] rip Azure/Google/Addis adapters out of managed app; run gates
6. [ ] push branch (allowed now); NO deploy
7. [ ] write the production rebuild plan (multi-round) and deliver it

## Standing constraints
- No deploy. No TTS provider other than the custom AmharicAI backend.
- Nothing is ever deleted in QA — every row lands in clean/review/reject with reasons.
- Serving the base model unannounced is worse than failing (dev voice stays off by default).
- Foundation vs final voice: 5h news corpus = phonetics/prosody; course register needs its
  own short-form recordings. 1455/1532 rows are long_form; only 77 are course-length.

## Traps
- tmux only; no pkill -f matching own command line. Sessions: ttsrv(:8899), nuxt(:3000)
- Never two `edit` calls on the same file in one parallel batch.
