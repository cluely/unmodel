/**
 * `revana.image` — every `kind: "image"` model on
 * `POST https://api.revana.si/v1/generations`.
 *
 * The widest picture surface: text-to-image, image-to-image and the upscaler
 * are all image models on one route, told apart by `input` alone
 * (`nano-banana-pro` with `image_url` IS an edit), so all of them validate
 * here. `revana.imageEdit` and `revana.upscale` are narrower views over the
 * same route and the same check battery (`docs/decisions.md` §4).
 *
 * Per model, from its catalog row: `resolution` and `quality` are that model's
 * lists, `aspect_ratio` is its list or free-form (`"16:9"`) when it lists
 * none, `image_urls` is capped at its `max_input_images`, and `num_images`
 * (also accepted as `n`) at its `max_images`. Pictures have no `duration` and
 * make no sound.
 *
 * The POST answers `202` with a queued `Generation`; `output.urls` lists one
 * file per picture once it succeeds. Auth is
 * `Authorization: Bearer <REVANA_API_KEY>`.
 *
 * ```ts
 * const params = revana.image({
 *   model: "nano-banana-pro",
 *   input: { prompt: "A red fox in snow", resolution: "2K", aspect_ratio: "16:9", num_images: 2 },
 * });
 * ```
 */

import { elsewhere } from "./addresses";
import { createGenerationValidator } from "./generation";
import type { RevanaImageModelId } from "./gen/ids.gen";
import { imageModels } from "./gen/models-image.gen";
import { REVANA_IMAGE_PRICES } from "./gen/prices-image.gen";
import { REVANA_IMAGE_SHAPES } from "./gen/shapes-image.gen";

export const image = createGenerationValidator<RevanaImageModelId>({
  endpoint: "revana.image",
  catalog: imageModels,
  shapes: REVANA_IMAGE_SHAPES,
  prices: REVANA_IMAGE_PRICES,
  elsewhere: elsewhere("revana.image"),
});
