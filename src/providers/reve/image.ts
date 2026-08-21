/**
 * Reve v1 text-to-image — POST https://api.reve.com/v1/image/create
 *
 * Wire notes (verified against https://api.reve.com/console/docs on
 * 2026-08-13):
 * - Synchronous JSON endpoint: the response carries the image base64-encoded
 *   (`image`) plus `version`, `content_violation`, `request_id`,
 *   `credits_used`, `credits_remaining`. Set `Accept: image/png` (or jpeg /
 *   webp) to get raw bytes with the same metadata in `X-Reve-*` headers —
 *   that's the caller's choice, so unmodel only sets `content-type`.
 * - The model is selected by `version`, not by a `model` field: `latest` or
 *   `reve-create@20250915` (nothing else). `latest` is a moving alias — the
 *   catalog prices it as the dated row it resolves to today.
 * - v1 accepts only the legacy aspect-ratio subset (7 ratios, default `3:2`);
 *   `auto` and the wide/tall v2 ratios are v2-only.
 * - `prompt` is capped at 2560 characters and is "automatically enhanced by
 *   the model".
 * - Pricing: 18 credits ≈ $0.024, scaled by `test_time_scaling`. See models.ts
 *   for the credit→USD conversion.
 * - Auth is an `Authorization: Bearer …` header — unmodel never touches keys.
 * - Reve publishes no official JS SDK; `.toSdk("reve")` returns the wire body
 *   unchanged.
 */

import { z } from "zod";
import { createValidator, type PipelineContext } from "../../core/pipeline";
import { toValidated, JSON_HEADERS, type Validated, type ExactKeys } from "../../core/request";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";
import type { ModelInfo } from "../../core/catalog-types";
import type { EndpointConstraints } from "../../core/constraint-types";
import { models, REVE_CREATE_VERSIONS, resolveReveVersion, type ReveCreateVersion } from "./models";
import {
  REVE_API_BASE_URL,
  REVE_V1_ASPECT_RATIOS,
  checkAspectRatio,
  checkPostprocessing,
  checkPromptLength,
  checkTestTimeScaling,
  checkVersion,
  reveEstimateUSD,
  type RevePostprocessingOperation,
  type ReveV1AspectRatio,
} from "./shared";

export const REVE_CREATE_URL = `${REVE_API_BASE_URL}/v1/image/create`;

/** "The maximum length is 2560 characters." — v1 create/edit/remix. */
export const REVE_V1_PROMPT_MAX_LENGTH = 2560;

export interface CreateParams {
  /** Text description of the desired image; ≤ 2560 chars. REQUIRED. */
  prompt: string;
  /**
   * Output aspect ratio, from the v1 subset. Default "3:2". CLOSED enum — "The
   * v1 endpoints intentionally document and accept only the smaller legacy
   * subset", so the wide/tall v2 ratios and `auto` are compile errors here.
   */
  aspect_ratio?: ReveV1AspectRatio;
  /** Model version. Default "latest". */
  version?: ReveCreateVersion | (string & {});
  /** Post-generation operations (upscale / remove_background / fit_image / effect). */
  postprocessing?: RevePostprocessingOperation[];
  /** Extra effort per image, 1–15. Default 1. Values above 1 cost proportionally more. */
  test_time_scaling?: number;
}

const createSchema = z.looseObject({
  prompt: z.string(),
  aspect_ratio: z.string().optional(),
  version: z.string().optional(),
  postprocessing: z.array(z.unknown()).optional(),
  test_time_scaling: z.number().optional(),
});

function checkCreate(
  params: CreateParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  checkPromptLength(ctx, ["prompt"], params.prompt, REVE_V1_PROMPT_MAX_LENGTH);
  checkAspectRatio(
    ctx,
    params.aspect_ratio,
    REVE_V1_ASPECT_RATIOS,
    " The v1 endpoints accept only the legacy subset; the wide/tall ratios and `auto` are v2-only (POST /v2/image/create).",
  );
  checkVersion(ctx, params.version, REVE_CREATE_VERSIONS);
  checkPostprocessing(ctx, params.postprocessing);
  checkTestTimeScaling(ctx, params.test_time_scaling);
}

function estimate(params: CreateParams, info: ModelInfo | undefined) {
  const costUSD = reveEstimateUSD(info?.cost?.perImage, params.test_time_scaling);
  return costUSD === undefined ? {} : { costUSD };
}

/**
 * The one `.toSdk("reve")` target for this endpoint — Reve ships no official
 * JS SDK, so this is the wire body. Derived from the `sdk` literal in
 * `finalize`; it must stay an object type with no index signature, or
 * `toSdk` would accept any string.
 */
type ReveSdkTargets<B> = { reve: () => B };

function finalize(params: CreateParams): unknown {
  const body = { ...params };
  return toValidated(body, {
    url: REVE_CREATE_URL,
    method: "POST",
    headers: JSON_HEADERS,
  }, {
    sdk: { reve: () => body },
  });
}

const validator = createValidator<CreateParams, unknown>({
  endpoint: "reve.image",
  schema: createSchema,
  modelId: (params) => resolveReveVersion("create", params.version),
  catalog: models,
  checks: [checkCreate],
  estimate,
  finalize,
});

/**
 * Validates params for `POST https://api.reve.com/v1/image/create` (Reve v1
 * text-to-image).
 *
 * The returned object's enumerable props are the exact fetch JSON body.
 * Auth is your job: add an `Authorization: Bearer …` header when fetching.
 *
 * ```ts
 * const params = reve.image({
 *   prompt: "A serene mountain landscape at sunset with snow-capped peaks",
 *   aspect_ratio: "16:9",
 *   version: "reve-create@20250915",
 * });
 * ```
 */
export const image = validator as unknown as {
  <T extends CreateParams>(
    params: T & ExactKeys<T, CreateParams>,
    options?: ValidateOptions<T>,
  ): Validated<T, ReveSdkTargets<T>>;
  safe<T extends CreateParams>(
    params: T & ExactKeys<T, CreateParams>,
    options?: ValidateOptions<T>,
  ): ValidateResult<Validated<T, ReveSdkTargets<T>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
