---
"unmodel": patch
---

elevenlabs (2026-11-12): corrected rates, limits and deprecations, and five requests the API accepts that were being refused

- **Rates** (elevenlabs.io/pricing/api):
  - Multilingual-class TTS (`eleven_v4`, `eleven_v3`, `eleven_multilingual_v2`) is now $0.08 per 1,000 characters (was $0.10). Flash/Turbo is now $0.04 (was $0.05).
  - `eleven_v3_conversational` gains its published $0.04 rate.
  - Batch Scribe (`scribe_v3`, `scribe_v2`, `scribe_v2_medical`, `scribe_v1`) is now $0.20 per hour (was $0.22). The page has no Scribe v1 card, so `scribe_v1` takes the generic "(Scribe)" rate.
  - Realtime Scribe (`scribe_v2_realtime`, `scribe_v3_live`) is now $0.22 per hour (was $0.39).
  - `checkTranscription` and every estimate move with them.
- **Limits**: `eleven_multilingual_v1` and `eleven_english_sts_v1` carry the 10,000-character figure from elevenlabs.io/docs/overview/models.
- **Deprecations**: `music_v1` (removal 2027-01-31; use `music_v2_5`) and `eleven_text_to_sound_v2` (removal 2027-03-01; use `eleven_text_to_sound_v3`) are marked `deprecated`. Both are still served and are still the server defaults, so `elevenlabs.music` and `elevenlabs.sfx` without a `model_id` now warn `deprecated_model`.
- **Requests that were wrongly refused**:
  - `elevenlabs.sfx` accepts the seven `wav_*` output formats (`wav_8000` … `wav_48000`, added 2026-10-19). In `unmodel/sfx`, 16-bit PCM now compiles to `wav_<rate>` by default and to `pcm_<rate>` with `container: "raw"`, the arrangement `unmodel/tts` already uses.
  - Batch STT and Dubbing accept keyterms of exactly 50 characters. The cap is "at most 50", not "less than 50".
  - `elevenlabs.tts` accepts `use_pvc_as_ivc: null`. The field is no longer tagged `@deprecated`: the API deprecated it on Text to Dialogue only.
  - `elevenlabs.stt` accepts `null` for `webhook_id`, `temperature` and `seed`. Source: api.elevenlabs.io/openapi.json.
- **Links**: error `source` links point at the pages ElevenLabs serves today. The dubbing reference moved to `/docs/api-reference/dubbing/create-project`; the old URL redirects to a sign-in page. `/docs/models`, `/docs/capabilities/voice-changer` and `/docs/best-practices/prompting/controls` now redirect to their `/docs/overview/…` pages. `provider.doc` is updated to match.
