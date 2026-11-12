---
"unmodel": patch
---

deepseek: `deepseek-flash` joins the catalog, and `deepseek.chat` enforces DeepSeek's documented thinking-mode and endpoint rules

- `deepseek-flash` (DeepSeek-V4.1-Flash-1017, text and image input) validates
  and prices like its siblings: a 1,048,576-token context, `max_tokens` up to
  393,216, and $0.15 input / $0.003 cache hit / $0.60 output per 1M tokens.
- The legacy names `deepseek-v4-flash` and `deepseek-v4-flash-vision-exp` stay
  reachable and now warn `deprecated_model`: DeepSeek retired both models and
  serves both names with DeepSeek-V4.1-Flash-1017 at the Flash price, so their
  rows now carry that model's limits, image input and rates.
- `deepseek-v4-pro` is repriced to $0.66 input / $0.022 cache hit / $1.98
  output per 1M tokens.
- Every deepseek id accepts `max_tokens` up to the documented 393,216; values
  from 384,001 up were refused before.
- Cost estimates use DeepSeek's off-peak rates (what models.dev carries). Peak
  hours — 01:00–04:00 and 06:00–10:00 UTC, Monday to Friday, excluding Chinese
  public holidays — bill at twice these rates, which the estimate does not model.

New refusals, each a documented 400:

- `tool_choice: "required"` or a named function choice while thinking mode is on,
  which is DeepSeek's default. Turn thinking off with `reasoning_effort: "none"`
  or `thinking: { type: "disabled" }`, or use `"auto"` / `"none"`.
- `stream_options` without `stream: true`.
- `reasoning_effort` outside DeepSeek's values: `none`, `low`, `high`, `max`,
  the compatibility aliases `minimal`, `medium`, `xhigh`, and `ultra`.
- Inline or declared images on the image-capable ids beyond JPEG/PNG/GIF/WebP,
  32 MiB, or 8192 px per side.

New warnings (the API accepts the value and does not use it):
`frequency_penalty` and `presence_penalty` ("no longer supported"),
`temperature` in thinking mode, and `top_p` where the model fixes or clamps it
(`deepseek-flash` raises values below 0.95 in thinking mode and ignores the
value in non-thinking mode; `deepseek-v4-pro` ignores it in thinking mode).

Sources, all checked 2026-11-12:
https://api-docs.deepseek.com/api/create-chat-completion,
https://api-docs.deepseek.com/api/list-models,
https://api-docs.deepseek.com/quick_start/pricing,
https://api-docs.deepseek.com/guides/vision,
https://api-docs.deepseek.com/guides/thinking_mode,
https://api-docs.deepseek.com/updates.
