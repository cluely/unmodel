---
"unmodel": patch
---

cartesia: no more false refusals on `language` / `locale` for the Sonic aliases, unlisted Sonic 3.6 locales and the realtime STT socket; new `normalization` field; `locale` from the unified layer on Sonic 3.6 (sources read 2026-11-12)

- Fixes a false refusal on `sonic-preview`, `sonic-latest` and `sonic-3-latest`.
  `cartesia.tts` and `cartesia.ttsWebsocket` held them to the 42-code list at
  error severity, so `locale: "en-GB"` or `language: "ur"` failed at compile
  time and at run time, even though no page names the model behind these ids.
  - `sonic-preview` now takes the Sonic 3.6 values quietly. The api-changes
    "Stable offerings" row points its supported languages at the Sonic 3.6 page.
  - On `sonic-latest` and `sonic-3-latest` (deprecated aliases of
    `sonic-preview`) a Sonic 3.6 value is now an `invalid_enum_value`
    *warning*.
  - Ids the catalog does not know (`sonic-3.7`) work the same way.
  - On all of these ids a value on no documented list is also a warning, never
    an error, and their `language` / `locale` types are open-tailed
    (`CARTESIA_TTS_ALIAS_LANGUAGES`).
  - The ids whose list is documented (`sonic-3.6`, `sonic-3.5`, `sonic-3` and
    their dated snapshots) still refuse at error severity.
- Fixes a false refusal of the five locales that Sonic 3.6 serves but no page
  names. The locale table lists 56 codes while the changelog counts "44
  languages / 61 locales". A well-formed regional code on a Sonic 3.6 base that
  the table does not list (`ar-SA`, `zh-TW`, `es-419`) is now a warning on
  `sonic-3.6` and its snapshot, and it compiles. `en-gb` (wrong case) and
  `cy-GB` (Welsh is not a Sonic 3.6 language) are still errors.
- New `normalization` field on `TtsBytesBody` (nullable, as on the wire) and
  `TtsWebsocketMessage`. Before, a TypeScript caller could not send this
  documented field without a cast.
  - It takes `"auto"`, `"off"`, any base code (on every model) or a locale
    code.
  - A locale code on a model before Sonic 3.6 is a warning ("Locale codes
    require Sonic 3.6 or later.").
  - Any other value is an `invalid_enum_value` error ("Values not on the list
    return a 400 error.").
- Fixes a false refusal on `cartesia.sttWebsocket`. `language` was an error for
  anything but `"en"`, including `ink-whisper` with `"es"` and `ink-preview`
  with `"fr"`. Only the 2026-03-01 reference lists `en` alone, and it does not
  say other codes are refused. The 2026-08-14 reference points `ink-whisper` at
  its 100 codes, and the troubleshooting page says to pass `?language=xx`.
  - It now never errors. `ink-whisper` warns only outside its 100 codes, and
    `ink-2` / `ink-preview` warn on anything but `en` (the field is "Used by
    `ink-whisper` models only.").
  - `CartesiaSttWebsocketLanguage` widens to
    `CartesiaSttLanguage | (string & {})`.
- Unified `tts`: on `cartesia/sonic-3.6`, a tag on Sonic 3.6's list is now sent
  exactly as `locale`, with its case folded (`pt-br` and `pt_BR` become
  `pt-BR`). Before, it was cut to `language: "pt"` with an `approximated_param`.
  Tags that are not on the list, and every other model, still go through
  `language` as a bare primary subtag. The `cartesia/sonic-preview` and
  `cartesia/sonic-latest` rows now complete Sonic 3.6's 44 languages.
- Issue `meta.source` links for the TTS and STT routes now point at the
  `docs.cartesia.ai/2026-03-01/api-reference/...` pages, the version these
  routes pin. The unversioned pages render 2026-08-14, where for example
  `sonic-3.6` *is* on the `model_id` enum.
- The batch `/stt` model error now names `cartesia.sttWebsocket` for `ink-2`.
  Before, it said the WebSocket route was not validated.
- Catalog notes: speech from a cloned voice is billed at 1 credit per character
  ("Speech from a clone costs 1 credit per character, unless your Enterprise
  plan says otherwise.", cartesia.ai/pricing). The old figure of ~1.5 appears
  on no Cartesia page. `sonic-english` / `sonic-multilingual` stay unlisted,
  now citing their June 1, 2026 sunset on the api-changes page.
