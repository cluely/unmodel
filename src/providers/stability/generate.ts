/**
 * Stability AI v2beta Stable Image generation —
 * POST https://api.stability.ai/v2beta/stable-image/generate/{ultra|core|sd3}
 *
 * Wire notes (transcribed from the machine-readable v2beta spec at
 * https://api.stability.ai/v2alpha/openapi — despite the /v2alpha path it
 * serves the v2beta REST spec and IS the definition the rendered reference at
 * https://platform.stability.ai/docs/api-reference loads — on 2026-08-13):
 * - These are MULTIPART form endpoints. The validated output's enumerable
 *   props are the exact multipart fields (including the `image` Blob) — do
 *   NOT `JSON.stringify` them. The raw-fetch path is `.request.url` +
 *   `toFormData(validated)` as the body; fetch derives the multipart
 *   content-type (with boundary) from the FormData, which is why
 *   `.request.headers` is empty. Never set content-type yourself.
 * - Accept header: the response is raw image bytes by default. Set `accept:
 *   "image/*"` for bytes (server default) or `accept: "application/json"`
 *   for base64-encoded JSON — your choice, added alongside your auth header.
 * - Auth is `authorization: Bearer <key>` — unmodel never touches keys.
 * - One endpoint fn per route (mirroring Stability's own resources): the
 *   three routes take different field surfaces, and ultra/core have no
 *   `model` wire field at all — the route is the model. Only the sd3 route
 *   takes a `model` form field (sd3.5-large default).
 * - Billing is flat credits per successful generation (1 credit = $0.01);
 *   the cost estimate is exact per image, surcharge-free.
 */

import { z } from "zod";
import { createValidator, type PipelineContext } from "../../core/pipeline";
import { toValidated, type Validated, type ExactKeys } from "../../core/request";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";
import type { ModelInfo } from "../../core/catalog-types";
import type { EndpointConstraints } from "../../core/constraint-types";
import { models, type StabilitySd3ModelId } from "./models";

const GENERATE_BASE_URL = "https://api.stability.ai/v2beta/stable-image/generate";

export const STABLE_IMAGE_ULTRA_URL = `${GENERATE_BASE_URL}/ultra`;
export const STABLE_IMAGE_CORE_URL = `${GENERATE_BASE_URL}/core`;
export const STABLE_IMAGE_SD3_URL = `${GENERATE_BASE_URL}/sd3`;

/**
 * Machine-readable ground truth. The /v2alpha path is a legacy URL: the
 * document it serves is the v2beta REST spec (title "StabilityAI REST API",
 * version v2beta) and carries every stable-image route.
 */
const API_REFERENCE_URL = "https://api.stability.ai/v2alpha/openapi";

/**
 * Server-side default when the sd3 route's `model` field is omitted —
 * "The model to use for generation … default sd3.5-large".
 */
export const DEFAULT_SD3_MODEL_ID = "sd3.5-large";

/** Aspect ratios accepted by all three generate routes. */
export const STABILITY_ASPECT_RATIOS = [
  "21:9",
  "16:9",
  "3:2",
  "5:4",
  "1:1",
  "4:5",
  "2:3",
  "9:16",
  "9:21",
] as const;
export type StabilityAspectRatio = (typeof STABILITY_ASPECT_RATIOS)[number];

/** `style_preset` values accepted by all three generate routes. */
export const STABILITY_STYLE_PRESETS = [
  "enhance",
  "anime",
  "photographic",
  "digital-art",
  "comic-book",
  "fantasy-art",
  "line-art",
  "analog-film",
  "neon-punk",
  "isometric",
  "low-poly",
  "origami",
  "modeling-compound",
  "cinematic",
  "3d-model",
  "pixel-art",
  "tile-texture",
] as const;
export type StabilityStylePreset = (typeof STABILITY_STYLE_PRESETS)[number];

export const STABILITY_OUTPUT_FORMATS = ["png", "jpeg", "webp"] as const;
export type StabilityOutputFormat = (typeof STABILITY_OUTPUT_FORMATS)[number];

// ---------------------------------------------------------------------------
// Wire types — mirror the multipart form fields exactly.
// ---------------------------------------------------------------------------

/** POST /v2beta/stable-image/generate/ultra (8 credits per generation). */
export interface StableImageUltraParams {
  /** What you wish to see in the image; 1–10,000 characters. */
  prompt: string;
  /** What you do NOT wish to see; up to 10,000 characters. */
  negative_prompt?: string;
  /** Aspect ratio of the output. Default "1:1". */
  aspect_ratio?: StabilityAspectRatio;
  /** 0–4294967294; omit or 0 for a random seed. */
  seed?: number;
  /** Dictates the content-type of the generated image. Default "png". */
  output_format?: StabilityOutputFormat;
  /**
   * Image (jpeg/png/webp bytes) to use as the starting point.
   * `strength` is REQUIRED when this is provided.
   */
  image?: Blob;
  /** Guides the model towards a particular style. */
  style_preset?: StabilityStylePreset;
  /** Denoising 0–1: influence of `image` on the result. Required with `image`. */
  strength?: number;
}

/** POST /v2beta/stable-image/generate/core (3 credits per generation). */
export interface StableImageCoreParams {
  /** What you wish to see in the image; 1–10,000 characters. */
  prompt: string;
  /** Aspect ratio of the output. Default "1:1". */
  aspect_ratio?: StabilityAspectRatio;
  /** What you do NOT wish to see; up to 10,000 characters. */
  negative_prompt?: string;
  /** 0–4294967294; omit or 0 for a random seed. */
  seed?: number;
  /** Guides the model towards a particular style. */
  style_preset?: StabilityStylePreset;
  /** Dictates the content-type of the generated image. Default "png". */
  output_format?: StabilityOutputFormat;
}

/** POST /v2beta/stable-image/generate/sd3 (2.5–6.5 credits per generation). */
export interface StableImageSd3Params {
  /** What you wish to see in the image; 1–10,000 characters. */
  prompt: string;
  /**
   * text-to-image (default) needs only `prompt`; image-to-image requires
   * `prompt`, `image`, and `strength`.
   */
  mode?: "text-to-image" | "image-to-image";
  /** Starting-point image (jpeg/png/webp, sides ≥ 64px). image-to-image only. */
  image?: Blob;
  /** Denoising 0–1. image-to-image only (required in that mode). */
  strength?: number;
  /** Aspect ratio of the output. Default "1:1". text-to-image only. */
  aspect_ratio?: StabilityAspectRatio;
  /**
   * SD 3.5 model to use. Default "sd3.5-large". The deprecated sd3-* ids are
   * re-routed server-side to their sd3.5 equivalents at the same price.
   */
  model?: StabilitySd3ModelId | (string & {});
  /** 0–4294967294; omit or 0 for a random seed. */
  seed?: number;
  /** Dictates the content-type of the generated image. Default "png". */
  output_format?: StabilityOutputFormat;
  /** Guides the model towards a particular style. */
  style_preset?: StabilityStylePreset;
  /** What you do NOT wish to see; up to 10,000 characters. */
  negative_prompt?: string;
  /** Prompt adherence 1–10. Defaults: 4 (large/medium), 1 (turbo/flash). */
  cfg_scale?: number;
}

// ---------------------------------------------------------------------------
// Schemas (loose: unknown keys pass through with a warning).
// ---------------------------------------------------------------------------

const promptSchema = z
  .string()
  .min(1, "prompt must be 1–10000 characters")
  .max(10000, "prompt must be 1–10000 characters");
const negativePromptSchema = z
  .string()
  .max(10000, "negative_prompt allows at most 10000 characters")
  .optional();
const seedSchema = z.number().min(0).max(4294967294).optional();

const ultraSchema = z.looseObject({
  prompt: promptSchema,
  negative_prompt: negativePromptSchema,
  aspect_ratio: z.enum(STABILITY_ASPECT_RATIOS).optional(),
  seed: seedSchema,
  output_format: z.enum(STABILITY_OUTPUT_FORMATS).optional(),
  image: z.instanceof(Blob).optional(),
  style_preset: z.enum(STABILITY_STYLE_PRESETS).optional(),
  strength: z.number().min(0).max(1).optional(),
});

const coreSchema = z.looseObject({
  prompt: promptSchema,
  aspect_ratio: z.enum(STABILITY_ASPECT_RATIOS).optional(),
  negative_prompt: negativePromptSchema,
  seed: seedSchema,
  style_preset: z.enum(STABILITY_STYLE_PRESETS).optional(),
  output_format: z.enum(STABILITY_OUTPUT_FORMATS).optional(),
});

const sd3Schema = z.looseObject({
  prompt: promptSchema,
  mode: z.enum(["text-to-image", "image-to-image"]).optional(),
  image: z.instanceof(Blob).optional(),
  strength: z.number().min(0).max(1).optional(),
  aspect_ratio: z.enum(STABILITY_ASPECT_RATIOS).optional(),
  model: z.string().optional(),
  seed: seedSchema,
  output_format: z.enum(STABILITY_OUTPUT_FORMATS).optional(),
  style_preset: z.enum(STABILITY_STYLE_PRESETS).optional(),
  negative_prompt: negativePromptSchema,
  cfg_scale: z.number().min(1).max(10).optional(),
});

// ---------------------------------------------------------------------------
// Checks — documented field-pairing rules the API enforces server-side.
// ---------------------------------------------------------------------------

/** Ultra: "The `strength` parameter is required when `image` is provided." */
function checkUltraImageStrength(
  params: StableImageUltraParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (params.image !== undefined && params.strength === undefined) {
    ctx.report({
      code: "invalid_shape",
      path: ["strength"],
      message: "`strength` is required when `image` is provided.",
      meta: { source: API_REFERENCE_URL },
    });
  }
}

/**
 * `model` values the sd3 route accepts. The spec's enum lists the three
 * original sd3.5 ids; sd3.5-flash and the re-routed sd3-* ids are documented
 * in the same spec's `model`/credits descriptions.
 */
export const SD3_MODELS = [
  "sd3.5-large",
  "sd3.5-large-turbo",
  "sd3.5-medium",
  "sd3.5-flash",
  "sd3-large",
  "sd3-large-turbo",
  "sd3-medium",
] as const;

const SD3_MODEL_SET = new Set<string>(SD3_MODELS);

function checkSd3Model(
  params: StableImageSd3Params,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const model = params.model;
  if (model === undefined || SD3_MODEL_SET.has(model)) return;
  ctx.report({
    code: "invalid_enum_value",
    path: ["model"],
    model,
    message: `\`model\` must be one of ${SD3_MODELS.map((v) => JSON.stringify(v)).join(", ")} on the sd3 route; got ${JSON.stringify(model)}.`,
    meta: { allowed: [...SD3_MODELS], value: model, source: API_REFERENCE_URL },
  });
}

/**
 * SD3 mode pairing: image-to-image requires `image` + `strength`;
 * `image`/`strength` are only valid in image-to-image mode; `aspect_ratio`
 * is only valid for text-to-image.
 */
function checkSd3Mode(
  params: StableImageSd3Params,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const mode = params.mode ?? "text-to-image";
  if (mode === "image-to-image") {
    if (params.image === undefined) {
      ctx.report({
        code: "invalid_shape",
        path: ["image"],
        message: "`image` is required when `mode` is \"image-to-image\".",
        meta: { source: API_REFERENCE_URL },
      });
    }
    if (params.strength === undefined) {
      ctx.report({
        code: "invalid_shape",
        path: ["strength"],
        message: "`strength` is required when `mode` is \"image-to-image\".",
        meta: { source: API_REFERENCE_URL },
      });
    }
    if (params.aspect_ratio !== undefined) {
      ctx.report({
        code: "invalid_shape",
        path: ["aspect_ratio"],
        message: "`aspect_ratio` is only valid for text-to-image requests.",
        meta: { source: API_REFERENCE_URL },
      });
    }
    return;
  }
  if (params.image !== undefined) {
    ctx.report({
      code: "invalid_shape",
      path: ["image"],
      message: "`image` is only valid when `mode` is \"image-to-image\".",
      meta: { source: API_REFERENCE_URL },
    });
  }
  if (params.strength !== undefined) {
    ctx.report({
      code: "invalid_shape",
      path: ["strength"],
      message: "`strength` is only valid when `mode` is \"image-to-image\".",
      meta: { source: API_REFERENCE_URL },
    });
  }
}

// ---------------------------------------------------------------------------
// Estimation — flat credits per successful generation (models.ts).
// ---------------------------------------------------------------------------

function perImageEstimate(info: ModelInfo | undefined) {
  const perImage = info?.cost?.perImage;
  return perImage === undefined ? {} : { costUSD: perImage };
}

// ---------------------------------------------------------------------------
// FormData helper + finalize
// ---------------------------------------------------------------------------

/**
 * Builds the multipart/form-data body for any stable-image route (generate,
 * edit, …) from validated params: `image`/`mask` Blobs are appended as file
 * parts, every other field is stringified, and null/undefined fields are
 * omitted.
 *
 * ```ts
 * const params = stability.stableImageCore({ prompt: "a lighthouse at dawn" });
 * const res = await fetch(params.request.url, {
 *   method: params.request.method,
 *   headers: {
 *     authorization: `Bearer ${process.env.STABILITY_API_KEY}`,
 *     accept: "image/*", // or "application/json" for base64 JSON
 *   },
 *   body: stability.toFormData(params),
 * });
 * const image = await res.arrayBuffer();
 * ```
 */
export function toFormData(params: object): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(params)) {
    if (value == null) continue;
    if (value instanceof Blob) form.append(key, value);
    else form.append(key, String(value));
  }
  return form;
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
      // Deliberately empty: this is a multipart endpoint, and fetch must
      // derive the multipart boundary from the FormData body itself. Add
      // your own accept header (image/* or application/json) and auth.
      headers: {},
    }, {
      sdk: { stability: () => body },
    });
  };
}

const ultraValidator = createValidator<StableImageUltraParams, unknown>({
  endpoint: "stability.stableImageUltra",
  schema: ultraSchema,
  // The ultra route has no model wire field — the route is the model.
  modelId: () => "stable-image-ultra",
  catalog: models,
  checks: [checkUltraImageStrength],
  estimate: (_params, info) => perImageEstimate(info),
  finalize: finalizeTo(STABLE_IMAGE_ULTRA_URL),
});

const coreValidator = createValidator<StableImageCoreParams, unknown>({
  endpoint: "stability.stableImageCore",
  schema: coreSchema,
  // The core route has no model wire field — the route is the model.
  modelId: () => "stable-image-core",
  catalog: models,
  estimate: (_params, info) => perImageEstimate(info),
  finalize: finalizeTo(STABLE_IMAGE_CORE_URL),
});

const sd3Validator = createValidator<StableImageSd3Params, unknown>({
  endpoint: "stability.stableImageSd3",
  schema: sd3Schema,
  modelId: (params) => params.model ?? DEFAULT_SD3_MODEL_ID,
  catalog: models,
  checks: [checkSd3Model, checkSd3Mode],
  estimate: (_params, info) => perImageEstimate(info),
  finalize: finalizeTo(STABLE_IMAGE_SD3_URL),
});

interface StableImageValidator<P> {
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
 * Validates params for `POST /v2beta/stable-image/generate/ultra` (Stable
 * Image Ultra, 8 credits ≈ $0.08 per successful generation).
 *
 * Multipart endpoint: the validated output's enumerable props are the exact
 * form fields (including the `image` Blob) — send `.request.url` +
 * `toFormData(validated)` as the body, never `JSON.stringify`. Add your own
 * `authorization` and accept header (`image/*` for raw bytes — the server
 * default — or `application/json` for base64 JSON). Stability has no
 * official JS SDK, so `.toSdk("stability")` returns the fields unchanged.
 */
export const stableImageUltra = ultraValidator as unknown as
  StableImageValidator<StableImageUltraParams>;

/**
 * Validates params for `POST /v2beta/stable-image/generate/core` (Stable
 * Image Core, 3 credits ≈ $0.03 per successful generation; output is always
 * 1.5 megapixels).
 *
 * Multipart endpoint — see `stableImageUltra` for the fetch recipe.
 */
export const stableImageCore = coreValidator as unknown as
  StableImageValidator<StableImageCoreParams>;

/**
 * Validates params for `POST /v2beta/stable-image/generate/sd3` (Stable
 * Diffusion 3.5: sd3.5-large $0.065, sd3.5-large-turbo $0.04, sd3.5-medium
 * $0.035, sd3.5-flash $0.025 per successful generation; output is 1MP).
 *
 * `model` defaults to sd3.5-large server-side; mode pairing rules
 * (image-to-image requires `image` + `strength`, `aspect_ratio` is
 * text-to-image only) are enforced. Multipart endpoint — see
 * `stableImageUltra` for the fetch recipe.
 */
export const stableImageSd3 = sd3Validator as unknown as
  StableImageValidator<StableImageSd3Params>;
