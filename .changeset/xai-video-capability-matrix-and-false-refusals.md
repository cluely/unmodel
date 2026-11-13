---
"unmodel": patch
---

xai: the Grok Imagine video validators follow the per-model capability matrix, and four requests xAI fulfils are no longer refused (every fact re-read off docs.x.ai on 2026-11-12)

Requests xAI rejects that passed:

- `xai.videoEdit` and `xai.videoExtend` refuse `grok-imagine-video-1.5` and its
  aliases `grok-imagine-video-1.5-preview` / `grok-imagine-video-1.5-2026-05-30`,
  as they already refused grok-imagine-video-1.5-lite. Only `grok-imagine-video`
  passes: "| Model | `grok-imagine-video` |" on
  https://docs.x.ai/developers/model-capabilities/video/editing and
  https://docs.x.ai/developers/model-capabilities/video/extension.
- `xai.video` refuses `resolution: "1080p"` on grok-imagine-video
  ("`grok-imagine-video` supports up to 720p." —
  https://docs.x.ai/developers/model-capabilities/video/generation), on every
  mode, naming grok-imagine-video-1.5 and -lite as the models that render it.
  In `unmodel/video` and `unmodel/xai/values`, the `xai/grok-imagine-video` row
  lists `480p` and `720p` only.
- `reference_audios` is refused on grok-imagine-video, as it is on lite ("|
  Voice references | Yes: Up to 3 voices | Not supported | Not supported |" on
  https://docs.x.ai/developers/model-capabilities/video/overview). In
  `unmodel/video`, `xai/grok-imagine-video` no longer offers it as an extra.
- Reference-to-video limits are enforced per model: up to 14 `reference_images`
  on grok-imagine-video-1.5 and 7 on grok-imagine-video, and up to 10 seconds on
  grok-imagine-video
  (https://docs.x.ai/developers/model-capabilities/video/reference-to-video).
  The pinned `image` does not count toward the image cap.
- `xai.image` warns (`unsupported_param`, a warning, not an error) when `quality`
  is sent to an id other than grok-imagine-image-2.0: "The parameter is only
  supported for `grok-imagine-image-2.0`."
  (https://docs.x.ai/developers/model-capabilities/images/generation). xAI does
  not document a 400 for it.

Requests xAI fulfils that were refused:

- `last_frame`, `keyframes` and `generate_audio` are typed `xai.video` wire
  fields (they were compile-time errors and runtime `unknown_param` warnings).
  `keyframes` takes at most 4 `{ image, timestamp_s }` entries, each with
  `0 < timestamp_s < duration`. `last_frame` and `keyframes` are
  grok-imagine-video-1.5 only, and refused with `unsupported_capability` on
  grok-imagine-video ("Classic `grok-imagine-video` still rejects `last_frame`
  and `keyframes`") and on lite. `generate_audio: false` requests a silent video
  on any model. In `unmodel/video`, the `role: "last"` image compiles to
  `last_frame` on `xai/grok-imagine-video-1.5`.
- In `unmodel/video`, an inline image (`{ data, mimeType }`) on an `xai/…`
  model compiles to a `data:` URL instead of being refused. The OpenAPI
  `ImageUrl` "Accepts a public URL, a base64-encoded data URL, or a file_id from
  the xAI Files API" (https://docs.x.ai/openapi.json). Bytes with no `mimeType`
  are an `invalid_shape` error, never a guessed type.
- `storage_options.public_url` accepts the object form `{ expires_after }`
  beside `true`/`false` on `xai.image`, `xai.video`, `xai.videoEdit` and
  `xai.videoExtend` ("* `public_url` (boolean | object)" —
  https://docs.x.ai/developers/rest-api-reference/inference/videos).
- `xai.video` accepts `duration` as a digit string (`"8"`), which xAI documents
  for `/v1/videos/generations`: "Accepts both number (8) and string ("8")
  values." The type still names the number. `/v1/videos/extensions` documents
  no string form and still refuses it.

Also:

- The grok reasoning-model deny rules (`frequency_penalty`, `presence_penalty`,
  `stop`) cite
  https://docs.x.ai/developers/rest-api-reference/inference/chat-completions,
  which carries "(Not supported by reasoning models)". The previous link now
  redirects to the Responses page, which does not.
- New exports from `unmodel/xai`: `VIDEO_VOICE_AND_FRAME_MODELS`,
  `VIDEO_REFERENCE_LIMITS`, `VIDEO_MAX_KEYFRAMES`, and the types
  `XaiVideoKeyframe` and `XaiPublicUrlOptions` (also on `unmodel/xai/types`).
