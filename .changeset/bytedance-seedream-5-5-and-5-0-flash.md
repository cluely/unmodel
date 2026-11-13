---
"unmodel": patch
---

bytedance: Seedream 5.5 (`dola-seedream-5-5-261028`) and Seedream 5.0 flash (`dola-seedream-5-0-flash-260915`) on `bytedance.image`, verified 2026-11-12 against the BytePlus ModelArk Model list, Pricing and image generation API reference

- Both ids now validate, price and compile like their siblings: catalog rows, typed arms (`Seedream55Body`, `Seedream50FlashBody`), shape rules, constraint tables, the `unmodel/image` adapter rows and `IMAGE_MODELS` / `IMAGE_MODEL_PARAMS` on `unmodel/bytedance/values`.
- Seedream 5.5 pricing is tiered by output pixels — $0.020 per image up to 1536² × 1.05² (2,601,123.84) pixels, $0.035 above it, every input image $0.008 — and its layer decomposition bills up to `layer_decomposition_options.max_images` images (default 30, base image included). Catalog `perImage` is 0.035 (the 2K default). New exports: `SEEDREAM_5_5_RATES`, `SEEDREAM_5_5_TIER_PIXELS`, `SEEDREAM_5_5_INPUT_IMAGE_USD`, `SEEDREAM_5_5_DEFAULT_LAYER_IMAGES`.
- Seedream 5.0 flash is $0.018 per output image with free inputs; a layer-decomposition request now estimates its base image plus 16 layers (`generatedImageCount` counts them).
- `background` gains `"auto"` (`IMAGE_BACKGROUNDS` is now `["auto", "transparent", "opaque"]`): Seedream 5.5 takes all three, Seedream 5.0 pro / flash keep `transparent | opaque`. The "transparent needs exactly one alpha-channel input image" rule now applies to Seedream 5.0 pro / flash only — Seedream 5.5 makes RGBA from text and from up to 10 ordinary references, which the validator refused before.
- New `layer_decomposition_options` (`LayerDecompositionOptions`: `max_images` 2–100, `text_recognition`) for Seedream 5.5, refused on every other model, and warned as ignored when `layer_decomposition` is not `true`. `LAYER_MAX_IMAGES_RANGE` is exported.
- New `safety_identifier` (≤ 64 characters) on Seedream 5.5 / 5.0 pro / 5.0 flash, typed and validated; it was a compile error and an `unknown_param` warning on Seedream 5.0 pro.
- Seedream 5.5, 5.0 pro and 5.0 flash refuse `background` together with `layer_decomposition: true` ("This parameter is not supported for layer decomposition. Passing it causes an error."). Seedream 5.5 and 5.0 flash deny the sequential-batch family and `stream`, and take `optimize_prompt_options.mode: "standard"` only. Deny reasons for `layer_decomposition`, `background` and `output_format` on the other models now name every model that does take them.

Sources: https://docs.byteplus.com/docs/en/modelark/model-list.md, https://docs.byteplus.com/docs/en/modelark/model-pricing.md, https://docs.byteplus.com/docs/en/modelark/image-generation-api.md, https://docs.byteplus.com/docs/en/modelark/image-generation-tutorial.md, https://docs.byteplus.com/docs/en/modelark/seedream-5-5.md.
