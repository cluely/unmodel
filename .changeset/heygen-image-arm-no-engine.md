---
"unmodel": patch
---

heygen: `engine` is refused on the raw-image arm, whatever it names

`heygen.avatar({ type: "image", engine: … })` is now refused for every value,
including `{ type: "avatar_iv" }` and `null`, with `unsupported_param` at
`engine`. `CreateVideoFromImage` in HeyGen's OpenAPI document
(https://developers.heygen.com/openapi/external-api.json, read 2026-11-13) is
`additionalProperties: false` with 23 properties, and `engine` is not one of
them, so HeyGen answers 400 rather than ignoring it. The Talking Photo page
(https://developers.heygen.com/image-to-video) fixes the engine instead: "|
Engine | Avatar IV |".

Replacement: omit `engine` — the arm renders on Avatar IV. To choose an engine,
use the catalogued-look arm, which is unchanged: `heygen.avatar({ type:
"avatar", avatar_id, engine: { type } })`. `HEYGEN_IMAGE_ENGINES` stays
`["avatar_iv"]`, as the engine the arm renders on rather than a value to send.
`unmodel/avatar` already compiled this arm without `engine`.
