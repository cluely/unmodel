---
"unmodel": patch
---

black-forest-labs: retire `flux-pro-1.0-fill-finetuned`

BFL discontinued the FLUX.1 Finetuning API on 2025-10-31 and the route is no
longer in https://api.bfl.ai/openapi.json. The release notes
(https://docs.bfl.ml/release-notes, read 2026-11-12) list
`flux-pro-1.0-fill-finetuned` under the deprecation with "No migration path
available. Finetuning functionality will be discontinued."

- Removed: the `flux-pro-1.0-fill-finetuned` catalog row, its
  `blackForestLabs.imageEditFill` arm, and the `FluxFillFinetunedBody` type
  (from `unmodel/black-forest-labs` and `unmodel/black-forest-labs/types`).
  The id now validates as an unknown model, with an `unknown_model` warning
  and no cost estimate.
- Replacement: BFL names none. For inpainting without a LoRA, use
  `flux-pro-1.0-fill`. LoRAs now run on the FLUX.2 [klein] `-finetuned`
  routes of `blackForestLabs.image` (`flux-2-klein-4b-finetuned`,
  `flux-2-klein-9b-finetuned`, `flux-2-klein-9b-kv-finetuned`,
  `flux-2-klein-9b-kv-bf16-finetuned`). Those are text-to-image/editing
  routes, not inpainting, and BFL calls them a self-serve product "separate
  from the FLUX.1-era Finetuning API".
- `finetune_id` / `finetune_strength` on `flux-pro-1.0-fill` are still an
  `unsupported_param`, and the message now points to the klein LoRA routes.
