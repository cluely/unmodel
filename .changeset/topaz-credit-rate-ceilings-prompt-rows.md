---
"unmodel": patch
---

topaz: $0.10 a credit, 256 MP classic ceilings, `prompt` only where a page lists it

Every fact below was read from Topaz's own pages on 2026-11-12 / 2026-11-13.

- **`CREDIT_USD` is 0.10, not 0.12.** The $0.12 "Starter" rate is gone:
  https://www.topazlabs.com/enhance-api now redirects to
  https://www.topazlabs.com/api, which publishes only Developer ("$0.10 /
  credit") and Scale ("$0.08 / credit"). `topazCostUSD` and every
  `estimate.costUSD` on `topaz.upscale` / `topaz.upscaleGenerative` now use
  $0.10, the highest published plan rate. A one-time credit pack exists at an
  unpublished price, so that figure is not a ceiling for every account.
- **The classic upscalers cap their output at 256 MP, not 1024.** "This model
  accepts up to 256 MP input and output." is on the pages of `Standard V2`,
  `High Fidelity V2`, `Upscale High Fidelity V3`, `Low Resolution V2`, `CGI`
  and `Text Refine`. Requests between 256 and 1024 MP used to pass here, but
  Topaz's spec documents a 413 for them: "Output image dimensions exceed
  maximum allowed of 256 MP." `TOPAZ_MEGAPIXEL_LIMITS` is now 256 / 256 for
  all six; `Upscale High Fidelity V3` is a new row.
- **`prompt` is refused at `topaz/Wonder`, `topaz/Wonder 2`, `topaz/Wonder 3`,
  `topaz/Wonder 3.5`, `topaz/Standard MAX`, `topaz/Recover 3` and
  `topaz/Bloom Realism`** in `unmodel/upscale`, as it already was at
  `topaz/Wonder 4` and `topaz/Detail`. None of their pages lists `prompt`
  ("Wonder 1 has no model-specific parameters.", "Standard Max has no
  model-specific parameters."), so Topaz dropped the prompt without a word.
  Only `Redefine`, `Bloom 2` and `Bloom` take one. In `TOPAZ_SETTINGS_BY_MODEL`,
  `prompt` and `autoprompt` are removed from those seven rows, so at the wire
  they warn as ignored settings. Those seven catalog rows no longer declare a
  `text` input. The unified `autoprompt` extra is now offered only at
  `topaz/Redefine` and `topaz/Bloom 2`.
- **`Redefine` takes `creativity` 1–6.** Its page says "`1` to `6`", and 7–9
  are now refused (`invalid_enum_value`). `Bloom 2` and `Bloom` still take 1–9.
- **`Recover 3` refuses a word for `enhancementStrength`.** Its page types the
  dial as a decimal from 0.0 to 10.0. `"low"`, `"medium"` and `"high"` are now
  `invalid_shape` there. They are still the only values `Wonder 3` and
  `Wonder 3.5` take.
- Dead documentation links are re-cited:
  - `topaz.provider.doc` and the unified refusals' `meta.source` now point at
    https://developer.topazlabs.com/reference/image/enhance.
  - The classic route's issues now cite
    https://developer.topazlabs.com/image-models/upscaling-and-enhancement/precision,
    and the generative route's issues cite
    https://developer.topazlabs.com/image-models/upscaling-and-enhancement.
  - The spec is cited at
    https://openapi.gitbook.com/o/HctdcUHRfIWXBVA1egPp/spec/image-yaml.yaml.
    The dated `image-yaml-feb-2026.yaml` URL now serves the Video API.
