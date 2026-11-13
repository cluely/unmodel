---
"unmodel": patch
---

amazon-bedrock: the 2026-11-12 models.dev refresh lands in `unmodel/amazon-bedrock`, adding Claude Fable 5.2, Opus 5.5, Sonnet 5.5 and Haiku 5.5, GPT-6 and Grok 4.7 among 85 new model and inference-profile ids, plus the two rules the new Claude ids need

- 85 new catalog ids validate and price through `createAmazonBedrock({ region }).chat` and `checkChat`:
  - `anthropic.claude-fable-5-2`, `anthropic.claude-opus-5-5`, `anthropic.claude-sonnet-5-5` and `anthropic.claude-haiku-5-5`, each with the profiles models.dev lists (geo profiles cost 10% more than the global row):
    - Fable 5.2: `us.` / `global.`
    - Opus 5.5: `us.` / `eu.` / `au.` / `jp.` / `global.`
    - Sonnet 5.5: `us.` / `eu.` / `au.` / `global.`
    - Haiku 5.5: `us.` / `eu.` / `au.` / `jp.` / `global.`. AWS also serves `ca.anthropic.claude-haiku-5-5` (docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-haiku-5-5.html, checked 2026-11-12), which models.dev does not list yet. It validates with an `unknown_model` warning and gets no `costUSD`.
  - `openai.gpt-6-astra` / `-sol` / `-luna` and `openai.gpt-6.1-sol` / `-terra`
  - `us.` / `global.xai.grok-4.7`, `global.moonshotai.kimi-k3.1`, `global.zai.glm-5.3` and `google.gemma-4-*`
  - the `us.` / `eu.` / `apac.` / `jp.` / `ca.` Nova profiles
- 108 existing rows change with the snapshot. For example:
  - Nova Lite / Micro / Pro output rises from 8,192 to 10,000 tokens, and they gain cache-write rates.
  - Nova 2 Lite gets a 1M-token context.
  - `au.anthropic.claude-opus-4-6-v1` drops from $16.50 / $82.50 to $5.50 / $27.50.
  - `anthropic.claude-sonnet-4-6` output rises from 64K to 128K.
  - Some limits narrow. `google.gemma-3-27b-it`, `google.gemma-3-4b-it` and `deepseek.r1-v1:0` (and its `us.` profile) now carry `toolCall: false`, so `toolConfig` on them is `unsupported_capability`. Llama 4 Maverick / Scout output drops from 16,384 to 8,192.
- 33 existing rows become `status: "deprecated"`: `anthropic.claude-sonnet-4-5-20250929-v1:0` and its five profiles, plus Llama 3.x / 4, Gemma 3, DeepSeek R1 / V3, MiniMax M2 / M2.1, GLM 4.7, Qwen3 Coder, Voxtral, Nemotron Nano v2, Palmyra X4 / X5, Devstral 2 and Kimi K2 Thinking. 10 of the new profile ids also arrive deprecated: the `apac.` / `eu.` / `global.` / `us.` profiles of `anthropic.claude-sonnet-4-20250514-v1:0`, `us.amazon.nova-premier-v1:0`, and the `us.` Llama 3.x and Palmyra X4 / X5 profiles. All of them are still served, so they still validate and warn `deprecated_model`.
- Claude Fable 5.2, Fable 5.1, Opus 5.5 and Sonnet 5.5, and every inference profile of them, refuse forced tool choice: `toolConfig.toolChoice` `any` or `tool` is `unsupported_param`. Send `{ auto: {} }` or omit `toolChoice`. The Opus 5.5 and Sonnet 5.5 Bedrock model cards say: "Client-side tool calling ( tool_choice types auto and none only)" (docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-opus-5-5.html and …-sonnet-5-5.html). The Fable cards are silent, but Bedrock's Claude tool-use guide says: "Claude Fable 5.2, Claude Mythos 5.2, Claude Opus 5.5, Claude Fable 5.1, and Claude Mythos 5.1 do not support forced tool use. … In the Converse API, the equivalent `toolChoice` settings (`tool` and `any`) surface the same error." (docs.aws.amazon.com/bedrock/latest/userguide/model-parameters-anthropic-claude-messages-tool-use.html#model-parameters-anthropic-claude-forced-tool-use)
- Claude Haiku 5.5 is priced by prompt length, and its catalog rows carry only the rates for prompts up to 100,000 tokens. Above that, `chat(...).estimate.costUSD` and `checkChat(...).costUSD` are omitted rather than stated at the lower rate, which would be 5x too low. The prompt counts input, cache reads and cache writes. The models.dev Bedrock rows carry the tier (`"tier": { "size": 100000, "type": "context" }`), and Anthropic's pricing page states it: "Claude Haiku 5.5 is priced by prompt length: a request whose prompt is over 100,000 tokens pays higher prices." (platform.claude.com/docs/en/about-claude/pricing)
