---
"unmodel": patch
---

kling: retire the models Kling retired on 2026-09-15

Kling's 2026-08-13 announcement on https://kling.ai/document-api: "selected legacy
models, video effect templates, and the Virtual Try-On API will be retired on
September 15, 2026" — Kling 1.0, 1.5, 1.6, 2.0 Master, 2.1 and 2.1 Master (video)
and Kling Image 1.0, 1.5, 2.0 and 2.0 New. The current references agree (read
2026-11-12): `POST /v1/videos/text2video` and `/image2video` take
`enum:["kling-v2-5-turbo","kling-v2-6","kling-v3"]`
(`/api/video/3-0-omni/text-to-video/legacy`, `/image-to-video/legacy`) and
`POST /v1/images/generations` takes `enum:["kling-v2-1","kling-v3"]` with
`default:"kling-v3"` (`/api/image/3-0-omni/image-generation`).

Retired ids, with their replacements:

- Video (`kling.video`, `kling.videoFromImage`, `unmodel/video`): `kling-v1`,
  `kling-v1-5`, `kling-v1-6`, `kling-v2-master`, `kling-v2-1`, `kling-v2-1-master`
  → `kling-v3` (or `kling-v2-6` / `kling-v2-5-turbo`; Kling 4.0 on the
  path-addressed routes). `kling-v2-1` stays as the Kling Image 2.1 model on
  `kling.image`.
- Image (`kling.image`, `unmodel/image`): `kling-v1`, `kling-v1-5`, `kling-v2`,
  `kling-v2-new` → `kling-v3` (or `kling-v2-1`).

They leave the catalogs, the price tables, `TEXT2VIDEO_MODELS` /
`IMAGE2VIDEO_MODELS`, `V1_MODEL_RULES`, the `VIDEO_MODELS` / `IMAGE_MODELS` value
lists and `KLING_VIDEO_FAL_REFUSALS` (now empty: every `/v1/videos/*` id has a fal
row). `models["kling-v2-1"]` is now the image row alone, and `kling-v3` is the one
id that names both a video and an image model.

The request fields only those models had leave with them — the current
`/v1/videos/*` bodies document none of them: `cfg_scale` and `camera_control`
(both routes) and `static_mask` / `dynamic_masks` (image2video). Removed with
them: `KLING_CAMERA_TYPES`, `KLING_CAMERA_AXES`, `CAMERA_AXIS_MIN`,
`CAMERA_AXIS_MAX`, `KlingCameraType`, `KlingCameraConfig`, `KlingCameraControl`,
`KlingDynamicMask`, `KlingTrajectoryPoint`, and the `cfgScale` / `cameraControl`
fields of `V1ModelRules`. Sent anyway, those keys now draw an `unknown_param`
warning like any undocumented key.

`DEFAULT_V1_MODEL` (`"kling-v1"`) is removed. The reference marks `model_name`
`required:!0` while its prose still says an empty one calls "the V1 model", so an
omitted `model_name` on `kling.video` / `kling.videoFromImage` now runs no
model-dependent check and has no estimate, instead of being priced as Kling 1.0.
`DEFAULT_IMAGE_MODEL` is now `"kling-v3"`, the field's documented default, so an
omitted `model_name` on `kling.image` estimates at $0.028 rather than $0.0035.
