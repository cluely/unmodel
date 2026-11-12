---
"unmodel": patch
---

google: the three preview TTS ids are deprecated (shutdown 2026-11-17), and `gemini-2.5-flash-image` takes its documented 65,536-token window

- **`gemini-2.5-flash-preview-tts`, `gemini-2.5-pro-preview-tts`, `gemini-3.1-flash-tts-preview`** now carry `status: "deprecated"` on `google.tts` and `google.chat`, so a request to any of them gets a `deprecated_model` warning five days before they stop answering. Source: https://ai.google.dev/gemini-api/docs/deprecations (2026-11-12) — "`gemini-3.1-flash-tts-preview` — February 26, 2026 — November 17, 2026 — `gemini-3.8-flash-tts` or `gemini-3.8-flash-lite-tts`", with the same November 17, 2026 row for the two 2.5 ids. models.dev carries no status for them; the hand rows in `ttsModels` do, and `google.chat`'s overlay now takes those hand rows wholesale for every TTS id models.dev carries (`ttsModelOverrides` is that table), so both surfaces say the same thing about the same id. The `unmodel/tts` golden fixtures for google move to `gemini-3.8-flash-tts`, the named replacement.
- **`gemini-2.5-flash-image`** — a false `over_context` refusal fixed: its model page says "**Input token limit** 65,536" (https://ai.google.dev/gemini-api/docs/models/gemini-2.5-flash-image, 2026-11-12) where models.dev carries 32,768, so a 32k–65k-token prompt the API accepts was refused. `google.chat` now validates against 65,536 (`GEMINI_25_FLASH_IMAGE_CONTEXT_TOKENS` on `unmodel/google`); the test pins both halves so the override retires when the upstream row is fixed.
