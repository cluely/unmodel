/**
 * LTX Audio to Video — POST https://api.ltx.io/v2/audio-to-video (async).
 *
 * Wire notes (verified against https://docs.ltx.io/openapi.json on
 * 2026-11-12, `AudioToVideoRequest`, except where a bullet says otherwise):
 * - Only `audio_uri` is required by the schema, but the field descriptions
 *   pair `image_uri` and `prompt`: each is "required if the other is not
 *   provided", so a body with neither is rejected here.
 * - There is no `duration` field: the audio sets the length. It "must be at
 *   least 2 seconds and must not exceed the maximum the selected model
 *   supports at the chosen resolution" — 20s for ltx-2-5-fast and ltx-2-3-pro
 *   at 720p/1080p, 10s for both at 1440p/4K, and 10s for ltx-2-5-pro at every
 *   tier. unmodel cannot read a remote audio file's length, so neither the
 *   window nor the per-second cost is checked or estimated here.
 * - `resolution` and `fps` take the same per-model matrix as text-to-video
 *   ("Supported resolutions depend on the model … `ltx-2-5-fast`,
 *   `ltx-2-5-pro`, and `ltx-2-3-pro` support 720p through 4K."), checked by
 *   `checkSupportMatrix`. An omitted `resolution` follows the image's
 *   orientation, "If no image is provided, defaults to 1920x1080"; `model`
 *   defaults to `ltx-2-3-pro`. `ltx-2-3-fast` has no arm.
 * - `last_frame_uri` "Requires `image_uri`"
 *   (https://docs.ltx.io/api-documentation/api-reference/async-video-generation/submit-audio-to-video.md).
 * - `guidance_scale` (5 with text only, 9 with an image) was transcribed on
 *   2026-08-13. The 2026-11-12 OpenAPI and reference page no longer list it,
 *   and neither says whether the API now ignores or rejects it.
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
  AUDIO_TO_VIDEO_MODELS,
  LTX_CAMERA_MOTIONS,
  LTX_HEADERS,
  OPENAPI_SOURCE,
  checkRouteSupport,
  checkSupportMatrix,
  ltxUrl,
  uriSchema,
  type LtxCameraMotion,
  type LtxFps,
  type LtxResolution,
} from "./shared";

export const AUDIO_TO_VIDEO_ENDPOINT = "audio-to-video";

export const AUDIO_TO_VIDEO_URL = ltxUrl(AUDIO_TO_VIDEO_ENDPOINT);

/** Server-side default when `model` is omitted (OpenAPI `default`). */
export const DEFAULT_AUDIO_TO_VIDEO_MODEL = "ltx-2-3-pro";

/**
 * What an omitted `resolution` renders at without an image (OpenAPI: "If no
 * image is provided, defaults to 1920x1080"). A portrait image's default,
 * 1080x1920, is the same tier, so it allows the same frame rates.
 */
const DEFAULT_RESOLUTION = "1920x1080";

const REFERENCE_SOURCE =
  "https://docs.ltx.io/api-documentation/api-reference/async-video-generation/submit-audio-to-video.md";

export interface AudioToVideoParams {
  /** Soundtrack; its duration sets the video length. Required. */
  audio_uri: string;
  /** First frame. Required when `prompt` is absent. */
  image_uri?: string;
  /** Video description. Required when `image_uri` is absent. */
  prompt?: string;
  /**
   * `WIDTHxHEIGHT`; allowed values per model. Defaults to the input image's
   * orientation, else "1920x1080".
   */
  resolution?: LtxResolution;
  /** CFG. Defaults to 5 (text-only) or 9 (with an image). */
  guidance_scale?: number;
  /** Defaults to "ltx-2-3-pro". `ltx-2-3-fast` has no arm here. */
  model?: LightricksModelId | (string & {});
  /** Frame rate; defaults to 24. Allowed values per model × resolution. */
  fps?: LtxFps;
  /** Last frame to interpolate to. Requires `image_uri`. */
  last_frame_uri?: string;
  camera_motion?: LtxCameraMotion;
}

const videoFromAudioSchema = z.looseObject({
  audio_uri: uriSchema,
  image_uri: uriSchema.optional(),
  prompt: z.string().optional(),
  resolution: z.string().min(1).optional(),
  guidance_scale: z.number().optional(),
  model: z.string().optional(),
  fps: z.number().int().optional(),
  last_frame_uri: uriSchema.optional(),
  camera_motion: z.enum(LTX_CAMERA_MOTIONS).optional(),
});

/**
 * The text-to-video resolution × fps matrix, minus duration (the audio sets
 * the length). Only models with an arm here are checked — `checkRouteSupport`
 * already answers for the rest.
 */
function checkAudioMatrix(
  params: AudioToVideoParams,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const model = params.model ?? DEFAULT_AUDIO_TO_VIDEO_MODEL;
  if (!(AUDIO_TO_VIDEO_MODELS as readonly string[]).includes(model)) return;
  checkSupportMatrix(
    { model, resolution: params.resolution ?? DEFAULT_RESOLUTION, fps: params.fps },
    info,
    ctx,
  );
}

function checkLastFrameNeedsImage(
  params: AudioToVideoParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (params.last_frame_uri == null || params.image_uri != null) return;
  ctx.report({
    code: "invalid_shape",
    path: ["last_frame_uri"],
    message:
      "`last_frame_uri` requires `image_uri` on audio-to-video — the video interpolates from the " +
      "first frame to the last, so send the first frame as `image_uri`.",
    meta: { source: REFERENCE_SOURCE },
  });
}

function checkPromptOrImage(
  params: AudioToVideoParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (params.image_uri != null || params.prompt != null) return;
  ctx.report({
    code: "invalid_shape",
    path: ["prompt"],
    message:
      "audio-to-video needs a `prompt` or an `image_uri` — each is required when the other is absent.",
    meta: { source: OPENAPI_SOURCE },
  });
}

/**
 * The one `.toSdk("lightricks")` target for this endpoint — LTX Studio ships
 * no first-party JS SDK, so this is the wire body. Derived from the `sdk`
 * literal in `finalize`; it must stay an object type with no index
 * signature, or `toSdk` would accept any string.
 */
type LightricksSdkTargets<B> = { lightricks: () => B };

function finalize(params: AudioToVideoParams): unknown {
  const body = { ...params };
  return toValidated(body, {
    url: AUDIO_TO_VIDEO_URL,
    method: "POST",
    headers: LTX_HEADERS,
  }, {
    sdk: { lightricks: () => body },
  });
}

const validator = createValidator<AudioToVideoParams, unknown>({
  endpoint: "lightricks.videoFromAudio",
  schema: videoFromAudioSchema,
  modelId: (params) => params.model ?? DEFAULT_AUDIO_TO_VIDEO_MODEL,
  catalog: models,
  checks: [
    checkRouteSupport(
      "audio-to-video",
      AUDIO_TO_VIDEO_MODELS,
      'use ltx-2-5-fast, ltx-2-5-pro or ltx-2-3-pro — "ltx-2-3-fast" is text/image-to-video only.',
    ),
    checkPromptOrImage,
    checkAudioMatrix,
    checkLastFrameNeedsImage,
  ],
  // No estimate: this route bills per second of INPUT audio
  // (https://docs.ltx.io/pricing.md) and the request carries only a URI.
  finalize,
});

/**
 * Validates raw wire params for LTX `POST /v2/audio-to-video`.
 *
 * ```ts
 * const params = lightricks.videoFromAudio({
 *   audio_uri: "https://example.com/vo.mp3",
 *   prompt: "a narrator in a dim recording booth",
 *   model: "ltx-2-3-pro",
 * });
 * ```
 */
export const videoFromAudio = validator as unknown as {
  <T extends AudioToVideoParams>(
    params: T & ExactKeys<T, AudioToVideoParams>,
    options?: ValidateOptions<T>,
  ): Validated<T, LightricksSdkTargets<T>>;
  safe<T extends AudioToVideoParams>(
    params: T & ExactKeys<T, AudioToVideoParams>,
    options?: ValidateOptions<T>,
  ): ValidateResult<Validated<T, LightricksSdkTargets<T>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
