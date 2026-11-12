---
"unmodel": patch
---

xai: `grok-4.7` and `grok-imagine-video-1.5-lite` (models.dev refresh 2026-11-12, every fact re-read off docs.x.ai)

- `xai.chat` validates and prices `grok-4.7` ($2.00 input / $0.50 cached /
  $6.00 output per 1M below 200k prompt tokens — https://docs.x.ai/developers/models).
  It is a reasoning model, so `frequency_penalty`, `presence_penalty` and `stop`
  are refused as on the rest of the reasoning line ("Requests that include them
  return an error" — https://docs.x.ai/developers/model-capabilities/text/reasoning).
  `reasoning_effort: "xhigh"` passes. The ≥200k long-context tier ($4 / $1 / $12)
  is not modelled: `ModelCost` has no tier field yet.
- `xai.video` and `unmodel/video` accept `grok-imagine-video-1.5-lite`, priced at
  "$0.020 / sec" (https://docs.x.ai/developers/models). It serves text-to-video
  and image-to-video only, per the capability matrix on
  https://docs.x.ai/developers/model-capabilities/video/overview: `reference_images`
  and `reference_audios` are refused with `unsupported_capability` naming
  grok-imagine-video-1.5, `xai.videoEdit` / `xai.videoExtend` refuse the id naming
  grok-imagine-video, and the unified adapter gives it no reference route and no
  `reference_audios` extra. `VIDEO_TEXT_IMAGE_ONLY_MODELS` and
  `VIDEO_1_5_LITE_PER_SECOND_USD` are exported from `unmodel/xai`.
- `grok-imagine-image-2.0` and `grok-imagine-image-quality` left models.dev but
  xAI still serves both, so they stay valid on `xai.image` as hand rows
  (text, image → image; `limit.context: 0`, since xAI publishes no prompt limit).
- The mirrored Imagine rows follow the snapshot: `grok-imagine-image` is
  text, image → image with a 16,000 context, and both video rows drop `pdf` input.
