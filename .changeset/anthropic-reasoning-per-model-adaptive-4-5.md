---
"unmodel": patch
---

anthropic: unified `reasoning` compiles per Claude model, and `adaptive` is refused on Claude 4.5 (vendor pages read 2026-11-12)

- `unmodel/chat`: `reasoning: "off"` (or `false`) on `anthropic/claude-sonnet-5-5`
  was refused, because it compiled to `thinking: {type: "disabled"}`, which
  that model rejects. It now compiles to `thinking: {type: "between_tools"}`,
  the model's lowest setting, with an `approximated_param` warning: there is
  no up-front thinking, but the progress updates between tool calls still
  come back as thinking blocks. Other models are unchanged: `disabled` where
  they accept it, and still refused on models where thinking is always on
  (`claude-opus-5-5`, `claude-fable-5*`).
  (platform.claude.com/docs/en/build-with-claude/thinking)
- `unmodel/chat`: a `reasoning` with `budgetTokens` on Claude 4.7 and later
  was refused, because it compiled to `thinking.type "enabled"`. That
  includes the portable `{ effort, budgetTokens }` form. These models have no
  token budget. A request now compiles to `thinking: {type: "adaptive"}` plus
  `output_config.effort`, the vendor's documented migration:
  - With `{ effort, budgetTokens }`, the effort you gave is sent. No warning:
    nothing was approximated.
  - With a bare `{ budgetTokens }`, the budget becomes an effort bucket, with
    an `approximated_param` warning: up to 2,048 tokens is `low`, up to 8,192
    is `medium`, anything above is `high`. These are the buckets the
    chat-completions codec already used.

  `adaptive` is always sent explicitly, because Claude Opus 4.7 and 4.8 run
  with thinking off when `thinking` is absent. Models that still take a
  budget (Claude 4.6 and earlier) compile to `enabled` as before.
  (platform.claude.com/docs/en/build-with-claude/extended-thinking,
  "Migrating to adaptive thinking")
- `anthropic.chat`: `thinking: {type: "adaptive"}` is refused on
  `claude-opus-4-5`, `claude-sonnet-4-5` and `claude-haiku-4-5` (and their
  dated snapshots), both at run time and in the type of `thinking`. The API
  returns a 400 there: "Models that support only extended thinking (Claude
  4.5 and earlier models) reject `thinking: {"type": "adaptive"}`". The
  refusal names `thinking: {type: "enabled", budget_tokens: N}`. The
  `between_tools` refusal on these models no longer suggests `adaptive`.
  (platform.claude.com/docs/en/api/errors)
