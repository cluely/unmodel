---
"unmodel": patch
---

soniox: Soniox STT v6 — `stt-async-v6` and `stt-rt-v6` — plus `enable_agent_text_input`

- `stt-async-v6` (`soniox.stt`, and `soniox/stt-async-v6` on `unmodel/stt`)
  and `stt-rt-v6` (`soniox.realtimeTranscription`) join the catalog. They were
  released November 3, 2026 and are "fully compatible with the existing v5
  models and Soniox API" (https://docs.soniox.com/stt/models). Pricing is the
  same per-mode rate as v5: $0.10/hour async, $0.12/hour real-time
  (https://soniox.com/pricing).
- `soniox.realtimeTranscription` accepts `enable_agent_text_input`, typed on
  `RealtimeTranscriptionConfig`. The WebSocket reference says it is
  "Supported only by `stt-rt-v6`", and the agent-text-input page lists
  "`enable_agent_text_input` on a model that doesn't support it." under
  "These errors end the stream". So `true` on `stt-rt-v5` or `stt-rt-v4` is
  now an `unsupported_param` error that names `stt-rt-v6`. `false`, and ids
  missing from the catalog, still pass.
- `endpoint_sensitivity` and `endpoint_latency_adjustment_level` no longer
  warn on `stt-rt-v6`: they are "Supported by `stt-rt-v5` and `stt-rt-v6`"
  (https://docs.soniox.com/api-reference/stt/websocket-api). The warning on
  other catalogued ids now gives that model list as `meta.supportedModels`.
- The cost-estimation docs on both validators now say that context,
  translation and agent text are billed per input text token on top of the
  hourly rate, which makes a per-minute estimate a lower bound.
