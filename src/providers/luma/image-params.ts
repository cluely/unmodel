/**
 * The image adapter's **data**: the model list, the per-model narrowing table,
 * and the format spec where the category has one.
 *
 * A leaf rather than a section of the adapter beside it, because
 * `unmodel/luma/values` publishes these arrays for client-side pickers and the
 * adapter imports this provider's validator, its zod schema and the compile
 * helpers in `core/unified/derive`. The adapter reads the very same objects, so
 * what is published and what is sent cannot drift.
 */

import { EXTRA } from "../../core/unified/derive";
import type { ModelParamTable } from "../../core/unified/vocabulary/image";
import type { LumaCharacterRef, LumaImageRef } from "./image";
import { LUMA_ASPECT_RATIOS } from "./shared";

/** The two Photon rows in the route-scoped catalog — the ref union for `luma/…`. */
export const MODELS = ["photon-1", "photon-flash-1"] as const;

/**
 * Photon's per-model surface, which is the same row twice: the two ids share
 * `ImageGenerationsParams` byte for byte and differ only in price.
 *
 * No `sizes`, because `POST /generations/image` has no pixel field of any kind
 * — so `size` types as `never` and an editor offers the seven shapes instead.
 * `tiers` is empty for the same reason `resolution` is a declared gap below:
 * there is no size field to carry a tier, and saying so in the type means the
 * mistake is caught before the request is built.
 *
 * The three extras are Photon's reference inputs. They are typed from
 * `./image.ts`'s own interfaces rather than restated, so the shape an editor
 * offers and the shape `imageGenerations` checks are one declaration.
 */
export const LUMA_ROW = {
  ratios: LUMA_ASPECT_RATIOS,
  tiers: [],
  extras: {
    style_ref: EXTRA as LumaImageRef[],
    character_ref: EXTRA as LumaCharacterRef,
    modify_image_ref: EXTRA as LumaImageRef,
  },
} as const;

export const LUMA_IMAGE_MODEL_PARAMS = {
  "photon-1": LUMA_ROW,
  "photon-flash-1": LUMA_ROW,
} as const satisfies ModelParamTable;

/**
 * Canonical encoding → Luma's `format`.
 *
 * `jpeg` → `"jpg"` is a spelling difference and not a loss: it is the same
 * codec, so it is a rename in the same sense `input` ← `text` is one, and it
 * does not warn. `webp` has no entry — Luma documents exactly two values — and
 * lands in the `invalid_enum_value` branch below.
 */
export const FORMAT: Readonly<Record<string, "jpg" | "png">> = { png: "png", jpeg: "jpg" };
