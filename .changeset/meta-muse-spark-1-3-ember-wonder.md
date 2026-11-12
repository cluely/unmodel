---
"unmodel": patch
---

meta: Muse Spark 1.3, Muse Ember and Muse Wonder validate and price; `meta.chat` refuses the request fields Meta's Chat Completions endpoint documents as HTTP 400

- New catalog rows (models.dev refresh, 2026-11-12): `muse-spark-1.3`,
  `muse-spark-1.3-contributor`, `muse-ember-1.0` and `muse-wonder-1.0` validate
  on `meta.chat` and in `unmodel/chat` (`"meta/<id>"`), with cost estimates at
  Meta's published per-1M-token rates (https://dev.meta.ai/docs/pricing-rate-limits).
  `muse-spark-1.1` now carries the documented 1,048,576-token context window.
- `muse-ember-1.0` caveat: Meta bills a request over 200K input tokens at the
  long-context rates in full ($0.30 / $1.50 / $0.012 per 1M). Estimates use the
  up-to-200K rates, so they run 3x low above that threshold.
- `meta.chat` now refuses, for every Muse model, what Meta's docs say returns
  HTTP 400 (so does `unmodel/chat`, whose meta bodies finish in `meta.chat`;
  `stopSequences` is refused there as the `stop` it compiles to):
  - `stop`, `logit_bias`, `prediction`, `verbosity`, `web_search_options`,
    `modalities`, `audio`, `max_output_tokens` and `text.format`
    (https://dev.meta.ai/docs/protocols/chat-completions);
  - `reasoning_effort: "none"` (every Muse model always reasons; the accepted
    levels are `minimal` through `max`), `logprobs: true`, and `n` above 1;
  - `tool_choice` other than `"auto"`, `custom` tools, and function tool names
    that do not match `^[a-zA-Z0-9_.-]+$` or contain more than one dot
    (https://dev.meta.ai/docs/tool-calling);
  - `temperature` outside 0–2 and `top_p` outside `0 < top_p ≤ 1`
    (https://dev.meta.ai/docs/error-handling);
  - more than 50 images in one request (https://dev.meta.ai/docs/media-understanding).
- Not refused, because Meta never states a 400 for them: `frequency_penalty`,
  `presence_penalty`, `top_logprobs`, and `reasoning_effort: "max"` on
  `muse-spark-1.2`, `muse-spark-1.1` and the contributor ids.
