---
"unmodel": patch
---

assemblyai: `assemblyai.stt` refuses three requests AssemblyAI answers with an error

These requests used to validate clean. Every fact below was checked against
AssemblyAI's live docs on 2026-11-12.

FALSE ACCEPTS FIXED

- `summarization: true`, `auto_chapters: true` and a non-null `summary_model`
  are now refused (`unsupported_param`) on every routing, universal-2
  included. The changelog's 2026-10-06 entry
  (https://www.assemblyai.com/changelog) says: "The legacy Summarization
  model (the top-level `summarization` boolean and `summary_model` parameter)
  and the legacy Auto Chapters model are deprecated. Starting October 20,
  2026, requests using them will return errors." The model reference
  (https://www.assemblyai.com/llms/models.md, last updated 2026-11-10) says
  "the top-level `summarization` and `auto_chapters` options return errors
  since October 20, 2026".
  - **Replacement:** `speech_understanding.request.summarization`. The model
    reference adds that `summary_type: "paragraph"` "gives chapter-style
    sections".
  - These still validate: `false` / `null` values (the submit reference's own
    example sends them), and `summary_type` on its own, which neither source
    names.
  - In `unmodel/stt`, `summarization`, `summary_model`, `summary_type` and
    `auto_chapters` are no longer extras on `assemblyai/universal-2`, so they
    are now a compile error there. `providerOptions.assemblyai` still reaches
    the wire, where the provider validator refuses them.
  - The old pairing refusals for these params ("requires automatic
    punctuation", "cannot be combined with `summarization`") are gone. The
    retirement refusal is reported in their place, so their advice no longer
    points at a request that still errors.
- `speech_model: "universal-3-5-pro"` or `"universal-2"` is now refused with
  `invalid_enum_value`. The message names the fix:
  `speech_models: ["<id>"]`. The errors page
  (https://www.assemblyai.com/docs/errors) lists "`400` when a current model
  name is sent in `speech_model` | The singular `speech_model` is deprecated. |
  Use `speech_models`." The changelog says: "Passing a current model name (
  universal-2 , universal-3-5-pro ) to the async speech_model field now returns
  a 400."
  - Legacy names (`best`, `universal`, `nano`) and `slam-1` still validate.
    The changelog says the legacy names return 200, and SDK 4.43.0 types
    `slam-1` as a legacy `speech_model` value.
  - `universal-3-6-pro-preview` also still validates, because neither source
    names it.
- `language_detection_options.on_no_speech_detected: "fallback"` is now
  refused unless `fallback_language` is a specific language code.
  `fallback_language` omitted, `"auto"` or `null` is refused. The submit
  reference
  (https://www.assemblyai.com/docs/pre-recorded-audio/api-reference/transcripts/submit)
  says: "`fallback` requires `fallback_language` to be set to a specific
  language code; `auto` returns a `400`." The language-detection guide says:
  "When `fallback_language` is unspecified, it is set to `"auto"` by
  default."
