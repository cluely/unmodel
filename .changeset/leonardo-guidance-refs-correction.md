---
"unmodel": patch
---

leonardo: accept content ULTRA, URL / base64 image references, and prompt-less third-party models

Four false refusals on `leonardo.image`, each a request the live reference
(https://docs.leonardo.ai/reference/creategeneration, OpenAPI updatedAt
2026-09-01, read 2026-11-12) accepts:

- **Content guidance takes `ULTRA`.** All 15 content schemas now read
  `"enum": ["LOW", "MID", "HIGH", "ULTRA"]` (the prose tables still say LOW / MID
  / HIGH; the schema is the wire). New `LEONARDO_CONTENT_STRENGTHS` /
  `LeonardoContentStrength`; `LeonardoContentGuidance` takes it. Character,
  image-to-image, edge, pose, depth and text-image guidance stay on LOW / MID /
  HIGH — character now types as `LeonardoGuidance` rather than
  `LeonardoContentGuidance`.
- **Image references can be a URL or inline bytes.** `image.type` is
  `UPLOADED | GENERATED | VARIATION | URL | BASE64` on all 189 image-reference
  schemas, and `LeonardoImageReference` gains `data` ("Base64-encoded image bytes.
  Required when type is BASE64."). `LEONARDO_IMAGE_TYPES` is now exactly the
  published enum. `INIT` and `GENERATION` are no longer listed anywhere in the
  reference; they still type-check and validate, with an `invalid_enum_value`
  **warning** (`LEONARDO_UNLISTED_IMAGE_TYPES`), because no page says whether the
  API still takes them.
- **Untabled models are not required to send `prompt`.** remove-bg, both aurora
  upscalers, rodin-v2 and bytedance/video-upscaler have no `prompt` property, and
  meshy/meshy-7's is optional, so the documented remove-bg and
  aurora-upscaler-precise bodies no longer fail with "`parameters.prompt` is
  required." The loose arm now checks only that `parameters` is an object.
- **Docs URL.** `LEONARDO_DOCS_URL`, `provider.doc` and every issue's
  `meta.source` move to `https://docs.leonardo.ai/reference/creategeneration`;
  the `creategeneration-1` page now 301-redirects there and its `.md` form 404s.

The module notes no longer claim an official SDK sends the v2 body: both
Leonardo SDKs target `/api/rest/v1` (the TypeScript SDK's config.ts:
`openapiDocVersion: "v1.0.0"`), so `.toSdk("leonardo")` is documented as the raw
body, unchanged. Comment counts are corrected (87 discriminator ids; 36
`style_ids` arrays, none with `maxItems`); the 1-style cap stays an advisory
warning.
