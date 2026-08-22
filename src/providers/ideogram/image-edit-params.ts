/**
 * The image-edit adapter's **data**: the model list, the per-model narrowing table,
 * and the format spec where the category has one.
 *
 * A leaf rather than a section of the adapter beside it, because
 * `unmodel/ideogram/values` publishes these arrays for client-side pickers and the
 * adapter imports this provider's validator, its zod schema and the compile
 * helpers in `core/unified/derive`. The adapter reads the very same objects, so
 * what is published and what is sent cannot drift.
 */

import { EXTRA } from "../../core/unified/derive";
import type { ModelParamTable } from "../../core/unified/vocabulary/image-edit";
import type {
  IdeogramColorPalette,
  IdeogramMagicPromptOption,
  IdeogramStylePreset,
  IdeogramStyleType,
} from "./image";
import { RESOLUTIONS } from "./constraints";
import type { IdeogramModelId } from "./models";

/**
 * The 3.0 pseudo-models, and only those: remix is `/v1/ideogram-v3/remix` and
 * the 4.0 line publishes no remix route, so a `ideogram-4.0-…` ref here would
 * autocomplete a request that cannot be made.
 *
 * `satisfies readonly IdeogramModelId[]` pins the list to `models.ts`, so a
 * typo is a compile error rather than an `unknown_model` warning that silently
 * skips the per-speed price.
 */
export const MODELS = [
  "ideogram-3.0-flash",
  "ideogram-3.0-turbo",
  "ideogram-3.0-default",
  "ideogram-3.0-quality",
] as const satisfies readonly IdeogramModelId[];

/**
 * One row, four times: the four refs differ only in `rendering_speed` and
 * price, and `/v1/ideogram-v3/remix` is one route with one form.
 *
 * `sizes` is the same closed 69-value `resolution` enum the generation route
 * has, and `ratios` the same fifteen shapes respelled with a colon — the wire
 * spells them with an `x`, and `toRatioEnum` bridges the two. Neither is
 * free-form: `checkEnums` rejects anything outside the lists.
 *
 * `rendering_speed` is deliberately absent from the extras: it is compiled
 * from the model half of the ref, and a second way to set it would let one
 * request say two things about which model it wants.
 */
export const IDEOGRAM_REMIX_RATIOS = [
  "1:3",
  "3:1",
  "1:2",
  "2:1",
  "9:16",
  "16:9",
  "10:16",
  "16:10",
  "2:3",
  "3:2",
  "3:4",
  "4:3",
  "4:5",
  "5:4",
  "1:1",
] as const;

export const REMIX_ROW = {
  sizes: RESOLUTIONS,
  ratios: IDEOGRAM_REMIX_RATIOS,
  extras: {
    magic_prompt: EXTRA as IdeogramMagicPromptOption,
    style_type: EXTRA as IdeogramStyleType,
    style_preset: EXTRA as IdeogramStylePreset,
    style_codes: EXTRA as string[],
    color_palette: EXTRA as IdeogramColorPalette,
    style_reference_images: EXTRA as Blob[],
    character_reference_images: EXTRA as Blob[],
    character_reference_images_mask: EXTRA as Blob[],
  },
} as const;

export const IDEOGRAM_IMAGE_EDIT_MODEL_PARAMS = {
  "ideogram-3.0-flash": REMIX_ROW,
  "ideogram-3.0-turbo": REMIX_ROW,
  "ideogram-3.0-default": REMIX_ROW,
  "ideogram-3.0-quality": REMIX_ROW,
} as const satisfies ModelParamTable;
