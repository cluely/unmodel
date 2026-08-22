/**
 * The video adapter's **data**: the model list, the per-model narrowing table,
 * and the format spec where the category has one.
 *
 * A leaf rather than a section of the adapter beside it, because
 * `unmodel/minimax/values` publishes these arrays for client-side pickers and the
 * adapter imports this provider's validator, its zod schema and the compile
 * helpers in `core/unified/derive`. The adapter reads the very same objects, so
 * what is published and what is sent cannot drift.
 */

import { EXTRA } from "../../core/unified/derive";
import type { VideoModelParamTable } from "../../core/unified/vocabulary/video";

/** Every video model, both routes — the `minimax/…` ref union. */
export const MODELS = [
  "MiniMax-H3",
  "MiniMax-Hailuo-2.3",
  "MiniMax-Hailuo-2.3-Fast",
  "MiniMax-Hailuo-02",
  "T2V-01-Director",
  "T2V-01",
  "I2V-01-Director",
  "I2V-01-live",
  "I2V-01",
  "S2V-01",
] as const;

/**
 * MiniMax's per-model surface, and the clearest case in the category for what
 * an **empty** list means.
 *
 * The six 01-generation models (`T2V-01*`, `I2V-01*`, `S2V-01`) accept
 * `resolution` on the wire — but the only value their rule row allows is
 * `"720P"`, and the adapter's `V1_RESOLUTIONS` has no entry that produces it
 * (canonical `720p` maps to `"768P"`, which is 768 lines and a different
 * value). So *every* canonical tier fails on those six, and the only request
 * that works is one that omits `resolution` entirely and lets the endpoint
 * default. `resolutions: []` says exactly that: the field is not expressible
 * from this vocabulary, and the caller finds out while typing.
 *
 * `ratios: []` says the same thing about shape on all nine v1 models —
 * `/v1/video_generation` has no aspect-ratio field at all, which `compile`
 * reports as an `unsupported_param` pointing at `MiniMax-H3`. The type now says
 * it first.
 *
 * `MiniMax-H3` is the v2 route and the mirror image: `duration` and
 * `resolution` are both **required** there (they are what the generation is
 * billed by), so its lists are the full documented enums — every integer 4–15,
 * and the two tiers `768P`/`2K` answer for.
 *
 * `prompt_optimizer` is a v1 field and is on all nine v1 rows; the v2 body has
 * no such key. `fast_pretreatment` is gated to the three Hailuo models by
 * `checkScenarioInputs`.
 */
export const V1_EXTRAS = { prompt_optimizer: EXTRA as boolean } as const;

export const HAILUO_EXTRAS = {
  prompt_optimizer: EXTRA as boolean,
  fast_pretreatment: EXTRA as boolean,
} as const;

/** The 01 generation: 6 seconds, no expressible tier, no shape. */
export const V1_01_ROW = {
  durations: [6],
  resolutions: [],
  ratios: [],
  extras: V1_EXTRAS,
} as const;

export const MINIMAX_VIDEO_MODEL_PARAMS = {
  "MiniMax-H3": {
    durations: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    resolutions: ["720p", "1440p"],
    ratios: ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"],
  },
  "MiniMax-Hailuo-2.3": {
    durations: [6, 10],
    resolutions: ["720p", "1080p"],
    ratios: [],
    extras: HAILUO_EXTRAS,
  },
  "MiniMax-Hailuo-2.3-Fast": {
    durations: [6, 10],
    resolutions: ["720p", "1080p"],
    ratios: [],
    extras: HAILUO_EXTRAS,
  },
  "MiniMax-Hailuo-02": {
    durations: [6, 10],
    resolutions: ["480p", "720p", "1080p"],
    ratios: [],
    extras: HAILUO_EXTRAS,
  },
  "T2V-01-Director": V1_01_ROW,
  "T2V-01": V1_01_ROW,
  "I2V-01-Director": V1_01_ROW,
  "I2V-01-live": V1_01_ROW,
  "I2V-01": V1_01_ROW,
  "S2V-01": V1_01_ROW,
} as const satisfies VideoModelParamTable;
