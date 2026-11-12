---
"unmodel": patch
---

mistral: Mistral Large 4, GLM 5.3, Ministral 3, Voxtral 3 transcription — and the rules they need

The mistral slice of the 2026-11-12 models.dev refresh, plus what the new models
needed beyond it. Every hand fact was read off docs.mistral.ai on 2026-11-12.

CATALOG

- New generated rows: `codestral-2508`, `deepseek-v4-1-flash-1017`,
  `ministral-3b-2512`, `ministral-8b-2512`, `ministral-14b-2512`,
  `mistral-large-4`, `zai-glm-5-3`, `zai-glm-5-3-flash` and the chat-capable
  `voxtral-small-2507`. `ministral-3b-latest` / `ministral-8b-latest` now carry
  Ministral 3's rates ($0.1 / $0.15 per 1M), 256k-class windows and image
  input; `voxtral-small-latest` output is $0.4 per 1M.
- Ids models.dev dropped, all retired by Mistral (requests 404, per
  https://docs.mistral.ai/getting-started/models): `devstral-medium-2507`,
  `devstral-small-2505`, `devstral-small-2507`, `magistral-small`,
  `mistral-large-2411`, `mistral-nemo`, `open-mistral-7b`,
  `open-mixtral-8x22b`, `open-mixtral-8x7b`, `pixtral-large-latest`. They now
  validate with an `unknown_model` warning and no cost estimate. Mistral's
  named replacements: Mistral Medium 3.5 for `devstral-medium-2507`,
  `devstral-small-2505`, `mistral-large-2411` and `pixtral-large-latest` (and
  Medium 3.5 is itself deprecated in favour of `mistral-large-4`); Mistral
  Small 4 (`mistral-small-latest`) for `devstral-small-2507`, `magistral-small`
  and both Mixtrals; Ministral 3 8B (`ministral-8b-2512`) for `mistral-nemo` and
  `open-mistral-7b`.
- Two new generated rows name models Mistral has already retired, and are
  reported upstream rather than hidden: `glm-5-2` (alias of `zai-glm-5-2`,
  retired 2026-10-31) and `labs-leanstral-1-5-1` (no vendor page carries this
  spelling; Leanstral 1.5 retired 2026-09-30). Both carry models.dev's
  `deprecated` status, so they warn.

`mistral.chat` — `chatModels`, the generated catalog plus what models.dev lacks

- Vendor aliases, each priced as the model it serves (the card's `"names"`
  array): `mistral-large-4-0` (Large 4), `mistral-medium-3-5` and
  `mistral-medium-3` (Medium 3.5, deprecated 10/31/2026 and served until
  4/30/2027 — they warn), `ministral-14b-latest`, `zai-glm-5` and
  `zai-glm-latest` (GLM 5.3). New type `MistralChatModelId`; `ChatBody`'s
  default model union is now that one.
- `mistral-large-4` is GA (card: "November 5, 2026 GA") and open-weight (the
  card's Weights tab links huggingface.co/mistralai/Mistral-Large-4-1T-A52B).
- `ministral-3b-2512`'s context is 262,144 (card: "Context 256k"; models.dev's
  131,072 refused valid long prompts as `over_context`).
- `deepseek-v4-1-flash-1017` takes images ("with text and image inputs",
  https://docs.mistral.ai/getting-started/models), so `image_url` parts no
  longer fail.

RULES

- `reasoning_effort` on Mistral Large 4 (`mistral-large-4`, `mistral-large-4-0`)
  must be `low`, `medium` or `high` — "Mistral Large 4 does not accept none ,
  minimal , xhigh , or max" — and on Z.ai GLM 5.3 (`zai-glm-5-3`, `zai-glm-5`,
  `zai-glm-latest`, `zai-glm-5-3-flash`) `low`, `high` or `max` — "none is not
  supported" (https://docs.mistral.ai/inference/conversations/reasoning). A
  `"none"` previously validated on both and came back a 400; it is now an
  `invalid_enum_value` naming the levels each model takes.

`mistral.stt` — Voxtral 3

- New transcription ids, priced from the cards and the pricing page: Voxtral
  Mini Transcribe 3 (`voxtral-mini-transcribe-3-0` / `-3` / `-latest`,
  $0.0035/min) and Voxtral Small Transcribe 3 (`voxtral-small-transcribe-3-0` /
  `-3` / `-latest`, $0.004/min), in Public Preview. New export
  `VOXTRAL_3_TRANSCRIPTION_MODEL_IDS`; `TRANSCRIPTION_MODEL_IDS` gains them.
- On those ids, `timestamp_granularities` takes `"segment"` only ("word returns
  a 400 error") and `diarize: true` needs segment timestamps (a 422 otherwise),
  per https://docs.mistral.ai/studio/audio/migrate-from-voxtral-2 and
  https://docs.mistral.ai/studio/audio/speech-to-text/transcribe-files. They
  document no audio-length cap, so none is enforced, and their `context_bias`
  takes phrases and free-form passages with "no fixed number of entries" — the
  100-term cap and the no-whitespace rule now apply to the earlier Voxtral ids
  only.
- The realtime ids — Voxtral Mini Transcribe Realtime 3
  (`voxtral-mini-transcribe-realtime-3-0` / `-3` / `-latest`, $0.008/min) and
  `voxtral-mini-realtime-latest` (the 2602 realtime model's alias) — are
  catalogued and rejected by name as WebSocket-only, instead of passing as
  unknown models.
- `voxtral-small-2507` is now a generated row with its per-minute rate layered
  on in `transcriptionModels`, so `MistralTranscriptionSupplementModelId` no
  longer includes it.
- `unmodel/stt` reaches the six Voxtral 3 ids; their `timestamps` row is
  `"none" | "segment"`, so `timestamps: "word"` is a compile error there.
