/**
 * Black Forest Labs FLUX.1 Tools editing —
 * POST https://api.bfl.ai/v1/flux-pro-1.0-fill (inpainting, + the
 * `-finetuned` variant) and POST https://api.bfl.ai/v1/flux-pro-1.0-expand
 * (border expansion / outpainting).
 *
 * Wire notes (verified against https://api.bfl.ai/openapi.json and
 * https://docs.bfl.ml/flux_1_fill on 2026-08-13):
 * - Route-is-the-model, like every other BFL endpoint: `model` is a
 *   pseudo-param, STRIPPED from the wire body and interpolated into
 *   `.request.url`.
 * - Both schemas (FluxProFillInputs / FluxProExpandInputs) differ from the
 *   generation routes in three ways worth typing: `image` is REQUIRED, `steps`
 *   starts at 15 (not 1), and `guidance` runs 1.5–100 with a default of 60
 *   (the generation routes cap guidance at 5 or 10). Copying the generation
 *   bounds here would reject valid requests.
 * - `fill` takes an optional `mask` (black = keep, white = inpaint; must match
 *   the image's dimensions — a rule the API validates server-side and unmodel
 *   cannot check from a base64 string). `expand` takes per-side pixel margins
 *   `top`/`bottom`/`left`/`right`, each 0–2048.
 * - `safety_tolerance` is 0–6 on these routes (FLUX.2 caps it at 5).
 * - ASYNC-JOB API: the POST returns `{ id, polling_url }`; polling
 *   `GET /v1/get_result` is transport — out of scope.
 * - Auth is an `x-key` header — unmodel never touches keys.
 */

import { z } from "zod";
import { createValidator, type PipelineContext } from "../../core/pipeline";
import { toValidated, JSON_HEADERS, type Validated, type ExactKeys } from "../../core/request";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";
import type { ModelInfo } from "../../core/catalog-types";
import type { EndpointConstraints } from "../../core/constraint-types";
import { models } from "./models";
import { bflModelUrl, BFL_OUTPUT_FORMATS, type BflOutputFormat } from "./image";

const OPENAPI_URL = "https://api.bfl.ai/openapi.json";
const FILL_SCHEMA_URL = `${OPENAPI_URL}#/components/schemas/FluxProFillInputs`;
const EXPAND_SCHEMA_URL = `${OPENAPI_URL}#/components/schemas/FluxProExpandInputs`;

/** Max pixels `expand` will add on any one side (FluxProExpandInputs). */
export const FLUX_EXPAND_MAX_PIXELS = 2048;

// ---------------------------------------------------------------------------
// Shared fields (FluxProFillInputs ∩ FluxProExpandInputs).
// ---------------------------------------------------------------------------

interface FluxEditCoreFields {
  /** Base64-encoded image to modify. REQUIRED. */
  image: string;
  /** Description of the changes you want. Defaults to "" server-side. */
  prompt?: string | null;
  /** Steps for the generation process, 15–50. Default 50. */
  steps?: number | null;
  /** Automatically embellish the prompt. Default false. */
  prompt_upsampling?: boolean | null;
  /** Optional seed for reproducibility. */
  seed?: number | null;
  /** Guidance strength, 1.5–100 on the editing routes. Default 60. */
  guidance?: number | null;
  /** Output image format. Default "jpeg". */
  output_format?: BflOutputFormat | null;
  /** Moderation strictness 0 (strictest) – 6 (least strict). Default 2. */
  safety_tolerance?: number;
  /** URL (1–2083 chars) to receive the async result instead of polling. */
  webhook_url?: string | null;
  /** Secret for webhook signature verification. */
  webhook_secret?: string | null;
}

// ---------------------------------------------------------------------------
// Fill (inpainting)
// ---------------------------------------------------------------------------

interface FluxFillFields extends FluxEditCoreFields {
  /**
   * Base64 black/white mask the same size as `image`: black (0%) keeps the
   * pixel, white (100%) marks it for inpainting. Optional when `image`
   * carries an alpha mask.
   */
  mask?: string | null;
}

export interface FluxFillBody extends FluxFillFields {
  model: "flux-pro-1.0-fill";
  /** Only the `-finetuned` route takes a LoRA id. */
  finetune_id?: never;
  /** Only the `-finetuned` route takes a LoRA strength. */
  finetune_strength?: never;
}

export interface FluxFillFinetunedBody extends FluxFillFields {
  model: "flux-pro-1.0-fill-finetuned";
  /** REQUIRED. LoRA name, or "org-id/lora-name" for a shared LoRA. */
  finetune_id: string;
  /** LoRA influence, 0–2. Default 1.1. */
  finetune_strength?: number;
}

/** Escape hatch for fill-like routes unmodel doesn't know yet. */
export interface UnknownFluxFillBody {
  model: string & {};
  image: string;
  [key: string]: unknown;
}

export type FluxFillParams = FluxFillBody | FluxFillFinetunedBody | UnknownFluxFillBody;

interface FluxFillBodyByModel {
  "flux-pro-1.0-fill": FluxFillBody;
  "flux-pro-1.0-fill-finetuned": FluxFillFinetunedBody;
}

type FluxFillArm<M extends string> = M extends keyof FluxFillBodyByModel
  ? FluxFillBodyByModel[M]
  : UnknownFluxFillBody;

// ---------------------------------------------------------------------------
// Expand (outpainting by per-side margins)
// ---------------------------------------------------------------------------

export interface FluxExpandParams extends FluxEditCoreFields {
  /** Route selector — stripped from the wire body. */
  model?: "flux-pro-1.0-expand" | (string & {});
  /** Pixels to add at the top, 0–2048. Default 0. */
  top?: number | null;
  /** Pixels to add at the bottom, 0–2048. Default 0. */
  bottom?: number | null;
  /** Pixels to add on the left, 0–2048. Default 0. */
  left?: number | null;
  /** Pixels to add on the right, 0–2048. Default 0. */
  right?: number | null;
}

// ---------------------------------------------------------------------------
// Schemas (loose: unknown keys pass through with a warning).
// ---------------------------------------------------------------------------

const editCoreShape = {
  image: z.string().min(1, "image is required"),
  prompt: z.string().nullable().optional(),
  steps: z
    .number()
    .int()
    .min(15, "steps must be between 15 and 50 on the editing routes")
    .max(50, "steps must be between 15 and 50 on the editing routes")
    .nullable()
    .optional(),
  prompt_upsampling: z.boolean().nullable().optional(),
  seed: z.number().int().nullable().optional(),
  guidance: z
    .number()
    .min(1.5, "guidance must be between 1.5 and 100 on the editing routes")
    .max(100, "guidance must be between 1.5 and 100 on the editing routes")
    .nullable()
    .optional(),
  output_format: z.enum(BFL_OUTPUT_FORMATS).nullable().optional(),
  safety_tolerance: z.number().int().min(0).max(6).optional(),
  webhook_url: z.string().min(1).max(2083).nullable().optional(),
  webhook_secret: z.string().nullable().optional(),
};

const fillSchema = z.looseObject({
  ...editCoreShape,
  model: z.string(),
  mask: z.string().nullable().optional(),
  finetune_id: z.string().optional(),
  finetune_strength: z.number().min(0).max(2).optional(),
});

const expandMargin = z
  .number()
  .int()
  .min(0, `expansion must be between 0 and ${FLUX_EXPAND_MAX_PIXELS} pixels`)
  .max(FLUX_EXPAND_MAX_PIXELS, `expansion must be between 0 and ${FLUX_EXPAND_MAX_PIXELS} pixels`)
  .nullable()
  .optional();

const expandSchema = z.looseObject({
  ...editCoreShape,
  model: z.string().optional(),
  top: expandMargin,
  bottom: expandMargin,
  left: expandMargin,
  right: expandMargin,
});

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

/** `finetune_id` is required on the `-finetuned` fill route. */
function checkFillFinetuneId(
  params: FluxFillParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (!params.model.endsWith("-finetuned")) return;
  if ((params as { finetune_id?: unknown }).finetune_id != null) return;
  ctx.report({
    code: "invalid_shape",
    path: ["finetune_id"],
    model: params.model,
    message: `\`finetune_id\` is required by "${params.model}".`,
    meta: { source: `${OPENAPI_URL}#/components/schemas/FinetuneFluxProFillInputs` },
  });
}

/**
 * `finetune_id`/`finetune_strength` belong to the finetuned route only —
 * denied here rather than in a constraint table because the base fill route
 * is one of only two arms and the message reads better with the alternative
 * route named.
 */
function checkFillFinetuneUnsupported(
  params: FluxFillParams,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (info === undefined || params.model.endsWith("-finetuned")) return;
  for (const field of ["finetune_id", "finetune_strength"] as const) {
    if ((params as Record<string, unknown>)[field] == null) continue;
    ctx.report({
      code: "unsupported_param",
      path: [field],
      model: params.model,
      message: `\`${field}\` is not supported by "${params.model}": LoRA params only exist on the flux-pro-1.0-fill-finetuned route (FinetuneFluxProFillInputs).`,
      meta: { source: FILL_SCHEMA_URL },
    });
  }
}

/** At least one side must be expanded, else the request is a no-op. */
function checkExpandDirections(
  params: FluxExpandParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const total =
    (params.top ?? 0) + (params.bottom ?? 0) + (params.left ?? 0) + (params.right ?? 0);
  if (total > 0) return;
  ctx.report({
    code: "invalid_shape",
    path: ["top"],
    message:
      "at least one of `top`, `bottom`, `left`, `right` must be a non-zero number of pixels to expand.",
    meta: { source: EXPAND_SCHEMA_URL },
  });
}

// ---------------------------------------------------------------------------
// Estimation — flat per-image credit pricing (models.ts).
// ---------------------------------------------------------------------------

function estimate(_params: unknown, info: ModelInfo | undefined) {
  const perImage = info?.cost?.perImage;
  return perImage === undefined ? {} : { costUSD: perImage };
}

/** The only expand route BFL documents; used when `model` is omitted. */
export const DEFAULT_EXPAND_MODEL_ID = "flux-pro-1.0-expand";

/**
 * The one `.toSdk("black-forest-labs")` target for this endpoint — BFL ships
 * no official JS SDK, so this is the wire body. Derived from the `sdk`
 * literal in `finalize`; it must stay an object type with no index
 * signature, or `toSdk` would accept any string.
 */
type BflSdkTargets<B> = { "black-forest-labs": () => B };

function finalize(params: { model?: string }): unknown {
  const { model, ...body } = params;
  return toValidated(body, {
    url: bflModelUrl(model ?? DEFAULT_EXPAND_MODEL_ID),
    method: "POST",
    headers: JSON_HEADERS,
  }, {
    sdk: { "black-forest-labs": () => body },
  });
}

const fillValidator = createValidator<FluxFillParams, unknown>({
  endpoint: "black-forest-labs.fluxFill",
  schema: fillSchema,
  modelId: (params) => params.model,
  catalog: models,
  checks: [checkFillFinetuneId, checkFillFinetuneUnsupported],
  estimate,
  finalize,
});

const expandValidator = createValidator<FluxExpandParams, unknown>({
  endpoint: "black-forest-labs.fluxExpand",
  schema: expandSchema,
  modelId: (params) => params.model ?? DEFAULT_EXPAND_MODEL_ID,
  catalog: models,
  checks: [checkExpandDirections],
  estimate,
  finalize,
});

/**
 * Validates submit params for FLUX.1 Fill [pro] inpainting
 * (`POST https://api.bfl.ai/v1/flux-pro-1.0-fill` and its `-finetuned`
 * variant, 5 credits ≈ $0.05 per image).
 *
 * `model` is a route selector, stripped from the body and interpolated into
 * `.request.url`; `.toSdk("black-forest-labs")` returns the wire body unchanged (BFL ships no
 * official JS SDK). The POST returns an async job (`{ id, polling_url }`) —
 * poll `BFL_GET_RESULT_URL`. Auth is your job: add an `x-key` header.
 *
 * ```ts
 * const params = blackForestLabs.fluxFill({
 *   model: "flux-pro-1.0-fill",
 *   image: imageBase64,
 *   mask: maskBase64,
 *   prompt: "a bunch of sunflowers in the vase",
 * });
 * ```
 */
export const fluxFill = fillValidator as unknown as {
  <M extends FluxFillParams["model"], T extends FluxFillArm<M>>(
    params: T & FluxFillArm<M> & { model: M } & ExactKeys<T, FluxFillArm<M>>,
    options?: ValidateOptions,
  ): Validated<Omit<T, "model">, BflSdkTargets<Omit<T, "model">>>;
  safe<M extends FluxFillParams["model"], T extends FluxFillArm<M>>(
    params: T & FluxFillArm<M> & { model: M } & ExactKeys<T, FluxFillArm<M>>,
    options?: ValidateOptions,
  ): ValidateResult<Validated<Omit<T, "model">, BflSdkTargets<Omit<T, "model">>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};

/**
 * Validates submit params for FLUX.1 Expand [pro]
 * (`POST https://api.bfl.ai/v1/flux-pro-1.0-expand`) — outpainting by adding
 * pixels on any combination of sides (each side 0–2048).
 *
 * `model` is optional (there is one expand route); it is stripped from the
 * body and interpolated into `.request.url`. The route has no published
 * price, so no cost is estimated. Auth is your job: add an `x-key` header.
 */
export const fluxExpand = expandValidator as unknown as {
  <T extends FluxExpandParams>(
    params: T & ExactKeys<T, FluxExpandParams>,
    options?: ValidateOptions,
  ): Validated<Omit<T, "model">, BflSdkTargets<Omit<T, "model">>>;
  safe<T extends FluxExpandParams>(
    params: T & ExactKeys<T, FluxExpandParams>,
    options?: ValidateOptions,
  ): ValidateResult<Validated<Omit<T, "model">, BflSdkTargets<Omit<T, "model">>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
