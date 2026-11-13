---
"unmodel": patch
---

topaz: false refusals fixed, Wonder 3 / 3.5 repriced, four models marked deprecated

Every fact below was read from the model's own page under
https://developer.topazlabs.com/image-models/upscaling-and-enhancement/ on
2026-11-12.

- **`Recover 3` takes `enhancementStrength` as a decimal from 0.0 to 10.0**
  (default 5.0; its own sample sends `enhancementStrength=5`). A number used
  to be refused at runtime and at compile time. `enhancementStrength` is now
  `TopazEnhancementStrength | number`. `Wonder 3` and `Wonder 3.5` still take
  only `"low"` / `"medium"` / `"high"`.
- **`faceEnhancement: true` no longer requires `faceEnhancementStrength` and
  `faceEnhancementCreativity`, and `detail: true` no longer requires
  `detailStrength`.** Wonder 2's page lists the strength as optional (default
  0.8) and its sample sends `faceEnhancement=true` on its own, and no page now
  ties `detailStrength` to a switch. The check that refused these requests is
  gone.
- **`Wonder` accepts up to 256 MP of output, not 128** ("This model accepts up
  to 256 MP input and output." on wonder-1.md). Requests between 128 and 256
  MP were refused.
- **Settings the pages list that were untyped, or that warned as ignored:**
  `Wonder 2` now takes `colorCorrection` and `preDownscale` (1–4); `Redefine`
  now takes `creativityBoost`, `detailLevel` (1–5) and `seed`; `High Fidelity
  V2` and `Low Resolution V2` now take `deblurStrength`,
  `decompressionStrength`, `denoiseStrength` and `opacity`; `CGI` now takes
  `denoiseStrength` and `opacity`; `Standard V2` takes `opacity` and its three
  strength dials in both spellings. Standard 2's page and sample write them as
  `deblur_strength` / `decompression_strength` / `denoise_strength`, while the
  request parameters page says every setting is camelCase, so both spellings
  are typed. The unified `topaz/…` refs offer the same dials.
- **`Wonder 3` and `Wonder 3.5` are 8 MP per credit, not 4** ("costs 1 credit
  per every 8 MP of generated output."), so their estimates halve.
  `MP_PER_CREDIT["Wonder 3"]` and `["Wonder 3.5"]` are now 8.
- **`High Fidelity V2`, `Wonder`, `Wonder 2` and `Wonder 3` carry `status:
  "deprecated"`** and validate with a `deprecated_model` warning. Each page
  says it "is deprecated and will be retired no sooner than January 1, 2027",
  and https://developer.topazlabs.com/resources/model-deprecations.md lists
  each one as Deprecated. They are still served.
- JSDoc: `recoveryStrength` defaults to 0.333 on `Upscale High Fidelity V3`;
  `Bloom Realism`'s `creativity` defaults to 2 and its page gives `seed` no
  bound. `Recovery V2` is recorded as Recover 2 (deprecated) and stays
  unrostered. So do the deprecated first-generation ids `Standard`, `Low
  Resolution`, `High Fidelity` and `Recover`. `/denoise-gen/async` (Denoise
  Max) is added to the routes the provider deliberately does not serve.
