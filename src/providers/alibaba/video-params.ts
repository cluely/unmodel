/**
 * The video adapter's **data**: the model list and the per-model narrowing
 * table.
 *
 * A leaf rather than a section of the adapter beside it, because
 * `unmodel/alibaba/values` publishes these arrays for client-side pickers and
 * the adapter imports this provider's validator, its zod schema and the
 * compile helpers in `core/unified/derive`. The adapter reads the very same
 * objects, so what is published and what is sent cannot drift.
 */

import { EXTRA } from "../../core/unified/derive";
import type { VideoModelParamTable } from "../../core/unified/vocabulary/video";

/** Every video-synthesis model — the `alibaba/…` ref union. */
export const MODELS = [
  "wan3.0-video",
  "wan2.7-t2v",
  "wan2.7-t2v-2026-06-12",
  "wan2.7-t2v-2026-04-25",
  "wan2.7-i2v-2026-04-25",
  "wan2.7-i2v",
  "wan2.6-t2v",
  "wan2.6-t2v-us",
  "wan2.5-t2v-preview",
  "wan2.2-t2v-plus",
  "wan2.1-t2v-turbo",
  "wan2.1-t2v-plus",
  "happyhorse-1.1-t2v",
  "happyhorse-1.0-t2v",
  "happyhorse-1.1-i2v",
  "happyhorse-1.0-i2v",
  "happyhorse-1.1-r2v",
  "happyhorse-1.0-r2v",
  "happyhorse-1.0-video-edit",
] as const;

const seconds = (from: number, to: number): readonly number[] =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i);

/**
 * Ratio vocabularies. wan3's wire also takes `"adaptive"` (its default) —
 * excluded here for MiniMax's reason: "adaptive" is not a shape, so it is not
 * a candidate for a caller who named one; it is what an image-driven request
 * gets by omitting `aspectRatio`.
 *
 * The legacy (`size`-string) models express a ratio by *which size* is sent:
 * "1280*720" is 16:9, "960*960" is 1:1, and the docs' 4:3 / 3:4 entries are
 * actually 1088×832-shaped (≈17:13) — the adapter warns `approximated_param`
 * when it picks one of those.
 */
export const WAN_RATIOS = ["16:9", "9:16", "1:1", "4:3", "3:4"] as const;
export const HAPPYHORSE_RATIOS = [
  "16:9",
  "9:16",
  "1:1",
  "4:3",
  "3:4",
  "4:5",
  "5:4",
  "9:21",
  "21:9",
] as const;

const WAN3_EXTRAS = {
  watermark: EXTRA as boolean,
  audio: EXTRA as boolean,
} as const;

const WAN27_T2V_EXTRAS = {
  prompt_extend: EXTRA as boolean,
  watermark: EXTRA as boolean,
  audio_url: EXTRA as string,
} as const;

const WAN27_I2V_EXTRAS = {
  prompt_extend: EXTRA as boolean,
  watermark: EXTRA as boolean,
} as const;

const WAN26_EXTRAS = {
  prompt_extend: EXTRA as boolean,
  watermark: EXTRA as boolean,
  audio_url: EXTRA as string,
  shot_type: EXTRA as "single" | "multi",
} as const;

const WAN25_EXTRAS = {
  prompt_extend: EXTRA as boolean,
  watermark: EXTRA as boolean,
  audio_url: EXTRA as string,
} as const;

const WAN_OLD_EXTRAS = {
  prompt_extend: EXTRA as boolean,
  watermark: EXTRA as boolean,
} as const;

/** HappyHorse documents no prompt_extend; watermark defaults to TRUE there. */
const HAPPYHORSE_EXTRAS = { watermark: EXTRA as boolean } as const;

const HAPPYHORSE_EDIT_EXTRAS = {
  watermark: EXTRA as boolean,
  audio_setting: EXTRA as "auto" | "origin",
} as const;

const WAN27_T2V_ROW = {
  durations: seconds(2, 15),
  resolutions: ["720p", "1080p"],
  ratios: WAN_RATIOS,
  extras: WAN27_T2V_EXTRAS,
} as const;

/** No ratio field: the output frame follows the input media. */
const WAN27_I2V_ROW = {
  durations: seconds(2, 15),
  resolutions: ["720p", "1080p"],
  ratios: [],
  extras: WAN27_I2V_EXTRAS,
} as const;

const HH_T2V_ROW = {
  durations: seconds(3, 15),
  resolutions: ["720p", "1080p"],
  ratios: HAPPYHORSE_RATIOS,
  extras: HAPPYHORSE_EXTRAS,
} as const;

const HH_I2V_ROW = {
  durations: seconds(3, 15),
  resolutions: ["720p", "1080p"],
  ratios: [],
  extras: HAPPYHORSE_EXTRAS,
} as const;

export const ALIBABA_VIDEO_MODEL_PARAMS = {
  "wan3.0-video": {
    durations: seconds(2, 30),
    resolutions: ["480p", "720p", "1080p"],
    ratios: WAN_RATIOS,
    extras: WAN3_EXTRAS,
  },
  "wan2.7-t2v": WAN27_T2V_ROW,
  "wan2.7-t2v-2026-06-12": WAN27_T2V_ROW,
  "wan2.7-t2v-2026-04-25": WAN27_T2V_ROW,
  "wan2.7-i2v-2026-04-25": WAN27_I2V_ROW,
  "wan2.7-i2v": WAN27_I2V_ROW,
  "wan2.6-t2v": {
    durations: seconds(2, 15),
    resolutions: ["720p", "1080p"],
    ratios: WAN_RATIOS,
    extras: WAN26_EXTRAS,
  },
  "wan2.6-t2v-us": {
    durations: [5, 10],
    resolutions: ["720p", "1080p"],
    ratios: WAN_RATIOS,
    extras: WAN26_EXTRAS,
  },
  // 480p exists on this model but only in 16:9 / 9:16 / 1:1 sizes; the
  // adapter refuses 480p + 4:3 / 3:4 with the sizes the tier does offer.
  "wan2.5-t2v-preview": {
    durations: [5, 10],
    resolutions: ["480p", "720p", "1080p"],
    ratios: WAN_RATIOS,
    extras: WAN25_EXTRAS,
  },
  "wan2.2-t2v-plus": {
    durations: [5],
    resolutions: ["480p", "1080p"],
    ratios: WAN_RATIOS,
    extras: WAN_OLD_EXTRAS,
  },
  "wan2.1-t2v-turbo": {
    durations: [5],
    resolutions: ["480p", "720p"],
    ratios: WAN_RATIOS,
    extras: WAN_OLD_EXTRAS,
  },
  "wan2.1-t2v-plus": {
    durations: [5],
    resolutions: ["720p"],
    ratios: WAN_RATIOS,
    extras: WAN_OLD_EXTRAS,
  },
  "happyhorse-1.1-t2v": HH_T2V_ROW,
  "happyhorse-1.0-t2v": HH_T2V_ROW,
  "happyhorse-1.1-i2v": HH_I2V_ROW,
  "happyhorse-1.0-i2v": HH_I2V_ROW,
  "happyhorse-1.1-r2v": HH_T2V_ROW,
  "happyhorse-1.0-r2v": HH_T2V_ROW,
  // No duration param (output follows the input clip) and no ratio field.
  "happyhorse-1.0-video-edit": {
    durations: [],
    resolutions: ["720p", "1080p"],
    ratios: [],
    extras: HAPPYHORSE_EDIT_EXTRAS,
  },
} as const satisfies VideoModelParamTable;
