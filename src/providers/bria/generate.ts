/**
 * Bria FIBO image generation —
 *   POST https://engine.prod.bria-api.com/v2/image/generate       (full pipeline)
 *   POST https://engine.prod.bria-api.com/v2/image/generate/lite   (Fibo Lite pipeline)
 *
 * Wire notes (verified 2026-08-13 against
 * https://docs.bria.ai/_bundle/image-generation.yaml — the bundled OpenAPI the
 * docs site serves — and https://docs.bria.ai/image-generation):
 * - Both routes are two-step: a VLM bridge turns your input into a
 *   `structured_prompt` (JSON) and FIBO renders that. You can skip the bridge
 *   by sending a `structured_prompt` of your own (e.g. from a previous
 *   response), which is how "recreate" and "refine" work.
 * - The documented input combinations are mutually exclusive: `prompt` |
 *   `images` | `images` + `prompt` | `structured_prompt` | `structured_prompt`
 *   + `prompt`. `images` + `structured_prompt` is NOT one of them, and at
 *   least one of the three must be present.
 * - `structured_prompt` is a JSON **string**, not an object.
 * - The two routes differ: `/image/generate` adds `resolution` (1MP/4MP),
 *   `negative_prompt` and `steps_num` (35–50); the lite route has none of
 *   those. Both accept the same 9 aspect ratios and the same async/moderation
 *   flags.
 * - ASYNC BY DEFAULT: `sync` defaults to false, so the POST answers 202 with a
 *   `status_url` to poll (or set `webhook_url`). Polling is transport — out of
 *   unmodel's scope.
 * - Auth is an `api_token` header — unmodel never touches keys.
 * - Bria ships a Python client, not a JS SDK; `.toSdk("bria")` returns the wire body
 *   unchanged.
 */

import { z } from "zod";
import { createValidator, type PipelineContext } from "../../core/pipeline";
import { toValidated, JSON_HEADERS, type Validated, type ExactKeys } from "../../core/request";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";
import type { ModelInfo } from "../../core/catalog-types";
import type { EndpointConstraints } from "../../core/constraint-types";
import { models } from "./models";
import {
  BRIA_API_BASE_URL,
  BRIA_ASPECT_RATIOS,
  BRIA_GENERATION_SPEC_URL,
  BRIA_OUTPUT_TYPES,
  BRIA_RESOLUTIONS,
  checkBriaEnum,
  checkBriaImages,
  checkBriaIntegerRange,
  checkBriaWebhook,
  checkStructuredJsonString,
  type BriaAspectRatio,
  type BriaCommonParams,
  type BriaResolution,
} from "./shared";

export const BRIA_IMAGE_GENERATE_URL = `${BRIA_API_BASE_URL}/image/generate`;
export const BRIA_IMAGE_GENERATE_LITE_URL = `${BRIA_API_BASE_URL}/image/generate/lite`;

/** `model_version` enum on both generate routes. */
export const BRIA_GENERATE_MODEL_VERSIONS = ["FIBO"] as const;
export type BriaGenerateModelVersion = (typeof BRIA_GENERATE_MODEL_VERSIONS)[number];

/** `steps_num` bounds on the full generate route (default 50). */
export const BRIA_GENERATE_STEPS_MIN = 35;
export const BRIA_GENERATE_STEPS_MAX = 50;

interface BriaGenerateCommon extends BriaCommonParams {
  /** Text instruction; alone, or refining `images` / `structured_prompt`. */
  prompt?: string;
  /** Reference image (URL or base64) — exactly one entry. */
  images?: string[];
  /** JSON **string** from a previous response or /v2/structured_prompt/generate. */
  structured_prompt?: string;
  /** Pin the generation model. Optional — omit to track Bria's default. */
  model_version?: BriaGenerateModelVersion | (string & {});
  /**
   * Output aspect ratio. Default "1:1". CLOSED enum — the 9 values are the
   * OpenAPI `aspect_ratio` enum in full, identical on both generate routes.
   */
  aspect_ratio?: BriaAspectRatio;
}

export interface ImageGenerateParams extends BriaGenerateCommon {
  /**
   * Output resolution. "4MP" adds ~30s of latency. Default "1MP". CLOSED
   * enum — the OpenAPI `resolution` enum has exactly these two values.
   */
  resolution?: BriaResolution;
  /** Concepts to exclude from the image. */
  negative_prompt?: string;
  /** Diffusion steps, 35–50. Default 50. */
  steps_num?: number;
}

/** The lite route's body: no `resolution`, `negative_prompt` or `steps_num`. */
export interface ImageGenerateLiteParams extends BriaGenerateCommon {
  /** Full generate route only. */
  resolution?: never;
  /** Full generate route only. */
  negative_prompt?: never;
  /** Full generate route only. */
  steps_num?: never;
}

const commonShape = {
  prompt: z.string().optional(),
  images: z.array(z.unknown()).optional(),
  structured_prompt: z.unknown().optional(),
  model_version: z.string().optional(),
  aspect_ratio: z.string().optional(),
  seed: z.number().int().optional(),
  sync: z.boolean().optional(),
  webhook_url: z.string().optional(),
  output_type: z.string().optional(),
  ip_signal: z.boolean().optional(),
  prompt_content_moderation: z.boolean().optional(),
  visual_input_content_moderation: z.boolean().optional(),
  visual_output_content_moderation: z.boolean().optional(),
};

const generateSchema = z.looseObject({
  ...commonShape,
  resolution: z.string().optional(),
  negative_prompt: z.string().optional(),
  steps_num: z.number().int().optional(),
});

const generateLiteSchema = z.looseObject(commonShape);

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

/**
 * "The request body must include one of the following mutually exclusive
 * combinations: prompt | images | images + prompt | structured_prompt |
 * structured_prompt + prompt".
 */
function checkInputCombination(params: BriaGenerateCommon, ctx: PipelineContext): void {
  const hasPrompt = params.prompt != null;
  const hasImages = Array.isArray(params.images) && params.images.length > 0;
  const hasStructured = params.structured_prompt != null;

  if (!hasPrompt && !hasImages && !hasStructured) {
    ctx.report({
      code: "invalid_shape",
      path: ["prompt"],
      message:
        "a generate request needs at least one of `prompt`, `images` or `structured_prompt` (the documented combinations are: prompt · images · images+prompt · structured_prompt · structured_prompt+prompt).",
      meta: { source: BRIA_GENERATION_SPEC_URL },
    });
    return;
  }
  if (hasImages && hasStructured) {
    ctx.report({
      code: "invalid_shape",
      path: ["structured_prompt"],
      message:
        "`images` and `structured_prompt` are mutually exclusive — the documented combinations are: prompt · images · images+prompt · structured_prompt · structured_prompt+prompt.",
      meta: { source: BRIA_GENERATION_SPEC_URL },
    });
  }
  if (hasStructured && params.seed == null) {
    ctx.report({
      code: "invalid_shape",
      severity: "warning",
      path: ["seed"],
      message:
        "recreating or refining an image with `structured_prompt` is documented as combined with the `seed` of the visual result — without it the render will not reproduce the original.",
      meta: { source: BRIA_GENERATION_SPEC_URL },
    });
  }
}

function checkGenerateCommon(params: BriaGenerateCommon, ctx: PipelineContext): void {
  checkInputCombination(params, ctx);
  checkStructuredJsonString(ctx, "structured_prompt", params.structured_prompt, BRIA_GENERATION_SPEC_URL);
  checkBriaImages(ctx, params.images, BRIA_GENERATION_SPEC_URL, "at-most-one");
  checkBriaEnum(ctx, ["aspect_ratio"], params.aspect_ratio, BRIA_ASPECT_RATIOS, BRIA_GENERATION_SPEC_URL);
  checkBriaEnum(ctx, ["output_type"], params.output_type, BRIA_OUTPUT_TYPES, BRIA_GENERATION_SPEC_URL);
  checkBriaEnum(
    ctx,
    ["model_version"],
    params.model_version,
    BRIA_GENERATE_MODEL_VERSIONS,
    BRIA_GENERATION_SPEC_URL,
    " Omit `model_version` to track Bria's current default; \"FIBO-edit\" belongs to POST /v2/image/edit.",
  );
  checkBriaWebhook(ctx, params.webhook_url, BRIA_GENERATION_SPEC_URL);
}

function checkGenerate(
  params: ImageGenerateParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  checkGenerateCommon(params, ctx);
  checkBriaEnum(
    ctx,
    ["resolution"],
    params.resolution,
    BRIA_RESOLUTIONS,
    BRIA_GENERATION_SPEC_URL,
    ' "4MP" improves image details but adds ~30 seconds of latency.',
  );
  checkBriaIntegerRange(
    ctx,
    ["steps_num"],
    params.steps_num,
    BRIA_GENERATE_STEPS_MIN,
    BRIA_GENERATE_STEPS_MAX,
    BRIA_GENERATION_SPEC_URL,
  );
}

function checkGenerateLite(
  params: ImageGenerateLiteParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  checkGenerateCommon(params, ctx);
  const record = params as Record<string, unknown>;
  for (const param of ["resolution", "negative_prompt", "steps_num"] as const) {
    if (record[param] == null) continue;
    ctx.report({
      code: "unsupported_param",
      path: [param],
      message: `\`${param}\` is not part of the Fibo Lite request schema; only POST /v2/image/generate accepts it.`,
      meta: { source: BRIA_GENERATION_SPEC_URL },
    });
  }
}

// ---------------------------------------------------------------------------
// Estimation — one image per request; these routes have no image-count param.
// ---------------------------------------------------------------------------

function estimate(_params: BriaGenerateCommon, info: ModelInfo | undefined) {
  const perImage = info?.cost?.perImage;
  return perImage === undefined ? {} : { costUSD: perImage };
}

/**
 * The one `.toSdk("bria")` target for this endpoint — Bria ships no official
 * JS SDK, so this is the wire body. Derived from the `sdk` literal in
 * `finalize`; it must stay an object type with no index signature, or
 * `toSdk` would accept any string.
 */
type BriaSdkTargets<B> = { bria: () => B };

function finalizeFor(url: string) {
  return (params: BriaGenerateCommon): unknown => {
    const body = { ...params };
    return toValidated(body, { url, method: "POST", headers: JSON_HEADERS }, {
      sdk: { bria: () => body },
    });
  };
}

/** Route-fixed catalog id, unless the caller pinned an unknown `model_version`. */
function generateModelId(params: BriaGenerateCommon, routeId: "FIBO" | "FIBO-lite"): string {
  const version = params.model_version;
  return version === undefined || version === "FIBO" ? routeId : version;
}

const generateValidator = createValidator<ImageGenerateParams, unknown>({
  endpoint: "bria.imageGenerate",
  schema: generateSchema,
  modelId: (params) => generateModelId(params, "FIBO"),
  catalog: models,
  checks: [checkGenerate],
  estimate,
  finalize: finalizeFor(BRIA_IMAGE_GENERATE_URL),
});

/**
 * Validates params for `POST https://engine.prod.bria-api.com/v2/image/generate`
 * (Bria's full FIBO pipeline: Gemini 2.5 Flash VLM bridge + FIBO).
 *
 * The returned object's enumerable props are the exact fetch JSON body. The
 * call is asynchronous unless you pass `sync: true` — the 202 response carries
 * a `status_url` to poll (transport, out of unmodel's scope). Auth is your
 * job: add an `api_token` header when fetching.
 *
 * ```ts
 * const params = bria.imageGenerate({
 *   prompt: "a photorealistic rendering of balloon lettering on a white backdrop",
 *   aspect_ratio: "16:9",
 *   resolution: "4MP",
 * });
 * ```
 */
export const imageGenerate = generateValidator as unknown as {
  <T extends ImageGenerateParams>(
    params: T & ExactKeys<T, ImageGenerateParams>,
    options?: ValidateOptions,
  ): Validated<T, BriaSdkTargets<T>>;
  safe<T extends ImageGenerateParams>(
    params: T & ExactKeys<T, ImageGenerateParams>,
    options?: ValidateOptions,
  ): ValidateResult<Validated<T, BriaSdkTargets<T>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};

const generateLiteValidator = createValidator<ImageGenerateLiteParams, unknown>({
  endpoint: "bria.imageGenerateLite",
  schema: generateLiteSchema,
  modelId: (params) => generateModelId(params, "FIBO-lite"),
  catalog: models,
  checks: [checkGenerateLite],
  estimate,
  finalize: finalizeFor(BRIA_IMAGE_GENERATE_LITE_URL),
});

/**
 * Validates params for
 * `POST https://engine.prod.bria-api.com/v2/image/generate/lite` (the
 * speed-optimized Fibo Lite pipeline: open-source FIBO-VLM bridge + Fibo Lite).
 *
 * Same body as `imageGenerate` minus `resolution`, `negative_prompt` and
 * `steps_num`, at $0.02 instead of $0.03 per image.
 *
 * ```ts
 * const params = bria.imageGenerateLite({ prompt: "a ring on a marble table" });
 * ```
 */
export const imageGenerateLite = generateLiteValidator as unknown as {
  <T extends ImageGenerateLiteParams>(
    params: T & ExactKeys<T, ImageGenerateLiteParams>,
    options?: ValidateOptions,
  ): Validated<T, BriaSdkTargets<T>>;
  safe<T extends ImageGenerateLiteParams>(
    params: T & ExactKeys<T, ImageGenerateLiteParams>,
    options?: ValidateOptions,
  ): ValidateResult<Validated<T, BriaSdkTargets<T>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
