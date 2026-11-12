---
"unmodel": patch
---

google: retire the shut-down `gemini-omni-flash-preview`, the two image `-preview` rule rows and `gemini-3.1-flash-lite-preview` from the curated surfaces

Every date below is from https://ai.google.dev/gemini-api/docs/deprecations (retrieved 2026-11-12).

- **`google.video` / `unmodel/video` — `gemini-omni-flash-preview`.** "June 30, 2026 — October 22, 2026 — `gemini-omni-1.2-flash`"; its model page: "Shut down: `gemini-omni-flash-preview`". models.dev still carries the row, so the id is now refused by name — `unsupported_capability` at `model`, naming the shutdown and the replacement (`gemini-omni-1.2-flash`, an Interactions API model unmodel does not serve yet) — through the new `VIDEO_RETIRED_IDS` map on `unmodel/google`, instead of validating against a model that no longer answers. It leaves `VIDEO_MODELS` / `VIDEO_MODEL_PARAMS`, `VEO_PARAMETER_SPACE` and `videoConstraints`. Retired with it: `GEMINI_OMNI_FLASH_DOCS_URL` and `videoDocsUrl()` (every remaining video constraint cites the Veo page).
- **`GEMINI_IMAGE_MODEL_RULES` — `gemini-3.1-flash-image-preview` and `gemini-3-pro-image-preview`.** Both rows are gone: "`gemini-3.1-flash-image-preview` — February 26, 2026 — June 25, 2026 — `gemini-nano-banana-2.1`" and "`gemini-3-pro-image-preview` — November 20, 2025 — June 25, 2026 — `gemini-3-pro-image`". The ids also left the models.dev snapshot, so `google.chat` now reports them `unknown_model`.
- **`google.stt` / `unmodel/stt` — `gemini-3.1-flash-lite-preview`.** "March 3, 2026 — May 25, 2026 — `gemini-3.1-flash-lite`". Moved from `GEMINI_STT_MODEL_IDS` to `GEMINI_STT_EXCLUDED_IDS`, so a transcription request to it is refused with the shutdown date and pointed at `gemini-3.1-flash-lite`, which the surface serves. The curated list is now 19 ids, the exclusion map 6.
