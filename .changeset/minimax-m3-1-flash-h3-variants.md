---
"unmodel": patch
---

minimax: MiniMax-M3.1-Flash on `minimax.chat`, and MiniMax-H3-Highspeed / -Lite / -Max on `minimax.videoV2`

Read off MiniMax's live docs on 2026-11-12 — the OpenAI-compatible chat page and
its OpenAPI document, the v2 video-generation OpenAPI document, and the pricing
overview.

CHAT (`minimax.chat`, `unmodel/chat` as `minimax/…`)

- `MiniMax-M3.1-Flash` joins the generated catalog: 1,000,000-token context,
  524,288-token completion maximum, text + image + video in, $0.15 / $0.60 /
  $0.015 (cache read) per 1M tokens. It validates and prices like its siblings,
  `minimax/MiniMax-M3.1-Flash` is a `unmodel/chat` ref, and the hosts that serve
  it (openrouter, vercel, huggingface, nebius, novita-ai, nvidia) gain a
  `.toApi("minimax")` edge to it.
- `MiniMax-M3` is corrected by the same refresh: context 1,000,000 (was
  1,048,576) and completion maximum 524,288 (was 512,000 — a
  `max_completion_tokens` between the two used to be refused with
  `over_output_limit`). Both M3 models now carry `structuredOutput: false`, so a
  `response_format: { type: "json_schema" }` is refused: the OpenAI-compatible
  request body has no `response_format` field.
- The M2 / M2.1 / M2.5 / M2.7 rows are marked `deprecated` (a
  `deprecated_model` warning); MiniMax's model list files them as retired or
  retiring on 2026-11-18, with MiniMax-M3.1-Flash as the replacement.
  `MiniMax-M2.5-highspeed`'s cache-read rate follows models.dev to $0.03 per 1M
  (MiniMax's pricing page no longer lists any M2.x rate).
- New rules on `MiniMax-M3.1-Flash`: `reasoning_effort` must be `low`, `medium`,
  `high`, `xhigh` or `max` (`none` returns HTTP 400 — "MiniMax-M3.1-Flash always
  thinks"), so `unmodel/chat`'s `reasoning: false` is now a typed refusal on this
  model instead of a 400.
- On both `MiniMax-M3` and `MiniMax-M3.1-Flash`: `n` must be 1; the deprecated
  `function_call` is refused in favour of `tools`; `presence_penalty`,
  `frequency_penalty` and `logit_bias` are reported as ignored (a warning, never
  a refusal); `temperature` and `top_p` are reported as ignored ("any value
  passed has no effect"; the models always use 1 and 0.95), and `top_p` outside
  (0, 1] is refused.

VIDEO (`minimax.videoV2`, `unmodel/video` as `minimax/…`)

- `MiniMax-H3-Highspeed`, `MiniMax-H3-Lite` and `MiniMax-H3-Max` join
  `MiniMax-H3` on POST /v2/video_generation, with per-model rules:
  - resolution: `MiniMax-H3` renders `768P`/`2K`; the other three `480P`/`768P`
    (`480P` is new to the route, and canonical `480p` maps to it exactly);
  - duration: 4–15 seconds, except `MiniMax-H3-Max` at 5–15;
  - `MiniMax-H3-Lite` refuses an `"adaptive"` (or omitted) `ratio` for
    reference-to-video;
  - `MiniMax-H3-Max` takes the new `extra: { prompt_expansion_mode:
    "disabled" | "balanced" | "quality" }`; undeclared fields inside `extra` are
    refused, and `extra` on the other three is flagged as undocumented (a
    warning).
- Pricing is per model and resolution, per second of output: H3 $0.08 (768P) /
  $0.13 (2K); Highspeed $0.06 / $0.04 (480P); Lite $0.04 / $0.025 (480P); Max
  $0.08 / $0.05 (480P). Input images beyond the free quota add $0.04 / $0.03 /
  $0.02 each (first 5 free) and $0.074 on Max (first 2 free).
- New exports on `unmodel/minimax`: `VIDEO_V2_MODEL_RULES` (the per-model table
  above), `VIDEO_V2_PROMPT_EXPANSION_MODES`, and the types `VideoV2ModelRule`,
  `MinimaxVideoV2Extra`, `MinimaxVideoV2PromptExpansionMode`.
  `VIDEO_V2_RESOLUTIONS` gains `"480P"`.
- Removed: `VIDEO_V2_USD_PER_SECOND`, `VIDEO_V2_FREE_IMAGES` and
  `VIDEO_V2_USD_PER_EXTRA_IMAGE` — route-wide constants that were MiniMax-H3's
  rates. Read `VIDEO_V2_MODEL_RULES[model].usdPerSecond`, `.freeImages` and
  `.usdPerExtraImage` instead.

Sources: https://platform.minimax.io/docs/api-reference/text-openai-api,
https://platform.minimax.io/docs/api-reference/text/api/openapi-chat-openai.json,
https://platform.minimax.io/docs/api-reference/video/generation/api/v2-video-generation.json,
https://platform.minimax.io/docs/pricing/overview,
https://platform.minimax.io/docs/faq/models (all 2026-11-12).
