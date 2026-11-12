---
"unmodel": patch
---

heygen: retire Avatar V on the raw-image arm and two voice-engine models HeyGen's spec no longer lists

- `heygen/avatar_v` leaves `unmodel/avatar`, and `HEYGEN_IMAGE_ENGINES` is now
  `["avatar_iv"]`. HeyGen's engine comparison
  (https://developers.heygen.com/models, 2026-11-12) marks "Arbitrary image
  input" ✗ for Avatar V and Avatar III, and the Talking Photo page
  (https://developers.heygen.com/image-to-video) lists its engine as Avatar IV.
  `heygen.avatar({ type: "image", engine: { type: "avatar_v" }, … })` is now
  refused with `unsupported_capability` naming `"avatar_iv"`. Replacement:
  `heygen/avatar_iv` for a picture you supply, or Avatar V on the
  catalogued-look arm — `heygen.avatar({ type: "avatar", avatar_id, engine: {
  type: "avatar_v" } })`, which is unchanged. `AVATAR_MODELS` /
  `AVATAR_MODEL_PARAMS` on `unmodel/heygen/values` drop the `avatar_v` row and
  its `reference_look_id` extra.
- `voice_settings.engine_settings.model` no longer accepts
  `"eleven_flash_v2_5"` (ElevenLabs) or `"s1"` (Fish Audio). The OpenAPI
  document (https://developers.heygen.com/openapi/external-api.json,
  2026-11-12) lists `["eleven_multilingual_v2", "eleven_turbo_v2_5",
  "eleven_v3", "eleven_v4"]` and `["s2.1-pro", "s2-pro"]`. Replacements:
  `eleven_turbo_v2_5` or `eleven_v3` for ElevenLabs, `s2-pro` for Fish Audio.
  `HEYGEN_ELEVENLABS_MODELS` and `HEYGEN_FISH_MODELS` shrink to match.
- `HEYGEN_V1_V2_SUNSET` documents that the date has passed: "Those endpoints
  passed their October 31, 2026 sunset and are being removed"
  (https://developers.heygen.com/docs/quick-start).
