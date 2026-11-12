---
"unmodel": patch
---

assemblyai: `universal-3-6-pro-preview` joins `assemblyai.stt` and `unmodel/stt`

- `universal-3-6-pro-preview`, AssemblyAI's next-generation pre-recorded model,
  is now a catalogued `speech_models` id with `status: "beta"`. It is listed
  self-serve on the model-selection page
  (https://www.assemblyai.com/docs/pre-recorded-audio/select-the-speech-model,
  checked 2026-11-12: "Our next-generation pre-recorded model, currently in
  preview. Supports 32 languages."). It validates without an `unknown_model`
  warning, and `assemblyai/universal-3-6-pro-preview` is a typed `unmodel/stt`
  ref that compiles to `speech_models: ["universal-3-6-pro-preview"]`.
- No cost estimate. https://www.assemblyai.com/pricing publishes pre-recorded
  rates only for Universal-3.5 Pro and Universal-2, so `estimate.costUSD` is
  `undefined` for this id. The library does not guess a rate.
- Same gating as its siblings. The submit reference says `prompt` and
  `remove_audio_tags` are "only supported for the Universal-3.5 Pro model",
  that `temperature` "only takes effect on the Universal-3.5 Pro model", and
  that `summarization` / `auto_chapters` are "only supported for the
  Universal-2 model". On a routing that names only the preview, those params
  are refused with `unsupported_param`, and the unified row leaves them out.
  They are still accepted when the routing can fall through to the model
  that takes them, e.g. `["universal-3-6-pro-preview", "universal-3-5-pro"]`.
