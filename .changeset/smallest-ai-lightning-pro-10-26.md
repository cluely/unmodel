---
"unmodel": patch
---

smallest-ai: catalog the `lightning_v3.1_pro_10_26` preview checkpoint

`smallest-ai.tts` and `tts({ model: "smallest-ai/lightning_v3.1_pro_10_26" })`
now know the third value of the Waves `model` enum ("Allowed values:
`lightning_v3.1`, `lightning_v3.1_pro`, `lightning_v3.1_pro_10_26`",
https://docs.smallest.ai/api-reference/models/text-to-speech/synthesize-speech,
read 2026-11-12). Until now the id drew an `unknown_model` warning and no cost
estimate.

- It is the Pro pool's preview checkpoint for English, Spanish and Hindi,
  released 2026-10-29 (https://docs.smallest.ai/changelog/lightning-v-3-1/2026/10/29).
  It "becomes the stable `lightning_v3.1_pro` for these three languages" on
  2026-11-28 and "remains available until 2026-12-28". Its catalog row is
  marked `status: "beta"`.
- It prices like `lightning_v3.1_pro`, $19.50 per 1M characters: "pricing ...
  the same as `lightning_v3.1_pro`" (changelog), and the Pro pool is "approximately
  USD 0.195 per 10,000 characters" (https://smallest.ai/pricing/models).
- `word_timestamps` gets the same accepted-but-ignored warning as on the two
  stable pools, and the unified row is the Pro row (same codecs, languages and
  extras), because "Other request parameters behave identically".
- `SmallestModelId` / `SmallestTtsModelId`, `SMALLEST_MODEL_IDS` and the
  `unmodel/smallest-ai/values` `TTS_MODELS` / `TTS_MODEL_PARAMS` tables gain
  the id.
