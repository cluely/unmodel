/**
 * The video adapter's **data**: the model list, the per-model narrowing table,
 * and the format spec where the category has one.
 *
 * A leaf rather than a section of the adapter beside it, because
 * `unmodel/pixverse/values` publishes these arrays for client-side pickers and the
 * adapter imports this provider's validator, its zod schema and the compile
 * helpers in `core/unified/derive`. The adapter reads the very same objects, so
 * what is published and what is sent cannot drift.
 */

import { EXTRA } from "../../core/unified/derive";
import type { VideoModelParamTable } from "../../core/unified/vocabulary/video";
import { LEGACY_ASPECT_RATIOS, WIDE_ASPECT_RATIOS, type PixverseMotionMode } from "./shared";

/** Every id the generation routes accept — the `pixverse/…` ref union. */
export const MODELS = ["c1", "v6", "v5.6", "v5.5", "v5", "v4.5", "v4", "v3.5"] as const;

/**
 * PixVerse's per-model surface.
 *
 * Three groups, and the boundary between them is the audio story: the modern
 * models (v5.5 upward) generate sound from a switch, the legacy ones (v5 and
 * below) take a sound-effect prompt and a lip-sync TTS block, and nothing takes
 * both. `checkModelGatedFields` is where those lists live and this table is
 * keyed off the same three: `AUDIO_SWITCH_MODELS`, `MULTI_CLIP_MODELS` and
 * `LEGACY_AUDIO_MODELS`.
 *
 * `motion_mode`, `camera_movement` and `template_id` are ungated — every model
 * takes them — so they are on every row.
 *
 * `durations` is a closed enum on six of the eight and a *range* on `v6` and
 * `c1` (every integer from 1 to 15), so those two carry no `durations` and
 * `duration` stays `number` there. `quality` is `360p`/`540p`/`720p`/`1080p` on
 * every model, of which two have canonical names — hence the identical
 * `resolutions` on all eight, and `providerOptions.pixverse.quality` for the
 * other two. Note the adapter *fills* `quality: "540p"` when the caller names
 * no tier: that default is a value this row cannot name, which is exactly why
 * filling it warns.
 */
export const COMMON_EXTRAS = {
  motion_mode: EXTRA as PixverseMotionMode,
  camera_movement: EXTRA as string,
  template_id: EXTRA as number,
} as const;

export const LEGACY_AUDIO_EXTRAS = {
  ...COMMON_EXTRAS,
  sound_effect_switch: EXTRA as boolean,
  sound_effect_content: EXTRA as string,
  lip_sync_tts_switch: EXTRA as boolean,
  lip_sync_tts_content: EXTRA as string,
  lip_sync_tts_speaker_id: EXTRA as string,
} as const;

export const TIERS = ["720p", "1080p"] as const;

export const LEGACY_ROW = {
  durations: [5, 8],
  resolutions: TIERS,
  ratios: LEGACY_ASPECT_RATIOS,
  extras: LEGACY_AUDIO_EXTRAS,
} as const;

export const WIDE_ROW = {
  resolutions: TIERS,
  ratios: WIDE_ASPECT_RATIOS,
  extras: {
    ...COMMON_EXTRAS,
    generate_audio_switch: EXTRA as boolean,
  },
} as const;

export const PIXVERSE_VIDEO_MODEL_PARAMS = {
  c1: WIDE_ROW,
  v6: {
    resolutions: TIERS,
    ratios: WIDE_ASPECT_RATIOS,
    extras: {
      ...COMMON_EXTRAS,
      generate_audio_switch: EXTRA as boolean,
      generate_multi_clip_switch: EXTRA as boolean,
    },
  },
  "v5.6": {
    durations: [5, 8, 10],
    resolutions: TIERS,
    ratios: LEGACY_ASPECT_RATIOS,
    extras: { ...COMMON_EXTRAS, generate_audio_switch: EXTRA as boolean },
  },
  "v5.5": {
    durations: [5, 8, 10],
    resolutions: TIERS,
    ratios: LEGACY_ASPECT_RATIOS,
    extras: {
      ...COMMON_EXTRAS,
      generate_audio_switch: EXTRA as boolean,
      generate_multi_clip_switch: EXTRA as boolean,
    },
  },
  v5: LEGACY_ROW,
  "v4.5": LEGACY_ROW,
  v4: LEGACY_ROW,
  "v3.5": LEGACY_ROW,
} as const satisfies VideoModelParamTable;
