/**
 * The image adapter's **data**: the model list, the per-model narrowing table,
 * and the format spec where the category has one.
 *
 * A leaf rather than a section of the adapter beside it, because
 * `unmodel/kling/values` publishes these arrays for client-side pickers and the
 * adapter imports this provider's validator, its zod schema and the compile
 * helpers in `core/unified/derive`. The adapter reads the very same objects, so
 * what is published and what is sent cannot drift.
 */

import { EXTRA } from "../../core/unified/derive";
import type { ModelParamTable } from "../../core/unified/vocabulary/image";
import {
  KLING_IMAGE_ASPECT_RATIOS,
  KLING_IMAGE_REFERENCES,
  KLING_IMAGE_RESOLUTIONS,
} from "./shared";
import { OMNI_IMAGE_RESOLUTIONS, OMNI_RESULT_TYPES, OMNI_SERIES_AMOUNTS } from "./shared";
import type { KlingWatermarkInfo } from "./shared";

/**
 * Both image catalogs, concatenated: `imageModels` first, then
 * `omniImageModels`. One `as const` array, because it is one ref union and one
 * runtime allow-list — {@link OMNI_MODELS} is what splits it again inside
 * `compile`.
 */
export const MODELS = [
  "kling-v3",
  "kling-v2-1",
  "kling-v2-new",
  "kling-v2",
  "kling-v1-5",
  "kling-v1",
  "kling-image-o1",
  "kling-v3-omni",
] as const;

/**
 * The two routes' per-model surfaces.
 *
 * No `sizes` on either — neither `POST /v1/images/generations` nor
 * `/v1/images/omni-image` has a pixel field, so `size` types as `never` and
 * shape and tier are the two independent enums below.
 *
 * `ratios` is each route's own list **minus `"auto"`**, which the Omni route
 * accepts and which is not a shape: it means "read it off the reference
 * images". `providerOptions.kling` still reaches it, spelled the way Kling
 * spells it. `tiers` is already canonical on this API — Kling's `resolution`
 * enum is literally `"1k" | "2k"` / `"1k" | "2k" | "4k"`.
 *
 * The extras split cleanly by route: the reference-and-fidelity controls
 * belong to `/generations`, `result_type` / `series_amount` to Omni, and
 * `element_list` / `watermark_info` to both.
 */
export const KLING_SHARED_EXTRAS = {
  element_list: EXTRA as Array<{ element_id: string | number }>,
  watermark_info: EXTRA as KlingWatermarkInfo,
} as const;

export const KLING_GENERATIONS_ROW = {
  ratios: KLING_IMAGE_ASPECT_RATIOS,
  tiers: KLING_IMAGE_RESOLUTIONS,
  extras: {
    image_reference: EXTRA as (typeof KLING_IMAGE_REFERENCES)[number],
    image_fidelity: EXTRA as number,
    human_fidelity: EXTRA as number,
    ...KLING_SHARED_EXTRAS,
  },
} as const;

export const KLING_OMNI_ROW = {
  ratios: KLING_IMAGE_ASPECT_RATIOS,
  tiers: OMNI_IMAGE_RESOLUTIONS,
  extras: {
    result_type: EXTRA as (typeof OMNI_RESULT_TYPES)[number],
    // The wire accepts `string | number`; `checkSeriesAmount` stringifies and
    // then enforces this closed set, so the closed set is what to offer.
    series_amount: EXTRA as (typeof OMNI_SERIES_AMOUNTS)[number],
    ...KLING_SHARED_EXTRAS,
  },
} as const;

export const KLING_IMAGE_MODEL_PARAMS = {
  "kling-v3": KLING_GENERATIONS_ROW,
  "kling-v2-1": KLING_GENERATIONS_ROW,
  "kling-v2-new": KLING_GENERATIONS_ROW,
  "kling-v2": KLING_GENERATIONS_ROW,
  "kling-v1-5": KLING_GENERATIONS_ROW,
  "kling-v1": KLING_GENERATIONS_ROW,
  "kling-image-o1": KLING_OMNI_ROW,
  "kling-v3-omni": KLING_OMNI_ROW,
} as const satisfies ModelParamTable;
