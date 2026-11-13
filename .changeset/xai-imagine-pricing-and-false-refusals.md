---
"unmodel": patch
---

xai: Grok Imagine pricing follows resolution and quality, and five requests xAI fulfils are no longer refused (every fact re-read off docs.x.ai on 2026-11-12)

Pricing — the per-resolution rates live only in the rendered "Imagine" table on
https://docs.x.ai/developers/pricing, and the estimates now use them:

- Video, per second: grok-imagine-video $0.05 at 480p and $0.07 at 720p (it
  serves up to 720p, so it has no 1080p rate); grok-imagine-video-1.5
  $0.08 / $0.14 / $0.25 at 480p / 720p / 1080p; grok-imagine-video-1.5-lite
  $0.02 / $0.03 / $0.14. Each input image (`image` and each `reference_images`
  entry) adds $0.01, or $0.002 on grok-imagine-video. `videoPriceUSD` takes an
  optional third argument, `{ resolution, inputImages }`.
- `xai.videoExtend` no longer returns an estimate: grok-imagine-video bills the
  input clip at $0.01 per second, and the clip's length is not in the request.
- Image, per image: grok-imagine-image-2.0 is $0.04 / $0.05 / $0.06 at
  1k / 1.5k / 2k at low quality and $0.06 / $0.07 / $0.08 at medium quality.
  An omitted or `"auto"` quality is priced as low, because "Auto currently uses
  `low` for image generation"
  (https://docs.x.ai/developers/model-capabilities/images/generation).
  grok-imagine-image has 1k and 2k rates only, so a 1.5k request has no estimate.
- grok-imagine-image-quality was retired on 2026-11-02, but the id still works
  and is served by 2.0 at low quality. It now prices at that rate ($0.04 at 1k,
  down from $0.05) and comes with a `deprecated_model` warning
  (https://docs.x.ai/developers/migration/imagine-image-quality-nov-2).
- New exports from `unmodel/xai`: `IMAGE_RATES`, `IMAGE_MEDIUM_RATES`,
  `VIDEO_RATES` and `VIDEO_INPUT_IMAGE_USD`. `IMAGE_QUALITY_PER_IMAGE_USD` is
  now 0.04.

Requests xAI fulfils that were refused:

- `aspect_ratio` `"21:9"` and `"5:2"` on every video id, as listed in the REST
  reference and the OpenAPI `VideoAspectRatio` enum.
- `prompt` may be omitted on `xai.video` and `unmodel/video` when the request
  includes `image`, `reference_images`, `reference_audios`, `last_frame` or
  `keyframes`. It is still required for text-to-video ("it is required only for
  text-to-video").
- `image` together with `reference_images` is allowed on grok-imagine-video-1.5,
  where it "is reference-to-video with a pinned first frame". Only
  grok-imagine-video still refuses the combination.
- `xai.image` accepts `resolution: "1.5k"` and grok-imagine-image-2.0's
  `quality` (`"low" | "medium" | "auto"`). `IMAGE_QUALITIES` and
  `XaiImageQuality` are exported. Neither field has a canonical spelling in
  `unmodel/image`, so both are set through `providerOptions.xai`.
- The model aliases xAI documents now validate and price as the model they
  point to: `grok-imagine-image-2026-03-02` (grok-imagine-image), and
  `grok-imagine-video-1.5-preview` and `grok-imagine-video-1.5-2026-05-30`
  (grok-imagine-video-1.5). They are exported as `IMAGE_MODEL_ALIASES` and
  `VIDEO_MODEL_ALIASES`.
