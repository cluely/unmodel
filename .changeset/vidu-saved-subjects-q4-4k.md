---
"unmodel": patch
---

vidu: saved subjects on viduq2-pro, video subjects elsewhere, and `4k` on `unmodel/video` (review fixes, 2026-11-13)

- `vidu.videoFromReference` no longer refuses viduq2-pro's documented maximum
  of 4 image subjects plus 2 saved video subjects. A subject passed as
  `{ name, server_id }` keeps its kind (image or video) on Vidu's side, so on
  viduq2-pro it counts toward neither the 4 image-or-text cap nor the 2 video
  cap, only toward their total of 6. On every other model it can only be an
  image subject and still counts toward the 7. Source:
  https://platform.vidu.com/docs/api-reference/video-models/vidu-q3/reference-to-video
  ("The number of image or text subjects should not exceed 4. The number of
  video subjects should not exceed 2 (or 1 for temporary video subjects).")
- `subjects[].videos` is now refused with `unsupported_param` at
  `["subjects", i, "videos"]` on every model except `viduq2-pro` ("Note 1: Only
  the viduq2-pro Reference to Video model supports video subjects.", same
  page). It used to pass silently.
- `unmodel/video` compiles `resolution: "4k"` to the wire `"4K"` for
  `vidu/viduq4-preview` on both of its routes (img2video and reference2video),
  and `VIDEO_MODEL_PARAMS["viduq4-preview"].resolutions` on
  `unmodel/vidu/values` lists `"4k"`. It used to be refused, although both q4
  pages list `4K`. Every other Vidu model still refuses `4k`, at compile time
  and from its endpoint check. Sources:
  https://platform.vidu.com/docs/api-reference/video-models/vidu-q4-preview/image-to-video
  and …/vidu-q4-preview/reference-to-video.
