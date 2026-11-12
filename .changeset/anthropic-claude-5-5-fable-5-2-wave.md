---
"unmodel": patch
---

anthropic: Claude Fable 5.2, Opus 5.5, Sonnet 5.5 and Haiku 5.5 land in `unmodel/anthropic` with the per-model rules they need (models.dev refresh and vendor pages read 2026-11-12)

- Catalog rows for `claude-fable-5-2` ($8 / $40 per MTok, cache read $0.20,
  5m cache write $10), `claude-opus-5-5` ($4 / $20, cache read $0.20, write
  $5), `claude-sonnet-5-5` ($2 / $10, cache read $0.10 — half Sonnet 5's —
  write $2.50) and `claude-haiku-5-5` ($0.10 / $0.50, cache read $0.01, write
  $0.125, for prompts up to 100,000 tokens). All four: 1M context, 128K output,
  text + image + PDF in, sampling removed. `claude-sonnet-4-5` and
  `claude-sonnet-4-5-20250929` now carry `status: "deprecated"` (retirement
  2026-11-30, replacement `claude-sonnet-5-5`) and their real 200K context, so
  the per-request image cap on them is 100.
- Haiku 5.5 is priced by prompt length and the catalog row carries only the
  rates for prompts up to 100,000 tokens, so `chat(...).estimate.costUSD` and
  `checkChat(...).costUSD` are omitted — never stated at the sub-threshold
  rate, which is 5x too low — once the prompt (input + cache reads + cache
  writes) exceeds 100,000 tokens.
  (platform.claude.com/docs/en/about-claude/pricing)
- The four new ids join the Claude 4.7+ generation: `top_k` is refused at any
  value, `temperature` other than 1 and `top_p` below 0.99 are refused, and
  images estimate at the high-resolution tier (4784 tokens per image).
- Forced tool use (`tool_choice` `any` / `tool`) is refused on
  `claude-fable-5-2`, `claude-opus-5-5` and `claude-sonnet-5-5`; Haiku 5.5
  keeps it. (platform.claude.com/docs/en/api/errors)
- Thinking rules, each with its compile-time arm on `anthropic.chat`:
  - `thinking: {type: "disabled"}` is refused at every effort on
    `claude-opus-5-5` and `claude-fable-5-2` (adaptive thinking is always on).
    `claude-opus-5-5` is no longer treated as a snapshot of `claude-opus-5`,
    so it gets this rule rather than Opus 5's effort cap: a snapshot is now
    `<id>-YYYYMMDD` only.
  - `claude-sonnet-5-5` refuses `disabled` and takes
    `thinking: {type: "between_tools"}` instead — a new wire value (it was
    `invalid_shape` before) accepted at `output_config.effort` high or below,
    refused at `xhigh` / `max`, refused with any extra field, and refused on
    every other catalog model.
  - `claude-haiku-5-5` accepts `disabled` at effort high or below and refuses
    it at `xhigh` / `max`, as Opus 5 does.
  - `thinking: {type: "enabled", budget_tokens}` (manual extended thinking) is
    refused on every Claude 4.7+ id: the four new ones and `claude-opus-4-7`,
    `claude-opus-4-8`, `claude-opus-5`, `claude-sonnet-5`, `claude-fable-5`,
    `claude-fable-5-1`. (errors page: "Claude 4.7 and later models don't
    support extended thinking")
- A trailing assistant message (response prefill) is refused on Claude 4.6 and
  later whether or not thinking is on; earlier models keep the thinking-scoped
  rule.
- `tools[].type` `computer_20251124` and `computer_20250124` are refused on
  the four new ids on the Claude API; the message names
  `computer_toolset_20260801` as what they accept.
- `speed?: "standard" | "fast" | null` joins `MessagesBody` (fast mode).
  `"fast"` validates on `claude-fable-5-2` and `claude-opus-5-5` (GA), on
  `claude-opus-5` and `claude-opus-4-8` with the `fast-mode-2026-02-01` beta
  header you add yourself, is a warning on `claude-opus-4-6` (it runs at
  standard speed) and is refused on every other catalog model. `checkChat`
  reads `usage.speed` and omits `costUSD` for fast-mode responses, whose
  premium rates are not in the catalog.
  (platform.claude.com/docs/en/build-with-claude/fast-mode)
