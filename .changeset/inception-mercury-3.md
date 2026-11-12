---
"unmodel": patch
---

inception: `mercury-3` and `mercury-2.5` join the `inception.chat` catalog from the 2026-11-12 models.dev refresh, and an out-of-range `temperature` now warns

- `inception.chat` validates `mercury-3` and `mercury-2.5` without an
  `unknown_model` warning, caps `max_tokens` / `max_completion_tokens` at
  their 131,072 and 65,536-token output ceilings, and prices responses at the
  rates the API bills: $0.10 input / $0.01 cached input / $0.35 output per 1M
  for `mercury-3` (a launch promotion with no published end date; regularly
  $0.20 / $0.02 / $0.70), $0.20 / $0.02 / $0.75 for `mercury-2.5`. Sources:
  https://docs.inceptionlabs.ai/get-started/models and
  https://api.inceptionlabs.ai/v1/models.
- `temperature` outside 0.5–1 on `mercury-3`, `mercury-2.5` or `mercury-2`
  now validates with an `invalid_shape` warning naming the value the request
  will actually run at: the API does not refuse it, it resets it to the
  model's default (1 for `mercury-3` and `mercury-2.5`, 0.75 for `mercury-2`)
  and says so in the response's `warning` field. Sources:
  https://docs.inceptionlabs.ai/resources/faq and
  https://api.inceptionlabs.ai/openapi.json.
- `inception/mercury-3` and `inception/mercury-2.5` join the `unmodel/chat`
  model refs, and Vercel's `inception/mercury-3` and `inception/mercury-2.5`
  gain `.toApi("inception")`.
- `mercury-edit-2`'s generated row drops reasoning and structured outputs, so
  `reasoning_effort` and a `json_schema` `response_format` are now refused on
  it: its endpoints take neither (https://api.inceptionlabs.ai/openapi.json),
  and Inception serves it only on `/v1/fim/completions` and
  `/v1/edit/completions`, which unmodel does not validate yet. Its context
  moves from 128,000 to models.dev's 32,000, the docs' "FIM: 32K".
- `mercury-2` and `mercury-2.5` are closed to new users; existing customers
  keep access until 2026-11-15 and enterprise customers under their
  agreements (https://www.inceptionlabs.ai/models), so both stay validated.
  Any other key gets a 404 for them.
