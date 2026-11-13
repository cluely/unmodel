---
"unmodel": patch
---

atlascloud: eight in-family video ids — Veo 3.1 Fast and Lite, Seedance 2.5 `draft-complete`, and the Wan 3.0 reference routes

`atlascloud.video` now types and validates eight more Atlas Cloud ids, each
transcribed from its own OpenAPI document (`https://static.atlascloud.ai/model/schema/<id>.json`,
read 2026-11-12, snapshots committed under `data/atlascloud/openapi/`):

- `google/veo3.1-fast/text-to-video`, `google/veo3.1-fast/image-to-video` —
  Veo 3.1's schema with only `model`'s default changed: the same `[8, 4, 6]`
  durations, `720p` / `1080p` / `4k`, and "When resolution is 1080p or 4k,
  duration must be 8 (seconds)."
- `google/veo3.1-lite/text-to-video`, `/image-to-video`,
  `/start-end-frame-to-video` — "Veo 3.1 Lite does not support 4K.", durations
  `[4, 6, 8]`, and "When resolution is 1080p, duration must be 8 (seconds)."
  `generate_audio` and `negative_prompt` are refused by name ("Audio is always
  generated", model page); the image route refuses `last_image` and names the
  start-end-frame route, which requires both frames.
- `bytedance/seedance-2.5/draft-complete` — the second step of Seedance 2.5's
  draft mode: `draft_id` (required), `resolution` (`1080p` | `4k`),
  `output_format`, `watermark`, `return_last_frame`. Everything the draft fixes
  (prompt, media, duration, ratio, seed, audio) is refused by name — "do not
  send those fields again". `4k` is accepted because the schema lists it,
  although the model page says "Render the 1080p final" and Atlas's
  2026-11-05 cost test says "upgrades currently top out at 1080p". It is
  wire-only: no canonical word reaches `draft_id`, so it is not a
  `unmodel/video` ref.
- `alibaba/wan-3.0/reference-to-video`, `alibaba/wan-3.0-prime/reference-to-video`
  — references are one typed list, `refers: [{ url, type }]` (≤ 20 items).
  Plain Wan 3.0 requires `type` on every item ("Each item requires a public URL
  and explicit media type."); prime infers it and caps images at 10, videos and
  audio at 5 each. `file` / `link` document and webpage parsing "requires
  enable_thinking" and the two are mutually exclusive; `enable_thinking`
  defaults to false on plain Wan 3.0 and true on prime (schema). `unmodel/video`
  compiles reference images and the clip into `refers`.

`refers`, `enable_thinking`, `file`, `link` and `draft_id` are refused by name
on every other Atlas model, naming the id that takes them. Seven of the eight
are `unmodel/video` refs (`VIDEO_MODELS` / `VIDEO_MODEL_PARAMS` on
`unmodel/atlascloud/values`); `VEO_LITE_RESOLUTIONS`,
`DRAFT_COMPLETE_RESOLUTIONS` and `REFER_TYPES` join the published enums.

No new id ships a `cost`, for the reason every Atlas row does not: the catalog
(`https://api.atlascloud.ai/api/v1/models`, read 2026-11-12) gives a bare
`base_price` with no unit (0.08 on Veo 3.1 Fast, 0.05 on Lite, 0.263 on
draft-complete, 0.04 / 0.061 on the Wan reference routes), and Atlas's billing
page says video pricing "Varies by model, duration, and resolution". The
figures are in `ATLASCLOUD_LISTED_BASE_PRICE_USD`, unit-less.
