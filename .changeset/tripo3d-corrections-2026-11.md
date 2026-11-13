---
"unmodel": patch
---

tripo3d: three false refusals fixed, the texture-version parameters typed, and P1 priced

- **`texture_quality: "fast"`** is accepted on every model that takes `texture_quality`.
  It needs `texture_version: "v3.5-20260815"`, so a `fast` request that omits
  `texture_version` (every model derives v3.0 or v2.5 by default) or names another
  documented version is refused, naming the version it would run. Docs: "`fast` is only
  available on texture `v3.5-20260815`. … Any other texture version returns `1004` rather
  than silently falling back to `standard`."
  (https://developers.tripo3d.ai/en/docs/generation-text-to-model/standard, read 2026-11-12).
  It costs the same as `standard`.
- **New parameters on both routes and every model**: `texture_version` (open string;
  `TEXTURE_VERSIONS` lists `v3.5-20260815`, `v3.0-20250812`, `v2.5-20250123`), `delight`
  (boolean; a warning when the texture version ignores it) and `export_orientation`
  (`+x` / `-x` / `+y` / `-y`, `EXPORT_ORIENTATIONS`). All three sit outside the version
  gate and reach `unmodel/3d` as extras. Changelog: "new `texture_version` pins the texture
  model independently of the geometry `model`."
  (https://developers.tripo3d.ai/en/docs/changelog, read 2026-11-12).
- **`generate_parts` with `quad: true` is no longer refused.** Only `texture` / `pbr` being
  true (including their true defaults) is an error; `quad: true` now warns that the parts come
  back as triangles, and `smart_low_poly: true` warns that parts are not produced. Docs:
  "`quad=true` — quad is ignored; the returned parts are triangle meshes." /
  "`smart_low_poly=true` — smart_low_poly takes precedence and parts are NOT produced."
- **`tripo3d.threeDFromImage` accepts a prior task's id as `input`.** Task ids are bare UUIDs
  ("Example: `550e8400-e29b-41d4-a716-446655440000`",
  https://developers.tripo3d.ai/en/docs/generation-image-to-model/standard); the input check
  only recognised a `task_` prefix that no Tripo page uses, and refused the real shape.
- **P1 is priced**: 30 credits bare / 40 textured on text-to-model, 40 / 50 on image-to-model,
  texture tiers +10 / +20, from the pricing page's P-Series tab
  (`noTexP1:30 … stdTexP1:40`, `noTexP1:40 … stdTexP1:50` in
  https://developers.tripo3d.ai/assets/PricingPage-BWsTiO9s.js, read 2026-11-12). Estimates
  for P1 were `undefined`.
- Docs: Tripo's `models-and-versions` page now lists the same dated ids as the endpoint pages;
  the note about a short-alias conflict is gone.
