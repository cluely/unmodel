---
"unmodel": patch
---

black-forest-labs: refuse requests the API rejects or silently drops, checked against https://api.bfl.ai/openapi.json and https://docs.bfl.ml on 2026-11-12

- **Outpainting refuses `seed`, `webhook_url` and `webhook_secret`.**
  `FluxOutpaintingInputs` is closed (`additionalProperties: false`), and
  unlike erase, deblur and VTO it declares none of the three. The docs say
  "The endpoint rejects unknown fields", so each was a 422. They are now an
  `unsupported_param` and a compile error on `imageEditOutpainting`, and
  `constraintsFor("flux-tools/outpainting-v1")` lists them. The route has no
  seed, and it delivers results only through the `polling_url` the POST
  returns. Erase, deblur and VTO still take all three.
- **Outpainting refuses canvases over 4 MP.** "The target canvas area
  (`width × height`) cannot exceed 4 megapixels (4,194,304 pixels). …
  Requests above this limit return `422`." (https://docs.bfl.ml/flux_tools/flux_outpainting).
  A larger canvas is now an `invalid_shape` on `width`, and the outpainting
  cost estimate no longer prices requests the API refuses. Exactly 4 MP is
  still accepted, in any aspect ratio. The new `FLUX_OUTPAINTING_MAX_PIXELS`
  exports the limit.
- **`raw` on `flux-pro-1.1-ultra-finetuned` is now an `unsupported_param`
  and a compile error.** `FinetuneFluxUltraInput` declares no `raw`, so the
  server dropped it without saying so. Raw mode exists only on
  `flux-pro-1.1-ultra`. The `IMAGE_MODEL_PARAMS` row for the finetuned route
  in `unmodel/black-forest-labs/values` no longer lists `raw`.
- The FLUX.2 [klein] LoRA docs also list `flux-2-klein-base-4b-finetuned` and
  `flux-2-klein-base-9b-finetuned`. They stay out of the catalog: the OpenAPI
  has no hosted klein Base route, so the request schema they are said to
  match cannot be checked. They validate on the loose path, with an
  `unknown_model` warning, and `finetune_id` is still required. The LoRA-only
  error on the other FLUX.2 routes now names them as well.
