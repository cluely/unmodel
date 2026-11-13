---
"unmodel": patch
---

mistral: Voxtral 3 takes `language` with timestamps, `codestral-latest` is Codestral 25.08, and two non-chat refs leave `unmodel/chat`

`mistral.stt`

- The "`timestamp_granularities` is not compatible with `language`" refusal
  now applies only to `voxtral-mini-latest`, `voxtral-mini-2602`,
  `voxtral-small-latest` and `voxtral-small-2507`, the ids on the deprecated
  page that states it. The Voxtral 3 pages document the two fields
  independently ("Pinning the language can improve accuracy.",
  https://docs.mistral.ai/studio/audio/speech-to-text/transcribe-files,
  2026-11-12). Before, a diarized request with a pinned language was refused on
  every Voxtral 3 id, because diarization there needs segment timestamps. The
  `unmodel/stt` call `{ model: "mistral/voxtral-mini-transcribe-3", diarization:
  true, timestamps: "segment", language: "fr" }` now validates.
- The `speaker_references` refusals cite
  https://docs.mistral.ai/studio/audio/speech-to-text/diarize-speakers, the page
  whose error table states them.

`mistral.chat`

- `codestral-latest` validates and prices as Codestral 25.08: the card lists
  `"names":["codestral-2508","codestral-latest"]`
  (https://docs.mistral.ai/models/codestral-25-08). models.dev carried the 2024
  Codestral row under the alias, so `max_tokens` 4097–8192 was refused as
  `over_output_limit` although `codestral-2508` accepts it.
- `mistral-medium-3-5`, `mistral-medium-3` and `mistral-medium-latest` are named
  "Mistral Medium 3.5", the row of the 26.04 snapshot they resolve to, not
  "Mistral Medium (latest)".

`unmodel/chat`

- `"mistral/mistral-embed"` and `"mistral/voxtral-mini-latest"` are no longer
  `ChatModelRef`s or `CHAT_MODEL_REFS` entries. Neither model is served by
  POST /v1/chat/completions: `mistral-embed` answers /v1/embeddings
  (https://docs.mistral.ai/models/mistral-embed-23-12), and
  `voxtral-mini-latest` answers only /v1/audio/transcriptions
  (https://docs.mistral.ai/models/voxtral-mini-transcribe-26-02), which is
  `stt` from `unmodel/mistral`.
