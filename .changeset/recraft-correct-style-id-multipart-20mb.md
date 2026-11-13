---
"unmodel": patch
---

recraft: stop refusing four request shapes the API accepts, and re-source the generation rules to the current docs

- `style_id` validates on every V4 / V4.1 model (V4.1 Flash excepted). It was refused with `unsupported_param` on the strength of a styles-doc sentence that is gone; the V4 Styles page now reads "Every V4 and V4.1 model (except V4.1 Flash) also accepts `style_id` or style references, at that model's own price." The `unmodel/image` rows for the V4 / V4.1 line carry `style_id` too. Curated `style`, `negative_prompt` and `text_layout` stay denied there, now sourced to the per-family matrix of https://www.recraft.ai/docs/api-reference/agents.
- With no `model`, a curated `style` now resolves the request to the model whose list holds it — V3 first, then V2 — as the server does ("If a style name is supported by multiple models, the API defaults to Recraft V3 (if supported, to Recraft V2 otherwise)", https://www.recraft.ai/docs/api-reference/styles). Recraft's own example `{ prompt, style: "Illustration", text_layout }` used to be refused; it now validates and prices as `recraftv3`.
- `response_format: "multipart"` is accepted on `recraft.image` and all five editing routes ("Must be one of `url`, `b64_json` or `multipart`", https://www.recraft.ai/docs/api-reference/endpoints). The multipart answer is `multipart/form-data`, which the OpenAI SDK behind `.toSdk("recraft")` cannot read.
- The editing routes' input cap is 20 MB, not 10 ("| File size | Under 20 MB |", https://www.recraft.ai/docs/api-reference/appendix); `MAX_INPUT_IMAGE_BYTES` is now `20 * 1024 * 1024`, so a 15 MB image or mask no longer fails with `media_too_large`.
- Provenance: `image_format` is cited to the endpoints doc, `upscale` to the `UpscaleMode` enum of https://www.recraft.ai/docs/api-reference/openapi.json, and the `issue.meta.source` of `substyle` / `creativity` records that the internal spec those lists came from now returns 404 and that no current Recraft source declares them.
