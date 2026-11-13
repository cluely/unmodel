---
"unmodel": patch
---

lightricks: retire LTX-2 (`ltx-2-fast`, `ltx-2-pro`) and the synchronous `/v1` generation routes

RETIRED UPSTREAM
- `ltx-2-fast` and `ltx-2-pro` leave the lightricks catalog, the unified video
  table (`VIDEO_MODELS` / `VIDEO_MODEL_PARAMS`), `GENERATION_MODELS`,
  `AUDIO_TO_VIDEO_MODELS`, `SUPPORT_MATRIX` and the fal refusal table. LTX
  removed both on 2026-08-15: "As announced in the July 2 LTX-2 deprecation
  notice, `ltx-2-fast` and `ltx-2-pro` are no longer available. Requests that
  specify these models return an error."
  (https://docs.ltx.io/api-changelog/2026/8/16.md, read 2026-11-12). Use
  `ltx-2-3-fast` / `ltx-2-5-fast` in place of `ltx-2-fast`, and `ltx-2-3-pro` /
  `ltx-2-5-pro` in place of `ltx-2-pro`. Requests naming the retired ids still
  validate, with an `unknown_model` warning, no support-matrix check and no
  cost estimate.
- `NO_LAST_FRAME_MODELS` is removed: it listed only the LTX-2 pair, so every
  model LTX still serves takes `last_frame_uri` on image-to-video.
- The synchronous `/v1` generation routes are gone, and with them the
  non-wire `api_version` param on `lightricks.video`, `lightricks.videoFromImage`
  and `lightricks.videoFromAudio`, the `TEXT_TO_VIDEO_V1_URL`,
  `IMAGE_TO_VIDEO_V1_URL` and `AUDIO_TO_VIDEO_V1_URL` constants,
  `LTX_API_VERSIONS` (also dropped from `unmodel/lightricks/values`),
  `DEFAULT_API_VERSION`, the `LtxApiVersion` type, and `ltxUrl`'s second
  argument. "The V1 video generation endpoints listed below were retired on
  October 26, 2026 and return an error. Use the V2 endpoints instead."
  (https://docs.ltx.io/migrate-v1-to-v2.md, read 2026-11-12). Every validator
  now builds its `/v2/<endpoint>` URL, which is the only generation API LTX
  serves; the request body is unchanged. `api_version` is no longer stripped,
  so a caller still sending it gets an `unknown_param` warning. The media upload
  route stays at `POST /v1/upload`.
- `lightricks.video`'s `.toApi("fal")` no longer refuses `api_version: "v1"`:
  the param it answered for no longer exists.
