/**
 * The video adapter's **data**: the model list, the per-model narrowing table,
 * and the format spec where the category has one.
 *
 * A leaf rather than a section of the adapter beside it, because
 * `unmodel/bytedance/values` publishes these arrays for client-side pickers and the
 * adapter imports this provider's validator, its zod schema and the compile
 * helpers in `core/unified/derive`. The adapter reads the very same objects, so
 * what is published and what is sent cannot drift.
 */

import { EXTRA } from "../../core/unified/derive";
import type { VideoModelParamTable } from "../../core/unified/vocabulary/video";
import { OMNI_REFERENCE_TASK_TYPES } from "./constraints";

/** The seven catalogued ids on this route — the `bytedance/…` ref union. */
export const MODELS = [
  "dreamina-seedance-2-5-260628",
  "dreamina-seedance-2-0-260128",
  "dreamina-seedance-2-0-fast-260128",
  "dreamina-seedance-2-0-mini-260615",
  "seedance-1-5-pro-251215",
  "seedance-1-0-pro-250528",
  "seedance-1-0-pro-fast-251015",
] as const;

/**
 * The six shapes, which is {@link VIDEO_RATIOS} minus `adaptive` — the same
 * filter `compile` applies below, said once so the type and the run-time
 * candidate list cannot disagree.
 */
export const RATIOS = ["16:9", "4:3", "1:1", "3:4", "9:16", "21:9"] as const;

/**
 * Seedance's per-model surface.
 *
 * **No `durations` anywhere on this provider**, and that is the row shape doing
 * its job rather than an omission: `videoSchema` types `duration` as
 * `z.number().int()` and `checkDuration` enforces inclusive per-model *bounds*
 * (4–30 on 2.5, 4–15 on the 2.0 series, 4–12 on 1.5 pro, 2–12 on the 1.0 pros).
 * A range is not an enum, and spelling 27 literals to describe a `>=` would put
 * a wall of numbers in a completion list and still be wrong at the edges. So
 * `duration` stays the wide `number` here and the endpoint's own bounds answer,
 * remapped onto the canonical field. The sentinel `-1` ("the model picks the
 * length") stays legal for the same reason.
 *
 * `resolutions` is the pleasant case: ModelArk spells its tiers exactly as the
 * vocabulary does, so these lists are the wire's own enums with nothing lost.
 * `1440p` is on no Seedance model, which is why it is absent everywhere.
 *
 * The extras are the generation knobs, gated exactly as `constraints.ts` gates
 * them: `generate_audio` is denied on the 1.0 pros, `camera_fixed` on the 2.x
 * series, `frames` everywhere but the 1.0 pros, `draft` everywhere but 1.5 pro,
 * and `omni_reference_task_type` everywhere but Dreamina 2.5. Transport
 * (`callback_url`, `execution_expires_after`, `priority`, `service_tier`) and
 * `output_format` (which is the canonical `outputFormat`'s spelling on a
 * category that has no such word) stay on `providerOptions.bytedance`.
 */
export const AUDIO_2X_EXTRAS = {
  watermark: EXTRA as boolean,
  generate_audio: EXTRA as boolean,
  return_last_frame: EXTRA as boolean,
  safety_identifier: EXTRA as string,
} as const;

export const SEEDANCE_1_0_EXTRAS = {
  watermark: EXTRA as boolean,
  camera_fixed: EXTRA as boolean,
  frames: EXTRA as number,
  return_last_frame: EXTRA as boolean,
  safety_identifier: EXTRA as string,
} as const;

export const SEEDANCE_1_0_ROW = {
  resolutions: ["480p", "720p", "1080p"],
  ratios: RATIOS,
  extras: SEEDANCE_1_0_EXTRAS,
} as const;

export const SEEDANCE_2_0_SMALL_ROW = {
  resolutions: ["480p", "720p"],
  ratios: RATIOS,
  extras: AUDIO_2X_EXTRAS,
} as const;

export const BYTEDANCE_VIDEO_MODEL_PARAMS = {
  "dreamina-seedance-2-5-260628": {
    resolutions: ["480p", "720p"],
    ratios: RATIOS,
    extras: {
      ...AUDIO_2X_EXTRAS,
      omni_reference_task_type: EXTRA as (typeof OMNI_REFERENCE_TASK_TYPES)[number],
    },
  },
  "dreamina-seedance-2-0-260128": {
    resolutions: ["480p", "720p", "1080p", "4k"],
    ratios: RATIOS,
    extras: AUDIO_2X_EXTRAS,
  },
  "dreamina-seedance-2-0-fast-260128": SEEDANCE_2_0_SMALL_ROW,
  "dreamina-seedance-2-0-mini-260615": SEEDANCE_2_0_SMALL_ROW,
  "seedance-1-5-pro-251215": {
    resolutions: ["480p", "720p", "1080p"],
    ratios: RATIOS,
    extras: {
      ...AUDIO_2X_EXTRAS,
      camera_fixed: EXTRA as boolean,
      draft: EXTRA as boolean,
    },
  },
  "seedance-1-0-pro-250528": SEEDANCE_1_0_ROW,
  "seedance-1-0-pro-fast-251015": SEEDANCE_1_0_ROW,
} as const satisfies VideoModelParamTable;
