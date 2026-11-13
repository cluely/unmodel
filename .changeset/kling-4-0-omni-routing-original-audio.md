---
"unmodel": patch
---

kling: `unmodel/video` sends Kling 4.0 `audio` and frame-plus-shape requests to omni; omni `audio: "original"` needs a video

- `unmodel/video` refused two Kling 4.0 / 4.0 Flash requests that the API fulfils.
  It sent every text-only or keyframe request to `/text-to-video` or `/image-to-video`.
  Neither route has an audio switch for these ids, and image-to-video has no
  `settings.aspect_ratio`. So `{ model: "kling/kling-4.0", prompt, audio: "native" }`
  was refused with `unsupported_param`, and so was a first frame with `aspectRatio`.
  Both ids now compile these requests to `/omni-video/{model}`. The omni route takes
  `audio` (`enum:["native","original"]`) and `aspectRatio`
  (`enum:["21:9","16:9","9:16","1:1","adaptive"]`), and that `aspect_ratio` "takes
  precedence" over the first frame
  (https://kling.ai/document-api/api/video/4-0/video-omni, read 2026-11-12).
  Text and frames without these settings still go to their own routes.
- `kling.videoOmni` now checks Kling 4.0 / 4.0 Flash `settings.audio: "original"`
  against the documented rules: "Voice references cannot be included in the same
  request" and "At least one `base_video` or `feature_video` must be provided"
  (kling-4-params, 2026-11-12). A request without either video entry is refused with
  `invalid_shape` at `settings.audio`, and a `voice` entry is refused at its
  `contents` index. `RouteModelRules` gains `originalAudioNeedsVideo`. The 3.0 Omni
  and O1 rows are unchanged.
