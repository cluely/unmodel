---
"unmodel": patch
---

vidu: `viduq4-preview`, `viduq3-drama` and `viduq3-ad` (models refresh 2026-11-12)

- `viduq4-preview` validates on `vidu.videoFromImage` and `vidu.videoFromReference`
  (and `vidu/viduq4-preview` on `unmodel/video`): 3–16 seconds, `540p` / `720p` /
  `1080p` / `2K` / `4K`, up to 15 reference images, no subjects form. Sources:
  https://platform.vidu.com/docs/api-reference/video-models/vidu-q4-preview/image-to-video
  and …/vidu-q4-preview/reference-to-video.
- `viduq3-drama` (both reference forms, 2–16 seconds, `720p` / `1080p`) and
  `viduq3-ad` (images form, 3–15 seconds, `720p` / `1080p`) validate on
  `vidu.videoFromReference`. Source:
  https://platform.vidu.com/docs/api-reference/video-models/vidu-q3/reference-to-video.
- None of the three carries a cost or produces an estimate: q4 is priced in
  credits on a page that prices credits in RMB only, and the pricing pages have
  no drama or ad row (https://platform.vidu.com/docs/overview/pricing).
- `Reference2VideoParams` gains `sounds` (up to 3 mp3 audio references, documented
  on `viduq3-mix`, `viduq3-ad`, `viduq3-drama` and `viduq4-preview`), and its
  `aspect_ratio` accepts `"auto"` — both were refused at compile time although
  the API documents them.
- `ViduResolution` / `VIDU_RESOLUTIONS` gain `"2K"` and `"4K"` for the q4 img2video
  and reference2video arms; `Text2VideoParams.resolution` keeps excluding them.
- The video `prompt` ceiling is 20000 characters (the q3 and q4 pages); the
  q2 / q1 / vidu2.0 models stay capped at 5000. `PROMPT_MAX_CHARS` is now 20000,
  and the new `PROMPT_CAPS` export lists the per-model caps below it.
