---
"unmodel": patch
---

amazon-bedrock: Fable 5.2 / 5.1 fixed sampling, GPT-6 Converse content and long-context cost rules, and Grok 4.7's real context window

`unmodel/amazon-bedrock`'s `chat` now enforces three more Bedrock model-card rules and corrects one catalog limit. Every rule covers the foundation id and each of its inference profiles.

- **Claude Fable 5.2 and Fable 5.1 have fixed sampling.** These now return `unsupported_param`:
  - `inferenceConfig.temperature` other than `1`
  - `inferenceConfig.topP` below `0.99`

  Two more cases validate with an `unsupported_param` warning instead: `topP` above `0.99`, and `temperature` sent together with `topP`. The card rules out both, but the Anthropic SDK documents `top_p` >= 0.99 as accepted, so neither is refused until a live request settles which source is right. Both cards say: "Sampling parameters: temperature must be 1.0 or unset; top_p must be 0.99 or unset; temperature and top_p cannot be specified together; top_k is not supported" (docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-fable-5-2.html and …-fable-5-1.html). Fable 5 states a different rule and is unchanged.
- **GPT-6 Astra / Sol / Luna and GPT-6.1 Sol / Terra refuse two Converse content shapes** with `unsupported_capability`:
  - a `document` content block, at any depth
  - an `image` block inside a `toolResult`

  Each card says: "This model doesn't accept `document` content blocks, and it doesn't accept an `image` content block inside a `toolResult`. A request that includes either is rejected with a `ValidationException`. To send a document to this model, use the Responses API with an `input_file` content part instead." (docs.aws.amazon.com/bedrock/latest/userguide/model-card-openai-gpt-6-sol.html and its siblings). Top-level images in user messages still validate.
- **GPT-6, GPT-6.1 and GPT-5.6 withhold cost above 272,000 prompt tokens.** Above that size, `chat(...).estimate.costUSD` and `checkChat(...).costUSD` are omitted, as they already are for Claude Haiku 5.5 above 100,000. The catalog rows carry only the short-context rates, and the long-context rates are up to twice as high. The prompt counts input, cache reads and cache writes. The models.dev Bedrock rows carry the tier (`"tier": { "size": 272000, "type": "context" }`), and the GPT-6 Sol card says: "Long-context rates apply to the full request when input exceeds 272,000 tokens."
- **Grok 4.7 (`us.` / `global.xai.grok-4.7`) gets its card's 524,288-token context and output limit.** The catalog row carries models.dev's 500,000, which refused prompts and `maxTokens` between 500,001 and 524,288 with `over_context` / `over_output_limit` although Bedrock accepts them. The card says: "Context window: 524,288 tokens, shared between input and output" and "Max output tokens: 524,288 minus input tokens" (docs.aws.amazon.com/bedrock/latest/userguide/model-card-xai-grok-4-7.html). The exported `models` table still carries the generated 500,000 until models.dev does. Grok 4.6's card says 500K, so it is unchanged.

Cards checked 2026-11-12 and 2026-11-13.
