---
"unmodel": patch
---

moonshotai: Kimi K3.1 Pro joins `moonshotai.chat`, six retired Kimi ids leave, and the chat validator learns Kimi's fixed parameters

- `kimi-k3.1-pro` ($2 input / $10 output / $0.20 cached input / $2 5-minute
  cache write per 1M tokens) and `kimi-k3.1-pro-highspeed` ($4 / $20 / $0.20 /
  $4) validate, price and appear as `"moonshotai/kimi-k3.1-pro"` /
  `"moonshotai/kimi-k3.1-pro-highspeed"` refs in `unmodel/chat`. Both have a
  1,048,576-token context window and accept up to 1,048,576
  `max_completion_tokens`. Sources: https://platform.kimi.ai/docs/pricing/chat,
  https://platform.kimi.ai/docs/openapi.json.
- `kimi-k3` now accepts `max_completion_tokens` up to 1,048,576 (131,072 is
  only its default) and prices 5-minute cache writes at $3 per 1M tokens.
- Retired upstream and removed from the moonshotai catalog:
  `kimi-k2-0711-preview`, `kimi-k2-0905-preview`, `kimi-k2-turbo-preview`,
  `kimi-k2-thinking`, `kimi-k2-thinking-turbo` (the K2 series, retired May
  2026) and `kimi-k2.5` (retired August 2026; calls return 404). Kimi's
  migration target is `kimi-k3`; `kimi-k3.1-pro` / `kimi-k3.1-pro-highspeed`
  are the current flagships. These ids now validate with an `unknown_model`
  warning and no cost estimate. Source:
  https://platform.kimi.ai/docs/platform-changelog.
- `moonshotai.chat` enforces Kimi's fixed sampling parameters on every model
  it serves: `top_p` must be 0.95 (it previously refused 0.95 and accepted 1,
  the reverse of what the API does), `n` must be 1, and `presence_penalty` /
  `frequency_penalty` must be 0. Passing the fixed value itself still
  validates. Source: https://platform.kimi.ai/docs/api/models-overview.
- `moonshotai.chat` refuses a function-object `tool_choice` on `kimi-k3`,
  `kimi-k3.1-pro` and `kimi-k3.1-pro-highspeed`: the K3 series always thinks,
  and Kimi returns 400 "tool_choice 'specified' is incompatible with thinking
  enabled". Use `"required"` to force a tool call. Source:
  https://platform.kimi.ai/docs/guide/use-tool-choice.
- `moonshotai.chat` refuses `prompt_cache_breakpoint` on content parts (Kimi
  rejects the request with HTTP 400 and caches request prefixes on its own) and
  SVG `data:` URLs in `image_url` parts (Kimi accepts JPEG, PNG, GIF, WebP,
  BMP, HEIC and HEIF). Sources: https://platform.kimi.ai/docs/api/chat,
  https://platform.kimi.ai/docs/guide/use-kimi-vision-model.
