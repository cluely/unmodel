---
"unmodel": patch
---

krea: `krea.image` warns on a long data URI instead of refusing it, and checks `moodboards[].id` against the served UUID pattern (verified 2026-11-13)

- **False refusal fixed: data URIs over 1024 characters.** `image_url` and
  `image_style_references[].url` carry `"maxLength":1024` in the spec Krea
  serves at https://api.krea.ai/openapi.json. Krea's own guides contradict
  that. They send whole-file data URIs in these fields, and Zero Data
  Retention (the `X-Api-Zero-Data-Retention` header) requires them.
  https://www.krea.ai/docs/developers/zdr says: "Any URL provided, for
  example a style reference image, must be a base64 data URI. Using an
  external URL would result in a `422`". `krea.image` used to refuse any
  value over 1024 characters, and its advice to upload via `POST /assets`
  is a documented 422 under Zero Data Retention. A `data:` URI over the cap
  now gets an `invalid_shape` warning that names both sources. An external
  or asset URL over 1024 characters is still an error. Its message now
  points to `POST /assets` or a data URI, and notes that Zero Data
  Retention accepts only data URIs.
- **New refusal: `moodboards[].id` must be a UUID.** All three Krea 2 routes
  declare `"id":{"type":"string","format":"uuid","pattern":"^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"}`.
  Until now any string got through without a warning, and the API was
  certain to answer it with a 422. A non-matching id is now an
  `invalid_shape` error at `["moodboards", i, "id"]`. The pattern is exported
  verbatim as `KREA_MOODBOARD_ID_PATTERN` from `unmodel/krea`.
