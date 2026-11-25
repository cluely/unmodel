---
"unmodel": minor
---

Higgsfield joins `unmodel/image`, `unmodel/image-edit` and `unmodel/video`, with `unmodel/higgsfield/unified` and `unmodel/higgsfield/values`.

A ref names a route and splits on the first slash: `"higgsfield/higgsfield-ai/soul/standard"`, `"higgsfield/bytedance/seedance-2.5/text-to-video"`.

- `unmodel/image` — 18 routes: every image route with a `prompt` that does not require a source picture.
- `unmodel/image-edit` — the 10 routes of `higgsfield.imageEdit`. `operation: "edit"` at every one (`"removeBackground"` is a compile error and an `invalid_enum_value` at `operation`: no Higgsfield route removes a background); the source is `{ url }` only.
- `unmodel/video` — 86 routes: text-to-video, image-to-video, first-and-last-frame, reference-to-video, motion control (Genjutsu, Kling), clip editing and clip extension, all through `prompt`, `image` (with `role`) and `video`.

What each canonical word does is read from the route's own generated row, so it differs by route and is typed per ref:

- `n` is `batch_size` (Soul: 1 or 4; Ads Studio: 1 to 8) or `series_amount` (Kling Image series, where it is required), and refused on a route that renders one image. No video route takes a count.
- `resolution` maps only where the route's own value is a canonical tier. Soul's `720p | 1080p`, Seedream's `1.5k`, Kling Image's `8k` and MiniMax H3's `768P` / `2K` are not, so they are refused as `resolution` and sent through `providerOptions.higgsfield.resolution`. On `unmodel/image-edit` a route's `resolution` is one of its extras.
- `aspectRatio` is matched against the route's list. `dimensions` and a `WxH` `size` are sent as the listed shape they describe, with an `approximated_param` warning; no route takes pixels. `"auto"` and `"adaptive"` are not shapes and stay on `providerOptions.higgsfield.aspect_ratio`.
- `image` roles land on the route's own parameter (`image_url` / `first_frame_url`, `end_image_url` / `last_image_url` / `last_frame_url`, `image_urls`), and a role the route has no parameter for is refused naming the roles it serves. `video` lands on `video_url`, or as a one-element `video_urls` on a route that has only the list.
- `outputFormat` maps on the four Recraft routes. `outputDelivery: "url"` is what every route does; `"base64"` is refused. `strength` is refused: no editing route has one.
- Inline bytes (`{ file }`, `{ data }`) are refused with `POST /files/generate-upload-url` named.
- Everything else a route declares is a typed extra on that ref: `camera_movement` on Cinema Studio 4.0, `style_id` on Soul, `preset_id` on Genjutsu Restyle.

A word a route has no parameter for is an `unsupported_param` naming the route and counting the routes that do take it. Counts, durations and required fields are checked by the route's own validator and reported at the canonical word.

Not addressed by a pack, and still validated by id at `unmodel/higgsfield`: the five image routes that require a source picture (they are `unmodel/image-edit` refs), `higgsfield/ai-influencer` (no `prompt`), and `bytedance/seedance-2.5/finalize-draft` (its one input is a prior request's id).

`unmodel/higgsfield/values` exports `IMAGE_MODELS` / `IMAGE_MODEL_PARAMS`, `IMAGE_EDIT_*` and `VIDEO_*`: the same row objects the adapters compile with.

Bundle sizes: `unmodel/image` 1400.2 → 1587.1 KiB, `unmodel/image-edit` 814.6 → 997.7 KiB, `unmodel/video` 1403.5 → 1715.4 KiB. `createImage([…])`, `createImageEdit([…])` and `createVideo([…])` build a pack from only the adapters you name.
