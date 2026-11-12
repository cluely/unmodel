---
"unmodel": patch
---

cohere: `north-mini-code-1.0` validates under Cohere's own id, and Command A+ / Reasoning / Translate / Vision no longer carry a contradicted $2.50 / $10 rate

- **`north-mini-code-1.0`** is the id Cohere serves ("**Model Name**:
  `north-mini-code-1.0`" — https://docs.cohere.com/changelog; the model table
  at https://docs.cohere.com/docs/models and
  https://docs.cohere.com/docs/cohere-on-openrouter agree). models.dev's
  `north-mini-code-1-0` spelling left real requests at `unknown_model` with
  every capability and output-limit check skipped; they now run, and
  `north-mini-code-1-0` validates with an `unknown_model` warning instead.
  `response_format: json_object` stays accepted — the model page renders
  Structured Outputs as supported
  (https://docs.cohere.com/docs/north-mini-code-1.0).
- **`command-a-plus-05-2026`, `command-a-reasoning-08-2025`,
  `command-a-translate-08-2025`, `command-a-vision-07-2025`**: estimates and
  `checkChat` report no `costUSD`. The $2.50 / $10.00 per 1M rate comes only
  from cohere.com/pricing's card rows, which the same page contradicts (they
  price Command R7B at $2.50 / $2.50 against its own $0.0375 / $0.15 entry,
  and Command A+'s own entry there reads "Free"). Each model page says "For
  both trial keys and production keys, <model> is free until rate limits are
  reached" and sends production use to sales or Model Vault, with no
  per-token rate published (https://docs.cohere.com/docs/command-a-plus,
  /command-a-reasoning, /command-a-translate, /command-a-vision).
