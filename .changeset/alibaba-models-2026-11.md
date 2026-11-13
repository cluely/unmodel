---
"unmodel": patch
---

alibaba: models.dev refresh (2026-11-12), wan3.0-video-prime + wan2.7-r2v, and the Kimi / Qwen3.8 chat rules

Every fact below was read off Alibaba Cloud Model Studio's international docs
on 2026-11-12.

CATALOG (`alibaba.chat`, generated from models.dev)

- New rows: `kimi-k3`, `qwen3.5-flash`, `qwen3.7-flash` and
  `qwen3.8-omni-flash`, so they validate without an `unknown_model` warning
  and price from their rows. `qwen3.7-flash` prices at its ≤32K tier only (the
  generated catalog carries no context tiers yet), so above 32K input tokens
  its estimate is low.
- Repriced or re-limited rows follow the snapshot, e.g. `qwen3.7-plus`
  ($0.4 / $1.6, output 131,072), `qwen3.6-flash`, `qwen-vl-ocr`
  ($0.07 / $0.16) and `deepseek-v4-flash-0731` (the busy-hours rate,
  $0.44 / $1.32).
- `qwen2-5-14b-instruct`, `qwen2-5-32b-instruct`, `qwen2-5-72b-instruct`,
  `qwen2-5-7b-instruct`, `qwen2-5-vl-72b-instruct` and
  `qwen2-5-vl-7b-instruct` left the catalog: Model Studio decommissioned the
  Qwen2.5 open-source snapshots on 2026-05-13 ("Applications and services that
  continue to call the decommissioned models will fail to return results").
  Use the Qwen3.6 series. Requests naming them still validate, with an
  `unknown_model` warning and no cost estimate.
- Several older rows now carry `status: "deprecated"` (the six ids retired on
  2026-10-10 among them: `qwen2-5-omni-7b`, `qwen-omni-turbo`,
  `qwen-omni-turbo-realtime`, `qwen3-omni-flash-realtime`, `qwen-mt-turbo`,
  `qwen3-livetranslate-flash-realtime`), so requests naming them draw a
  `deprecated_model` warning.

CHAT RULES (`alibaba.chat`)

- `kimi-k3`: `reasoning_effort` must be `max`, `high` or `low` (the Chat
  Completions reference lists no mapped values for it); `parallel_tool_calls`
  draws an `unsupported_param` warning, never an error ("kimi-k3 does not
  support using this parameter to control whether tool calls are parallel").
  `top_p` accepts its documented default 0.95 (and 1); other values are
  refused. `temperature` stays at 1 only, per its catalog row.
- `kimi-k3.1-pro` (no catalog row yet): `temperature` 1, `top_p` 0.95 and
  `presence_penalty` 0 only ("Passing a non-default value for any of these
  parameters returns an error"), and `reasoning_effort` `max` / `high` /
  `medium` / `low`.
- `qwen3.8-omni-flash`, `qwen3.8-max`, `qwen3.8-max-0902`, `qwen3.8-flash`,
  `qwen3.8-2.4t-a95b` and `qwen3.8-27b`: `reasoning_effort` must be one of
  `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`, and sending it
  together with DashScope's `thinking_budget` is refused ("Setting both will
  cause an error").
- `qwen3.8-omni-flash` with `response_format: { type: "json_schema" }` now
  draws an `unsupported_capability` warning: the model offers JSON Mode only
  ("Qwen3.8-Omni-Flash does not support JSON Schema mode").

VIDEO (`alibaba.video`, `unmodel/video`)

- `wan3.0-video-prime`, the high-speed wan3.0 tier, takes the wan3.0-video
  request surface and prices at $0.068 / $0.14 / $0.28 per second for
  480P / 720P / 1080P.
- `wan2.7-r2v` and `wan2.7-r2v-2026-06-12` (reference-to-video): 1–5 reference
  images and videos combined plus an optional `first_frame`, an optional
  `reference_voice` audio URL on a `reference_image` or `reference_video`
  entry (refused on any other entry, and on every other model, since no
  other route documents it), `resolution` 720P/1080P,
  `ratio`, and `duration` 2–15 seconds (2–10 when a reference video is sent);
  $0.10 / $0.15 per second at 720P / 1080P. Through `unmodel/video`, reference
  images and `video` compile to `reference_image` / `reference_video` media.
  `WAN27_R2V_VIDEO_DURATIONS` and `WAN27_R2V_MAX_REFERENCES` are exported from
  `unmodel/alibaba`.

Sources: https://www.alibabacloud.com/help/en/model-studio/model-pricing,
https://www.alibabacloud.com/help/en/model-studio/qwen-api-via-openai-chat-completions,
https://www.alibabacloud.com/help/en/model-studio/kimi-api,
https://www.alibabacloud.com/help/en/model-studio/qwen-omni,
https://www.alibabacloud.com/help/en/model-studio/wan3-video-generation-api-reference,
https://www.alibabacloud.com/help/en/model-studio/wan-video-to-video-api-reference,
https://www.alibabacloud.com/en/notice/model_studio_notice_on_the_decommissioning_of_selected_historical_snapshot_models_730.
