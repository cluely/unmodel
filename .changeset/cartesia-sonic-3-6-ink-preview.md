---
"unmodel": patch
---

cartesia: Sonic 3.6, `ink-preview`, the `ink-whisper` snapshot and two deprecated aliases join the catalog, and the TTS language check goes per model (sources read 2026-11-12)

- New TTS rows: `sonic-3.6` (GA since 2026-08-27: "generally available from
  August 27 on `sonic-3.6`", docs.cartesia.ai/changelog/2026) and its dated
  snapshot `sonic-3.6-2026-08-27` (tts-models/latest). Both sit off the
  Cartesia-Version 2026-03-01 `model_id` enum, so `cartesia.tts` and
  `cartesia.ttsWebsocket` validate them with the existing off-enum warning.
  `cartesia/sonic-3.6` is reachable from `unmodel/tts` with a 44-language row.
- New deprecated aliases `sonic-3-latest` (use `sonic-preview`) and
  `sonic-3-preview` (use `sonic-3`), from the older-models page's
  "Deprecated Aliases" table. They validate with `deprecated_model`.
- New STT rows: `ink-preview` (beta, realtime-only: batch `/stt` refuses it,
  `cartesia.sttWebsocket` takes `keyterm` on it and reports the
  `ink-whisper`-only silence knobs as ignored, as on `ink-2`) and
  `ink-whisper-2025-06-04` (batch `/stt` accepts it; on the socket `keyterm` is
  ignored, as on `ink-whisper`). The `keyterm` deny reason now reads "used by
  `ink-2` and `ink-preview` only".
- Fixes a false refusal on the new model: `language` was checked against one
  42-code list for every model, so `sonic-3.6` with `language: "or"`, `"ur"`,
  `"en-GB"` or `"pt-BR"` failed with `invalid_enum_value`. The list is now per
  model (`CARTESIA_TTS_LANGUAGES_BY_MODEL`): the two Sonic 3.6 ids take
  their 44 base codes (`CARTESIA_TTS_3_6_LANGUAGES`) plus the 56 regional
  locales of the advanced-capabilities table (`CARTESIA_TTS_LOCALES`); every
  other id keeps the 42 (`CARTESIA_TTS_LANGUAGES`). Refusing a Sonic 3.6 value
  on an earlier model now names `sonic-3.6`, and for a locale also the bare
  code to send instead.
- New `locale` field on `TtsBytesBody` and `TtsWebsocketMessage`, taking the
  same per-model values ("Accepts exactly the same values as `language`").
  Setting both `language` and `locale` is an `invalid_shape` error ("Setting
  both returns a 400 error, even if the values match.").
- Types: `TtsBytesBody<M>` and `TtsWebsocketMessage<M>` infer the `model_id`
  literal, so `language` / `locale` complete and check against that model's
  own list (`CartesiaTtsLanguageFor<M>`, new `CartesiaTtsLocale`). Unchanged
  for earlier models: `language: "pt-BR"` on `sonic-3.5` is still a compile
  error. A `string`-typed `model_id` accepts every model's values.
- The `sonic-preview` row is renamed "Sonic Preview (beta alias)": the docs no
  longer say which model it serves.
