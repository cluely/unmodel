---
"unmodel": patch
---

topaz: `Wonder 4`, `Detail` and `Bloom` join `topaz.upscaleGenerative` and `unmodel/upscale`

- **`Wonder 4`** — Topaz's recommended generative upscaler. No settings at all
  (its page's parameter table is the `model` row alone; What's New: "No
  settings."), so any dial warns as one it ignores, and the canonical `prompt`
  is refused at `topaz/Wonder 4`. 8 MP per credit, 256 MP input and output.
  https://developer.topazlabs.com/image-models/upscaling-and-enhancement/generative/wonder-4.md
- **`Detail`** (Detail Faces) — filed under Precision Upscaling but served on
  `/image/v1/enhance-gen/async`. One setting, `detailStrength` (0.0–10.0), and
  no `prompt`. 24 MP per credit; no MP ceiling on its page.
  https://developer.topazlabs.com/image-models/upscaling-and-enhancement/precision/detail-faces.md
- **`Bloom`** (Bloom 1 Creative) — its page now states the `"Bloom"` model
  string. Settings `colorPreservation`, `creativity`, `creativityBoost`,
  `facePreservation`, `prompt` and `seed`; `creativityBoost` and
  `facePreservation` are newly typed on `TopazUpscaleGenerativeParams`. 2 MP per
  credit, 256 MP input and output. Legacy per Topaz's creative family page,
  Active in its Model Deprecations table, so no `deprecated` status.
  https://developer.topazlabs.com/image-models/upscaling-and-enhancement/creative/bloom-1-creative.md
- `unmodel/upscale` now decides canonical `prompt` per model from
  `TOPAZ_SETTINGS_BY_MODEL` rather than per route, so a generative-route model
  whose page documents no `prompt` refuses it by name, listing the models that
  take one. The catalog rows of `Wonder 4` and `Detail` declare no `text` input.
- **Breaking (values):** Topaz now prices per model rather than per family,
  because the rate no longer follows the route (`Detail` is 24 MP per credit on
  the generative route, `Wonder 4` is 8). `MP_PER_CREDIT` is keyed by model id
  and quotes each model page's "costs 1 credit per every N MP of generated
  output" sentence. Retired: `TOPAZ_PRICING_FAMILY`, the `TopazPricingFamily`
  type, and `MP_PER_CREDIT`'s `gigapixel` / `wonder` / `bloom` keys — read
  `MP_PER_CREDIT[model]` instead. `topazCredits` / `topazCostUSD` results are
  unchanged for every model already rostered.
