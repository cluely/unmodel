/**
 * The video adapter's **data**: the model list, the per-model narrowing table,
 * and the format spec where the category has one.
 *
 * A leaf rather than a section of the adapter beside it, because
 * `unmodel/lightricks/values` publishes these arrays for client-side pickers and the
 * adapter imports this provider's validator, its zod schema and the compile
 * helpers in `core/unified/derive`. The adapter reads the very same objects, so
 * what is published and what is sent cannot drift.
 */

import { EXTRA } from "../../core/unified/derive";
import type { VideoModelParamTable } from "../../core/unified/vocabulary/video";
import type { LtxCameraMotion } from "./shared";

/** The six ids with a text-to-video and an image-to-video arm. */
export const MODELS = [
  "ltx-2-5-fast",
  "ltx-2-5-pro",
  "ltx-2-3-fast",
  "ltx-2-3-pro",
  "ltx-2-fast",
  "ltx-2-pro",
] as const;

/** The two shapes {@link SIZES} is keyed by — LTX publishes 16:9 and nothing else. */
export const RATIOS = ["16:9", "9:16"] as const;

/**
 * LTX's per-model surface, read off `SUPPORT_MATRIX` in `./shared.ts`.
 *
 * The `fast` / `pro` split is the whole table: a fast model runs 6 to 20
 * seconds in even steps and reaches every tier, a pro model runs 6, 8 or 10.
 * `ltx-2-5-pro` is the one row that is neither — 720p and 1080p only, and the
 * one model whose `fps` list drops 48.
 *
 * **These lists are a union, not a product.** `checkSupportMatrix` owns the
 * pairings that a per-field row cannot state: a fast model's 12–20 second
 * lengths are 720p/1080p at 24 or 25 fps only, and 1440p/4k cap at 10 seconds
 * whatever the frame rate. So the row says "6 through 20 are lengths this model
 * offers" — true — and the endpoint answers for the combination, remapped onto
 * `duration`. `480p` is on no LTX model, which is why no row carries it.
 *
 * `fps` is typed as the exact per-model union rather than the exported
 * `LtxFps`, which is deliberately open (`| (number & {})`) because the wire
 * field is a bare `z.number().int()`. Here the model's matrix *is* the limit,
 * so the closed union is the truer type and `48` on `ltx-2-5-pro` is a compile
 * error rather than a 400.
 */
export const FAST_FPS = [24, 25, 48, 50] as const;

export const FAST_EXTRAS = {
  fps: EXTRA as (typeof FAST_FPS)[number],
  generate_audio: EXTRA as boolean,
  camera_motion: EXTRA as LtxCameraMotion,
} as const;

export const FAST_ROW = {
  durations: [6, 8, 10, 12, 14, 16, 18, 20],
  resolutions: ["720p", "1080p", "1440p", "4k"],
  ratios: RATIOS,
  extras: FAST_EXTRAS,
} as const;

export const PRO_ROW = {
  durations: [6, 8, 10],
  resolutions: ["720p", "1080p", "1440p", "4k"],
  ratios: RATIOS,
  extras: FAST_EXTRAS,
} as const;

export const LIGHTRICKS_VIDEO_MODEL_PARAMS = {
  "ltx-2-5-fast": FAST_ROW,
  "ltx-2-5-pro": {
    durations: [6, 8, 10],
    resolutions: ["720p", "1080p"],
    ratios: RATIOS,
    extras: {
      fps: EXTRA as 24 | 25 | 50,
      generate_audio: EXTRA as boolean,
      camera_motion: EXTRA as LtxCameraMotion,
    },
  },
  "ltx-2-3-fast": FAST_ROW,
  "ltx-2-3-pro": PRO_ROW,
  "ltx-2-fast": FAST_ROW,
  "ltx-2-pro": PRO_ROW,
} as const satisfies VideoModelParamTable;
