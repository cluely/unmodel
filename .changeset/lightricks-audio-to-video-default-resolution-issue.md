---
"unmodel": patch
---

lightricks: audio-to-video names the default resolution truthfully, and `guidance_scale` no longer documents defaults

CORRECTED DATA
- The JSDoc on `AudioToVideoParams.guidance_scale` no longer says "Defaults to
  5 (text-only) or 9 (with an image)". The current OpenAPI
  `AudioToVideoRequest` and the reference page
  (https://docs.ltx.io/api-documentation/api-reference/async-video-generation/submit-audio-to-video.md)
  do not list the field, so it is unknown whether LTX honours it and what its
  default is. It is still typed and passed through unchanged, and is checked
  only as a number.
- `lightricks.videoFromAudio` with `image_uri` and no `resolution`: an `fps`
  issue says "at the default 1080p resolution (1920x1080, or 1080x1920 for a
  portrait image)", and its `meta` carries `tier: "1080p"` in place of
  `resolution`. unmodel cannot see the image's orientation, so it no longer
  names 1920x1080, which is wrong for a portrait image. The allowed frame
  rates are the same, because both orientations are in the 1080p tier.
  Without an image the issue still names 1920x1080, the documented default.
  Source: `AudioToVideoRequest.resolution` in https://docs.ltx.io/openapi.json:
  "portrait images produce 1080x1920 video, landscape images produce
  1920x1080 video. If no image is provided, defaults to 1920x1080."

All sources read 2026-11-12 and re-checked 2026-11-13.
