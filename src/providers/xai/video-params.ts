/**
 * The video adapter's **data**: the model list and the per-model narrowing
 * table.
 *
 * A leaf rather than a section of the adapter beside it, because
 * `unmodel/xai/values` publishes these arrays for client-side pickers and the
 * adapter imports this provider's validator, its zod schema and the compile
 * helpers in `core/unified/derive`. The adapter reads the very same objects, so
 * what is published and what is sent cannot drift.
 */

import { EXTRA } from "../../core/unified/derive";
import type { VideoModelParamTable } from "../../core/unified/vocabulary/video";
import type { XaiReferenceAudio, XaiVideoOutput } from "./video";
import type { XaiStorageOptions } from "./image";

/** The two video ids on POST /v1/videos/generations — the `xai/…` ref union. */
export const MODELS = ["grok-imagine-video", "grok-imagine-video-1.5"] as const;

/**
 * One row for both ids: xAI documents a single request surface for the route
 * (the capability page's examples use grok-imagine-video-1.5; the models page
 * prices both), and nothing in the docs narrows a field per model.
 *
 * `durations` is absent on purpose: the documented lengths are a *range*
 * (every integer from 1 to 15), which cannot be a list, so `duration` keeps
 * the wide `number` and the validator's range check answers at run time.
 *
 * The three resolutions and seven ratios are the wire enums verbatim — xAI
 * spells both exactly the way the canonical vocabulary does, so every value
 * here is also the value that goes on the wire.
 */
export const XAI_VIDEO_ROW = {
  resolutions: ["480p", "720p", "1080p"],
  ratios: ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"],
  extras: {
    reference_audios: EXTRA as XaiReferenceAudio[],
    output: EXTRA as XaiVideoOutput,
    storage_options: EXTRA as XaiStorageOptions,
    user: EXTRA as string,
  },
} as const;

export const XAI_VIDEO_MODEL_PARAMS = {
  "grok-imagine-video": XAI_VIDEO_ROW,
  "grok-imagine-video-1.5": XAI_VIDEO_ROW,
} as const satisfies VideoModelParamTable;
