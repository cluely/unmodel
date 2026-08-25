/**
 * The image adapter's **data**: the model list and the per-model narrowing
 * table.
 *
 * A leaf rather than a section of the adapter beside it, because
 * `unmodel/xai/values` publishes these arrays for client-side pickers and the
 * adapter imports this provider's validator, its zod schema and the compile
 * helpers in `core/unified/derive`. The adapter reads the very same objects, so
 * what is published and what is sent cannot drift.
 */

import { EXTRA } from "../../core/unified/derive";
import type { ModelParamTable } from "../../core/unified/vocabulary/image";
import type { XaiStorageOptions } from "./image";

/** The three image ids on POST /v1/images/generations — the `xai/…` ref union. */
export const MODELS = [
  "grok-imagine-image",
  "grok-imagine-image-2.0",
  "grok-imagine-image-quality",
] as const;

/**
 * The 15 numeric `aspect_ratio` values (the wire enum minus `"auto"`, which is
 * not a shape a caller can *name* — it is what an omitted ratio means, and it
 * stays reachable through `providerOptions.xai`).
 */
export const XAI_IMAGE_RATIOS = [
  "1:1",
  "3:4",
  "4:3",
  "9:16",
  "16:9",
  "2:3",
  "3:2",
  "9:19.5",
  "19.5:9",
  "9:20",
  "20:9",
  "1:2",
  "2:1",
  "21:9",
  "5:2",
] as const;

/**
 * One row for all three ids: xAI documents a single request surface for the
 * endpoint, and the ids differ only in output quality and price.
 *
 * No `sizes`: the wire has no `WxH` field of any kind — shape is
 * `aspect_ratio` and size is the two-tier `resolution` — so `size` types as
 * `never` and an editor steers callers to `aspectRatio` + `resolution`.
 */
export const XAI_IMAGE_ROW = {
  ratios: XAI_IMAGE_RATIOS,
  tiers: ["1k", "2k"],
  extras: {
    user: EXTRA as string,
    storage_options: EXTRA as XaiStorageOptions,
  },
} as const;

export const XAI_IMAGE_MODEL_PARAMS = {
  "grok-imagine-image": XAI_IMAGE_ROW,
  "grok-imagine-image-2.0": XAI_IMAGE_ROW,
  "grok-imagine-image-quality": XAI_IMAGE_ROW,
} as const satisfies ModelParamTable;
