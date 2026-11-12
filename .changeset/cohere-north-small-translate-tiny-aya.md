---
"unmodel": patch
---

cohere: `north-small-translate-1.0` and the four Tiny Aya models validate on `cohere.chat`; the two retired Aya 8B ids leave the catalog (models.dev refresh, 2026-11-12)

- **`north-small-translate-1.0`** validates under Cohere's own id, with a 16K
  context and 16K output limit, priced at $0 ("For both trial keys and
  production keys, North Small Translate is free until rate limits are
  reached"). Tools, `thinking`, `response_format: json_object` and image input
  are refused — the model page's capability card greys out Tool Use,
  Reasoning, Structured Outputs and Image Inputs
  (https://docs.cohere.com/docs/north-small-translate-1.0). models.dev spells
  this model `north-small-translate-09-2026` with a 32768-token context; no
  Cohere page uses that id, so it validates with an `unknown_model` warning.
- **`tiny-aya-global`, `tiny-aya-earth`, `tiny-aya-fire`, `tiny-aya-water`**
  validate (8k context / 8k output). Cohere publishes no price for them, so
  estimates carry no `costUSD` (https://docs.cohere.com/docs/tiny-aya).
- **Retired:** `c4ai-aya-expanse-8b` and `c4ai-aya-vision-8b` — "Effective
  April 4, 2026, the following models are no longer available. Requests using
  these model IDs will fail." (https://docs.cohere.com/changelog). They leave
  `CohereTextModelId` and now validate with an `unknown_model` warning. Use
  `c4ai-aya-expanse-32b` / `c4ai-aya-vision-32b`, or Cohere's recommended chat
  alternatives `command-r7b-12-2024`, `command-a-03-2025` and
  `command-a-reasoning-08-2025` (https://docs.cohere.com/docs/deprecations).
- `north-mini-code-1-0` keeps accepting `response_format: json_object`:
  models.dev now marks it without structured outputs, but its model page
  renders Structured Outputs as supported
  (https://docs.cohere.com/docs/north-mini-code-1.0).
- `c4ai-aya-expanse-32b`, `c4ai-aya-vision-32b` and the Tiny Aya models now
  refuse `response_format: json_object` (models.dev marks them without
  structured outputs; Cohere's structured-outputs guide lists only Command
  models as compatible). `c4ai-aya-expanse-32b` gains its $0.50 / $1.50 per 1M
  token rate ("Aya Expanse models (8B and 32B) on the API are charged at
  $0.50/1M tokens for input and $1.50/1M tokens for output" —
  https://cohere.com/pricing).
- New exports on `unmodel/cohere`: `chatModels`, the catalog `cohere.chat`
  validates against (the generated models.dev table plus the doc-sourced
  corrections above), and its id union `CohereChatModelId`, which
  `ChatBody["model"]` now completes from.
