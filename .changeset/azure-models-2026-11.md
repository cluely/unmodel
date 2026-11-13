---
"unmodel": patch
---

azure: GPT-6, Grok 4.6 / 4.7 and DeepSeek V4.1 Flash on `azure.chat`, with Azure's own limits where they differ from models.dev (models.dev snapshot and Microsoft Learn pages read 2026-11-12)

- `azure.chat` deployments named after these models now resolve to their own
  catalog rows and get the full catalog checks and pricing: `gpt-6-astra`,
  `gpt-6-sol`, `gpt-6-luna`, `gpt-6.1-sol`, `gpt-6.1-terra` (1,050,000 context,
  922,000 input, 128,000 output), `grok-4.6`, `grok-4.7` and
  `deepseek-v4.1-flash`. models.dev records no Azure price for `grok-4.7`, so
  its `estimate.costUSD` and `checkChat(...).costUSD` are omitted.
- New export `chatModels` from `unmodel/azure`: the catalog `azure.chat`
  validates against, which is the generated `models` table with Azure's
  documented corrections on top. `models` is unchanged.
  - The five GPT-6 rows accept `temperature` and `top_p`. Azure's GPT-6 feature
    table lists both as supported on all five
    (https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/reasoning).
    The same page's "Unsupported parameters" section says only GPT-6 Astra
    supports them, so for Sol, Luna, 6.1 Sol and 6.1 Terra the page contradicts
    itself. `azure.chat` does not refuse what one of Azure's own statements
    says is supported.
  - `deepseek-v4.1-flash` takes up to 384,000 output tokens, as Azure lists it
    ("**Output:** text (384,000 tokens)",
    https://learn.microsoft.com/en-us/azure/foundry/foundry-models/concepts/models-sold-directly-by-azure).
    models.dev's 128,000 refused larger `max_completion_tokens` values.
- Generated row changes from the snapshot: `gpt-3.5-turbo-0125` and
  `gpt-3.5-turbo-1106` cap output at 4,096 tokens (was 16,384). `gpt-5-pro`
  caps output at 128,000 and input at 272,000. `gpt-5.1-codex-max` caps input
  at 272,000. `gpt-chat-latest` is 400,000 / 272,000 / 128,000 (was 128,000 /
  111,616 / 16,384). `gpt-5.1` and `gpt-5.1-codex` no longer list audio or image
  output. `deepseek-v4-flash` and `deepseek-v4-pro` accept `tools`. Several
  GPT-4.x, GPT-5.x and o-series rows add PDF input. Cache-read prices change
  for `gpt-5`, `gpt-5-codex`, `gpt-5-mini`, `gpt-5-nano` and `gpt-5.2`, and
  `gpt-5.6-sol` is now $4 / $20 (was $5 / $30).
- models.dev no longer lists `claude-opus-4-1` or `deepseek-r1` for Azure.
  Deployments named after them now validate with an `unknown_model` warning and
  no price.
