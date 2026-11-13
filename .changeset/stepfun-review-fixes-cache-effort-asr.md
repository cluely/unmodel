---
"unmodel": patch
---

stepfun: cache hits are priced, step-3.5-flash-2603's effort ladder is checked, and the ASR row leaves `unmodel/chat`

- `checkChat` now reads StepFun's top-level `usage.cached_tokens` ("A positive
  `response.usage.cached_tokens` value indicates a cache hit and reports the
  number of cached input tokens.",
  https://platform.stepfun.ai/docs/en/guides/developer/prompt-cache.md,
  2026-11-12). Before, it read only `prompt_tokens_details.cached_tokens`, so
  `cachedInputTokens` was missing and every cached token was priced at the
  full input rate. On `step-5-preview`, 900 cached of 1,000 prompt tokens was
  reported as $0.00108 instead of $0.00023. The nested field is still read
  first, and wins when both are present. The fix is in the shared
  openai-compatible checker, so any host that sends the top-level field
  benefits; hosts that never send it are unaffected.
- `reasoning_effort: "medium"` on `step-3.5-flash-2603` is now
  `invalid_enum_value`. It passed clean before. "`step-3.5-flash-2603` accepts
  `low` and `high` only."
  (https://platform.stepfun.ai/docs/en/api-reference/chat/chat-completion-create.md,
  2026-11-12). Every other StepFun model keeps `low` / `medium` / `high`.
- `stepaudio-2.5-asr` is no longer a `ChatModelRef`: the retired ref is
  `stepfun/stepaudio-2.5-asr`. The model is speech recognition, served on
  "POST https://api.stepfun.ai/v1/audio/asr/sse"
  (https://platform.stepfun.ai/docs/en/api-reference/audio/asr-sse.md,
  2026-11-12), not on chat completions. `stepfun.chat` still accepts the id,
  but now warns `unsupported_capability` at `model`, names that route, and
  says unmodel has no validator for it. It used to validate with no warning
  at all.
- `step-tts-2` no longer carries `status: "deprecated"` and no longer warns
  `deprecated_model`. No StepFun page deprecates it: the China reference lists
  it and the Global pricing page prices it. It still warns
  `invalid_enum_value` because it is off the Global reference's enum.
