---
"unmodel": patch
---

speechify: Simba 3.5, and the `pronunciations` field it ships with

Speechify's recommended model since 2026-10-18 is `simba-3.5` ("Streaming-native model covering
48 languages under one model id, on every plan." — https://docs.speechify.ai/build/guides/concepts/models,
read 2026-11-12). The OpenAPI `model` enum on both synthesis routes is now
`"simba-3.0" | "simba-3.2" | "simba-3.5"` (https://docs.speechify.ai/openapi/api-reference.json).

- `simba-3.5` joins the Speechify catalog, `SPEECHIFY_MODEL_IDS` and the `unmodel/tts` ref union
  (`speechify/simba-3.5`), and validates on `speechify.tts` and `speechify.ttsStream` without
  `unknown_model`. It prices at its $15 per 1M characters Starter list rate ("Simba 3.5 lists at
  $15/$12/$10 per 1M characters on Starter/Pro/Scale , billed at $10/$8/$6 until 21 Nov 2026 ." —
  https://speechify.ai/pricing): the launch price ends on a published date, and the estimate is the
  worst case a budget check should assume. `simba-3.0` and `simba-3.2` stay at $10.
- `AudioSpeechBody` and `AudioStreamParams` gain `pronunciations` (OpenAPI `Pronunciations`), typed
  as `SpeechifyPronunciation` — an `ipa` entry or an `alias` entry, never both. It was a compile
  error before. Shape rules every model shares are checked: at most 200 entries
  (`MAX_PRONUNCIATIONS`), `text` 1-64 characters (one word on an `ipa` entry), `alias` 1-160
  characters, `ipa` 1-64 phones, no control characters, no repeated `text` (case-insensitive unless
  both entries are `case_sensitive`).
- Which model applies them is now exported as `PRONUNCIATION_LANGUAGES`, each model's
  `pronunciation_languages` from GET /v1/audio/models. A non-empty list on `simba-3.0`, `simba-3.2`
  or an omitted `model` is an `unsupported_capability` error (both publish
  `"pronunciation_languages": []`, and "A request whose model or language is not listed refuses the
  field with `400 pronunciations_unsupported`" — https://docs.speechify.ai/build/guides/text-to-speech/pronunciation).
  On `simba-3.5` a `language` outside its 47 pronunciation languages is a warning: English is "not
  supported yet", and the set "can grow over time". An empty list passes on every model.
- The `simba-3.2` English-only error now points non-English requests to `simba-3.5` and `simba-3.0`.
