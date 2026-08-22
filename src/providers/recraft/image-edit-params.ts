/**
 * The image-edit adapter's **data**: the model list, the per-model narrowing table,
 * and the format spec where the category has one.
 *
 * A leaf rather than a section of the adapter beside it, because
 * `unmodel/recraft/values` publishes these arrays for client-side pickers and the
 * adapter imports this provider's validator, its zod schema and the compile
 * helpers in `core/unified/derive`. The adapter reads the very same objects, so
 * what is published and what is sent cannot drift.
 */

import { EXTRA } from "../../core/unified/derive";
import type { ModelParamTable } from "../../core/unified/vocabulary/image-edit";
import type { RecraftControls, RecraftTextLayoutElement } from "./image";
import { IMAGE_TO_IMAGE_MODELS, type RecraftModelId } from "./models";
import { RECRAFT_V3_STYLES, RECRAFT_V3_VECTOR_STYLES } from "./styles";

/**
 * Every model `imageToImage` documents — the V3 **and** V4 lines, which is one
 * more line than the four V3-only editing routes accept and the reason this
 * list is not just `MODELS` from the generation adapter (recraftv2 and
 * recraft20b are generation-only).
 *
 * Spread from `IMAGE_TO_IMAGE_MODELS` rather than retyped: that array is what
 * the endpoint's own `makeModelCheck` allows, so the refs that autocomplete and
 * the ids that validate cannot drift.
 */
export const MODELS = [...IMAGE_TO_IMAGE_MODELS] as const satisfies readonly RecraftModelId[];

/**
 * Fourteen rows, and **no sizing on any of them**: `imageToImage` publishes no
 * `size` and no aspect field, so `sizes` and `ratios` are both absent and
 * `aspectRatio` / `dimensions` are declared gaps below. `size` types as
 * `never` for the same reason, which is the answer this route actually gives.
 *
 * The extras are the style vocabulary, and the split is the same one the
 * generation route has: `style` is a curated per-model list on the two V3 ids
 * and denied on the whole V4/V4.1 line, `text_layout` is V3-only, and
 * `negative_prompt` — which *is* a canonical word on the generation surface —
 * is an extra here because `ImageEditParams` has no `negativePrompt`.
 */
export const RECRAFT_EDIT_SHARED_EXTRAS = {
  style_id: EXTRA as string | null,
  controls: EXTRA as RecraftControls | null,
} as const;

export const V4_EDIT_ROW = { extras: RECRAFT_EDIT_SHARED_EXTRAS } as const;

export const RECRAFT_IMAGE_EDIT_MODEL_PARAMS = {
  recraftv3: {
    extras: {
      style: EXTRA as (typeof RECRAFT_V3_STYLES)[number] | (string & {}) | null,
      negative_prompt: EXTRA as string | null,
      text_layout: EXTRA as RecraftTextLayoutElement[] | null,
      ...RECRAFT_EDIT_SHARED_EXTRAS,
    },
  },
  recraftv3_vector: {
    extras: {
      style: EXTRA as (typeof RECRAFT_V3_VECTOR_STYLES)[number] | (string & {}) | null,
      negative_prompt: EXTRA as string | null,
      text_layout: EXTRA as RecraftTextLayoutElement[] | null,
      ...RECRAFT_EDIT_SHARED_EXTRAS,
    },
  },
  recraftv4: V4_EDIT_ROW,
  recraftv4_vector: V4_EDIT_ROW,
  recraftv4_pro: V4_EDIT_ROW,
  recraftv4_pro_vector: V4_EDIT_ROW,
  recraftv4_1: V4_EDIT_ROW,
  recraftv4_1_vector: V4_EDIT_ROW,
  recraftv4_1_pro: V4_EDIT_ROW,
  recraftv4_1_pro_vector: V4_EDIT_ROW,
  recraftv4_1_utility: V4_EDIT_ROW,
  recraftv4_1_utility_vector: V4_EDIT_ROW,
  recraftv4_1_utility_pro: V4_EDIT_ROW,
  recraftv4_1_utility_pro_vector: V4_EDIT_ROW,
} as const satisfies ModelParamTable;
