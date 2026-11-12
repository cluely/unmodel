---
"unmodel": patch
---

inworld: `assemblyai/universal-3-5-pro` joins the STT router catalog

- `inworld.realtimeTranscribeConfig` now knows `assemblyai/universal-3-5-pro`
  (WebSocket only, 18 languages, per docs.inworld.ai/stt/third-party): it no
  longer warns `unknown_model`, and `inworld.stt` reports it as
  `unsupported_capability` naming the sync roster, like every other
  WebSocket-only route. It carries no `cost`. Inworld prints "$0.21/hr" for
  it, but in a column whose `inworld/inworld-stt-1` cell is the committed-plan
  $0.10/hr, not the On-Demand $0.15/hr, so the column's tier is unstated.
- The AssemblyAI and Soniox routes now warn (`invalid_enum_value`, severity
  warning) on any `audioEncoding` other than `LINEAR16`. Each vendor block on
  docs.inworld.ai/stt/third-party says "WebSocket streaming only; audio must be
  `LINEAR16`", while the WebSocket reference lists `AUTO_DETECT` for every
  model. The pages disagree, so this is a warning, not an error.
