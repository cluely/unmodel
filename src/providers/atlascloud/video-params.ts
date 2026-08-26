/**
 * The video adapter's **data**: the model list and the per-model narrowing
 * table.
 *
 * A leaf rather than a section of the adapter beside it, because
 * `unmodel/atlascloud/values` publishes these arrays for client-side pickers
 * while the adapter imports this provider's validator, its zod schema and the
 * compile helpers in `core/unified/derive`. The adapter reads the very same
 * objects, so what is published and what is sent cannot drift.
 */

import { EXTRA } from "../../core/unified/derive";
import type { VideoModelParamTable } from "../../core/unified/vocabulary/video";
import { BITRATE_MODES, OMNI_REFERENCE_TASK_TYPES, VIDEO_OUTPUT_FORMATS } from "./constraints";

/**
 * The twenty-three curated ids — the `atlascloud/…` ref union.
 *
 * These are Atlas's OWN ids, slashes and all, so a unified ref is
 * `"atlascloud/bytedance/seedance-2.5/text-to-video"` and splits on the FIRST
 * slash (the fal / krea / openrouter precedent). The vendor prefix inside the
 * id is Atlas's, not unmodel's: `bytedance/…` here means "the Seedance weights
 * as Atlas serves them", which is a different transport from `bytedance/…` the
 * unmodel provider.
 */
export const MODELS = [
  "bytedance/seedance-2.5/text-to-video",
  "bytedance/seedance-2.5/image-to-video",
  "bytedance/seedance-2.5/reference-to-video",
  "bytedance/seedance-2.0/text-to-video",
  "bytedance/seedance-2.0/image-to-video",
  "bytedance/seedance-2.0/reference-to-video",
  "bytedance/seedance-2.0-mini/text-to-video",
  "bytedance/seedance-2.0-mini/image-to-video",
  "bytedance/seedance-2.0-mini/reference-to-video",
  "bytedance/seedance-2.0-fast/text-to-video",
  "bytedance/seedance-2.0-fast/image-to-video",
  "bytedance/seedance-2.0-fast/reference-to-video",
  "bytedance/seedance-v1.5-pro/text-to-video",
  "bytedance/seedance-v1.5-pro/image-to-video",
  "bytedance/seedance-v1.5-pro/text-to-video-fast",
  "bytedance/seedance-v1.5-pro/image-to-video-fast",
  "alibaba/wan-3.0-prime/text-to-video",
  "alibaba/wan-3.0-prime/image-to-video",
  "alibaba/wan-3.0/text-to-video",
  "alibaba/wan-3.0/image-to-video",
  "google/veo3.1/text-to-video",
  "google/veo3.1/image-to-video",
  "google/veo3.1/reference-to-video",
] as const;

/**
 * The six shapes on the Seedance 2.x models — {@link VIDEO_RATIOS} minus
 * `adaptive`, which is not a shape but the default "follow the input".
 */
export const RATIOS = ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"] as const;

/** Wan 3.0 text-to-video: the same list without `21:9`. */
export const WAN_RATIOS_SHAPES = ["16:9", "4:3", "1:1", "3:4", "9:16"] as const;

/** Veo 3.1's two shapes. */
export const VEO_RATIOS_SHAPES = ["16:9", "9:16"] as const;

/** Wan 3.0 and Seedance 2.x reach the same four canonical tiers, differently spelled. */
const NO_RATIOS = [] as const;

/**
 * The `-1` sentinel and why `durations` is absent on nineteen of these rows.
 *
 * Atlas publishes `duration` as an ENUM on every family but Seedance v1.5 pro
 * — and the enums are long: `[-1, 4…30]` on Seedance 2.5, `[-1, 2…30]` on Wan
 * 3.0. Spelling twenty-nine literals into a completion list to describe what is
 * really "any integer in a range, plus a sentinel" is the trade
 * `model-params.ts` documents against, so those rows declare no `durations`,
 * `duration` stays the wide `number`, and `checkDuration` in ./video.ts answers
 * with the model's own enum on the way out.
 *
 * Veo 3.1 is the exception worth having: a genuine three-member enum
 * (`8 | 4 | 6`, and `[8]` on the reference arm), short enough to be useful in
 * a picker and closed enough to be true.
 *
 * `duration: -1` ("let the model choose") is NOT in any list here, and cannot
 * be: the canonical `duration` is defined as "a positive number of seconds"
 * (`core/unified/derive.ts`) at every provider in the pack. It is reached
 * through `providerOptions.atlascloud.duration`, which is documented on the
 * adapter beside the reason — and `checkDuration` in ./video.ts still gates it
 * per model, so the sentinel is refused on Seedance v1.5 pro and Veo 3.1 where
 * the schema does not declare it.
 */
const SEEDANCE_2X_EXTRAS = {
  watermark: EXTRA as boolean,
  generate_audio: EXTRA as boolean,
  return_last_frame: EXTRA as boolean,
} as const;

const SEEDANCE_25_EXTRAS = {
  ...SEEDANCE_2X_EXTRAS,
  output_format: EXTRA as (typeof VIDEO_OUTPUT_FORMATS)[number],
} as const;

const SEEDANCE_25_REFERENCE_EXTRAS = {
  ...SEEDANCE_25_EXTRAS,
  omni_reference_task_type: EXTRA as (typeof OMNI_REFERENCE_TASK_TYPES)[number],
} as const;

const SEEDANCE_20_EXTRAS = {
  ...SEEDANCE_2X_EXTRAS,
  bitrate_mode: EXTRA as (typeof BITRATE_MODES)[number],
} as const;

const SEEDANCE_15_EXTRAS = {
  generate_audio: EXTRA as boolean,
  camera_fixed: EXTRA as boolean,
} as const;

/** Wan spells the audio toggle `audio`, which is why it is not `generate_audio`. */
const WAN_EXTRAS = {
  audio: EXTRA as boolean,
} as const;

const VEO_EXTRAS = {
  generate_audio: EXTRA as boolean,
} as const;

const SEEDANCE_25_TIERS = ["480p", "720p", "1080p", "1440p", "4k"] as const;
const SEEDANCE_20_TIERS = ["480p", "720p", "1080p", "1440p", "4k"] as const;
const SEEDANCE_20_SMALL_TIERS = ["480p", "720p", "1080p", "1440p"] as const;
const SEEDANCE_15_TIERS = ["480p", "720p"] as const;
const SEEDANCE_15_FAST_TIERS = ["720p"] as const;
const WAN_PRIME_TIERS = ["480p", "720p", "1080p"] as const;
const WAN_TIERS = ["480p", "720p", "1080p", "1440p", "4k"] as const;
const VEO_TIERS = ["720p", "1080p", "4k"] as const;

/** Veo 3.1's `duration` enum, in the schema's own order. */
const VEO_DURATIONS = [8, 4, 6] as const;

/**
 * Atlas's per-model surface.
 *
 * `resolutions` is where this provider is least like its neighbours: Atlas
 * spells the same tier four ways across four families (`1080p` on Seedance 2.x
 * and Wan 3.0, `1080P` on Wan 3.0-prime, and on Seedance 2.5 the tier is
 * reachable three ways — native `1080p`, upscaled `1080p-sr` and enhanced
 * `1080p-esr`, which the schema says "are different products and are priced
 * differently"). The tiers listed here are the CANONICAL ones the adapter can
 * reach, which is always the native spelling; the `-sr`/`-esr` ladder has no
 * canonical word and is reachable through `providerOptions.atlascloud`.
 *
 * `1440p` and `4k` appear on the Seedance rows only via that ladder
 * (`1440p-sr`, `4k-esr`), which is why they are listed: the adapter maps the
 * canonical tier onto the spelling the model's own enum actually has.
 */
export const ATLASCLOUD_VIDEO_MODEL_PARAMS = {
  "bytedance/seedance-2.5/text-to-video": {
    resolutions: SEEDANCE_25_TIERS,
    ratios: RATIOS,
    extras: SEEDANCE_25_EXTRAS,
  },
  "bytedance/seedance-2.5/image-to-video": {
    resolutions: SEEDANCE_25_TIERS,
    // "…accepts only 'adaptive': the output preserves the source image's
    // aspect ratio." So this route has no shape to offer at all.
    ratios: NO_RATIOS,
    extras: SEEDANCE_25_EXTRAS,
  },
  "bytedance/seedance-2.5/reference-to-video": {
    resolutions: SEEDANCE_25_TIERS,
    ratios: RATIOS,
    extras: SEEDANCE_25_REFERENCE_EXTRAS,
  },
  "bytedance/seedance-2.0/text-to-video": {
    resolutions: SEEDANCE_20_TIERS,
    ratios: RATIOS,
    extras: SEEDANCE_20_EXTRAS,
  },
  "bytedance/seedance-2.0/image-to-video": {
    resolutions: SEEDANCE_20_TIERS,
    ratios: RATIOS,
    extras: SEEDANCE_20_EXTRAS,
  },
  "bytedance/seedance-2.0/reference-to-video": {
    resolutions: SEEDANCE_20_TIERS,
    ratios: RATIOS,
    extras: SEEDANCE_20_EXTRAS,
  },
  "bytedance/seedance-2.0-mini/text-to-video": {
    resolutions: SEEDANCE_20_SMALL_TIERS,
    ratios: RATIOS,
    extras: SEEDANCE_20_EXTRAS,
  },
  "bytedance/seedance-2.0-mini/image-to-video": {
    resolutions: SEEDANCE_20_SMALL_TIERS,
    ratios: RATIOS,
    extras: SEEDANCE_20_EXTRAS,
  },
  "bytedance/seedance-2.0-mini/reference-to-video": {
    resolutions: SEEDANCE_20_SMALL_TIERS,
    ratios: RATIOS,
    extras: SEEDANCE_20_EXTRAS,
  },
  "bytedance/seedance-2.0-fast/text-to-video": {
    resolutions: SEEDANCE_20_SMALL_TIERS,
    ratios: RATIOS,
    extras: SEEDANCE_20_EXTRAS,
  },
  "bytedance/seedance-2.0-fast/image-to-video": {
    resolutions: SEEDANCE_20_SMALL_TIERS,
    ratios: RATIOS,
    extras: SEEDANCE_20_EXTRAS,
  },
  "bytedance/seedance-2.0-fast/reference-to-video": {
    resolutions: SEEDANCE_20_SMALL_TIERS,
    ratios: RATIOS,
    extras: SEEDANCE_20_EXTRAS,
  },
  "bytedance/seedance-v1.5-pro/text-to-video": {
    resolutions: SEEDANCE_15_TIERS,
    ratios: RATIOS,
    extras: SEEDANCE_15_EXTRAS,
  },
  "bytedance/seedance-v1.5-pro/image-to-video": {
    resolutions: SEEDANCE_15_TIERS,
    ratios: RATIOS,
    extras: SEEDANCE_15_EXTRAS,
  },
  "bytedance/seedance-v1.5-pro/text-to-video-fast": {
    resolutions: SEEDANCE_15_FAST_TIERS,
    ratios: RATIOS,
    extras: SEEDANCE_15_EXTRAS,
  },
  "bytedance/seedance-v1.5-pro/image-to-video-fast": {
    resolutions: SEEDANCE_15_FAST_TIERS,
    ratios: RATIOS,
    extras: SEEDANCE_15_EXTRAS,
  },
  "alibaba/wan-3.0-prime/text-to-video": {
    resolutions: WAN_PRIME_TIERS,
    ratios: WAN_RATIOS_SHAPES,
    extras: WAN_EXTRAS,
  },
  "alibaba/wan-3.0-prime/image-to-video": {
    resolutions: WAN_PRIME_TIERS,
    // Wan's image-to-video schema has no `ratio` field at all.
    ratios: NO_RATIOS,
    extras: WAN_EXTRAS,
  },
  "alibaba/wan-3.0/text-to-video": {
    resolutions: WAN_TIERS,
    ratios: WAN_RATIOS_SHAPES,
    extras: WAN_EXTRAS,
  },
  "alibaba/wan-3.0/image-to-video": {
    resolutions: WAN_TIERS,
    ratios: NO_RATIOS,
    extras: WAN_EXTRAS,
  },
  "google/veo3.1/text-to-video": {
    durations: VEO_DURATIONS,
    resolutions: VEO_TIERS,
    ratios: VEO_RATIOS_SHAPES,
    extras: VEO_EXTRAS,
  },
  "google/veo3.1/image-to-video": {
    durations: VEO_DURATIONS,
    resolutions: VEO_TIERS,
    ratios: VEO_RATIOS_SHAPES,
    extras: VEO_EXTRAS,
  },
  "google/veo3.1/reference-to-video": {
    // One member, and it is the schema's: `{"enum":[8]}`.
    durations: [8],
    resolutions: VEO_TIERS,
    // The schema declares no `aspect_ratio` property on this route.
    ratios: NO_RATIOS,
    extras: VEO_EXTRAS,
  },
} as const satisfies VideoModelParamTable;
