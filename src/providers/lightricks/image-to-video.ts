/**
 * LTX Image to Video — POST https://api.ltx.io/v2/image-to-video (async)
 * and POST https://api.ltx.io/v1/image-to-video (sync).
 *
 * Wire notes (verified against https://docs.ltx.io/openapi.json and
 * https://docs.ltx.io/models.md on 2026-08-13):
 * - `image_uri`, `prompt`, `model`, `duration` and `resolution` are all
 *   REQUIRED by the spec; `duration` must be sent as `null` to use LTX-2.5's
 *   automatic duration.
 * - `last_frame_uri` turns the request into first-to-last-frame
 *   interpolation. It is not supported by the deprecated `ltx-2-fast` /
 *   `ltx-2-pro`, and "cannot be combined with `duration: null`" — a last
 *   frame fixes where the clip ends, which requires a known length
 *   (https://docs.ltx.io/models/ltx-2-5.md).
 * - `api_version` is NOT a wire field (see ./text-to-video.ts).
 * - Auth is `Authorization: Bearer <LTX_API_KEY>`.
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
  DEFAULT_API_VERSION,
  LTX_API_VERSIONS,
  LTX_CAMERA_MOTIONS,
  LTX_HEADERS,
  MODELS_SOURCE,
  OPENAPI_SOURCE,
  checkSupportMatrix,
  ltxUrl,
  uriSchema,
  type LtxApiVersion,
  type LtxCameraMotion,
  type LtxDuration,
  type LtxFps,
  type LtxResolution,
} from "./shared";
import { videoCostUSD } from "./pricing";

export const IMAGE_TO_VIDEO_ENDPOINT = "image-to-video";

export const IMAGE_TO_VIDEO_URL = ltxUrl(IMAGE_TO_VIDEO_ENDPOINT);
export const IMAGE_TO_VIDEO_V1_URL = ltxUrl(IMAGE_TO_VIDEO_ENDPOINT, "v1");

/** Models with no `last_frame_uri` support — the deprecated LTX-2 pair. */
export const NO_LAST_FRAME_MODELS = ["ltx-2-fast", "ltx-2-pro"] as const;

export interface ImageToVideoParams {
  /** First frame: HTTPS URL, base64 data URI, or an upload `storage_uri`. */
  image_uri: string;
  /** How the image should be animated. Required. */
  prompt: string;
  model: LightricksModelId | (string & {});
  /** Required; `null` selects LTX-2.5's automatic duration. */
  duration: LtxDuration | null;
  /** `WIDTHxHEIGHT`. Required; allowed values per model. */
  resolution: LtxResolution;
  /** Defaults to 24. */
  fps?: LtxFps;
  /** Defaults to true. */
  generate_audio?: boolean;
  /** Last frame to interpolate to; incompatible with `duration: null`. */
  last_frame_uri?: string;
  camera_motion?: LtxCameraMotion;
  /** NOT a wire field — picks `/v1` (sync) or `/v2` (async). Default "v2". */
  api_version?: LtxApiVersion;
}

const imageToVideoSchema = z.looseObject({
  image_uri: uriSchema,
  prompt: z.string(),
  model: z.string(),
  duration: z.number().int().nullable(),
  resolution: z.string().min(1),
  fps: z.number().int().optional(),
  generate_audio: z.boolean().optional(),
  last_frame_uri: uriSchema.optional(),
  camera_motion: z.enum(LTX_CAMERA_MOTIONS).optional(),
  api_version: z.enum(LTX_API_VERSIONS).optional(),
});

function checkLastFrame(
  params: ImageToVideoParams,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (params.last_frame_uri == null) return;
  if (info !== undefined && (NO_LAST_FRAME_MODELS as readonly string[]).includes(params.model)) {
    ctx.report({
      code: "unsupported_param",
      path: ["last_frame_uri"],
      model: params.model,
      message: `\`last_frame_uri\` is not supported by "${params.model}" (deprecated LTX-2); use ltx-2-3-* or ltx-2-5-*.`,
      meta: { source: OPENAPI_SOURCE },
    });
  }
  if (params.duration === null) {
    ctx.report({
      code: "unsupported_param",
      path: ["last_frame_uri"],
      model: params.model,
      message:
        "`last_frame_uri` cannot be combined with automatic duration (`duration: null`) — a last frame fixes where the clip ends, which requires a known length.",
      meta: { source: MODELS_SOURCE },
    });
  }
}

function estimate(params: ImageToVideoParams, info: ModelInfo | undefined, _ctx: PipelineContext) {
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
type LightricksSdkTargets<B> = { lightricks: () => B };

function finalize(params: ImageToVideoParams): unknown {
  const { api_version, ...body } = params;
  return toValidated(body, {
    url: ltxUrl(IMAGE_TO_VIDEO_ENDPOINT, api_version ?? DEFAULT_API_VERSION),
    method: "POST",
    headers: LTX_HEADERS,
  }, {
    sdk: { lightricks: () => body },
  });
}

const validator = createValidator<ImageToVideoParams, unknown>({
  endpoint: "lightricks.imageToVideo",
  schema: imageToVideoSchema,
  modelId: (params) => params.model,
  catalog: models,
  checks: [checkSupportMatrix, checkLastFrame],
  estimate,
  finalize,
});

/**
 * Validates raw wire params for LTX `POST /v2/image-to-video` (or `/v1` via
 * `api_version: "v1"`).
 *
 * ```ts
 * const params = lightricks.imageToVideo({
 *   model: "ltx-2-3-fast",
 *   image_uri: "https://example.com/first.png",
 *   prompt: "the camera pushes in as the waves roll",
 *   resolution: "1280x720",
 *   duration: 6,
 * });
 * ```
 */
export const imageToVideo = validator as unknown as {
  <T extends ImageToVideoParams>(
    params: T & ExactKeys<T, ImageToVideoParams>,
    options?: ValidateOptions,
  ): Validated<Omit<T, "api_version">, LightricksSdkTargets<Omit<T, "api_version">>>;
  safe<T extends ImageToVideoParams>(
    params: T & ExactKeys<T, ImageToVideoParams>,
    options?: ValidateOptions,
  ): ValidateResult<Validated<Omit<T, "api_version">, LightricksSdkTargets<Omit<T, "api_version">>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
