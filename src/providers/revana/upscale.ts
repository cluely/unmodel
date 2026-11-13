/**
 * `revana.upscale` — the models whose `tasks` include `upscale`.
 *
 * A narrower VIEW of `revana.image` over the same route and the same check
 * battery (`docs/decisions.md` §4), for `unmodel/upscale`. One model today,
 * `recraft-crisp-upscale`, and it is the one model on Revana with no prompt:
 * "Required unless the model only transforms media (an upscaler)". It takes
 * the thing to enlarge and nothing else — the API's own summary is "It takes:
 * input.image_url or input.video_url." — and takes a picture handed over as
 * `image_urls` as well (2026-11-12, `quote-oracle.json`), so that is a request
 * this view serves too.
 *
 * ```ts
 * const params = revana.upscale({
 *   model: "recraft-crisp-upscale",
 *   input: { image_url: "https://example.com/small.png" },
 * });
 * ```
 */

import { elsewhere } from "./addresses";
import { createGenerationValidator } from "./generation";
import { REVANA_UPSCALE_MODELS, type RevanaUpscaleModelId } from "./gen/ids.gen";
import { imageModels } from "./gen/models-image.gen";
import { REVANA_IMAGE_PRICES } from "./gen/prices-image.gen";
import { REVANA_IMAGE_SHAPES } from "./gen/shapes-image.gen";

export const upscale = createGenerationValidator<RevanaUpscaleModelId>({
  endpoint: "revana.upscale",
  catalog: imageModels,
  shapes: REVANA_IMAGE_SHAPES,
  prices: REVANA_IMAGE_PRICES,
  view: {
    ids: REVANA_UPSCALE_MODELS,
    does: "upscale a picture or a clip",
    wide: "revana.image",
    needsOneOf: ["image_url", "video_url", "image_urls"],
  },
  elsewhere: elsewhere("revana.image"),
});
