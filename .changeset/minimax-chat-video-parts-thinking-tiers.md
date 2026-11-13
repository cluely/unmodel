---
"unmodel": patch
---

minimax: `minimax.chat` accepts video and `detail: "default"` content parts, and encodes the remaining M3-generation rules

Read off MiniMax's OpenAI-compatible chat page and its OpenAPI document
(`MessageContentPart`, `ChatCompletionReq`), 2026-11-12.

- **Fixed a false refusal.** A `{ type: "video_url", video_url: { url, detail?,
  fps?, max_long_side_pixel? } }` user part, and `image_url.detail: "default"`
  (plus `image_url.max_long_side_pixel`), were refused with `invalid_shape` on
  `MiniMax-M3` and `MiniMax-M3.1-Flash`, although both models take text, image
  and video input. They now validate. `url` takes an http(s) URL, a base64
  `data:` URL or a Files API `mm_file://{file_id}` reference; `fps` must be in
  [0.2, 5] and `max_long_side_pixel` an integer ≥ 1. A model the catalog gives
  no video input (the deprecated M2.x rows) refuses the part with
  `unsupported_capability`. The widening is minimax's alone: every other
  OpenAI-compatible overlay still refuses both shapes.
- `unmodel/minimax/types`: `ChatBody` is now `MinimaxChatCompletionsBody`, the
  shared dialect with MiniMax's user content parts, and the new
  `MinimaxChatImagePart`, `MinimaxChatVideoPart`, `MinimaxChatUserContentPart`,
  `MinimaxChatUserMessage` and `MinimaxChatMessage` are exported. Every
  shared-dialect body still satisfies it.
- `MiniMax-M3.1-Flash` refuses `thinking: { type: "disabled" }` with
  `unsupported_param` at `thinking.type` — the documented HTTP 400 ("thinking
  cannot be disabled"). `{ type: "adaptive" }` validates. `MiniMax-M3` keeps
  `disabled`, which is its documented off switch.
- `MiniMax-M3` reports `reasoning_effort` as ignored, for every value (a warning,
  never a refusal): thinking depth is tunable on `MiniMax-M3.1-Flash` only.
- `MiniMax-M3` narrows `service_tier` to `standard` | `priority`; anything else
  is refused with `invalid_enum_value`. On `MiniMax-M3.1-Flash`, which MiniMax
  says does not support the field, `service_tier` is a warning, not a refusal —
  whether the API ignores it or 400s is not stated.
- `unmodel/openai-compatible`: `createOpenAICompatible` takes an optional
  `schema` (the top-level body schema, built with
  `createChatCompletionsSchema(extraShape)`) and a fifth `Body` type argument,
  for an overlay whose wire is wider than the shared dialect. Both default to
  the shared dialect, so existing overlays are unchanged.

Known gap: from `unmodel/chat`, `reasoning: "xhigh"` or `"max"` on
`minimax/MiniMax-M3.1-Flash` still compiles to `reasoning_effort: "high"` with an
`approximated_param` warning, because the encoder narrows to the
chat-completions levels rather than the target model's own ladder. Flash
defaults to `max`, so to get `xhigh` or `max`, set
`providerOptions.minimax.reasoning_effort` or leave `reasoning` unset.

Sources: https://platform.minimax.io/docs/api-reference/text-openai-api,
https://platform.minimax.io/docs/api-reference/text/api/openapi-chat-openai.json
(both 2026-11-12).
