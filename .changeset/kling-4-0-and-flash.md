---
"unmodel": patch
---

kling: Kling 4.0 and Kling 4.0 Flash

Both models are live on Kling's path-addressed routes — "Kling 4.0 API Is Now Fully
Available, with Native Video Generation up to 30s ... Request paths:
/text-to-video/kling-4.0, /image-to-video/kling-4.0, and /omni-video/kling-4.0", and
Kling 4.0 Flash "up to 20s" at `/…/kling-4.0-flash` (https://kling.ai/document-api/updates/api,
read 2026-11-12). They have no `model_name` spelling on `POST /v1/videos/*`.

- `kling.videoV3`, `kling.videoV3FromImage` and `kling.videoOmni` validate
  `kling-4.0` and `kling-4.0-flash`: 3–30s (Flash 3–20s), 720p/1080p (Flash 720p
  only), `21:9` on every route and `adaptive` on omni, omni `audio` of
  `"native"` / `"original"` (no `"off"`, and no audio switch on text- or
  image-to-video), up to 7 Elements on omni, 4.0's `middle_frame` keyframes and
  `voice` entries (`{ type: "voice", voice_id, id }`). 4.0's image-to-video
  needs no `first_frame` ("first frame, last frame, first-and-last frames, or
  intermediate frames"); Flash's still does ("Only first-frame-to-video
  generation is supported.").
- The prompt cap is per model: 4.0 / Flash take "up to 26,000 characters"
  English-only and "up to 11,000" non-English-only, with mixed input satisfying
  "E / 26000 + N / 11000 <= 1"; the earlier text-to-video rows keep 3072. Only
  letters outside the Latin script count as non-English.
- `unmodel/video` serves both ids: a text or keyframe request goes to
  `/text-to-video` or `/image-to-video`, and a reference image or clip to
  `/omni-video`. `aspectRatio: "21:9"` compiles on them.
- Costs from https://kling.ai/document-api/pricing/base/video: 4.0 is $0.157/s at
  720p and $0.235/s at its default 1080p; Flash is $0.094/s. With a video input
  they bill $0.094 / $0.141 (Flash $0.063) per second of a total duration of
  output × 2 or more, so those estimates are a floor; an omitted
  `settings.duration` (read off the prompt) has no estimate.
- New exports: `KLING_4_ASPECT_RATIOS`, `KLING_4_OMNI_ASPECT_RATIOS`,
  `DURATIONS_3_20`, `DURATIONS_3_30` (also on `unmodel/kling/values`),
  `KLING_4_MAX_ELEMENTS`, `KLING_4_PROMPT_BUDGET`, `PROMPT_BUDGET_3072`, and the
  types `KlingSettingsAspectRatio` and `PromptBudget`. `KlingDuration` widens to
  3–30, `KLING_CONTENT_TYPES` gains `middle_frame`, `KlingContent` gains
  `voice_id`, and `RouteModelRules` gains `requireFirstFrame`, `maxElements` and
  `prompt`.
