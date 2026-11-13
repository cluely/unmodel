/**
 * `revana.imageEdit` — the image models whose `tasks` include
 * `image_to_image`, asked to edit.
 *
 * A narrower VIEW of `revana.image`, not a second endpoint: the URL, the body
 * and the check battery are the same (`docs/decisions.md` §4). What the view
 * adds is the two things that make a request an edit —
 *
 * - the model must be one that edits (`imagen-4` is text-to-image only, and
 *   the API answers a picture sent to it with "cannot take this combination of
 *   inputs. It takes: a prompt alone");
 * - the request must carry the picture: `input.image_url` ("the picture to
 *   edit") or `input.image_urls` ("reference pictures, up to the model's
 *   max_input_images").
 *
 * — and it exists so `unmodel/image-edit` reaches Revana through a file with
 * the uniform name. Everything this view refuses, `revana.image` validates.
 *
 * ```ts
 * const params = revana.imageEdit({
 *   model: "flux-kontext-pro",
 *   input: { prompt: "Make the jacket red", image_url: "https://example.com/portrait.png" },
 * });
 * ```
 */

import { elsewhere } from "./addresses";
import { createGenerationValidator } from "./generation";
import { REVANA_IMAGE_EDIT_MODELS, type RevanaImageEditModelId } from "./gen/ids.gen";
import { imageModels } from "./gen/models-image.gen";
import { REVANA_IMAGE_PRICES } from "./gen/prices-image.gen";
import { REVANA_IMAGE_SHAPES } from "./gen/shapes-image.gen";

export const imageEdit = createGenerationValidator<RevanaImageEditModelId>({
  endpoint: "revana.imageEdit",
  catalog: imageModels,
  shapes: REVANA_IMAGE_SHAPES,
  prices: REVANA_IMAGE_PRICES,
  view: {
    ids: REVANA_IMAGE_EDIT_MODELS,
    does: "edit a picture",
    wide: "revana.image",
    needsOneOf: ["image_url", "image_urls"],
  },
  elsewhere: elsewhere("revana.image"),
});
