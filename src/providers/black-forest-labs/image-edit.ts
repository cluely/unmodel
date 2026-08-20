/**
 * Black Forest Labs FLUX.1 Kontext — POST https://api.bfl.ai/v1/{model}
 * (flux-kontext-pro, flux-kontext-max)
 *
 * Wire notes (verified against https://api.bfl.ai/openapi.json and
 * https://docs.bfl.ml on 2026-08-13):
 * - Kontext is BFL's image-editing family: text-to-image OR image editing via
 *   base64/URL `input_image` (plus experimental multiref `input_image_2..4`).
 *   Both routes share one input schema (FluxKontextProInputs), so a single
 *   `imageEdit()` endpoint fn discriminated on `model` mirrors the API; the
 *   `model` pseudo-param is STRIPPED from the wire body and interpolated into
 *   `.request.url` (the model is the route on this API).
 * - Kontext differs from the FLUX.2 routes: sizing is `aspect_ratio`
 *   (21:9 … 9:21) instead of width/height, upsampling is `prompt_upsampling`
 *   (default false), `safety_tolerance` ranges 0–6 (not 0–5), and
 *   `output_format` defaults to "png" (not "jpeg").
 * - ASYNC-JOB API: the POST returns `{ id, polling_url }`; polling
 *   `GET https://api.bfl.ai/v1/get_result?id=…` is transport — out of scope.
 * - Auth is an `x-key` header — unmodel never touches keys.
 */

import { z } from "zod";
import { createValidator, type PipelineContext } from "../../core/pipeline";
import { toValidated, JSON_HEADERS, type Validated, type ExactKeys } from "../../core/request";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";
import type { ModelInfo } from "../../core/catalog-types";
import type { EndpointConstraints } from "../../core/constraint-types";
import { models, type BflKontextModelId } from "./models";
import { bflModelUrl, BFL_OUTPUT_FORMATS, type BflOutputFormat } from "./image";
import { checkAspectRatioRange, type BflAspectRatio } from "./aspect";

const KONTEXT_SCHEMA_URL = "https://api.bfl.ai/openapi.json#/components/schemas/FluxKontextProInputs";

// ---------------------------------------------------------------------------
// Wire types — mirror FluxKontextProInputs exactly (both kontext routes share
// it). `model` is the route selector, stripped from the wire body.
// ---------------------------------------------------------------------------

export interface FluxKontextParams {
  /**
   * Route selector — stripped from the wire body; `.request.url` is
   * `https://api.bfl.ai/v1/{model}`.
   */
  model: BflKontextModelId | (string & {});
  /** Text prompt for image generation/editing. */
  prompt: string;
  /** Base64-encoded image or URL to edit. */
  input_image?: string | null;
  /** Base64/URL — *Experimental Multiref*. */
  input_image_2?: string | null;
  /** Base64/URL — *Experimental Multiref*. */
  input_image_3?: string | null;
  /** Base64/URL — *Experimental Multiref*. */
  input_image_4?: string | null;
  /** Optional seed for reproducibility. */
  seed?: number | null;
  /** Aspect ratio "W:H", between 21:9 and 9:21 (e.g. "16:9"). */
  aspect_ratio?: BflAspectRatio | null;
  /** Output image format. Default "png" on kontext routes. */
  output_format?: BflOutputFormat | null;
  /** URL (1–2083 chars) to receive the async result instead of polling. */
  webhook_url?: string | null;
  /** Secret for webhook signature verification. */
  webhook_secret?: string | null;
  /** Automatically embellish the prompt for more creative generation. Default false. */
  prompt_upsampling?: boolean;
  /** Moderation strictness 0 (strictest) – 6 (least strict). Default 2. */
  safety_tolerance?: number;
}

// ---------------------------------------------------------------------------
// Schema (loose: unknown keys pass through with a warning).
// ---------------------------------------------------------------------------

const kontextSchema = z.looseObject({
  model: z.string(),
  prompt: z.string(),
  input_image: z.string().nullable().optional(),
  input_image_2: z.string().nullable().optional(),
  input_image_3: z.string().nullable().optional(),
  input_image_4: z.string().nullable().optional(),
  seed: z.number().int().nullable().optional(),
  aspect_ratio: z.string().nullable().optional(),
  output_format: z.enum(BFL_OUTPUT_FORMATS).nullable().optional(),
  webhook_url: z.string().min(1).max(2083).nullable().optional(),
  webhook_secret: z.string().nullable().optional(),
  prompt_upsampling: z.boolean().optional(),
  safety_tolerance: z.number().int().min(0).max(6).optional(),
});

// ---------------------------------------------------------------------------
// Checks — aspect_ratio must be "W:H" between 21:9 and 9:21.
// ---------------------------------------------------------------------------

function checkAspectRatio(
  params: FluxKontextParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  checkAspectRatioRange({
    ratio: params.aspect_ratio,
    model: params.model,
    source: KONTEXT_SCHEMA_URL,
    ctx,
  });
}

// ---------------------------------------------------------------------------
// Estimation — kontext is flat per-image pricing (models.ts).
// ---------------------------------------------------------------------------

function estimate(_params: FluxKontextParams, info: ModelInfo | undefined) {
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

function finalize(params: FluxKontextParams): unknown {
  const { model, ...body } = params;
  return toValidated(body, {
    url: bflModelUrl(model),
    method: "POST",
    headers: JSON_HEADERS,
  }, {
    sdk: { "black-forest-labs": () => body },
  });
}

const validator = createValidator<FluxKontextParams, unknown>({
  endpoint: "black-forest-labs.imageEdit",
  schema: kontextSchema,
  modelId: (params) => params.model,
  catalog: models,
  checks: [checkAspectRatio],
  estimate,
  finalize,
});

/**
 * Validates submit params for the FLUX.1 Kontext routes
 * (`POST https://api.bfl.ai/v1/flux-kontext-pro` / `flux-kontext-max`).
 *
 * The returned object's enumerable props are the exact fetch JSON body —
 * `model` is a route selector, stripped from the body and interpolated into
 * `.request.url`. BFL has no official JS SDK, so `.toSdk("black-forest-labs")` returns the wire
 * body unchanged. The POST returns an async job (`{ id, polling_url }`), not
 * image bytes — poll `BFL_GET_RESULT_URL` (transport, out of unmodel's
 * scope). Auth is your job: add an `x-key` header when fetching.
 *
 * ```ts
 * const params = blackForestLabs.imageEdit({
 *   model: "flux-kontext-pro",
 *   prompt: "replace the sky with a thunderstorm",
 *   input_image: imageBase64,
 * });
 * await fetch(params.request.url, {
 *   method: params.request.method,
 *   headers: { ...params.request.headers, "x-key": process.env.BFL_API_KEY! },
 *   body: JSON.stringify(params),
 * });
 * ```
 */
export const imageEdit = validator as unknown as {
  <T extends FluxKontextParams>(
    params: T & ExactKeys<T, FluxKontextParams>,
    options?: ValidateOptions,
  ): Validated<Omit<T, "model">, BflSdkTargets<Omit<T, "model">>>;
  safe<T extends FluxKontextParams>(
    params: T & ExactKeys<T, FluxKontextParams>,
    options?: ValidateOptions,
  ): ValidateResult<Validated<Omit<T, "model">, BflSdkTargets<Omit<T, "model">>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
