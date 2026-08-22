/**
 * The video adapter's **data**: the model list, the per-model narrowing table,
 * and the format spec where the category has one.
 *
 * A leaf rather than a section of the adapter beside it, because
 * `unmodel/luma/values` publishes these arrays for client-side pickers and the
 * adapter imports this provider's validator, its zod schema and the compile
 * helpers in `core/unified/derive`. The adapter reads the very same objects, so
 * what is published and what is sent cannot drift.
 */

import { EXTRA } from "../../core/unified/derive";
import type { VideoModelParamTable } from "../../core/unified/vocabulary/video";
import { LUMA_ASPECT_RATIOS } from "./shared";
import type { LumaConcept } from "./video";

/** The two Ray ids this route serves — the `luma/…` ref union. */
export const MODELS = ["ray-2", "ray-flash-2"] as const;

/** "Duration can be 5s or 9s" — the two documented values, as seconds. */
export const DURATIONS = [5, 9] as const;

/**
 * Ray's per-model surface — one row, used twice.
 *
 * `ray-2` and `ray-flash-2` share `GenerationsParams` byte for byte and differ
 * only in price, and there is no per-model table anywhere in this provider (the
 * two checks `luma.video` runs are model-independent), so a second row would be
 * a second thing to keep in step with nothing.
 *
 * `durations` is the tightest enum in the category and the reason `duration` is
 * a closed list rather than a range here: `7` is a compile error naming 5 and 9
 * rather than a 9-second clip at nearly twice the price.
 *
 * The two extras are Ray's own generation controls, typed from `./video.ts`'s
 * `LumaConcept` rather than restated. `keyframes` is deliberately absent — it
 * is the *other* spelling of the canonical `image`, and the adapter writes it —
 * and `callback_url` is transport.
 */
export const LUMA_ROW = {
  durations: DURATIONS,
  resolutions: ["720p", "1080p", "4k"],
  ratios: LUMA_ASPECT_RATIOS,
  extras: {
    loop: EXTRA as boolean,
    concepts: EXTRA as LumaConcept[],
  },
} as const;

export const LUMA_VIDEO_MODEL_PARAMS = {
  "ray-2": LUMA_ROW,
  "ray-flash-2": LUMA_ROW,
} as const satisfies VideoModelParamTable;
