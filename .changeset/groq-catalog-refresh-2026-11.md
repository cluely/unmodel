---
"unmodel": patch
---

groq: catalog refresh (models.dev, 2026-11-12)

- `groq/compound` and `groq/compound-mini` are gone from the groq catalog and
  from `unmodel/chat`'s refs (`"groq/groq/compound"`, `"groq/groq/compound-mini"`).
  Groq decommissioned both on 2026-09-21 with no replacement: "Beginning on that
  date, requests to these model IDs will return errors."
  (https://console.groq.com/docs/deprecations). `groq.chat` now answers them with
  an `unknown_model` warning instead of validating them silently.
- `llama-3.1-8b-instant`, `llama-3.3-70b-versatile` and `qwen/qwen3.6-27b` are
  marked deprecated, so `groq.chat` validates them with a `deprecated_model`
  warning. They stay in the catalog because Groq still serves them to enterprise
  accounts: the shutdowns (08/16/26 for both Llamas, 09/14/26 for Qwen 3.6) apply
  "to free and developer-tier usage; enterprise customers with a committed-spend
  contract are not affected". Groq's named replacements: `openai/gpt-oss-20b` for
  Llama 3.1 8B, `openai/gpt-oss-120b` for Llama 3.3 70B, `qwen/qwen3.8-27b` for
  Qwen 3.6 27B.
- `qwen/qwen3.8-27b`: context window 131,072 (was 131,042), matching
  "CONTEXT WINDOW 131,072" on https://console.groq.com/docs/model/qwen/qwen3.8-27b;
  the row is now marked beta (Groq tags it Preview). Every host's availability
  edge to it on groq narrows to the corrected window.
- `openai/gpt-oss-safeguard-20b` prices cached input at $0.0375 / 1M tokens:
  Groq's prompt-caching page lists the model and gives "a 50% discount for cached
  input tokens" (https://console.groq.com/docs/prompt-caching).
- `whisper-large-v3` and `whisper-large-v3-turbo` carry models.dev's 448-token
  limits instead of 0.
