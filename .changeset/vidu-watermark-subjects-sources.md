---
"unmodel": patch
---

vidu: watermark fields, the full subject shape, viduq2-pro subjects, and live doc links (corrections, 2026-11-12)

- `Text2VideoParams`, `Img2VideoParams` and `Reference2VideoParams` gain the
  documented watermark fields — `watermark`, `wm_position` (the integers 1–4;
  the pages disagree on which corner each one names), `wm_url` and `meta_data`
  — as the shared `ViduWatermarkParams` type, with `VIDU_WM_POSITIONS` on
  `unmodel/vidu` and `unmodel/vidu/values`. They were refused at compile time.
  Source: https://platform.vidu.com/docs/api-reference/updates and the route
  pages under https://platform.vidu.com/docs/api-reference/video-models/.
- `ViduSubject` takes `server_id` (a saved subject from the Create Subject API)
  and `videos` (a temporary video subject, `viduq2-pro` only), and `images` is
  optional — a subject with only a `name` is a text subject.
- `vidu.videoFromReference` accepts the `subjects` form on `viduq2-pro`, capped
  at 4 image or text subjects and 2 video subjects (at most 1 temporary, one
  clip each). It was refused with `unsupported_param`. Source:
  https://platform.vidu.com/docs/api-reference/video-models/vidu-q3/reference-to-video
- `vidu.video` no longer warns that `audio` is q3-only on `viduq2`: the q2 and
  q1 text-to-video pages document it with "Default: true".
- Issue `meta.source` links point at the live API reference
  (`https://platform.vidu.com/docs/api-reference/video-models/vidu-q3/<route>`
  and `…/api-reference/image-generation`); the old `/docs/<route>` pages now
  render "Document not found".
