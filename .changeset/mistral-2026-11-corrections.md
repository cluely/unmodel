---
"unmodel": patch
---

mistral: `mistral-large-latest` is Large 4, `context_bias` takes phrases, `speaker_references` is typed, and the deprecations warn

Corrections to rows and rules that already existed, each read off
docs.mistral.ai on 2026-11-12.

`mistral.chat`

- `mistral-large-latest` now validates and prices as Mistral Large 4 — the
  card lists `"names":["mistral-large-4","mistral-large-4-0","mistral-large-latest"]`
  (https://docs.mistral.ai/models/mistral-large-4-0), while models.dev still
  carried Mistral Large 3 under it. Before, `reasoning_effort: "high"` (the
  value the reasoning guide recommends) was refused as `unsupported_capability`,
  prompts between 262k and 1M tokens were refused as `over_context`, and cost
  estimates used Large 3's $0.5 / $1.5 instead of $0.7 / $2.1 per 1M. It also
  joins the Large 4 `reasoning_effort` ladder (`low` / `medium` / `high`).
- `ministral-3b-latest` carries Ministral 3 3B's 262,144-token window ("Context
  i 256k", https://docs.mistral.ai/models/ministral-3-3b-25-12); models.dev's
  128,000 refused valid long prompts.
- `mistral-large-2512`, `mistral-medium-latest` and `mistral-medium-2604` now
  warn `deprecated_model`: deprecated 2026-10-31, served until 2027-04-30,
  replaced by Mistral Large 4 (https://docs.mistral.ai/getting-started/models).

`mistral.stt`

- `context_bias` entries may contain spaces and commas on every model. The
  no-comma/no-whitespace rule had no documented source: openapi.yaml types the
  entries as plain strings, and "Spaces, commas, and other punctuation are
  accepted"
  (https://docs.mistral.ai/studio/audio/speech-to-text/bias-context-and-vocabulary).
  The 100-entry cap stays on the pre-Voxtral 3 ids, whose page states it.
- New wire field `speaker_references` (speaker name → base64 reference clip),
  from openapi.yaml's `AudioTranscriptionRequest`; `ExactKeys` made it a compile
  error. It requires `diarize: true` ("When enabled, diarize must be true"; a
  422 otherwise) and takes at most 8 entries ("At most 8 speaker references are
  supported, got {n}", https://docs.mistral.ai/studio/audio/specs-and-limits/limits)
  — new export `MAX_SPEAKER_REFERENCES`. `toFormData` sends it as one JSON form
  field, as the Mistral SDK does. Not every model takes reference clips ("The
  model doesn't accept reference clips", https://docs.mistral.ai/studio/audio/speech-to-text/diarize-speakers),
  but Mistral names none, so unmodel refuses the field on no id.
- `voxtral-mini-2602`, `voxtral-mini-latest`, `voxtral-mini-transcribe-realtime-2602`
  and `voxtral-mini-realtime-latest` now carry `status: "deprecated"`, so the
  two transcription ids warn `deprecated_model`: deprecated 2026-10-31, served
  until 2027-04-30, replaced by the Voxtral 3 models.
- Provenance URLs follow Mistral's moved pages: the pre-Voxtral 3 transcription
  page is now `/studio/audio/deprecated/speech_to_text/offline_transcription`,
  model cards live at `/models/<card>`, and the `unmodel/stt` adapter cites the
  current `/studio/audio/speech-to-text/transcribe-files`.
