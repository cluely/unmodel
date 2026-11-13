---
"unmodel": patch
---

murf: `gen2` is retired from `murf.ttsStream`

"The Gen2 model has been decommissioned for the Streaming API. If you haven't migrated yet,
use our latest Falcon 2 model on the Streaming API."
(https://murf.ai/api/docs/changelog/2026/10/5, read 2026-11-12). Gen2 itself is not
retired: "Gen2 remains available via Synthesize or non-streaming (Gen2)"
(https://murf.ai/api/docs/introduction/overview).

Retired:

- `model: "gen2"` on `murf.ttsStream` — now an `invalid_enum_value` error naming the
  route that serves it, instead of passing and pricing at the Gen2 rate. Replacement:
  `murf.tts` with `modelVersion: "GEN2"` for Gen2, or `model: "falcon-2.1"` to keep
  streaming. `"gen2"` leaves `STREAM_MODEL_IDS` and `MurfStreamModelId`; the `gen2`
  catalog row and `murf/gen2` in `unmodel/tts` (which compiles to the generate route)
  are unchanged.
- `variation` on `SpeechStreamBody` — the Stream Speech schema does not declare it
  ("variations are Synthesize (Gen 2) only" —
  https://murf.ai/api/docs/text-to-speech/synthesize), so it moves to
  `SpeechGenerateBody`; on the stream route it is now a compile error and a runtime
  `unknown_param` warning. Replacement: `murf.tts`.
