/**
 * The `fal.imageEdit` adapter's **data**: the endpoint roster and the
 * per-model narrowing table.
 *
 * The image sibling's header explains the shape and the leaf rule in full;
 * this is the same file for the editing routes. One thing is worth adding
 * here: an editing row's `extras` is where the category's real variety lives —
 * `mask_url` on the fill route, `guidance_scale` on the flux ones,
 * `resolution` multipliers on the nano-banana ones — because the canonical
 * edit vocabulary has words for the source image, the prompt and the shape,
 * and nothing else. That is a statement about the vocabulary, not a gap: an
 * inpainting mask is not a word `unmodel/image-edit` has yet, and putting one
 * on a single provider's witness would be a guess.
 */

export {
  FAL_IMAGE_EDIT_PARAM_SHAPES as FAL_IMAGE_EDIT_MODEL_PARAMS,
  FAL_IMAGE_EDIT_MODELS as MODELS,
} from "./gen/image-edit-params.gen";
