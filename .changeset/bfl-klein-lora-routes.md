---
"unmodel": patch
---

black-forest-labs: `blackForestLabs.image` and `unmodel/image` now serve the FLUX.2 [klein] LoRA routes (public beta)

- New catalog rows and typed arms: `flux-2-klein-4b-finetuned`,
  `flux-2-klein-9b-finetuned`, `flux-2-klein-9b-kv-finetuned` and
  `flux-2-klein-9b-kv-bf16-finetuned` (`Flux2Klein4bFinetunedBody`,
  `Flux2Klein9bFinetunedBody`, `Flux2Klein9bKvFinetunedBody`,
  `Flux2Klein9bKvBf16FinetunedBody`). Each takes the klein request schema
  plus a required `finetune_id` and an optional `finetune_strength`
  (https://docs.bfl.ml/flux_2/flux2_lora_inference: "The request schema
  matches the underlying base endpoint, with two added parameters:
  `finetune_id` and `finetune_strength`"). A missing `finetune_id` is an
  `invalid_shape`; the klein limits (4 input images, no
  guidance/steps/upsampling) still apply. The routes carry `status: "beta"`.
- Pricing follows BFL's beta rule (billed as the base route): $0.014 for the
  4B route, $0.015 for the 9B and 9B KV routes (https://bfl.ai/pricing,
  https://docs.bfl.ml/quick_start/pricing). The BF16 route has no estimate —
  no BFL page says what it bills as.
- `finetune_id` / `finetune_strength` on any other FLUX.2 route
  (pro, max, flex, klein, previews) is now an `unsupported_param` naming the
  `-finetuned` routes, instead of an `unknown_param` warning that let a LoRA
  request go out as a plain generation.
- `unmodel/image` refs `black-forest-labs/flux-2-klein-*-finetuned` compile
  like klein, with `finetune_id` / `finetune_strength` as extras; `.toApi("fal")`
  refuses them by name (fal serves no klein row and cannot load a BFL LoRA).
