---
"unmodel": patch
---

assemblyai: `assemblyai.stt` stops refusing requests the API accepts, and `checkTranscript` prices the model that actually ran

Every fact below was checked against AssemblyAI's live docs on 2026-11-12.

FALSE REFUSALS FIXED

- `domain: "veterinary-v1"` (Veterinary Mode, beta) now validates.
  `ASSEMBLYAI_DOMAINS` and the `AssemblyaiDomain` type are now
  `"medical-v1" | "veterinary-v1"`. The submit reference
  (https://www.assemblyai.com/docs/pre-recorded-audio/api-reference/transcripts/submit)
  types the field "enum: - medical-v1 - veterinary-v1 - null".
- `language_codes` without `"en"` is now refused only on a routing that can
  land only on `universal-2`. The code-switching guide
  (https://www.assemblyai.com/docs/pre-recorded-audio/code-switching) says
  "On Universal-3.5 Pro, `language_codes` accepts any number of languages, and
  English is **not** required" and "These two-code, English-required limits
  apply to Universal-2 only." The following now validate:
  `language_codes: ["es", "fr"]` on the default routing or on
  `universal-3-5-pro`, and the unified `languages: ["es", "fr"]` on
  `assemblyai/universal-3-5-pro`. The submit reference still carries the older
  "One of the values specified must be `en`." line; the guide and the
  2026-09-11 changelog entry are newer.
- `speech_threshold: null` validates. The request schema types it
  `[number, null]`.
- `speaker_options.include_speaker_confidence` (boolean) and
  `language_detection_options.on_no_speech_detected` (`"error" | "fallback"`)
  are now typed fields. Both are in the request schema, and a typed object
  literal that used either of them alone used to be a compile error.

COST

- `checkTranscript` now prices from `speech_model_used` ("The speech model
  that was actually used for the transcription."). It falls back to
  `speech_model`, which is a deprecated request echo that is `null` on
  `speech_models`-pinned requests. Before this change, `costUSD` was
  `undefined` for exactly those transcripts. `TranscriptResponseLike` gains
  `speech_model_used`.

DOCS AND PROVENANCE

- JSDoc on `speech_model` now says that a current model name there returns a
  400 ("Passing a current model name ( universal-2 , universal-3-5-pro ) to the
  async speech_model field now returns a 400."). Pin a model with
  `speech_models` instead.
- JSDoc on `summarization` / `auto_chapters` now quotes the changelog
  ("Starting October 20, 2026, requests using them will return errors.") and
  names `speech_understanding.request` as the replacement. So does the
  Universal-2-only refusal message.
- Issue `meta.source` links now point at the canonical
  `docs/pre-recorded-audio/api-reference/transcripts/{submit,get}` pages. The
  old paths 308-redirect there.
- The AssemblyAI catalog header now records that streaming has ids of its own
  (`universal-3-6-pro` is the default, plus `universal-3-5-pro` and
  `universal-streaming-english/multilingual`). None of them is a
  `/v2/transcript` id. The two pre-recorded rates are unchanged ($0.21/hr
  Universal-3.5 Pro, $0.15/hr Universal-2).
