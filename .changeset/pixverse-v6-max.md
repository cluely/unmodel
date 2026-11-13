---
"unmodel": patch
---

pixverse: V6 Max (`v6-max`) joins the catalog, `pixverse.video`, `pixverse.videoFromImage` and `unmodel/video`

PixVerse added V6 Max to text-to-video and image-to-video on 2026-10-22
([changelog](https://docs.platform.pixverse.ai/changelog-2394996m0)). It
used to pass both validators with an `unknown_model` warning, no per-model
checks and no estimate, and `unmodel/video` could not name it. Now it
validates, prices and compiles the way its siblings do:

- `duration` is any integer from 1 to 15 (`PER_SECOND_MODELS`), and
  `aspect_ratio` takes all eight ratios, 2:3, 3:2 and 21:9 included
  ([capability map](https://docs.platform.pixverse.ai/model-capability-map-2394982m0)).
- `generate_audio_switch` is accepted (`AUDIO_SWITCH_MODELS`).
- `template_id` is refused on V6 Max, by the wire validators and by the
  `pixverse/v6-max` row in `unmodel/video`. The capability map marks
  "Video Templates" as "Not supported" for it, and the pricing page says
  "V6 MAX (v6-max) Only support text-to-video/image-to-video now". The new
  `NO_TEMPLATE_MODELS` list (on `unmodel/pixverse` and
  `unmodel/pixverse/values`) names it.
- `generate_multi_clip_switch` stays v5.5 / v6 only. The image-to-video
  schema's `allOf` and the text-to-video error example ("supported in model
  v5.5, v6 only") both leave V6 Max out.
- Estimates are per second, 6 / 9 / 11 / 22 credits silent and 9 / 11 / 15 / 28
  with audio at 360p / 540p / 720p / 1080p
  ([pricing](https://docs.platform.pixverse.ai/pixverse-api-pricing-2394995m0)).
- `.toApi("fal")` refuses `v6-max` with a reason, because fal serves no V6 Max
  endpoint and sending the request to the v6 URL would change the model.

`v5-fast` still has no row. PixVerse gates it by account and publishes no
price and no capability column for it, so it validates with an
`unknown_model` warning.
