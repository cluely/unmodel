---
"unmodel": patch
---

lightricks: `ltx-2-5-pro` reaches 1440p/4K and 48fps, LTX-2.5 takes 1:1 / 3:2 / 2:3, and audio-to-video takes the full resolution matrix

FALSE REFUSALS FIXED
- `ltx-2-5-pro` validates at 1440p and 4K and at 48fps, on `lightricks.video`,
  `lightricks.videoFromImage`, `lightricks.videoFromAudio` and through
  `unmodel/video` (its `resolution` now offers `1440p` / `4k` and `fps` offers
  `48`). Its matrix is now the same as `ltx-2-3-pro`'s: every tier at 24, 25,
  48 and 50fps, 6, 8 or 10 seconds. Source: "`ltx-2-5-pro` now generates 1440p
  and 4K in 16:9 and 9:16, and accepts 48 fps, on text-to-video,
  image-to-video, and audio-to-video."
  (https://docs.ltx.io/api-changelog/2026/9/2.md), and the
  https://docs.ltx.io/models/ltx-2-5.md matrix row "| **ltx-2-5-pro** | 720p |
  24, 25, 48, 50 | 6, 8, 10 |", repeated for 1080p, 1440p and 4K.
- `ltx-2-5-fast` and `ltx-2-5-pro` accept twelve more `resolution` values:
  1:1 (`720x720`, `1080x1080`, `1440x1440`, `2160x2160`), 3:2 (`1080x720`,
  `1620x1080`, `2160x1440`, `3240x2160`) and 2:3 (`720x1080`, `1080x1620`,
  `1440x2160`, `2160x3240`), on all three routes and as `aspectRatio` `1:1` /
  `3:2` / `2:3` in `unmodel/video`. LTX-2.3 still refuses them: its resolution
  table has only 16:9 and 9:16 columns. Source: "`ltx-2-5-fast` and
  `ltx-2-5-pro` now generate 1:1, 3:2, and 2:3 video at every resolution from
  720p to 4K, on text-to-video, image-to-video, and audio-to-video."
  (https://docs.ltx.io/api-changelog/2026/10/12.md).
- `lightricks.videoFromAudio` takes the same per-model `resolution` set as
  text-to-video (720p through 4K) instead of 1080p only, plus the `fps`,
  `last_frame_uri` and `camera_motion` fields. `resolution` and `fps` are
  checked against the model's matrix, and an omitted `resolution` is checked
  at the documented default tier (1920x1080). `last_frame_uri` without
  `image_uri` is refused with `invalid_shape`, because the reference page says
  it "Requires `image_uri`". Sources: "**Audio-to-video** now supports the same
  resolution tiers as text-to-video and image-to-video"
  (https://docs.ltx.io/api-changelog/2026/8/18.md); "**Audio-to-video** now
  supports `fps` (default 24), `last_frame_uri` (requires `image_uri`), and
  `camera_motion`" (https://docs.ltx.io/api-changelog/2026/8/19.md); and the
  `AudioToVideoRequest` schema in https://docs.ltx.io/openapi.json.
- `AUDIO_TO_VIDEO_RESOLUTIONS` is removed. It listed the two 1080p strings,
  and the route's resolutions are now per model. Read `SUPPORT_MATRIX` with
  `RESOLUTION_SHAPES`, or `LTX_RESOLUTION_GRID`, instead.

CORRECTED DATA
- `VIDEO_USD_PER_SECOND["ltx-2-5-pro"]` gains 1440p at $0.25/s and 4K at
  $0.39/s, so those requests now get a cost estimate. Source: "1440p is billed
  at $0.25 per second and 4K at $0.39 per second."
  (https://docs.ltx.io/api-changelog/2026/9/2.md), and https://docs.ltx.io/pricing.md.
  Every 1:1 / 3:2 / 2:3 size is billed at the rate of its short side's tier:
  "Each is priced the same as the 16:9 size with the same short side."
  (https://docs.ltx.io/api-changelog/2026/10/12.md).
- `AUDIO_TO_VIDEO_USD_PER_SECOND` is now keyed by model, then tier, like
  `VIDEO_USD_PER_SECOND` (per second of input audio, from
  https://docs.ltx.io/pricing.md): `ltx-2-5-fast` 0.09 / 0.13 / 0.19 / 0.30,
  `ltx-2-5-pro` 0.12 / 0.17 / 0.25 / 0.39, `ltx-2-3-pro` 0.06 / 0.10 / 0.18 /
  0.34 (720p / 1080p / 1440p / 4K). The 1080p figures are unchanged. The route
  still produces no estimate, because the request carries only the audio's URI.
- `ltx-2-5-fast` and `ltx-2-5-pro` are `openWeights: true`. Source: "LTX-2.5
  is an open world model with open weights, built for local execution and
  fine-tuning."
  (https://docs.ltx.io/open-source-model/getting-started/overview.md).
- New exports on `unmodel/lightricks`: `LTX_RESOLUTION_GRID` (tier → shape →
  `WIDTHxHEIGHT`), `RESOLUTION_SHAPES` (the shapes each model renders) and the
  `LtxResolutionShape` type (also on `unmodel/lightricks/types`).
  `LTX_RESOLUTION_TIERS` and `LTX_RESOLUTIONS` now carry all twenty strings.
- `lightricks.video`'s `.toApi("fal")` behaves as before: fal's
  `lightricks/ltx-2.5/text-to-video/pro` row is a strict subset of what LTX
  serves on `ltx-2-5-pro` (720p/1080p, 16:9/9:16, 24/25/50fps), so the new
  native values are refused there rather than mapped. The prompt-cap refusal
  now says that LTX's own schema has the same 5,000-character cap
  (`"maxLength":5000` in https://docs.ltx.io/openapi.json).

All sources read 2026-11-12.
