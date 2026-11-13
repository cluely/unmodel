/**
 * LTX Text to Video — POST https://api.ltx.io/v2/text-to-video (async).
 *
 * Wire notes (verified against https://docs.ltx.io/openapi.json and
 * https://docs.ltx.io/models.md on 2026-08-13):
 * - `prompt`, `model`, `duration` and `resolution` are all REQUIRED by the
 *   spec — including `duration`, which must be sent as `null` to use LTX-2.5's
 *   automatic duration ("The field is still required — leaving it out returns
 *   `duration is required`", https://docs.ltx.io/models/ltx-2-5.md).
 * - Which resolution / fps / duration combinations a model accepts is not in
 *   the schema (all three are bare string/integer types); it comes from the
 *   published support matrices and is enforced by `checkSupportMatrix`.
 * - The route responds `{ id }`; polling `GET /v2/text-to-video/{id}` is out
 *   of unmodel's scope.
 * - Auth is `Authorization: Bearer <LTX_API_KEY>` — unmodel never touches
 *   keys; add the header yourself when fetching.
 */

import { z } from "zod";
import { createValidator, type PipelineContext } from "../../core/pipeline";
import { toValidated, type ExactKeys, type Validated } from "../../core/request";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";
import type { ModelInfo } from "../../core/catalog-types";
import type { EndpointConstraints } from "../../core/constraint-types";
import { models, type LightricksModelId } from "./models";
import {
  LTX_CAMERA_MOTIONS,
  LTX_HEADERS,
  checkSupportMatrix,
  ltxUrl,
  type LtxCameraMotion,
  type LtxDuration,
  type LtxFps,
  type LtxResolution,
} from "./shared";
import { videoCostUSD } from "./pricing";

export const TEXT_TO_VIDEO_ENDPOINT = "text-to-video";

/** `POST https://api.ltx.io/v2/text-to-video` — the async job route. */
export const TEXT_TO_VIDEO_URL = ltxUrl(TEXT_TO_VIDEO_ENDPOINT);

// ---------------------------------------------------------------------------
// Wire types — mirror the raw JSON body exactly.
// ---------------------------------------------------------------------------

export interface TextToVideoParams {
  /** Text prompt describing the desired video content. Required. */
  prompt: string;
  model: LightricksModelId | (string & {});
  /**
   * Output duration in seconds. Required — send `null` for LTX-2.5's
   * automatic duration. Allowed values depend on model × resolution × fps.
   */
  duration: LtxDuration | null;
  /** `WIDTHxHEIGHT`, e.g. "1920x1080". Required; allowed values per model. */
  resolution: LtxResolution;
  /** Frame rate; defaults to 24. Allowed values per model × resolution. */
  fps?: LtxFps;
  /** Generate matching audio. Defaults to true. */
  generate_audio?: boolean;
  camera_motion?: LtxCameraMotion;
}

const videoSchema = z.looseObject({
  prompt: z.string().min(1),
  model: z.string(),
  duration: z.number().int().nullable(),
  resolution: z.string().min(1),
  fps: z.number().int().optional(),
  generate_audio: z.boolean().optional(),
  camera_motion: z.enum(LTX_CAMERA_MOTIONS).optional(),
});

function estimate(params: TextToVideoParams, info: ModelInfo | undefined, _ctx: PipelineContext) {
  if (info === undefined) return {};
  const costUSD = videoCostUSD({
    model: params.model,
    resolution: params.resolution,
    duration: params.duration,
  });
  return costUSD === undefined ? {} : { costUSD };
}

/**
 * The one `.toSdk("lightricks")` target for this endpoint — LTX Studio ships
 * no first-party JS SDK, so this is the wire body. Derived from the `sdk`
 * literal in `finalize`; it must stay an object type with no index
 * signature, or `toSdk` would accept any string.
 */
export type LightricksSdkTargets<B> = { lightricks: () => B };

function finalize(params: TextToVideoParams): unknown {
  const body = { ...params };
  return toValidated(body, {
    url: TEXT_TO_VIDEO_URL,
    method: "POST",
    headers: LTX_HEADERS,
  }, {
    sdk: { lightricks: () => body },
  });
}

const validator = createValidator<TextToVideoParams, unknown>({
  endpoint: "lightricks.video",
  schema: videoSchema,
  modelId: (params) => params.model,
  catalog: models,
  checks: [checkSupportMatrix],
  estimate,
  finalize,
});

/**
 * Validates raw wire params for LTX `POST /v2/text-to-video`.
 *
 * The returned object's enumerable props are the exact fetch JSON body.
 * `.toSdk("lightricks")` returns the body unchanged — LTX
 * ships no first-party SDK, so the wire body is the only shape. Auth is your
 * job: add `authorization: Bearer <LTX_API_KEY>` when fetching.
 *
 * ```ts
 * const params = lightricks.video({
 *   model: "ltx-2-3-pro",
 *   prompt: "A lighthouse beam sweeps across the water at dusk",
 *   resolution: "1920x1080",
 *   duration: 8,
 * });
 * const res = await fetch(params.request.url, {
 *   method: params.request.method,
 *   headers: { ...params.request.headers, authorization: `Bearer ${key}` },
 *   body: JSON.stringify(params),
 * });
 * ```
 */
export const video = validator as unknown as {
  <T extends TextToVideoParams>(
    params: T & ExactKeys<T, TextToVideoParams>,
    options?: ValidateOptions<T>,
  ): Validated<T, LightricksSdkTargets<T>>;
  safe<T extends TextToVideoParams>(
    params: T & ExactKeys<T, TextToVideoParams>,
    options?: ValidateOptions<T>,
  ): ValidateResult<Validated<T, LightricksSdkTargets<T>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
