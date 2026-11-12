---
"unmodel": patch
---

mistral: retire `voxtral-mini-2507`

Mistral retired Voxtral Mini Transcribe (`voxtral-mini-2507`) on 2026-05-31 —
"Voxtral Mini Transcribe ↗ 25.07 voxtral-mini-2507 2/27/2026 5/31/2026 Voxtral
Mini Transcribe 2" (https://docs.mistral.ai/getting-started/models, checked
2026-11-12) — and "Once retired, requests to its identifiers fail with a 404
error" (https://docs.mistral.ai/inference/model-lifecycle).

- `mistral.stt` no longer catalogs it: it leaves `transcriptionSupplementModels`
  (and `MistralTranscriptionSupplementModelId`), `TRANSCRIPTION_MAX_AUDIO_SECONDS`
  and `TRANSCRIPTION_MODEL_IDS`. A request naming it now validates with an
  `unknown_model` warning and no 15-minute cap.
- `unmodel/stt` drops the `mistral/voxtral-mini-2507` ref and its
  `STT_MODELS` / `STT_MODEL_PARAMS` entry in `unmodel/mistral/values`.

Replacement: Voxtral Mini Transcribe 2 (`voxtral-mini-2602`, or
`voxtral-mini-latest`) — itself deprecated since 2026-10-31 and served until
2027-04-30 — or its successor Voxtral Mini Transcribe 3
(`voxtral-mini-transcribe-3`).
