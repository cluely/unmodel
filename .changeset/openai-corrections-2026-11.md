---
"unmodel": patch
---

openai: three corrections read off the live docs on 2026-11-12 — two were refusals of requests the API accepts

- `openai.imageEdit` no longer refuses `input_fidelity` on `gpt-image-1-mini`.
  The createEdit reference reads "Supports `high` and `low` on
  `gpt-image-1.5`; `gpt-image-1-mini` supports only `low`.", so the param is
  narrowed to `low` (an `invalid_enum_value` for `high`) instead of denied
  outright; the wire arm and the `unmodel/image-edit` extras follow.
- `openai.image` no longer refuses `chatgpt-image-latest`. The create
  reference's model list now ends "…`gpt-image-2.6-flare`, and
  `chatgpt-image-latest`.", so the edits-only gate (an `unsupported_capability`
  error) is gone; the id gets a generations arm with the GPT Image 1 surface
  (`ChatgptImageLatestBody`) and joins `unmodel/image`'s roster. The reference
  also dropped its `dall-e-2` default — "Specify a model explicitly." — which
  is what `openai.image` has always required.
- Every `openai.tts` row (`tts-1`, `tts-1-hd`, `gpt-4o-mini-tts`,
  `gpt-4o-mini-tts-2025-12-15`) and every `openai.stt` row except
  `gpt-transcribe` (`whisper-1`, `gpt-4o-transcribe`, `gpt-4o-mini-transcribe`,
  `gpt-4o-mini-transcribe-2025-12-15`, `gpt-4o-transcribe-diarize`) is now
  `status: "deprecated"` and validates with a `deprecated_model` warning:
  "The following text-to-speech models are deprecated and will be removed from
  the API on January 6, 2027" and "On August 26, 2026, we notified developers
  using `whisper-1`, `gpt-4o-transcribe`, `gpt-4o-mini-transcribe`" (removal
  2027-02-26). No replacement row is added: the named TTS successor
  `gpt-realtime-2.1-mini` is "Speech generation | `v1/audio/speech` | Not
  supported", and the STT successors `gpt-live-transcribe` /
  `gpt-realtime-whisper` are realtime-transcription-session models.

Sources: https://developers.openai.com/api/reference/resources/images/methods/edit.md,
https://developers.openai.com/api/reference/resources/images/methods/generate.md,
https://developers.openai.com/api/docs/deprecations,
https://developers.openai.com/api/docs/models/gpt-realtime-2.1-mini.md,
https://developers.openai.com/api/docs/models/gpt-live-transcribe.md.
