/**
 * Bria FIBO image generation —
 *   POST https://engine.prod.bria-api.com/v2/image/generate       (full pipeline, Fibo 2)
 *   POST https://engine.prod.bria-api.com/v2/image/generate/lite   (Fibo Lite pipeline)
 *
 * Wire notes (verified 2026-11-12 against
 * https://docs.bria.ai/_bundle/image-generation.yaml — the bundled OpenAPI the
 * docs site serves — and https://docs.bria.ai/whats-new/fibo-2.md):
 * - Both routes are two-step: a VLM bridge turns your input into a
 *   `structured_prompt` (JSON) and the model renders that. You can skip the
 *   bridge by sending a `structured_prompt` of your own (e.g. from a previous
 *   response), which is how "recreate" and "refine" work.
 * - The documented input combinations are mutually exclusive: `prompt` |
 *   `images` | `images` + `prompt` | `structured_prompt` | `structured_prompt`
 *   + `prompt`. `images` + `structured_prompt` is NOT one of them, and at
 *   least one of the three must be present.
 * - `structured_prompt` is a JSON **string**, not an object.
 * - The two routes differ: `/image/generate` runs Fibo 2 ("Utilizes the Gemini
 *   2.5 Flash Bridge and Fibo 2." — https://docs.bria.ai/image-generation-overview.md)
 *   and takes 21 aspect ratios plus `resolution` (1MP/4MP), `style`,
 *   `negative_prompt` and `steps_num` (35–50); the lite route takes nine of
 *   the ratios and none of those four fields. Both share the
 *   async/moderation flags.
 * - Fibo 2's own limits on the full route, each a documented 422: the twelve
 *   ratios only it renders refuse 4MP, `prompt` + `structured_prompt` together and
 *   `images` without a `prompt`; `style` refuses `structured_prompt`, `images`
 *   and 4MP; and 4MP is async-only ("A synchronous 4MP request returns 422.").
 *   The spec also names `style_id`, a tailored-generation field the schema does
 *   not declare, so it has no rule here.
 * - The 2026-11-12 bundle does not list `model_version`, `negative_prompt`
 *   or `steps_num` on /v2/image/generate (nor `model_version` on lite), while
 *   Bria's Fibo 2 page says "Same API, nothing to change in your code." They
 *   stay typed, with their earlier bounds, until a keyed request settles
 *   whether the server still reads them.
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
  BRIA_FIBO2_ASPECT_RATIOS,
  BRIA_GENERATION_SPEC_URL,
  BRIA_LITE_ASPECT_RATIOS,
  BRIA_OUTPUT_TYPES,
  BRIA_RESOLUTIONS,
  BRIA_STYLES,
  checkBriaEnum,
  checkBriaImages,
  checkBriaIntegerRange,
  checkBriaWebhook,
  checkStructuredJsonString,
  type BriaAspectRatio,
  type BriaCommonParams,
  type BriaLiteAspectRatio,
  type BriaResolution,
  type BriaStyle,
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
}

export interface ImageGenerateParams extends BriaGenerateCommon {
  /**
   * Output aspect ratio. Default "1:1". CLOSED enum — the 21 values are the
   * OpenAPI `aspect_ratio` enum in full. The twelve only Fibo 2 renders ("16:10"
   * … "1:5", `BRIA_FIBO2_ASPECT_RATIOS`) return 422 with `resolution: "4MP"`,
   * with `prompt` + `structured_prompt` together, or with `images` and no
   * `prompt`.
   */
  aspect_ratio?: BriaAspectRatio;
  /**
   * Output resolution. "4MP" adds ~30s of latency and is async-only (a
   * request with `sync: true` returns 422). Default "1MP". CLOSED enum — the
   * OpenAPI `resolution` enum has exactly these two values.
   */
  resolution?: BriaResolution;
  /**
   * Photographic look Fibo 2 gives an image generated from a text `prompt`.
   * CLOSED enum. Returns 422 with `structured_prompt`, `images` or 4MP.
   */
  style?: BriaStyle;
  /** Concepts to exclude from the image. */
  negative_prompt?: string;
  /** Diffusion steps, 35–50. Default 50. */
  steps_num?: number;
}

/**
 * The lite route's body: nine aspect ratios, and no
 * `resolution`, `style`, `negative_prompt` or `steps_num`.
 */
export interface ImageGenerateLiteParams extends BriaGenerateCommon {
  /**
   * Output aspect ratio. Default "1:1". CLOSED enum — the lite route's
   * OpenAPI `aspect_ratio` enum is these nine values; Fibo 2's twelve extra
   * ratios are full-route only.
   */
  aspect_ratio?: BriaLiteAspectRatio;
  /** Full generate route only. */
  resolution?: never;
  /** Full generate route only. */
  style?: never;
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
  style: z.string().optional(),
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

/** `images` on both generate routes: "maxItems: 1", no minimum. */
const GENERATE_IMAGES_BOUNDS = { minItems: 0, maxItems: 1 } as const;

/** The twelve Fibo 2-only ratios, as a lookup for a caller's string. */
const FIBO2_RATIOS: ReadonlySet<string> = new Set<string>(BRIA_FIBO2_ASPECT_RATIOS);

function checkGenerateCommon(
  params: ImageGenerateParams | ImageGenerateLiteParams,
  ratios: readonly string[],
  ctx: PipelineContext,
  ratioNote = "",
): void {
  checkInputCombination(params, ctx);
  checkStructuredJsonString(ctx, "structured_prompt", params.structured_prompt, BRIA_GENERATION_SPEC_URL);
  checkBriaImages(ctx, params.images, BRIA_GENERATION_SPEC_URL, GENERATE_IMAGES_BOUNDS);
  checkBriaEnum(ctx, ["aspect_ratio"], params.aspect_ratio, ratios, BRIA_GENERATION_SPEC_URL, ratioNote);
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
  checkGenerateCommon(params, BRIA_ASPECT_RATIOS, ctx);
  checkBriaEnum(
    ctx,
    ["resolution"],
    params.resolution,
    BRIA_RESOLUTIONS,
    BRIA_GENERATION_SPEC_URL,
    ' "4MP" improves image details but adds ~30 seconds of latency.',
  );
  checkBriaEnum(ctx, ["style"], params.style, BRIA_STYLES, BRIA_GENERATION_SPEC_URL);
  checkBriaIntegerRange(
    ctx,
    ["steps_num"],
    params.steps_num,
    BRIA_GENERATE_STEPS_MIN,
    BRIA_GENERATE_STEPS_MAX,
    BRIA_GENERATION_SPEC_URL,
  );
  checkAsyncOnly4mp(params, ctx);
  checkStyleCombination(params, ctx);
  checkFibo2AspectRatio(params, ctx);
}

/**
 * "4MP is supported only on the asynchronous path, so it must be requested
 * with sync set to false (the default). A synchronous 4MP request returns
 * 422." — `resolution`, image-generation.yaml, read 2026-11-12.
 */
function checkAsyncOnly4mp(params: ImageGenerateParams, ctx: PipelineContext): void {
  if (params.resolution !== "4MP" || params.sync !== true) return;
  ctx.report({
    code: "invalid_shape",
    path: ["sync"],
    message:
      '`resolution: "4MP"` is served on the asynchronous path only — a synchronous 4MP request returns 422. Drop `sync: true` (the default `false` answers 202 with a `status_url` to poll), or request "1MP" synchronously.',
    meta: { source: BRIA_GENERATION_SPEC_URL },
  });
}

/**
 * `style` "Returns 422 with `style_id`, `structured_prompt`, `images` or 4MP
 * resolution." — `style`, image-generation.yaml, read 2026-11-12. ("A style
 * applies to generation from a text prompt, so it doesn't combine with
 * `structured_prompt` or reference images." — whats-new/fibo-2.md.)
 * `style_id` is not a declared field, so it has no arm here.
 */
function checkStyleCombination(params: ImageGenerateParams, ctx: PipelineContext): void {
  if (params.style == null) return;
  const conflicts: string[] = [];
  if (params.structured_prompt != null) conflicts.push("`structured_prompt`");
  if (hasReferenceImages(params.images)) conflicts.push("`images`");
  if (params.resolution === "4MP") conflicts.push('`resolution: "4MP"`');
  if (conflicts.length === 0) return;
  ctx.report({
    code: "invalid_shape",
    path: ["style"],
    message: `\`style\` applies to generation from a text \`prompt\` at 1MP; Bria returns 422 when it is combined with ${conflicts.join(" or ")}. Send \`style\` with a \`prompt\` alone, or drop it.`,
    meta: { value: params.style, source: BRIA_GENERATION_SPEC_URL },
  });
}

/**
 * The twelve ratios Fibo 2 added "return 422 on a request it doesn't serve
 * (4MP, `style_id`, a refinement with both `prompt` and a structured prompt,
 * or reference images without a prompt)" — `aspect_ratio`,
 * image-generation.yaml, read 2026-11-12. `style_id` is not a declared field,
 * so it has no arm here.
 */
function checkFibo2AspectRatio(params: ImageGenerateParams, ctx: PipelineContext): void {
  const ratio = params.aspect_ratio;
  if (ratio == null || !FIBO2_RATIOS.has(ratio)) return;
  const conflicts: string[] = [];
  if (params.resolution === "4MP") conflicts.push('`resolution: "4MP"`');
  if (params.prompt != null && params.structured_prompt != null) {
    conflicts.push("a refinement with both `prompt` and `structured_prompt`");
  }
  if (hasReferenceImages(params.images) && params.prompt == null) {
    conflicts.push("`images` without a `prompt`");
  }
  if (conflicts.length === 0) return;
  ctx.report({
    code: "invalid_shape",
    path: ["aspect_ratio"],
    message:
      `\`aspect_ratio: "${ratio}"\` is one of the twelve ratios only Fibo 2 renders, and Bria returns 422 for it with ${conflicts.join(" or ")}. ` +
      `Drop the conflicting field, or use one of the nine ratios every request takes: ${BRIA_LITE_ASPECT_RATIOS.join(", ")}.`,
    meta: { value: ratio, allowed: [...BRIA_LITE_ASPECT_RATIOS], source: BRIA_GENERATION_SPEC_URL },
  });
}

function hasReferenceImages(images: unknown): boolean {
  return Array.isArray(images) && images.length > 0;
}

function checkGenerateLite(
  params: ImageGenerateLiteParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  checkGenerateCommon(
    params,
    BRIA_LITE_ASPECT_RATIOS,
    ctx,
    ` The twelve Fibo 2 ratios (${BRIA_FIBO2_ASPECT_RATIOS.join(", ")}) are served by POST /v2/image/generate only.`,
  );
  const record = params as Record<string, unknown>;
  for (const param of ["resolution", "style", "negative_prompt", "steps_num"] as const) {
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
  endpoint: "bria.image",
  schema: generateSchema,
  modelId: (params) => generateModelId(params, "FIBO"),
  catalog: models,
  checks: [checkGenerate],
  estimate,
  finalize: finalizeFor(BRIA_IMAGE_GENERATE_URL),
});

/**
 * Validates params for `POST https://engine.prod.bria-api.com/v2/image/generate`
 * (Bria's full pipeline: Gemini 2.5 Flash VLM bridge + Fibo 2).
 *
 * The returned object's enumerable props are the exact fetch JSON body. The
 * call is asynchronous unless you pass `sync: true` — the 202 response carries
 * a `status_url` to poll (transport, out of unmodel's scope). Auth is your
 * job: add an `api_token` header when fetching.
 *
 * ```ts
 * const params = bria.image({
 *   prompt: "a photorealistic rendering of balloon lettering on a white backdrop",
 *   aspect_ratio: "16:9",
 *   resolution: "4MP",
 * });
 * ```
 */
export const image = generateValidator as unknown as {
  <T extends ImageGenerateParams>(
    params: T & ExactKeys<T, ImageGenerateParams>,
    options?: ValidateOptions<T>,
  ): Validated<T, BriaSdkTargets<T>>;
  safe<T extends ImageGenerateParams>(
    params: T & ExactKeys<T, ImageGenerateParams>,
    options?: ValidateOptions<T>,
  ): ValidateResult<Validated<T, BriaSdkTargets<T>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};

const generateLiteValidator = createValidator<ImageGenerateLiteParams, unknown>({
  endpoint: "bria.imageLite",
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
 * Same body as `image` minus `resolution`, `style`, `negative_prompt` and
 * `steps_num`, and with nine aspect ratios rather than Fibo 2's 21, at $0.0288
 * instead of $0.032 per image.
 *
 * ```ts
 * const params = bria.imageLite({ prompt: "a ring on a marble table" });
 * ```
 */
export const imageLite = generateLiteValidator as unknown as {
  <T extends ImageGenerateLiteParams>(
    params: T & ExactKeys<T, ImageGenerateLiteParams>,
    options?: ValidateOptions<T>,
  ): Validated<T, BriaSdkTargets<T>>;
  safe<T extends ImageGenerateLiteParams>(
    params: T & ExactKeys<T, ImageGenerateLiteParams>,
    options?: ValidateOptions<T>,
  ): ValidateResult<Validated<T, BriaSdkTargets<T>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
