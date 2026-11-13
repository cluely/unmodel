---
"unmodel": patch
---

recraft: the editing routes type `image_format` and `style_match`, and `recraft.imageEdit` refuses the V3-only params on V4 / V4.1

- `image_format` (`"webp"` | `"png"`) now compiles and validates on all five editing routes: `imageEdit`, `imageEditInpaint`, `imageEditOutpaint`, `imageEditReplaceBackground` and `imageEditGenerateBackground`. It used to type as `never` and pass at run time with an `unknown_param` warning. Every route page lists "| `image_format` | string, `webp` | `webp` (lossless) or `png`." (https://www.recraft.ai/docs/api-reference/tools/image-to-image, …/inpainting, …/outpainting, …/background, 2026-11-12). Any other value is now `invalid_enum_value`. It is not refused on vector models, where the API ignores it.
- `style_match` is typed `"regular"` on the same five routes ("**V3 only**, with `style_id`. Must be `regular`." on image-to-image; "Only `regular` for V3." on the others). `"precise"` / `"flexible"` are `invalid_enum_value` there.
- `recraft.imageEdit` (imageToImage) now refuses `style`, `style_id`, `style_match`, `negative_prompt` and `text_layout` on the V4 / V4.1 models and their `_raster` aliases with `unsupported_param`. The image-to-image page marks each one "**V3 only.**" and says "Image to image doesn't take V4 / V4.1 styles". `controls.artistic_level` and `controls.no_text` are refused there too ("V3 models only", https://www.recraft.ai/docs/api-reference/endpoints). These params all used to pass silently.
- With no `model`, a curated V3 `style` on `recraft.imageEdit` now resolves the request to `recraftv3` / `recraftv3_vector` for checks and pricing, as on the generations route. So `{ image_url, prompt, strength, style: "Illustration" }` validates and prices at $0.04.
- `unmodel/image-edit`: `outputFormat` on a `recraft/…` ref now compiles to `image_format` (`"webp"` / `"png"`; `"jpeg"` is an error that names both) instead of being declared unsupported. The V4 / V4.1 rows of `IMAGE_EDIT_MODEL_PARAMS` no longer offer `style_id` (now a compile error there). The three V3 rows offer `style_id` and `style_match: "regular"`.
