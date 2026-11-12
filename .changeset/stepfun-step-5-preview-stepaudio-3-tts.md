---
"unmodel": patch
---

stepfun: `step-5-preview` on `stepfun.chat`, `stepaudio-3-tts` on `stepfun.tts` with its 500-character instruction cap

- `stepfun.chat` (models.dev refresh, 2026-11-12) adds `step-5-preview`
  (text, image and video in; 1,000,000-token context, 65,536-token output;
  tools, structured output, reasoning). `max_tokens` above 65,536 is
  `over_output_limit`, matching the model page's "64k tokens"
  (https://platform.stepfun.ai/docs/en/guides/models/step-5-preview.md).
  The other StepFun chat rows pick up models.dev's new prices and the
  `structuredOutput` flag.
- `step-1-32k` and `step-2-16k` are removed from the StepFun catalog and from
  `ChatModelRef` (`stepfun/step-1-32k`, `stepfun/step-2-16k`): StepFun retired
  both on July 8, 2026, and names `step-1o-turbo-vision` as the replacement
  (https://platform.stepfun.ai/docs/en/guides/model-migration.md,
  https://platform.stepfun.com/docs/zh/guides/models/deprecations.md). Sending
  either id to `stepfun.chat` now draws `unknown_model`.
- `stepfun.tts` accepts `stepaudio-3-tts`, which the create-speech reference
  now lists ("Currently supports `stepaudio-3-tts` and `stepaudio-2.5-tts`",
  https://platform.stepfun.ai/docs/en/api-reference/audio/create-audio.md).
  It gets a hand catalog row (models.dev does not carry it yet), joins
  `TTS_MODELS` / `TTS_MODEL_PARAMS` on `unmodel/stepfun/values`, and is
  reachable from `unmodel/tts` as `stepfun/stepaudio-3-tts` with the same
  codecs and the `instruction` / `volume` extras. It carries no cost: the
  model card ("$0.36 / 10,000 characters") and the pricing page ("$14.00 / 1M
  billable input text characters" from November 17, 2026, weighted per
  script) disagree, so no `costUSD` is estimated.
- The `instruction` cap is now per model — "200 characters for
  `stepaudio-2.5-tts`, 500 characters for `stepaudio-3-tts`". A 201–500
  character instruction on `stepaudio-3-tts` was refused before; it now
  passes. Over the cap is still `invalid_shape` at `instruction`, and the
  message names both caps. Ids with no documented cap (`step-tts-2`) are not
  capped.
- **Breaking:** `MAX_INSTRUCTION_CHARACTERS` (from `unmodel/stepfun`) is now
  the per-model table `{ "stepaudio-3-tts": 500, "stepaudio-2.5-tts": 200 }`
  instead of the number `200`. Read `MAX_INSTRUCTION_CHARACTERS[model]`.
