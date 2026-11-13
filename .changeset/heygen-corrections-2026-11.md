---
"unmodel": patch
---

heygen: current USD rates, `null` on every nullable optional, the full voice-engine union, `more_blinking`, `output_upload`, and no `engine` on the raw-image arm

False refusals fixed (requests HeyGen's OpenAPI document,
https://developers.heygen.com/openapi/external-api.json, accepts on 2026-11-12
and `heygen.avatar` / `heygen.lipsync` refused):

- `null` on every optional the spec types `anyOf: [T, {"type": "null"}]`. On
  `heygen.avatar`: `engine`, `script`, `voice_id`, `audio_url`,
  `audio_asset_id`, `voice_settings`, `title`, `folder_id`, `resolution`,
  `aspect_ratio`, `fit`, `background`, `remove_background`, `callback_url`,
  `callback_id`, `watermark`, `caption`, `brand_glossary_id`, `motion_prompt`,
  `expressiveness`. On `heygen.lipsync`: `title`, `callback_url`,
  `callback_id`, `keep_the_same_format`, `start_time`, `end_time`, `fps_mode`,
  `folder_id`. Every cross-field check reads `null` as absent. `output_format`,
  `type`, `mode` and the defaulted lipsync booleans stay non-nullable, as in the
  spec.
- `voice_settings.engine_settings` takes all seven discriminator values the
  spec maps: `cartesia` (`model`: `"sonic-3.6" | "sonic-3.5"`), `heygen_voice`
  and its legacy alias `orca` (`model: "heygen-voice-1"`, `similarity`,
  `expressiveness` 0–1, `pitch` −4…4 in steps of 0.5, `inflection` 0.5–2) and
  `mockingbird`, beside `elevenlabs`, `fish` and `starfish`. ElevenLabs gains
  `eleven_v4` and Fish Audio `s2.1-pro` (its default). New exports:
  `HEYGEN_CARTESIA_MODELS`, `HEYGEN_VOICE_SIMILARITIES`, and the types
  `HeygenCartesiaEngineSettings`, `HeygenHeyGenVoiceEngineSettings`,
  `HeygenMockingbirdEngineSettings`, `HeygenVoiceSimilarity`.
- `engine: { type: "avatar_v", more_blinking: true }` type-checks ("Ask Avatar
  V for more natural blinking.").
- `output_upload` (`{ video, captions?, thumbnail? }` presigned PUT targets,
  "Available to enabled workspaces") is typed and validated instead of drawing
  an `unknown_param` warning. New types `HeygenOutputUpload`,
  `HeygenUploadTarget`.

Corrections:

- `unmodel/avatar` → HeyGen no longer writes `engine` into the body.
  `CreateVideoFromImage` declares no `engine` property and is
  `additionalProperties: false`, and the Talking Photo page
  (https://developers.heygen.com/image-to-video) lists its engine as Avatar IV.
  The compiled body is now `{ type: "image", image, audio_url, … }`; a ref
  other than `heygen/avatar_iv` is refused at `model` with
  `unsupported_capability`, naming `heygen.avatar({ type: "avatar", … })` for
  Avatar V and Avatar III.
- Catalog rates. The old source, https://developers.heygen.com/docs/pricing, is
  a 404; https://developers.heygen.com/llms.txt now points at
  https://platform.heygen.com/pricing ("Sign in to the API dashboard at
  platform.heygen.com to see current prices."). The rates are quoted from the
  platform's own catalog data
  (https://platform.heygen.com/assets/catalogText-1niwFpkW.js, identical in the
  two earlier builds): `avatar_iii` $0.0433 → $0.0165/sec (top of $0.01–$0.0165),
  `avatar_iv` $0.0667 → $0.0805 (top of $0.0385–$0.0805), `avatar_v` $0.0667 →
  $0.12 (the one published tier, Custom Video Avatar; HeyGen publishes no rate
  for its Studio and Photo looks), `lipsync-speed` $0.0333 → $0.014,
  `lipsync-precision` $0.0667 → $0.029. "Rates apply to 720p and 1080p
  output."
- Documentation: the OpenAPI document is now 1.96 MB with 136 paths and 517
  schemas; the ElevenLabs settings note now reads "When using eleven_v3 or
  eleven_v4, stability may be any value in [0.0, 1.0]."
