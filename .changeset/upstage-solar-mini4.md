---
"unmodel": patch
---

upstage: `solar-mini4` (Solar Mini 4) joins the `upstage.chat` catalog from the 2026-11-12 models.dev refresh

- `upstage.chat` now validates `solar-mini4` without an `unknown_model`
  warning, caps `max_tokens` at its 131,072-token (128K) output ceiling, and
  prices responses at the vendor list rate of $0.10 input / $0.40 output /
  $0.01 cached input per 1M tokens (dated snapshots such as
  `solar-mini4-260922` price the same way). Source:
  https://console.upstage.ai/docs/models/solar-mini-4.
- `reasoning_effort` stays accepted on `solar-mini4` and `solar-mini4-260922`
  for every documented value (`none`, `minimal`, `low`, `medium`, `high`,
  `xhigh`, `max`): the `solar-mini` family deny does not reach it, although
  models.dev files the model under family `solar-mini`. Source:
  https://console.upstage.ai/docs/capabilities/generate/reasoning.
- `upstage/solar-mini4` joins the `unmodel/chat` model refs, and OpenRouter's
  `upstage/solar-mini4` gains `.toApi("upstage")`.
