/**
 * The image adapter's **data**: the model list, the per-model narrowing table,
 * and the format spec where the category has one.
 *
 * A leaf rather than a section of the adapter beside it, because
 * `unmodel/recraft/values` publishes these arrays for client-side pickers and the
 * adapter imports this provider's validator, its zod schema and the compile
 * helpers in `core/unified/derive`. The adapter reads the very same objects, so
 * what is published and what is sent cannot drift.
 */

import { EXTRA } from "../../core/unified/derive";
import type { ModelParamTable } from "../../core/unified/vocabulary/image";
import type {
  RecraftControls,
  RecraftCreativity,
  RecraftSubstyle,
  RecraftTextLayoutElement,
  RecraftUpscaleMode,
} from "./image";
import {
  ASPECT_RATIOS,
  UNATTRIBUTED_SIZE_VALUES,
  V2_V3_SIZES,
  V4_PRO_SIZES,
  V4_STANDARD_SIZES,
} from "./constraints";
import type { RecraftModelId } from "./models";
import {
  RECRAFT_V2_STYLES,
  RECRAFT_V2_VECTOR_STYLES,
  RECRAFT_V3_STYLES,
  RECRAFT_V3_VECTOR_STYLES,
} from "./styles";

/**
 * Every model the hand catalog carries — the ref union for `recraft/…`.
 *
 * `satisfies readonly RecraftModelId[]` pins the list to `models.ts`, so a
 * typo is a compile error rather than an `unknown_model` warning that skips
 * the prompt cap and the cost estimate at the same time.
 */
export const MODELS = [
  "recraftv4_1",
  "recraftv4_1_vector",
  "recraftv4_1_pro",
  "recraftv4_1_pro_vector",
  "recraftv4_1_utility",
  "recraftv4_1_utility_vector",
  "recraftv4_1_utility_pro",
  "recraftv4_1_utility_pro_vector",
  "recraftv4",
  "recraftv4_vector",
  "recraftv4_pro",
  "recraftv4_pro_vector",
  "recraftv3",
  "recraftv3_vector",
  "recraftv2",
  "recraftv2_vector",
  "recraft20b",
] as const satisfies readonly RecraftModelId[];

/**
 * The per-model surface, and the widest table in the library — seventeen ids
 * across four size groups, two style vocabularies and one deny rule that cuts
 * across both.
 *
 * **Sizes.** The eight raster ids get the appendix's own `WxH` table, closed:
 * `checkSize` rejects a `WxH` a model's table does not list, so a template
 * tail would promise something the endpoint refuses. The vector line and
 * `recraft20b` get no `sizes` row at all — the appendix documents them with
 * aspect ratios alone — so `size` types as `never` there and an editor offers
 * the fourteen shapes, which is the whole size vocabulary those models have.
 * (`checkSize` is permissive for them at run time, having no table to check
 * against; the type is the narrower of the two on purpose.)
 *
 * **Ratios.** `ASPECT_RATIOS`, all fourteen, on every row: one field, two
 * vocabularies, and the ratio half is model-independent.
 *
 * **Styles.** `style` is denied on the whole V4/V4.1 line and typed from
 * `STYLE_NAMES_BY_MODEL`'s own lists everywhere it is allowed, so
 * `style: "Watercolor"` compiles on `recraftv3` and not on `recraftv3_vector`
 * — whose list is the vector one. `text_layout` is V3-and-`recraft20b`-only,
 * per the same family rules.
 */
export const RECRAFT_SHARED_EXTRAS = {
  // Closed, matching the wire body: `checkSpecEnums` refuses an off-list
  // substyle at error severity, and an extra wider than the wire param it
  // passes through is not assignable to the adapter's own validator signature.
  substyle: EXTRA as RecraftSubstyle | null,
  creativity: EXTRA as RecraftCreativity | null,
  upscale: EXTRA as RecraftUpscaleMode | null,
  controls: EXTRA as RecraftControls | null,
  block_nsfw: EXTRA as boolean | null,
  calculate_features: EXTRA as boolean | null,
  expire: EXTRA as boolean | null,
} as const;

export const TEXT_LAYOUT = EXTRA as RecraftTextLayoutElement[] | null;

export const STYLE_ID = EXTRA as string | null;

/** V4 / V4.1: no `style`, no `style_id`, no `text_layout`. */
export const V4_STANDARD_ROW = {
  sizes: V4_STANDARD_SIZES,
  ratios: ASPECT_RATIOS,
  tiers: ["1k"],
  extras: RECRAFT_SHARED_EXTRAS,
} as const;

export const V4_PRO_ROW = {
  sizes: V4_PRO_SIZES,
  ratios: ASPECT_RATIOS,
  tiers: ["2k"],
  extras: RECRAFT_SHARED_EXTRAS,
} as const;

export const V4_VECTOR_ROW = { ratios: ASPECT_RATIOS, tiers: [], extras: RECRAFT_SHARED_EXTRAS } as const;

export const V2_V3_RASTER_SIZES = [...V2_V3_SIZES, ...UNATTRIBUTED_SIZE_VALUES] as const;

export const RECRAFT_IMAGE_MODEL_PARAMS = {
  recraftv4_1: V4_STANDARD_ROW,
  recraftv4_1_utility: V4_STANDARD_ROW,
  recraftv4: V4_STANDARD_ROW,
  recraftv4_1_pro: V4_PRO_ROW,
  recraftv4_1_utility_pro: V4_PRO_ROW,
  recraftv4_pro: V4_PRO_ROW,
  recraftv4_1_vector: V4_VECTOR_ROW,
  recraftv4_1_pro_vector: V4_VECTOR_ROW,
  recraftv4_1_utility_vector: V4_VECTOR_ROW,
  recraftv4_1_utility_pro_vector: V4_VECTOR_ROW,
  recraftv4_vector: V4_VECTOR_ROW,
  recraftv4_pro_vector: V4_VECTOR_ROW,
  recraftv3: {
    sizes: V2_V3_RASTER_SIZES,
    ratios: ASPECT_RATIOS,
    tiers: ["1k"],
    extras: {
      style: EXTRA as (typeof RECRAFT_V3_STYLES)[number] | (string & {}) | null,
      style_id: STYLE_ID,
      text_layout: TEXT_LAYOUT,
      ...RECRAFT_SHARED_EXTRAS,
    },
  },
  recraftv3_vector: {
    ratios: ASPECT_RATIOS,
    tiers: [],
    extras: {
      style: EXTRA as (typeof RECRAFT_V3_VECTOR_STYLES)[number] | (string & {}) | null,
      style_id: STYLE_ID,
      text_layout: TEXT_LAYOUT,
      ...RECRAFT_SHARED_EXTRAS,
    },
  },
  recraftv2: {
    sizes: V2_V3_RASTER_SIZES,
    ratios: ASPECT_RATIOS,
    tiers: ["1k"],
    extras: {
      style: EXTRA as (typeof RECRAFT_V2_STYLES)[number] | (string & {}) | null,
      style_id: STYLE_ID,
      ...RECRAFT_SHARED_EXTRAS,
    },
  },
  recraftv2_vector: {
    ratios: ASPECT_RATIOS,
    tiers: [],
    extras: {
      style: EXTRA as (typeof RECRAFT_V2_VECTOR_STYLES)[number] | (string & {}) | null,
      style_id: STYLE_ID,
      ...RECRAFT_SHARED_EXTRAS,
    },
  },
  recraft20b: {
    ratios: ASPECT_RATIOS,
    tiers: [],
    extras: {
      // No curated list is published for this id, and no family rule denies
      // it — so the honest type is the open one the wire already has.
      style: EXTRA as string | null,
      style_id: STYLE_ID,
      text_layout: TEXT_LAYOUT,
      ...RECRAFT_SHARED_EXTRAS,
    },
  },
} as const satisfies ModelParamTable;
