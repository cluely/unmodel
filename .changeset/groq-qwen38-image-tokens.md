---
"unmodel": patch
---

groq: `qwen/qwen3.8-27b` image estimates, and an honest roster row

- `groq.chat` now estimates each image sent to `qwen/qwen3.8-27b` at 2048 input
  tokens, the figure Groq documents ("Each image counts as 2048 input tokens.",
  https://console.groq.com/docs/vision, read 2026-11-12), instead of the
  1000-token default. `estimate.inputTokens` and `estimate.costUSD` change for
  image-bearing qwen3.8 requests, and so do the checks that read them: each
  image now counts 2048 tokens toward the 131,072-token `over_context` /
  `near_context` check and toward a `maxCostUSD` `over_budget` check, so a
  request close to either limit can now be refused where it passed before.
- `docs/providers.md` no longer claims Whisper STT coverage for groq. unmodel
  validates Groq's chat endpoint only; Groq's `/audio/transcriptions`,
  `/audio/translations` (Whisper) and `/audio/speech` (Orpheus) endpoints have
  no validator yet, and their model ids are catalog rows only.
