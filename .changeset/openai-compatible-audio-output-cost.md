---
"unmodel": patch
---

- **`unmodel` (`computeCostUSD`), `unmodel/openai-compatible` (`checkChat`):** Add `audioOutputTokens` to `TokenBreakdown` and price `completion_tokens_details.audio_tokens` at the catalog's `outputAudio` rate (falling back to `cost.output` when a model publishes no `outputAudio` rate).
