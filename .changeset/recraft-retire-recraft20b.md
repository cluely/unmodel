---
"unmodel": patch
---

recraft: retire `recraft20b` from the catalog and from `unmodel/image`'s `recraft/…` refs

- `recraft20b` was cataloged (with no price and no prompt cap) on the strength of one source, the internal `TransformModel` enum of https://external.api.recraft.ai/doc/spec/api/api.yaml. That document now returns "404 page not found" (2026-11-12), and both current specs leave the id out of the `TransformModel` enum that types `model` on every generation request: the docs-generated https://www.recraft.ai/docs/api-reference/openapi.json (32 ids, `recraftv2` through `recraftv4_1_flash_raster`) and the backend https://external.api.recraft.ai/doc/spec/external-api.yaml. No Recraft docs page, pricing row or appendix entry names it.
- Replacement: none named by Recraft. A raw `recraft.image({ model: "recraft20b", … })` still validates, now with an `unknown_model` warning; the cataloged models are listed at https://www.recraft.ai/docs/api-reference/models/overview.
