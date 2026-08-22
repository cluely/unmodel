/**
 * The video adapter's **data**: the model list, the per-model narrowing table,
 * and the format spec where the category has one.
 *
 * A leaf rather than a section of the adapter beside it, because
 * `unmodel/openai/values` publishes these arrays for client-side pickers and the
 * adapter imports this provider's validator, its zod schema and the compile
 * helpers in `core/unified/derive`. The adapter reads the very same objects, so
 * what is published and what is sent cannot drift.
 */

import type { VideoModelParamTable } from "../../core/unified/vocabulary/video";

/** The five ids POST /v1/videos documents — the `openai/…` ref union. */
export const MODELS = [
  "sora-2",
  "sora-2-pro",
  "sora-2-2025-10-06",
  "sora-2-2025-12-08",
  "sora-2-pro-2025-10-06",
] as const;

/**
 * `seconds`, from the video-generation guide — the create reference's enum
 * lags it by two values, and `videoConstraints` (which re-checks this on the
 * way out) carries the same five.
 */
export const SORA_SECONDS = [4, 8, 12, 16, 20] as const;

/** The two shapes both size tables are keyed by. */
export const SORA_RATIOS = ["16:9", "9:16"] as const;

/**
 * Sora's per-model surface — the shortest table in this category, because the
 * whole body is four fields and none of them is a param the vocabulary has no
 * word for.
 *
 * The two rows differ in exactly one entry, which is the difference the
 * documentation leads with: "Use `sora-2-pro` for higher-resolution exports".
 * The dated snapshots repeat their base model's row rather than aliasing it,
 * because a snapshot is a frozen model and the day one of them diverges the
 * table should say so in one place.
 *
 * No `extras`: `input_reference.file_id` is the only unclaimed field on the
 * body and it is the *other* spelling of the canonical `image` — the endpoint
 * requires exactly one of the two — so it stays on `providerOptions.openai`.
 */
export const SORA_BASE_ROW = {
  durations: SORA_SECONDS,
  resolutions: ["720p"],
  ratios: SORA_RATIOS,
} as const;

export const SORA_PRO_ROW = {
  durations: SORA_SECONDS,
  resolutions: ["720p", "1080p"],
  ratios: SORA_RATIOS,
} as const;

export const OPENAI_VIDEO_MODEL_PARAMS = {
  "sora-2": SORA_BASE_ROW,
  "sora-2-2025-10-06": SORA_BASE_ROW,
  "sora-2-2025-12-08": SORA_BASE_ROW,
  "sora-2-pro": SORA_PRO_ROW,
  "sora-2-pro-2025-10-06": SORA_PRO_ROW,
} as const satisfies VideoModelParamTable;
