/**
 * The 3D adapter's **data**: the model list and the per-model narrowing table.
 *
 * A leaf rather than a section of the adapter beside it, because
 * `unmodel/tripo3d/values` publishes these for client-side pickers and the
 * adapter imports this provider's two validators, their zod schemas and the
 * compile helpers in `core/unified/derive`. The adapter reads the very same
 * objects, so what is published and what is sent cannot drift.
 *
 * ## Every row reads BOTH moods, and that is the shape of this provider
 *
 * At fal, `tripo3d/h3.1/text-to-3d` and `tripo3d/h3.1/image-to-3d` are two
 * endpoint ids and each row names one mood. Here they are two ROUTES on one
 * model: `model: "v3.1-20260211"` is the same string on both, and which URL the
 * request goes to follows from whether the caller wrote `prompt` or `image`. So
 * every row says `["image", "text"]` and the adapter — not the type — picks the
 * endpoint.
 *
 * That is the same model reached two ways giving two different narrowings, and
 * it is exactly the comparison `unmodel/3d` was built to make visible.
 *
 * ## The extras are where the two witnesses disagree
 *
 * `smart_low_poly`, `generate_parts`, `compress`, `export_uv`,
 * `enable_image_autofix` and `image_seed` are all on Tripo's own wire and none
 * of them survives fal's resale of the same models. `texture` and `pbr` are on
 * both — under those names — and are still extras, because agreeing with
 * yourself through a reseller is not a second witness: Hunyuan3D spells the
 * first `textured_mesh`, Hi3D `enable_texture`, Meshy `should_texture`.
 */

import { EXTRA } from "../../core/unified/derive";
import type { ThreeDModelParamTable } from "../../core/unified/vocabulary/3d";
import type {
  Tripo3dCompression,
  Tripo3dGeometryQuality,
  Tripo3dOrientation,
  Tripo3dTextureAlignment,
  Tripo3dTextureQuality,
} from "./shared";

/** Every id both generation routes accept — the `tripo3d/…` ref union. */
export const MODELS = [
  "v3.1-20260211",
  "v3.0-20250812",
  "v2.5-20250123",
  "P1-20260311",
] as const;

/** Both moods, on every model: the route follows the input, not the id. */
const INPUTS = ["image", "text"] as const;

/**
 * The extras every model takes, on whichever route.
 *
 * `texture_seed` is here rather than under the canonical `seed` because Tripo
 * publishes three seeds and only one of them pins the mesh; `model_seed` is the
 * canonical one and is written by the adapter.
 */
const COMMON_EXTRAS = {
  negative_prompt: EXTRA as string,
  texture_seed: EXTRA as number,
  face_limit: EXTRA as number,
  texture: EXTRA as boolean,
  pbr: EXTRA as boolean,
  export_uv: EXTRA as boolean,
  /** Text route only; ignored by the image route, which has no such stage. */
  image_seed: EXTRA as number,
  /** Image route only. */
  enable_image_autofix: EXTRA as boolean,
  texture_alignment: EXTRA as Tripo3dTextureAlignment,
  orientation: EXTRA as Tripo3dOrientation,
} as const;

/** The seven parameters Tripo gates on `model ≥ v3.0-20250812`. */
const ADVANCED_EXTRAS = {
  texture_quality: EXTRA as Tripo3dTextureQuality,
  geometry_quality: EXTRA as Tripo3dGeometryQuality,
  auto_size: EXTRA as boolean,
  quad: EXTRA as boolean,
  smart_low_poly: EXTRA as boolean,
  generate_parts: EXTRA as boolean,
  compress: EXTRA as Tripo3dCompression,
} as const;

/** v3.1 and v3.0: everything. */
const H_ADVANCED_ROW = {
  inputs: INPUTS,
  extras: { ...COMMON_EXTRAS, ...ADVANCED_EXTRAS },
} as const;

export const TRIPO3D_THREE_D_MODEL_PARAMS = {
  "v3.1-20260211": H_ADVANCED_ROW,
  "v3.0-20250812": H_ADVANCED_ROW,
  // The legacy generation takes NONE of the seven — `geometry_quality` in
  // particular is called out twice in Tripo's own docs as one to keep away from
  // v2.5 — so its extras stop at the common block. `style` exists on fal's
  // resale of the same model and is marked DEPRECATED there; it is absent from
  // Tripo's own v3 schema and is therefore absent here.
  "v2.5-20250123": {
    inputs: INPUTS,
    extras: COMMON_EXTRAS,
  },
  // The low-poly series. Its endpoint pages declare `texture_quality`,
  // `auto_size` and `compress` and do NOT declare the other four, so those four
  // are off the row even though the copied "model ≥ v3.0" sentence on those
  // pages would suggest otherwise. `face_limit` runs 50–20,000 here.
  "P1-20260311": {
    inputs: INPUTS,
    extras: {
      ...COMMON_EXTRAS,
      texture_quality: EXTRA as Tripo3dTextureQuality,
      auto_size: EXTRA as boolean,
      compress: EXTRA as Tripo3dCompression,
    },
  },
} as const satisfies ThreeDModelParamTable;
