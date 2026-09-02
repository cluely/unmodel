---
"unmodel": patch
---

catalog refresh: gemini 3.7/3.8 flash, qwen3.8, fable-5.1 wave + doc-verified rules

A models.dev + fal snapshot refresh (28 new providers, 171 catalog files, 178 fal
snapshots), and the per-model rules the new flagships turned out to need. Every
fact below was read off the vendor's live docs on 2026-09-02, not off the
snapshot.

CATALOG

- New generations land in the generated catalogs: `gemini-3.7-flash` /
  `gemini-3.8-flash`, the `qwen3.8` family, `claude-fable-5-1`, `deepseek-v4-pro`
  / `deepseek-v4-flash-vision-exp`, `glm-5.3` / `glm-5.3-flash`, `kimi-k2.5`,
  `wan` v3.0 and `grok-imagine-image-2.0`.
- `gpt-5.6` repriced: input $5 → $4 and cacheWrite $6.25 → $5 per 1M, matching
  OpenAI's 2026-08-21 changelog entry ("GPT-5.6 Sol now costs $4 per million
  input tokens and $20 per million output tokens"). Cost estimates for gpt-5.6
  change accordingly.

RETIRED UPSTREAM

- `deepseek-chat` and `deepseek-reasoner` no longer resolve in the deepseek
  catalog: DeepSeek discontinued both ids on 2026-07-24 ("The two legacy API
  model names, `deepseek-chat` and `deepseek-reasoner`, will be discontinued in
  three months"). Use `deepseek-v4-flash` (thinking is a per-request toggle now,
  not a separate id) or `deepseek-v4-pro`. Requests naming the retired ids still
  validate, with an `unknown_model` warning and no cost estimate.
- `gemini-robotics-er-1.6-preview` left the google catalog upstream, so
  `google.stt`'s excluded-id list no longer carries a reason for it.

RULES

- `claude-fable-5-1` joins the sampling-removed generation: `top_k` is denied
  (any value returns a 400) and only the default `temperature` is accepted,
  matching Claude Fable 5, Opus 4.7/4.8/5 and Sonnet 5.
- `anthropic.chat` refuses forced tool use on `claude-fable-5-1`. `tool_choice`
  `{"type": "any"}` and `{"type": "tool", …}` return a 400
  `invalid_request_error` on this model, thinking on or off; `auto` and `none`
  are unaffected. The error names the documented replacements (`strict: true` on
  the tool, or structured outputs). `MessagesArm` narrows `tool_choice` to match,
  so the editor refuses it first — the fourth per-model fact moved to compile
  time.
- `claude-fable-5-1` is in the always-thinking arm alongside `claude-fable-5`:
  `thinking: {"type": "disabled"}` was already refused at run time, but the type
  arm did not say so.
- `google.stt` curates `gemini-3.7-flash` and `gemini-3.8-flash` for
  transcription. Both are audio-in / text-out `generateContent` models per
  ai.google.dev — not Live API, not TTS, not embedding.
- `google.chat` refuses `generationConfig.thinkingConfig.thinkingLevel:
  "MINIMAL"` on `gemini-3.7-flash` and `gemini-3.8-flash`. Both model pages
  state "Note: `minimal` is not supported and returns an error", and the issue
  names the three levels they do accept. Scoped to those two ids on purpose:
  `gemini-3.6-flash` and `gemini-3.5-flash` still take MINIMAL, and every other
  row in the thinking guide's table is silent on what an unlisted level does.
- `xai.image` mirrors the generated `grok-imagine-image-2.0` row rather than
  carrying a longhand hand row: models.dev now tracks it, so the id gains the
  snapshot's modalities and `limit.context` (8000) while keeping its docs-quoted
  "$0.04 / image" rate, which the snapshot still does not carry.

VERIFIED, NO RULE NEEDED

- `qwen3.8-max` / `qwen3.8-flash`: catalog limits, modalities and all four rates
  match Alibaba Model Studio's Singapore price table exactly.
- `gemini-3.7-flash` / `gemini-3.8-flash`: 1,048,576 context and 65,536 output
  agree with Google's model pages, so the chat TTS overlay gains nothing; no
  3.7/3.8 TTS, Live or embedding variants exist to classify.
