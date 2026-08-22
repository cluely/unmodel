/**
 * The image adapter's **data**: the model list, the per-model narrowing table,
 * and the format spec where the category has one.
 *
 * A leaf rather than a section of the adapter beside it, because
 * `unmodel/stability/values` publishes these arrays for client-side pickers and the
 * adapter imports this provider's validator, its zod schema and the compile
 * helpers in `core/unified/derive`. The adapter reads the very same objects, so
 * what is published and what is sent cannot drift.
 */

import { EXTRA } from "../../core/unified/derive";
import type { ModelParamTable } from "../../core/unified/vocabulary/image";
import type { StabilityStylePreset } from "./image";
import { STABILITY_ASPECT_RATIOS } from "./constraints";

/**
 * Every generate model in the hand catalog — the ref union for `stability/…`.
 *
 * The two `stable-image-*` entries are route handles; the seven others are
 * literal `model` values of the sd3 route, deprecated ids included (Stability
 * re-routes `sd3-large` & co. to their sd3.5 equivalents server-side "at the
 * same price", so they still work and still belong here).
 */
export const MODELS = [
  "stable-image-ultra",
  "stable-image-core",
  "sd3.5-large",
  "sd3.5-large-turbo",
  "sd3.5-medium",
  "sd3.5-flash",
  "sd3-large",
  "sd3-large-turbo",
  "sd3-medium",
] as const;

// ---------------------------------------------------------------------------
// The per-model table
// ---------------------------------------------------------------------------

/**
 * No `sizes` row anywhere: none of the three generate routes has a pixel or a
 * `WxH` field at all, so `size` types as `never` here and an editor offers
 * `aspectRatio` — which is the only thing this API can be told about shape.
 * A `size` still *runs*: it lands in the same `pixelsToRatio` the `dimensions`
 * arm uses, with the warning that conversion always carries.
 *
 * `tiers` is `["1k"]` on every row because every route's output is fixed —
 * ultra and sd3 return 1 MP, core 1.5 — and `checkResolution` above is what
 * turns 2k/4k into an error rather than a silent downgrade.
 */
export const STABILITY_TIERS = ["1k"] as const;

/** `style_preset` is the one extra all three routes share. */
export const STYLE_PRESET = EXTRA as StabilityStylePreset;

export const GENERATE_EXTRAS = { style_preset: STYLE_PRESET } as const;

/**
 * The sd3 route alone publishes `cfg_scale` and `mode`. `mode:
 * "image-to-image"` needs an `image` part this category has no word for, so it
 * is a value the endpoint's own schema will reject here — which is the right
 * division of labour: the table says the *param* exists, and `sd3Validator`
 * says which of its values this request can carry.
 */
export const SD3_EXTRAS = {
  style_preset: STYLE_PRESET,
  cfg_scale: EXTRA as number,
  mode: EXTRA as "text-to-image" | "image-to-image",
} as const;

export const RATIO_ONLY = { ratios: STABILITY_ASPECT_RATIOS, tiers: STABILITY_TIERS } as const;

export const STABILITY_IMAGE_MODEL_PARAMS = {
  "stable-image-ultra": { ...RATIO_ONLY, extras: GENERATE_EXTRAS },
  "stable-image-core": { ...RATIO_ONLY, extras: GENERATE_EXTRAS },
  "sd3.5-large": { ...RATIO_ONLY, extras: SD3_EXTRAS },
  "sd3.5-large-turbo": { ...RATIO_ONLY, extras: SD3_EXTRAS },
  "sd3.5-medium": { ...RATIO_ONLY, extras: SD3_EXTRAS },
  "sd3.5-flash": { ...RATIO_ONLY, extras: SD3_EXTRAS },
  "sd3-large": { ...RATIO_ONLY, extras: SD3_EXTRAS },
  "sd3-large-turbo": { ...RATIO_ONLY, extras: SD3_EXTRAS },
  "sd3-medium": { ...RATIO_ONLY, extras: SD3_EXTRAS },
} as const satisfies ModelParamTable;
