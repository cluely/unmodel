/**
 * Black Forest Labs FLUX.1 (previous-generation) text-to-image —
 * POST https://api.bfl.ai/v1/{model} for
 * `flux-pro-1.1`, `flux-pro-1.1-ultra`, `flux-pro-1.1-ultra-finetuned` and
 * `flux-dev`.
 *
 * Wire notes (verified against https://api.bfl.ai/openapi.json and
 * https://docs.bfl.ml/llms.txt on 2026-08-13):
 * - Same route-is-the-model shape as image()/imageEdit(): `model` is a
 *   pseudo-param, STRIPPED from the wire body and interpolated into
 *   `.request.url`.
 * - The four routes take THREE different Pydantic schemas, which is why they
 *   are Tier-A arms rather than one flat interface:
 *     FluxPro11Inputs  (flux-pro-1.1)      width/height, no steps/guidance
 *     FluxDevInputs    (flux-dev)          width/height + steps + guidance 1.5–5
 *     FluxUltraInput   (flux-pro-1.1-ultra) aspect_ratio + raw +
 *                                          image_prompt_strength, NO width/height
 *     FinetuneFluxUltraInput (…-finetuned) FluxUltraInput + finetune_id/strength
 * - `width`/`height` on the two width/height routes are documented as
 *   "multiple of 32", 256–1440 — enforced at runtime (the multiple-of rule is
 *   not expressible in the wire type).
 * - `safety_tolerance` is 0–6 on all four routes (FLUX.2 caps it at 5).
 * - `guidance` differs per route: 1.5–5 on flux-dev (FLUX.2 [flex] uses 1.5–10).
 * - ASYNC-JOB API: the POST returns `{ id, polling_url }`; polling
 *   `GET https://api.bfl.ai/v1/get_result?id=…` is transport — out of scope.
 * - Auth is an `x-key` header — unmodel never touches keys.
 */

import { z } from "zod";
import { createValidator, type PipelineContext } from "../../core/pipeline";
import { toValidated, JSON_HEADERS, type Validated, type ExactKeys } from "../../core/request";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";
import type { FutureModelId, ModelInfo } from "../../core/catalog-types";
import type { EndpointConstraints } from "../../core/constraint-types";
import { models } from "./models";
import { bflModelUrl, BFL_OUTPUT_FORMATS, type BflOutputFormat } from "./image";
import { checkAspectRatioRange, type BflAspectRatio } from "./aspect";
import { imageFlux1Constraints } from "./constraints";

const OPENAPI_URL = "https://api.bfl.ai/openapi.json";
const ULTRA_SCHEMA_URL = `${OPENAPI_URL}#/components/schemas/FluxUltraInput`;

/** `width`/`height` bounds shared by FluxPro11Inputs and FluxDevInputs. */
export const FLUX1_DIMENSION_MULTIPLE = 32;
export const FLUX1_MIN_DIMENSION = 256;
export const FLUX1_MAX_DIMENSION = 1440;

// ---------------------------------------------------------------------------
// Wire types — one Tier-A arm per route schema. Params a route's schema does
// not declare are typed `never` so they fail at compile time.
// ---------------------------------------------------------------------------

interface Flux1CoreFields {
  /** Text prompt for image generation. Defaults to "" server-side. */
  prompt?: string | null;
  /** Optional base64-encoded image (Flux Redux / remix input). */
  image_prompt?: string | null;
  /** Optional seed for reproducibility. */
  seed?: number | null;
  /** Automatically embellish the prompt. Default false. */
  prompt_upsampling?: boolean;
  /** Moderation strictness 0 (strictest) – 6 (least strict). Default 2. */
  safety_tolerance?: number;
  /** Output image format. Default "jpeg". */
  output_format?: BflOutputFormat | null;
  /** URL (1–2083 chars) to receive the async result instead of polling. */
  webhook_url?: string | null;
  /** Secret for webhook signature verification. */
  webhook_secret?: string | null;
}

/** Fields the two width/height routes reject (they size by pixels). */
interface NoUltraFields {
  /** flux-pro-1.1-ultra only — the width/height routes size by pixels. */
  aspect_ratio?: never;
  /** flux-pro-1.1-ultra only. */
  raw?: never;
  /** flux-pro-1.1-ultra only. */
  image_prompt_strength?: never;
  /** Only the `-finetuned` routes take a LoRA id. */
  finetune_id?: never;
  /** Only the `-finetuned` routes take a LoRA strength. */
  finetune_strength?: never;
}

export interface FluxPro11Body extends Flux1CoreFields, NoUltraFields {
  model: "flux-pro-1.1";
  /** Width in pixels: multiple of 32, 256–1440. Default 1024. */
  width?: number;
  /** Height in pixels: multiple of 32, 256–1440. Default 768. */
  height?: number;
  /** flux-dev only. */
  steps?: never;
  /** flux-dev only. */
  guidance?: never;
}

export interface FluxDevBody extends Flux1CoreFields, NoUltraFields {
  model: "flux-dev";
  /** Width in pixels: multiple of 32, 256–1440. Default 1024. */
  width?: number;
  /** Height in pixels: multiple of 32, 256–1440. Default 768. */
  height?: number;
  /** Generation steps, 1–50. Default 28. */
  steps?: number | null;
  /** Guidance scale, 1.5–5 on flux-dev. Default 3. */
  guidance?: number | null;
}

interface FluxUltraFields extends Flux1CoreFields {
  /** Aspect ratio "W:H", between 21:9 and 9:21. Default "16:9". */
  aspect_ratio?: BflAspectRatio;
  /** Generate less processed, more natural-looking images. Default false. */
  raw?: boolean;
  /** Blend between the prompt and `image_prompt`, 0–1. Default 0.1. */
  image_prompt_strength?: number;
  /** The ultra route sizes by aspect_ratio, not pixels. */
  width?: never;
  /** The ultra route sizes by aspect_ratio, not pixels. */
  height?: never;
  /** flux-dev only. */
  steps?: never;
  /** flux-dev only. */
  guidance?: never;
}

export interface FluxUltraBody extends FluxUltraFields {
  model: "flux-pro-1.1-ultra";
  /** Only the `-finetuned` route takes a LoRA id. */
  finetune_id?: never;
  /** Only the `-finetuned` route takes a LoRA strength. */
  finetune_strength?: never;
}

export interface FluxUltraFinetunedBody extends FluxUltraFields {
  model: "flux-pro-1.1-ultra-finetuned";
  /** REQUIRED. LoRA name, or "org-id/lora-name" for a shared LoRA. */
  finetune_id: string;
  /** LoRA influence, 0–2. Default 1.2. */
  finetune_strength?: number;
}

/** Escape hatch for routes unmodel doesn't know yet (unknown_model warning). */
export interface UnknownFlux1ModelBody<Model extends string> {
  model: FutureModelId<Model, keyof Flux1BodyByModel>;
  [key: string]: unknown;
}

/**
 * Closed over documented routes by default. Supply a future route literal to
 * opt into the loose arm: `Flux1Body<"flux-pro-2">`.
 */
export type Flux1Body<FutureModel extends string = never> =
  | FluxPro11Body
  | FluxDevBody
  | FluxUltraBody
  | FluxUltraFinetunedBody
  | UnknownFlux1ModelBody<FutureModel>;

interface Flux1BodyByModel {
  "flux-pro-1.1": FluxPro11Body;
  "flux-dev": FluxDevBody;
  "flux-pro-1.1-ultra": FluxUltraBody;
  "flux-pro-1.1-ultra-finetuned": FluxUltraFinetunedBody;
}

/** Resolves a model id literal to its exact Tier-A arm. */
type Flux1Arm<M extends string> = M extends keyof Flux1BodyByModel
  ? Flux1BodyByModel[M]
  : UnknownFlux1ModelBody<M>;

/** Runtime implementation type; the public alias stays closed by default. */
type AnyFlux1Body = Flux1Body<string>;
type Flux1ModelInput = keyof Flux1BodyByModel | (string & {});

// ---------------------------------------------------------------------------
// Schema — union of every param any FLUX.1 route accepts; per-route narrowing
// happens in constraints.ts (runtime) and the Tier-A arms (types).
// ---------------------------------------------------------------------------

const flux1Schema = z.looseObject({
  model: z.string(),
  prompt: z.string().nullable().optional(),
  image_prompt: z.string().nullable().optional(),
  image_prompt_strength: z.number().min(0).max(1).optional(),
  seed: z.number().int().nullable().optional(),
  width: z
    .number()
    .int()
    .min(FLUX1_MIN_DIMENSION, `width must be between ${FLUX1_MIN_DIMENSION} and ${FLUX1_MAX_DIMENSION}`)
    .max(FLUX1_MAX_DIMENSION, `width must be between ${FLUX1_MIN_DIMENSION} and ${FLUX1_MAX_DIMENSION}`)
    .optional(),
  height: z
    .number()
    .int()
    .min(FLUX1_MIN_DIMENSION, `height must be between ${FLUX1_MIN_DIMENSION} and ${FLUX1_MAX_DIMENSION}`)
    .max(FLUX1_MAX_DIMENSION, `height must be between ${FLUX1_MIN_DIMENSION} and ${FLUX1_MAX_DIMENSION}`)
    .optional(),
  steps: z.number().int().min(1).max(50).nullable().optional(),
  // flux-dev caps guidance at 5; the wider 1.5–10 bound belongs to FLUX.2
  // [flex]. Enforced per-route by the flux-dev arm below.
  guidance: z.number().min(1.5).max(5).nullable().optional(),
  aspect_ratio: z.string().optional(),
  raw: z.boolean().optional(),
  prompt_upsampling: z.boolean().optional(),
  safety_tolerance: z.number().int().min(0).max(6).optional(),
  output_format: z.enum(BFL_OUTPUT_FORMATS).nullable().optional(),
  finetune_id: z.string().optional(),
  finetune_strength: z.number().min(0).max(2).optional(),
  webhook_url: z.string().min(1).max(2083).nullable().optional(),
  webhook_secret: z.string().nullable().optional(),
});

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

function checkAspectRatio(
  params: AnyFlux1Body,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const ratio = (params as { aspect_ratio?: unknown }).aspect_ratio;
  if (typeof ratio !== "string" && ratio != null) return;
  checkAspectRatioRange({ ratio, model: params.model, source: ULTRA_SCHEMA_URL, ctx });
}

/** `width`/`height` "must be a multiple of 32" (FluxPro11Inputs/FluxDevInputs). */
function checkDimensionMultiple(
  params: AnyFlux1Body,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  for (const field of ["width", "height"] as const) {
    const value = (params as Record<string, unknown>)[field];
    if (typeof value !== "number") continue;
    if (value % FLUX1_DIMENSION_MULTIPLE === 0) continue;
    ctx.report({
      code: "invalid_shape",
      path: [field],
      model: params.model,
      message: `\`${field}\` must be a multiple of ${FLUX1_DIMENSION_MULTIPLE}; got ${value}.`,
      meta: {
        value,
        multipleOf: FLUX1_DIMENSION_MULTIPLE,
        source: `${OPENAPI_URL}#/components/schemas/FluxPro11Inputs`,
      },
    });
  }
}

/** `finetune_id` is required on the `-finetuned` routes. */
function checkFinetuneId(
  params: AnyFlux1Body,
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
    meta: { source: `${OPENAPI_URL}#/components/schemas/FinetuneFluxUltraInput` },
  });
}

// ---------------------------------------------------------------------------
// Estimation — FLUX.1 is flat per-image credit pricing (models.ts).
// ---------------------------------------------------------------------------

function estimate(_params: AnyFlux1Body, info: ModelInfo | undefined) {
  const perImage = info?.cost?.perImage;
  return perImage === undefined ? {} : { costUSD: perImage };
}

/**
 * The one `.toSdk("black-forest-labs")` target for this endpoint — BFL ships
 * no official JS SDK, so this is the wire body. Derived from the `sdk`
 * literal in `finalize`; it must stay an object type with no index
 * signature, or `toSdk` would accept any string.
 */
type BflSdkTargets<B> = { "black-forest-labs": () => B };

function finalize(params: AnyFlux1Body): unknown {
  const { model, ...body } = params;
  return toValidated(body, {
    url: bflModelUrl(model),
    method: "POST",
    headers: JSON_HEADERS,
  }, {
    sdk: { "black-forest-labs": () => body },
  });
}

const validator = createValidator<AnyFlux1Body, unknown>({
  endpoint: "black-forest-labs.imageFlux1",
  schema: flux1Schema,
  modelId: (params) => params.model,
  catalog: models,
  constraints: imageFlux1Constraints,
  checks: [checkAspectRatio, checkDimensionMultiple, checkFinetuneId],
  estimate,
  finalize,
});

/**
 * Validates submit params for the previous-generation FLUX.1 text-to-image
 * routes (`POST https://api.bfl.ai/v1/flux-pro-1.1`, `/flux-pro-1.1-ultra`,
 * `/flux-pro-1.1-ultra-finetuned`, `/flux-dev`). Known models get their exact
 * per-route param surface at compile time (e.g. `aspect_ratio` is a compile
 * error for flux-pro-1.1, `width` is a compile error for the ultra routes);
 * unknown models fall back to a loose arm with an unknown_model warning.
 *
 * The returned object's enumerable props are the exact fetch JSON body —
 * `model` is a route selector, stripped from the body and interpolated into
 * `.request.url`. BFL has no official JS SDK, so `.toSdk("black-forest-labs")` returns the wire
 * body unchanged. The POST returns an async job (`{ id, polling_url }`) —
 * poll `BFL_GET_RESULT_URL` (transport, out of unmodel's scope). Auth is your
 * job: add an `x-key` header when fetching.
 *
 * ```ts
 * const params = blackForestLabs.imageFlux1({
 *   model: "flux-pro-1.1",
 *   prompt: "a lighthouse in a storm",
 *   width: 1024,
 *   height: 768,
 * });
 * ```
 */
export const imageFlux1 = validator as unknown as {
  <M extends Flux1ModelInput, T extends Flux1Arm<M>>(
    params: T & Flux1Arm<M> & { model: M } & ExactKeys<T, Flux1Arm<M>>,
    options?: ValidateOptions<T>,
  ): Validated<Omit<T, "model">, BflSdkTargets<Omit<T, "model">>>;
  safe<M extends Flux1ModelInput, T extends Flux1Arm<M>>(
    params: T & Flux1Arm<M> & { model: M } & ExactKeys<T, Flux1Arm<M>>,
    options?: ValidateOptions<T>,
  ): ValidateResult<Validated<Omit<T, "model">, BflSdkTargets<Omit<T, "model">>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
