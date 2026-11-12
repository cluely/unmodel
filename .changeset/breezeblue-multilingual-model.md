---
"unmodel": patch
---

breezeblue: `breeze-tts-2-multilingual` joins the catalog and `unmodel/tts`, and an omitted `model_id` is resolved the way the API routes it

- `breezeblue.tts` catalogues `breeze-tts-2-multilingual` — "Breeze TTS 2
  Multilingual (`breeze-tts-2-multilingual`) supports all 51 codes accepted by
  the Voice contract" (https://docs.breezeblue.ai/concepts/multilingual) — so
  it validates and prices like `breeze-tts-2` instead of warning
  `unknown_model`. It is also a unified ref:
  `tts({ model: "breezeblue/breeze-tts-2-multilingual", … })`, whose
  `language` completes the 51 codes.
- `breeze-tts-2-preview` is catalogued as what the docs call it, "a
  compatibility alias for `breeze-tts-2-multilingual`": it validates without
  `unknown_model`, and stays out of `BREEZEBLUE_MODEL_IDS` and the unified ref
  union, which name the formal id (`GET /v1/models` lists the formal model
  only).
- An omitted or null `model_id` now resolves to the model that will serve the
  request, per https://docs.breezeblue.ai/guides/text-to-speech: "When
  `model_id` is omitted, explicit `language_code: en` or `zh` selects
  `breeze-tts-2`; other or omitted languages select
  `breeze-tts-2-multilingual`." Model-keyed checks now run on such requests
  instead of being skipped.
- `VOICE_LANGUAGE_CODES` (`unmodel/breezeblue`, `unmodel/breezeblue/values`)
  grows from 23 to the 51 codes of the Voice contract table on
  https://docs.breezeblue.ai/concepts/multilingual, adding af, bg, bn, bs, ca,
  da, et, eu, fa, gl, he, hu, is, kn, lt, mr, ms, ne, no, sk, sl, sq, sv, sw,
  ta, te, tl, ur. `BreezeblueVoiceLanguageCode` widens with it.
