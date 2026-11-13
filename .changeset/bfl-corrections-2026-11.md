---
"unmodel": patch
---

black-forest-labs: fix requests the validators wrongly refused, and add missing prices (checked against https://api.bfl.ai/openapi.json and https://bfl.ai/pricing on 2026-11-12)

- **`safety_tolerance` goes up to 7 on FLUX.2 and the FLUX tools.** It was
  capped at 5. The schemas allow 0–7 (`maximum: 7`) on `flux-2-pro`,
  `flux-2-max`, `flux-2-pro-preview`, `flux-2-flex`, the klein routes,
  outpainting, erase, deblur and both VTO routes: "Harm moderation tolerance
  from 0 to 7, with 0 the strictest. The route and organization determine the
  approved maximum…". Kontext, FLUX.1, Fill and Expand stay at 0–6.
  `.toApi("fal")` refuses 6 and 7, because fal's FLUX.2 rows stop at `"5"`.
- **`user` is accepted on every BFL endpoint.** Every request schema has
  this optional end-user identifier (`string | null`, 1–256 characters, no
  NUL): "Opaque identifier for the end user supplied by the calling
  platform." Before, it failed to compile and drew an `unknown_param`
  warning at run time. `.toApi("fal")` refuses it, because fal has no such
  field.
- **`flux-dev` costs $0.025 per image**, from https://bfl.ai/pricing: "FLUX.1
  [dev] Per image $0.025 /img".
- **Outpainting estimates its exact cost.** The rates are high (the default)
  $0.10 for the first MP plus $0.10 per additional MP, and fast $0.045 plus
  $0.006; the reference image is free. One megapixel is "1024 × 1024 pixels
  (1,048,576 pixels)", rounded up, and the output is the request's
  `width × height`. The new `outpaintingCostUSD` exposes the calculation.
- **Erase and deblur rates are published, without an estimate.** The new
  `FLUX_ERASE_RATE` / `FLUX_DEBLUR_RATE` export the rates ($0.03 first MP,
  $0.004 per additional MP, $0.004 per reference MP), along with
  `BFL_MEGAPIXEL` and `FLUX_OUTPAINTING_RATES`. Neither endpoint estimates a
  cost: the output follows the input's size, and BFL does not say whether the
  input bills as a reference.
- **`flux-pro-1.1-ultra-finetuned` is marked deprecated** and now returns a
  `deprecated_model` warning. BFL deprecated the FLUX.1 Finetuning API
  (https://docs.bfl.ml/release-notes: "No migration path available.
  Finetuning functionality will be discontinued."), but the route is still
  served.
- Provenance comments on the BFL catalog now quote https://bfl.ai/pricing and
  the docs `rates` table, and they note that the response `cost` field is in
  credits.
