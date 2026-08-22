/**
 * The image adapter's **data**: the model list, the per-model narrowing table,
 * and the format spec where the category has one.
 *
 * A leaf rather than a section of the adapter beside it, because
 * `unmodel/black-forest-labs/values` publishes these arrays for client-side pickers and the
 * adapter imports this provider's validator, its zod schema and the compile
 * helpers in `core/unified/derive`. The adapter reads the very same objects, so
 * what is published and what is sent cannot drift.
 */

import { EXTRA } from "../../core/unified/derive";
import type { ModelParamTable } from "../../core/unified/vocabulary/image";
import { BFL_ASPECT_RATIOS } from "./aspect";

// ---------------------------------------------------------------------------
// image — the FLUX.2 route family
// ---------------------------------------------------------------------------

/** Every FLUX.2 route in the catalog — the ref union for `black-forest-labs/…`. */
export const FLUX2_MODELS = [
  "flux-2-pro",
  "flux-2-max",
  "flux-2-pro-preview",
  "flux-2-flex",
  "flux-2-klein-9b",
  "flux-2-klein-9b-preview",
  "flux-2-klein-4b",
] as const;

// ---------------------------------------------------------------------------
// imageFlux1 — the previous-generation FLUX.1 routes
// ---------------------------------------------------------------------------

/**
 * # `imageFlux1`
 *
 * Four routes, three schemas, and one fork this adapter has to make in the
 * middle of the size decision:
 *
 * | route | schema | size |
 * |---|---|---|
 * | `flux-pro-1.1` | `FluxPro11Inputs` | `width`/`height` |
 * | `flux-dev` | `FluxDevInputs` | `width`/`height` |
 * | `flux-pro-1.1-ultra` | `FluxUltraInput` | `aspect_ratio` |
 * | `flux-pro-1.1-ultra-finetuned` | `FinetuneFluxUltraInput` | `aspect_ratio` |
 *
 * The ultra arm is a **range**, not a list. `FluxUltraInput` types
 * `aspect_ratio` as a bare string and documents the bound in prose — "Aspect
 * ratio of the image between 21:9 and 9:21" — and `checkAspectRatioRange`
 * enforces exactly that: any `W:H` whose value lies in `[9/21, 21/9]` passes,
 * including spellings BFL never enumerated. So this is {@link toRatioString}
 * (S5) with those bounds and not `toRatioEnum` (S1) with a list, and the
 * spelling that goes out is the reduced one — `"21:9"` compiles to `"7:3"`,
 * which is the same shape, inside the same bound, and the one spelling two
 * callers who meant the same thing will both send. `BflAspectRatio`'s thirteen
 * named presets are autocomplete for hand-written calls, not a closed domain.
 *
 * `-finetuned` is in `models` because it is a real route with its own catalog
 * row, but it also *requires* `finetune_id`, which has no canonical spelling
 * and never will. A unified call to it therefore fails at the provider's own
 * `checkFinetuneId` unless `providerOptions["black-forest-labs"]` supplies the
 * LoRA id — which is precisely the escape hatch's job, and precisely the error
 * message a caller needs to discover it.
 */
export const FLUX1_MODELS = [
  "flux-pro-1.1",
  "flux-dev",
  "flux-pro-1.1-ultra",
  "flux-pro-1.1-ultra-finetuned",
] as const;

// ---------------------------------------------------------------------------
// The adapter
// ---------------------------------------------------------------------------

/** Every BFL generation route, both generations, in catalog order. */
export const MODELS = [...FLUX2_MODELS, ...FLUX1_MODELS] as const;

// ---------------------------------------------------------------------------
// The per-model table
// ---------------------------------------------------------------------------

/**
 * Eleven generation routes, three sizing shapes and a `safety_tolerance` whose
 * *range* differs between the two generations — 0–5 on FLUX.2, 0–6 on FLUX.1
 * — which the endpoints' own schemas check and this table does not restate.
 *
 * **Sizes.** The FLUX.2 and FLUX.1 pixel routes take a free `width`/`height`
 * pair, so both carry `sizeFreeform` and a curated preset list: exact-ratio
 * integer pairs at ~1 MP and ~4 MP for FLUX.2 (whose only documented rule is
 * `minimum: 64`), and pairs with both sides divisible by 32 inside 256–1440
 * for FLUX.1 (whose grid and range are enforced). The ultra routes have no
 * width/height field at all — `FluxUltraInput` declares none — so they carry
 * no `sizes` and `size` types as `never` there, which is the same fact
 * `compileUltraSize` states at run time.
 *
 * **Ratios.** Only the ultra routes have a ratio field, and it is a *range*
 * rather than an enum ("between 21:9 and 9:21"), so `ratioFreeform` keeps the
 * template tail beside the thirteen presets. The pixel routes leave `ratios`
 * absent: a canonical ratio there is derived into a pair by `toPixels`.
 *
 * **Tiers.** FLUX.2 reaches 1k and 2k; FLUX.1's pixel routes cap at 1440²
 * (2.07 MP) so only 1k is reachable; the ultra routes have no size field, so
 * `tiers` is empty and `resolution` is a compile error there.
 */
export const FLUX_2_SIZES = [
  "1024x1024", "1568x672", "1440x720", "1344x756", "1248x832", "1184x888",
  "1140x912", "912x1140", "888x1184", "832x1248", "756x1344", "720x1440",
  "672x1568", "2048x2048", "3136x1344", "2896x1448", "2688x1512", "2496x1664",
  "2368x1776", "2280x1824", "1824x2280", "1776x2368", "1664x2496", "1512x2688",
  "1448x2896", "1344x3136",
] as const;

export const FLUX_1_SIZES = [
  "1024x1024", "512x512", "1440x1440", "1344x576", "1408x704", "1024x576",
  "1344x896", "960x640", "1280x960", "1024x768", "1280x1024", "1024x1280",
  "960x1280", "768x1024", "896x1344", "640x960", "576x1024", "704x1408",
  "576x1344",
] as const;

/** 0–5 on FLUX.2 and the tools routes, 0–6 on FLUX.1 — the schemas check it. */
export const SAFETY_TOLERANCE = EXTRA as number;

export const PROMPT_UPSAMPLING = EXTRA as boolean;

export const FLUX_2_BASE = { sizes: FLUX_2_SIZES, sizeFreeform: true, tiers: ["1k", "2k"] } as const;

export const FLUX_1_PIXEL_BASE = { sizes: FLUX_1_SIZES, sizeFreeform: true, tiers: ["1k"] } as const;

export const ULTRA_BASE = { ratios: BFL_ASPECT_RATIOS, ratioFreeform: true, tiers: [] } as const;

export const FLUX_2_PRO_ROW = {
  ...FLUX_2_BASE,
  extras: { disable_pup: EXTRA as boolean, safety_tolerance: SAFETY_TOLERANCE },
} as const;

export const FLUX_2_KLEIN_ROW = {
  ...FLUX_2_BASE,
  extras: { safety_tolerance: SAFETY_TOLERANCE },
} as const;

export const BFL_IMAGE_MODEL_PARAMS = {
  "flux-2-pro": FLUX_2_PRO_ROW,
  "flux-2-max": FLUX_2_PRO_ROW,
  "flux-2-pro-preview": FLUX_2_PRO_ROW,
  "flux-2-flex": {
    ...FLUX_2_BASE,
    extras: {
      prompt_upsampling: EXTRA as boolean | null,
      guidance: EXTRA as number,
      steps: EXTRA as number,
      safety_tolerance: SAFETY_TOLERANCE,
    },
  },
  "flux-2-klein-9b": FLUX_2_KLEIN_ROW,
  "flux-2-klein-9b-preview": FLUX_2_KLEIN_ROW,
  "flux-2-klein-4b": FLUX_2_KLEIN_ROW,
  "flux-pro-1.1": {
    ...FLUX_1_PIXEL_BASE,
    extras: { prompt_upsampling: PROMPT_UPSAMPLING, safety_tolerance: SAFETY_TOLERANCE },
  },
  "flux-dev": {
    ...FLUX_1_PIXEL_BASE,
    extras: {
      steps: EXTRA as number | null,
      guidance: EXTRA as number | null,
      prompt_upsampling: PROMPT_UPSAMPLING,
      safety_tolerance: SAFETY_TOLERANCE,
    },
  },
  "flux-pro-1.1-ultra": {
    ...ULTRA_BASE,
    extras: {
      raw: EXTRA as boolean,
      prompt_upsampling: PROMPT_UPSAMPLING,
      safety_tolerance: SAFETY_TOLERANCE,
    },
  },
  "flux-pro-1.1-ultra-finetuned": {
    ...ULTRA_BASE,
    extras: {
      finetune_id: EXTRA as string,
      finetune_strength: EXTRA as number,
      raw: EXTRA as boolean,
      prompt_upsampling: PROMPT_UPSAMPLING,
      safety_tolerance: SAFETY_TOLERANCE,
    },
  },
} as const satisfies ModelParamTable;
