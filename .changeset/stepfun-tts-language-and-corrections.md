---
"unmodel": patch
---

stepfun: `stepfun.tts` takes the documented `language` field, and `unmodel/tts` compiles `language` to it

- `TtsBody` gains `language?: "zh" | "en" | "ja" | "ko" | "fr" | "es"` —
  "Target language; defaults to English when omitted. Supported values:
  `zh`, `en`, `ja`, `ko`, `fr`, `es`. Japanese, Korean, French, and Spanish
  are in preview."
  (https://platform.stepfun.ai/docs/en/api-reference/audio/create-audio.md,
  2026-11-12). It was a compile error under `ExactKeys` and an
  `unknown_param` warning at run time; it now type-checks and validates, and
  a code off the six is `invalid_shape` at `language`. The six codes are
  exported as `LANGUAGES` (and `StepfunLanguage`) from `unmodel/stepfun`.
- `unmodel/tts` no longer refuses `language` on `stepfun/…` with
  `unsupported_param`: a BCP-47 tag compiles to its primary subtag
  (`"zh-CN"` → `"zh"`, with an `approximated_param` warning naming the
  dropped region), and both models' `TTS_MODEL_PARAMS` rows list the six
  codes for completion. A cloned voice takes only `zh` or `en` ("Cloned
  voices can be used only with `language` omitted, `zh`, or `en`",
  https://platform.stepfun.ai/docs/en/api-reference/audio/create-voice.md);
  unmodel cannot tell a cloned voice id from a system one, so that pairing is
  the API's to refuse.
- Corrected comments: StepFun speech has no `cost` because the pricing page
  counts characters by weight ("two English letters count as one
  character", https://platform.stepfun.ai/docs/en/guides/pricing/details.md),
  not because no rate is published; models.dev's `stepfun-ai` is StepFun's
  international platform (api.stepfun.ai), not a Hugging Face org; the China
  create-speech reference documents a different body (`text_normalization`,
  `voice_label`, `timestamp`, no `language`).
- docs/providers.md drops `image-edit` from StepFun's capabilities:
  "`step-2x-large` and `step-image-edit-2` were retired on October 10, 2026."
