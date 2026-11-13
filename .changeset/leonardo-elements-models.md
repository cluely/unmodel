---
"unmodel": patch
---

leonardo: the nine Elements image models

`leonardo.image` and `unmodel/image` now validate, type and compile `kino-xl`,
`anime-xl`, `portrait-perfect`, `stock-photography`, `illustrative-albedo`,
`concept-art`, `lifelike-vision`, `graphic-design` and `lightning-xl` — each a
discriminator key on `POST /v2/generations` with its own `…GenerationRequest`
schema (https://docs.leonardo.ai/reference/creategeneration, OpenAPI updatedAt
2026-09-01, read 2026-11-12). They used to fall through to the loose arm with an
`unknown_model` warning and no per-param checks.

- One shared `parameters` shape, `LeonardoElementsParameters`: Phoenix's keys plus
  `transparency` ("Whether the image can be generated with a transparent
  background"), `user_elements` and `platform_elements` (at most 4 entries each,
  `weight` ≥ 0 — the items declare no id key, so none is typed), `mode`
  `FAST | QUALITY` (no ULTRA), height 32–1536, width 32–1536 (kino-xl,
  portrait-perfect, stock-photography) or 32–1584 (the other six), a
  9999-character prompt, and four guidance kinds beyond Phoenix's: `edge`,
  `pose`, `depth`, `text_image` (one reference each).
- Every model keeps its own published `style_ids` allowlist (2 to 22 UUIDs).
- Catalog rows carry the schema titles as names ("Cinematic Kino", "Anime", …,
  "Leonardo Lightning") and no `cost`: Leonardo publishes no per-model rate.
  No vendor page names who trained these models, so no `family` is recorded.
- `unmodel/leonardo/values` lists them in `IMAGE_MODELS` / `IMAGE_MODEL_PARAMS`
  with a shared 1536-px preset list and the `1k` tier.
- `negativePrompt`, `contrast`, `tiling` and the new keys are no longer called
  "Phoenix-only": a request that sends one to a model without it is refused with
  the list of models that take it.
