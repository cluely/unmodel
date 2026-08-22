/**
 * The image adapter's **data**: the model list, the per-model narrowing table,
 * and the format spec where the category has one.
 *
 * A leaf rather than a section of the adapter beside it, because
 * `unmodel/google/values` publishes these arrays for client-side pickers and the
 * adapter imports this provider's validator, its zod schema and the compile
 * helpers in `core/unified/derive`. The adapter reads the very same objects, so
 * what is published and what is sent cannot drift.
 */

import { EXTRA } from "../../core/unified/derive";
import type { ModelParamTable } from "../../core/unified/vocabulary/image";
import { IMAGEN_ASPECT_RATIOS } from "./image-constraints";
import type { GoogleImagenOutputOptions, GoogleImagenPersonGeneration } from "./image";

/** The three Imagen 4 codes the Gemini API documents — the `google/…` ref union. */
export const MODELS = [
  "imagen-4.0-generate-001",
  "imagen-4.0-ultra-generate-001",
  "imagen-4.0-fast-generate-001",
] as const;

/**
 * The three Imagen rows.
 *
 * No `sizes` anywhere — `models.{model}:predict` has no width, height or `WxH`
 * field on any route, which is the same fact `unsupported.dimensions` states
 * below — so `size` types as `never` and an editor offers the five shapes.
 *
 * The `tiers` split is the whole reason this is a per-**model** table: Standard
 * and Ultra publish `sampleImageSize: "1K" | "2K"`, and Fast has no such field
 * ("only supported for the Standard and Ultra models"). An empty `tiers` makes
 * `resolution` on Fast a compile error, which is the same answer the
 * `unsupported_param` below gives a JavaScript caller.
 *
 * The extras are Imagen's own `parameters` keys, and they land under
 * `parameters` rather than at the body root — the one adapter so far that
 * needs `applyExtras`'s `at`. `outputOptions` shares its wire object with the
 * `mimeType` compiled from `outputFormat`; `place` merges rather than
 * replaces, so setting both keeps both.
 */
export const IMAGEN_EXTRAS = {
  personGeneration: EXTRA as GoogleImagenPersonGeneration,
  safetySetting: EXTRA as string,
  includeSafetyAttributes: EXTRA as boolean,
  includeRaiReason: EXTRA as boolean,
  language: EXTRA as string,
  guidanceScale: EXTRA as number,
  outputOptions: EXTRA as Omit<GoogleImagenOutputOptions, "mimeType">,
} as const;

export const GOOGLE_IMAGE_MODEL_PARAMS = {
  "imagen-4.0-generate-001": {
    ratios: IMAGEN_ASPECT_RATIOS,
    tiers: ["1k", "2k"],
    extras: IMAGEN_EXTRAS,
  },
  "imagen-4.0-ultra-generate-001": {
    ratios: IMAGEN_ASPECT_RATIOS,
    tiers: ["1k", "2k"],
    extras: IMAGEN_EXTRAS,
  },
  "imagen-4.0-fast-generate-001": {
    ratios: IMAGEN_ASPECT_RATIOS,
    tiers: [],
    extras: IMAGEN_EXTRAS,
  },
} as const satisfies ModelParamTable;
