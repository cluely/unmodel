---
"unmodel": patch
---

ideogram: `ideogram.image` (and `unmodel/image` refs to `ideogram/ideogram-3.0-…`) prices `custom_model_uri` requests at Ideogram's custom-model rate instead of the base 3.0 rate

- A request that sets `custom_model_uri` was estimated at the base per-image
  rate ($0.03 / $0.06 / $0.09), half of what Ideogram bills. It is now priced
  at the published custom-model rate: TURBO $0.06, DEFAULT $0.12, QUALITY
  $0.18 per image, × `num_images`. `maxCostUSD` enforces against the real
  figure.
- `rendering_speed: "FLASH"` with a custom model, and a custom model combined
  with `character_reference_images`, have no published API rate, so those
  requests now return no cost estimate rather than a guessed one.
- The rate table is exported as `CUSTOM_MODEL_PER_IMAGE` from
  `unmodel/ideogram`, next to `CHARACTER_REFERENCE_PER_IMAGE`.

Source: https://ideogram.ai/api/usage-pricing/catalog (retrieved 2026-11-12) —
the "Generation with a custom model" offerings "Ideogram 3.0 Custom Turbo"
60000, "Ideogram 3.0 Custom Default" 120000, "Ideogram 3.0 Custom Quality"
180000 (usd_micros), and the billing entries
`api_ideogram_v3_custom_model_generation` TURBO 0.06 / DEFAULT 0.12 / QUALITY
0.18, which carry no route or API-version dimension.
