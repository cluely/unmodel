/**
 * The video adapter's **data**: the model list, the per-model narrowing table,
 * and the format spec where the category has one.
 *
 * A leaf rather than a section of the adapter beside it, because
 * `unmodel/vidu/values` publishes these arrays for client-side pickers and the
 * adapter imports this provider's validator, its zod schema and the compile
 * helpers in `core/unified/derive`. The adapter reads the very same objects, so
 * what is published and what is sent cannot drift.
 */

import { EXTRA } from "../../core/unified/derive";
import type { VideoModelParamTable } from "../../core/unified/vocabulary/video";
import { VIDU_ASPECT_RATIOS, type ViduMovementAmplitude } from "./shared";

/** Every model with a video arm on any of the three routes. */
export const MODELS = [
  "viduq3-pro",
  "viduq3-pro-fast",
  "viduq3-turbo",
  "viduq3",
  "viduq3-mix",
  "viduq2",
  "viduq2-pro",
  "viduq2-pro-fast",
  "viduq2-turbo",
  "viduq1",
  "viduq1-classic",
  "vidu2.0",
] as const;

/**
 * Vidu's per-model surface.
 *
 * `durations` is present on only three rows, and the reason is the same one
 * Seedance gives: every other model's length is an inclusive *range* (1–16 on
 * q3, 1–10 on q2) enforced by `checkRouteSupport`, not an enum. `viduq1` and
 * `viduq1-classic` are exactly 5 seconds and `vidu2.0` is 4 or 8, so those
 * three narrow and the rest keep the wide `number`.
 *
 * `ratios: []` marks the five **image-only** models. `aspect_ratio` does not
 * exist on `POST /ent/v2/img2video` — the start frame sets the shape — so a
 * model whose only route is that one has no shape field to fill, and the type
 * now says so instead of the adapter saying it after the fact. The models that
 * also serve text2video or reference2video keep the five-value enum.
 *
 * `resolutions` is `720p`/`1080p` almost everywhere: `360p` and `540p` are real
 * wire values with no canonical name (they live on
 * `providerOptions.vidu.resolution`), and the q1 pair renders 1080p only.
 *
 * The three extras are the fields present on **all three** routes. `style`,
 * `audio_type`, `voice_id`, `is_rec`, `auto_subjects` and `subjects` are
 * deliberately absent: each exists on one or two of the three route bodies, and
 * a per-model row cannot say "only when you also pass an image" — declaring one
 * would put it on a body that has no such key for exactly the callers who used
 * the other route. `providerOptions.vidu` reaches all of them.
 */
export const VIDU_EXTRAS = {
  movement_amplitude: EXTRA as ViduMovementAmplitude,
  bgm: EXTRA as boolean,
  audio: EXTRA as boolean,
} as const;

export const TIERS = ["720p", "1080p"] as const;

/** A model that serves text2video or reference2video: the shape enum applies. */
export const SHAPED_ROW = {
  resolutions: TIERS,
  ratios: VIDU_ASPECT_RATIOS,
  extras: VIDU_EXTRAS,
} as const;

/** An image-only model: `img2video` has no `aspect_ratio` field at all. */
export const FRAME_ONLY_ROW = {
  resolutions: TIERS,
  ratios: [],
  extras: VIDU_EXTRAS,
} as const;

export const VIDU_VIDEO_MODEL_PARAMS = {
  "viduq3-pro": SHAPED_ROW,
  "viduq3-pro-fast": FRAME_ONLY_ROW,
  "viduq3-turbo": SHAPED_ROW,
  viduq3: SHAPED_ROW,
  "viduq3-mix": SHAPED_ROW,
  viduq2: SHAPED_ROW,
  "viduq2-pro": SHAPED_ROW,
  "viduq2-pro-fast": FRAME_ONLY_ROW,
  "viduq2-turbo": FRAME_ONLY_ROW,
  viduq1: {
    durations: [5],
    resolutions: ["1080p"],
    ratios: VIDU_ASPECT_RATIOS,
    extras: VIDU_EXTRAS,
  },
  "viduq1-classic": {
    durations: [5],
    resolutions: ["1080p"],
    ratios: [],
    extras: VIDU_EXTRAS,
  },
  "vidu2.0": {
    durations: [4, 8],
    resolutions: TIERS,
    ratios: VIDU_ASPECT_RATIOS,
    extras: VIDU_EXTRAS,
  },
} as const satisfies VideoModelParamTable;
