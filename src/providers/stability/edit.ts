/**
 * Stability AI v2beta Stable Image EDIT routes —
 * POST https://api.stability.ai/v2beta/stable-image/edit/{route}
 * (erase, inpaint, outpaint, search-and-replace, search-and-recolor,
 * remove-background).
 *
 * Wire notes (transcribed from the machine-readable v2beta spec at
 * https://api.stability.ai/v2alpha/openapi — the spec the rendered reference
 * SPA loads — on 2026-08-13):
 * - MULTIPART form endpoints, exactly like the generate routes: the validated
 *   output's enumerable props are the form fields (including the `image` /
 *   `mask` Blobs) — do NOT `JSON.stringify` them. Send `.request.url` +
 *   `toFormData(validated)`; `.request.headers` is deliberately empty so
 *   fetch derives the multipart boundary from the FormData.
 * - Accept header: raw image bytes by default (`image/*`), or
 *   `accept: "application/json"` for base64 JSON. Auth is
 *   `authorization: Bearer <key>` — unmodel never touches keys.
 * - One endpoint fn per route (mirroring Stability's own resources): the six
 *   routes take genuinely different field surfaces, and none of them has a
 *   `model` wire field — the route IS the model.
 * - `grow_mask` bounds are NOT uniform: 0–20 on erase / search-and-replace /
 *   search-and-recolor, but 0–100 on inpaint. Copying one bound across the
 *   family would reject valid inpaint requests.
 * - `output_format` is NOT uniform either: remove-background accepts only
 *   png/webp (no jpeg — the route's whole point is an alpha channel).
 * - `prompt` is required on inpaint / search-and-replace / search-and-recolor
 *   and absent from erase / remove-background. The spec's `required` list for
 *   erase names "prompt" even though the route declares no such property —
 *   a spec bug; unmodel follows the property list (image only) so valid
 *   requests are not rejected.
 * - Input-image validation rules ("every side ≥ 64 px", "total pixel count
 *   between 4,096 and 9,437,184", "aspect ratio between 1:2.5 and 2.5:1") are
 *   documented per route but cannot be checked from a Blob without decoding
 *   it, so they are recorded here and enforced server-side.
 * - Billing is flat credits per successful generation (1 credit = $0.01); the
 *   estimate is exact per image, surcharge-free.
 */

import { z } from "zod";
import { createValidator, type PipelineContext } from "../../core/pipeline";
import { toValidated, type Validated, type ExactKeys } from "../../core/request";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";
import type { ModelInfo } from "../../core/catalog-types";
import type { EndpointConstraints } from "../../core/constraint-types";
import { models } from "./models";
import {
  STABILITY_STYLE_PRESETS,
  STABILITY_OUTPUT_FORMATS,
  type StabilityStylePreset,
  type StabilityOutputFormat,
} from "./image";

const EDIT_BASE_URL = "https://api.stability.ai/v2beta/stable-image/edit";

export const STABLE_IMAGE_ERASE_URL = `${EDIT_BASE_URL}/erase`;
export const STABLE_IMAGE_INPAINT_URL = `${EDIT_BASE_URL}/inpaint`;
export const STABLE_IMAGE_OUTPAINT_URL = `${EDIT_BASE_URL}/outpaint`;
export const STABLE_IMAGE_SEARCH_AND_REPLACE_URL = `${EDIT_BASE_URL}/search-and-replace`;
export const STABLE_IMAGE_SEARCH_AND_RECOLOR_URL = `${EDIT_BASE_URL}/search-and-recolor`;
export const STABLE_IMAGE_REMOVE_BACKGROUND_URL = `${EDIT_BASE_URL}/remove-background`;

/**
 * The spec is served here despite the /v2alpha path; it carries the v2beta
 * routes and is what platform.stability.ai's reference renders.
 */
const SPEC_URL = "https://api.stability.ai/v2alpha/openapi";

/** Max pixels `outpaint` will add on any one side. */
export const STABILITY_OUTPAINT_MAX_PIXELS = 2000;

/**
 * `output_format` on remove-background: png/webp only. jpeg is absent because
 * the route returns an alpha channel.
 */
export const STABILITY_ALPHA_OUTPUT_FORMATS = ["png", "webp"] as const;
export type StabilityAlphaOutputFormat = (typeof STABILITY_ALPHA_OUTPUT_FORMATS)[number];

// ---------------------------------------------------------------------------
// Wire types — mirror the multipart form fields exactly, per route.
// ---------------------------------------------------------------------------

/** POST /v2beta/stable-image/edit/erase (5 credits). */
export interface StableImageEraseParams {
  /** Image to erase from (jpeg/png/webp). REQUIRED. */
  image: Blob;
  /**
   * Black/white mask; darker pixels are preserved, lighter pixels erased.
   * Optional when `image` carries an alpha channel.
   */
  mask?: Blob;
  /** Grow the mask outward by 0–20 px. Default 5. */
  grow_mask?: number;
  /** 0–4294967294; omit or 0 for a random seed. */
  seed?: number;
  /** Dictates the content-type of the generated image. Default "png". */
  output_format?: StabilityOutputFormat;
}

/** POST /v2beta/stable-image/edit/inpaint (5 credits). */
export interface StableImageInpaintParams {
  /** Image to inpaint (jpeg/png/webp). REQUIRED. */
  image: Blob;
  /** What you wish to see in the output image; 1–10,000 characters. REQUIRED. */
  prompt: string;
  /** What you do NOT wish to see; up to 10,000 characters. */
  negative_prompt?: string;
  /** Black/white mask; optional when `image` carries an alpha channel. */
  mask?: Blob;
  /** Grow the mask outward by 0–100 px on this route. Default 5. */
  grow_mask?: number;
  /** 0–4294967294; omit or 0 for a random seed. */
  seed?: number;
  /** Dictates the content-type of the generated image. Default "png". */
  output_format?: StabilityOutputFormat;
  /** Guides the model towards a particular style. */
  style_preset?: StabilityStylePreset;
}

/** POST /v2beta/stable-image/edit/outpaint (4 credits). */
export interface StableImageOutpaintParams {
  /** Image to outpaint (jpeg/png/webp). REQUIRED. */
  image: Blob;
  /** Pixels to add on the left, 0–2000. Default 0. */
  left?: number;
  /** Pixels to add on the right, 0–2000. Default 0. */
  right?: number;
  /** Pixels to add on the top, 0–2000. Default 0. */
  up?: number;
  /** Pixels to add on the bottom, 0–2000. Default 0. */
  down?: number;
  /** Likelihood of inventing detail not conditioned on the init image, 0–1. */
  creativity?: number;
  /** What you wish to see in the output image; up to 10,000 characters. */
  prompt?: string;
  /** 0–4294967294; omit or 0 for a random seed. */
  seed?: number;
  /** Dictates the content-type of the generated image. Default "png". */
  output_format?: StabilityOutputFormat;
  /** Guides the model towards a particular style. */
  style_preset?: StabilityStylePreset;
}

/** POST /v2beta/stable-image/edit/search-and-replace (5 credits). */
export interface StableImageSearchAndReplaceParams {
  /** Image containing content you wish to replace. REQUIRED. */
  image: Blob;
  /** What you wish to see in the output image; 1–10,000 characters. REQUIRED. */
  prompt: string;
  /** Short description of what to inpaint in `image`; ≤ 10,000 chars. REQUIRED. */
  search_prompt: string;
  /** What you do NOT wish to see; up to 10,000 characters. */
  negative_prompt?: string;
  /** Grow the derived mask outward by 0–20 px. Default 3. */
  grow_mask?: number;
  /** 0–4294967294; omit or 0 for a random seed. */
  seed?: number;
  /** Dictates the content-type of the generated image. Default "png". */
  output_format?: StabilityOutputFormat;
  /** Guides the model towards a particular style. */
  style_preset?: StabilityStylePreset;
}

/** POST /v2beta/stable-image/edit/search-and-recolor (5 credits). */
export interface StableImageSearchAndRecolorParams {
  /** Image containing content you wish to recolor. REQUIRED. */
  image: Blob;
  /** What you wish to see in the output image; 1–10,000 characters. REQUIRED. */
  prompt: string;
  /** Short description of what to search for in `image`; ≤ 10,000 chars. REQUIRED. */
  select_prompt: string;
  /** What you do NOT wish to see; up to 10,000 characters. */
  negative_prompt?: string;
  /** Grow the derived mask outward by 0–20 px. Default 3. */
  grow_mask?: number;
  /** 0–4294967294; omit or 0 for a random seed. */
  seed?: number;
  /** Dictates the content-type of the generated image. Default "png". */
  output_format?: StabilityOutputFormat;
  /** Guides the model towards a particular style. */
  style_preset?: StabilityStylePreset;
}

/** POST /v2beta/stable-image/edit/remove-background (5 credits). */
export interface StableImageRemoveBackgroundParams {
  /** Image whose background you wish to remove. REQUIRED. */
  image: Blob;
  /** png or webp only — this route returns an alpha channel. Default "png". */
  output_format?: StabilityAlphaOutputFormat;
}

// ---------------------------------------------------------------------------
// Schemas (loose: unknown keys pass through with a warning).
// ---------------------------------------------------------------------------

const imageSchema = z.instanceof(Blob, { message: "image must be a Blob" });
const seedSchema = z.number().min(0).max(4294967294).optional();
const promptSchema = z
  .string()
  .min(1, "prompt must be 1–10000 characters")
  .max(10000, "prompt must be 1–10000 characters");
const negativePromptSchema = z
  .string()
  .max(10000, "negative_prompt allows at most 10000 characters")
  .optional();
const outputFormatSchema = z.enum(STABILITY_OUTPUT_FORMATS).optional();
const stylePresetSchema = z.enum(STABILITY_STYLE_PRESETS).optional();

function growMask(max: number) {
  return z
    .number()
    .min(0, `grow_mask must be between 0 and ${max} on this route`)
    .max(max, `grow_mask must be between 0 and ${max} on this route`)
    .optional();
}

const eraseSchema = z.looseObject({
  image: imageSchema,
  mask: z.instanceof(Blob).optional(),
  grow_mask: growMask(20),
  seed: seedSchema,
  output_format: outputFormatSchema,
});

const inpaintSchema = z.looseObject({
  image: imageSchema,
  prompt: promptSchema,
  negative_prompt: negativePromptSchema,
  mask: z.instanceof(Blob).optional(),
  // inpaint alone allows 0–100 (the rest of the family caps at 20).
  grow_mask: growMask(100),
  seed: seedSchema,
  output_format: outputFormatSchema,
  style_preset: stylePresetSchema,
});

const outpaintPixels = z
  .number()
  .int()
  .min(0, `outpaint sides must be between 0 and ${STABILITY_OUTPAINT_MAX_PIXELS} pixels`)
  .max(
    STABILITY_OUTPAINT_MAX_PIXELS,
    `outpaint sides must be between 0 and ${STABILITY_OUTPAINT_MAX_PIXELS} pixels`,
  )
  .optional();

const outpaintSchema = z.looseObject({
  image: imageSchema,
  left: outpaintPixels,
  right: outpaintPixels,
  up: outpaintPixels,
  down: outpaintPixels,
  // The spec composes Creativity (0.2–0.5) with an inline {0–1, default 0.5}
  // override; the two disagree, so unmodel takes the union (0–1) rather than
  // rejecting values the rendered reference documents as valid.
  creativity: z.number().min(0).max(1).optional(),
  prompt: z.string().max(10000, "prompt allows at most 10000 characters").optional(),
  seed: seedSchema,
  output_format: outputFormatSchema,
  style_preset: stylePresetSchema,
});

const searchAndReplaceSchema = z.looseObject({
  image: imageSchema,
  prompt: promptSchema,
  search_prompt: z.string().max(10000, "search_prompt allows at most 10000 characters"),
  negative_prompt: negativePromptSchema,
  grow_mask: growMask(20),
  seed: seedSchema,
  output_format: outputFormatSchema,
  style_preset: stylePresetSchema,
});

const searchAndRecolorSchema = z.looseObject({
  image: imageSchema,
  prompt: promptSchema,
  select_prompt: z.string().max(10000, "select_prompt allows at most 10000 characters"),
  negative_prompt: negativePromptSchema,
  grow_mask: growMask(20),
  seed: seedSchema,
  output_format: outputFormatSchema,
  style_preset: stylePresetSchema,
});

const removeBackgroundSchema = z.looseObject({
  image: imageSchema,
  output_format: z.enum(STABILITY_ALPHA_OUTPUT_FORMATS).optional(),
});

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

/** "At least one outpainting direction must be supplied with a non-zero value." */
function checkOutpaintDirections(
  params: StableImageOutpaintParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const total = (params.left ?? 0) + (params.right ?? 0) + (params.up ?? 0) + (params.down ?? 0);
  if (total > 0) return;
  ctx.report({
    code: "invalid_shape",
    path: ["left"],
    message:
      "at least one outpainting direction (`left`, `right`, `up`, `down`) must be supplied with a non-zero value.",
    meta: { source: `${SPEC_URL}#/paths/~1v2beta~1stable-image~1edit~1outpaint` },
  });
}

// ---------------------------------------------------------------------------
// Estimation + finalize
// ---------------------------------------------------------------------------

function perImageEstimate(info: ModelInfo | undefined) {
  const perImage = info?.cost?.perImage;
  return perImage === undefined ? {} : { costUSD: perImage };
}

/**
 * The one `.toSdk("stability")` target for this endpoint — Stability ships
 * no official JS SDK, so this is the multipart source. Derived from the
 * `sdk` literal in `finalize`; it must stay an object type with no index
 * signature, or `toSdk` would accept any string.
 */
type StabilitySdkTargets<B> = { stability: () => B };

function finalizeTo(url: string) {
  return (params: object): unknown => {
    const body = { ...params };
    return toValidated(body, {
      url,
      method: "POST",
      // Deliberately empty: multipart endpoint — fetch must derive the
      // boundary from the FormData body. Add your own accept + auth headers.
      headers: {},
    }, {
      sdk: { stability: () => body },
    });
  };
}

const eraseValidator = createValidator<StableImageEraseParams, unknown>({
  endpoint: "stability.stableImageErase",
  schema: eraseSchema,
  // No `model` wire field on any edit route — the route is the model.
  modelId: () => "stable-image-erase",
  catalog: models,
  estimate: (_params, info) => perImageEstimate(info),
  finalize: finalizeTo(STABLE_IMAGE_ERASE_URL),
});

const inpaintValidator = createValidator<StableImageInpaintParams, unknown>({
  endpoint: "stability.stableImageInpaint",
  schema: inpaintSchema,
  modelId: () => "stable-image-inpaint",
  catalog: models,
  estimate: (_params, info) => perImageEstimate(info),
  finalize: finalizeTo(STABLE_IMAGE_INPAINT_URL),
});

const outpaintValidator = createValidator<StableImageOutpaintParams, unknown>({
  endpoint: "stability.stableImageOutpaint",
  schema: outpaintSchema,
  modelId: () => "stable-image-outpaint",
  catalog: models,
  checks: [checkOutpaintDirections],
  estimate: (_params, info) => perImageEstimate(info),
  finalize: finalizeTo(STABLE_IMAGE_OUTPAINT_URL),
});

const searchAndReplaceValidator = createValidator<StableImageSearchAndReplaceParams, unknown>({
  endpoint: "stability.stableImageSearchAndReplace",
  schema: searchAndReplaceSchema,
  modelId: () => "stable-image-search-and-replace",
  catalog: models,
  estimate: (_params, info) => perImageEstimate(info),
  finalize: finalizeTo(STABLE_IMAGE_SEARCH_AND_REPLACE_URL),
});

const searchAndRecolorValidator = createValidator<StableImageSearchAndRecolorParams, unknown>({
  endpoint: "stability.stableImageSearchAndRecolor",
  schema: searchAndRecolorSchema,
  modelId: () => "stable-image-search-and-recolor",
  catalog: models,
  estimate: (_params, info) => perImageEstimate(info),
  finalize: finalizeTo(STABLE_IMAGE_SEARCH_AND_RECOLOR_URL),
});

const removeBackgroundValidator = createValidator<StableImageRemoveBackgroundParams, unknown>({
  endpoint: "stability.stableImageRemoveBackground",
  schema: removeBackgroundSchema,
  modelId: () => "stable-image-remove-background",
  catalog: models,
  estimate: (_params, info) => perImageEstimate(info),
  finalize: finalizeTo(STABLE_IMAGE_REMOVE_BACKGROUND_URL),
});

interface StableImageEditValidator<P> {
  <T extends P>(
    params: T & ExactKeys<T, P>,
    options?: ValidateOptions,
  ): Validated<T, StabilitySdkTargets<T>>;
  safe<T extends P>(
    params: T & ExactKeys<T, P>,
    options?: ValidateOptions,
  ): ValidateResult<Validated<T, StabilitySdkTargets<T>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
}

/**
 * Validates params for `POST /v2beta/stable-image/edit/erase` (5 credits ≈
 * $0.05 per successful generation) — removes objects using a mask or the
 * image's alpha channel.
 *
 * Multipart endpoint: send `.request.url` + `stability.toFormData(validated)`
 * as the body, never `JSON.stringify`. Add your own `authorization` and
 * accept header (`image/*` for bytes — the server default — or
 * `application/json` for base64 JSON).
 */
export const stableImageErase =
  eraseValidator as unknown as StableImageEditValidator<StableImageEraseParams>;

/**
 * Validates params for `POST /v2beta/stable-image/edit/inpaint` (5 credits ≈
 * $0.05). Note `grow_mask` runs 0–100 here — wider than the 0–20 the other
 * edit routes allow. Multipart endpoint — see `stableImageErase`.
 */
export const stableImageInpaint =
  inpaintValidator as unknown as StableImageEditValidator<StableImageInpaintParams>;

/**
 * Validates params for `POST /v2beta/stable-image/edit/outpaint` (4 credits ≈
 * $0.04). At least one of `left`/`right`/`up`/`down` must be non-zero; each
 * is capped at 2000 px. Multipart endpoint — see `stableImageErase`.
 */
export const stableImageOutpaint =
  outpaintValidator as unknown as StableImageEditValidator<StableImageOutpaintParams>;

/**
 * Validates params for `POST /v2beta/stable-image/edit/search-and-replace`
 * (5 credits ≈ $0.05) — `search_prompt` selects the region, `prompt`
 * describes the replacement. Multipart endpoint — see `stableImageErase`.
 */
export const stableImageSearchAndReplace =
  searchAndReplaceValidator as unknown as StableImageEditValidator<StableImageSearchAndReplaceParams>;

/**
 * Validates params for `POST /v2beta/stable-image/edit/search-and-recolor`
 * (5 credits ≈ $0.05) — `select_prompt` selects the region, `prompt`
 * describes the new colors. Multipart endpoint — see `stableImageErase`.
 */
export const stableImageSearchAndRecolor =
  searchAndRecolorValidator as unknown as StableImageEditValidator<StableImageSearchAndRecolorParams>;

/**
 * Validates params for `POST /v2beta/stable-image/edit/remove-background`
 * (5 credits ≈ $0.05). `output_format` is png/webp only on this route — jpeg
 * cannot carry the alpha channel the route produces. Multipart endpoint —
 * see `stableImageErase`.
 */
export const stableImageRemoveBackground =
  removeBackgroundValidator as unknown as StableImageEditValidator<StableImageRemoveBackgroundParams>;
