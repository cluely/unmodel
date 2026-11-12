---
"unmodel": patch
---

perplexity: `checkChat` reports the billed cost and deep-research reasoning tokens

`perplexity.checkChat` priced a response from catalog token rates only, which
misses what every Sonar request also bills. On Perplexity's own sample
responses it reported $0.000411 for a `sonar` request billed $0.005420 ("1
request × $5 ÷ 1,000 = $0.005" is the search fee —
[sonar](https://docs.perplexity.ai/docs/legacy/sonar/models/sonar)), and
$0.091226 for a `sonar-deep-research` request billed $0.816123 (reasoning
tokens, citation tokens and "21 queries × $5 ÷ 1,000 = $0.105" —
[sonar-deep-research](https://docs.perplexity.ai/docs/legacy/sonar/models/sonar-deep-research)),
all read 2026-11-12.

- `costUSD` is now the response's own `usage.cost.total_cost` ("Total cost for
  the request in USD", a required field of the response's `usage` in the
  [API reference](https://docs.perplexity.ai/api-reference/legacy/sonar-post)).
  A response without `usage.cost` gets no `costUSD` instead of a token-only
  undercount.
- `usage.reasoningTokens` is read from the top-level `usage.reasoning_tokens`,
  where Perplexity reports it: "They're reported separately from completion
  tokens in `usage.reasoning_tokens` and billed at their own rate."
  ([FAQ](https://docs.perplexity.ai/docs/resources/faq)).
- `ChatCompletionLike` from `unmodel/perplexity/types` declares those two
  `usage` fields.

The pre-send `estimate.costUSD` (and so `maxCostUSD`) still prices tokens
only; the `unmodel/perplexity` module header and `docs/providers.md` now say
so, and correct the endpoint note: `/chat/completions` is the documented
alias of the canonical `POST /v1/sonar` ("For OpenAI SDK compatibility,
`POST /chat/completions` is also accepted as an alias" —
[OpenAI compatibility](https://docs.perplexity.ai/docs/legacy/sonar/openai-compatibility)),
and the Orchestrator API (`/orchestrator/v1`) speaks Chat Completions,
Responses and Anthropic Messages but stays out of the library because
"Orchestrator API is in private preview."
([orchestrator models](https://docs.perplexity.ai/docs/orchestrator/models)).
