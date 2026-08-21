/**
 * LTX Audio to Video — POST https://api.ltx.io/v2/audio-to-video (async)
 * and POST https://api.ltx.io/v1/audio-to-video (sync).
 *
 * Wire notes (verified against https://docs.ltx.io/openapi.json on
 * 2026-08-13):
 * - Only `audio_uri` is required by the schema, but the field descriptions
 *   pair `image_uri` and `prompt`: each is "required if the other is not
 *   provided", so a body with neither is rejected here.
 * - There is no `duration` field: the audio sets the length, and it must fall
 *   inside the model's window (ltx-2-5-fast 2–20s, ltx-2-5-pro 2–10s,
 *   ltx-2-3-pro 2–20s). unmodel cannot read a remote audio file's length, so
 *   neither the window nor the per-second cost is checked or estimated here.
 * - `resolution` is 1080p-only on this route ("1920x1080" / "1080x1920"), and
 *   `model` defaults to `ltx-2-3-pro`. `ltx-2-3-fast` has no arm.
 * - `guidance_scale` defaults to 5 (text) or 9 (with an image).
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
  DEFAULT_API_VERSION,
  LTX_API_VERSIONS,
  LTX_HEADERS,
  OPENAPI_SOURCE,
  checkRouteSupport,
  ltxUrl,
  uriSchema,
  type LtxApiVersion,
} from "./shared";

export const AUDIO_TO_VIDEO_ENDPOINT = "audio-to-video";

export const AUDIO_TO_VIDEO_URL = ltxUrl(AUDIO_TO_VIDEO_ENDPOINT);
export const AUDIO_TO_VIDEO_V1_URL = ltxUrl(AUDIO_TO_VIDEO_ENDPOINT, "v1");

/** Server-side default when `model` is omitted (OpenAPI `default`). */
export const DEFAULT_AUDIO_TO_VIDEO_MODEL = "ltx-2-3-pro";

/** The only resolutions this route offers. */
export const AUDIO_TO_VIDEO_RESOLUTIONS = ["1920x1080", "1080x1920"] as const;

export interface AudioToVideoParams {
  /** Soundtrack; its duration sets the video length. Required. */
  audio_uri: string;
  /** First frame. Required when `prompt` is absent. */
  image_uri?: string;
  /** Video description. Required when `image_uri` is absent. */
  prompt?: string;
  /** Defaults to the input image's orientation, else "1920x1080". */
  resolution?: (typeof AUDIO_TO_VIDEO_RESOLUTIONS)[number];
  /** CFG. Defaults to 5 (text-only) or 9 (with an image). */
  guidance_scale?: number;
  /** Defaults to "ltx-2-3-pro". `ltx-2-3-fast` has no arm here. */
  model?: LightricksModelId | (string & {});
  /** NOT a wire field — picks `/v1` (sync) or `/v2` (async). Default "v2". */
  api_version?: LtxApiVersion;
}

const videoFromAudioSchema = z.looseObject({
  audio_uri: uriSchema,
  image_uri: uriSchema.optional(),
  prompt: z.string().optional(),
  resolution: z.enum(AUDIO_TO_VIDEO_RESOLUTIONS).optional(),
  guidance_scale: z.number().optional(),
  model: z.string().optional(),
  api_version: z.enum(LTX_API_VERSIONS).optional(),
});

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
  const { api_version, ...body } = params;
  return toValidated(body, {
    url: ltxUrl(AUDIO_TO_VIDEO_ENDPOINT, api_version ?? DEFAULT_API_VERSION),
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
  ],
  // No estimate: this route bills per second of INPUT audio
  // (https://docs.ltx.io/pricing.md) and the request carries only a URI.
  finalize,
});

/**
 * Validates raw wire params for LTX `POST /v2/audio-to-video` (or `/v1` via
 * `api_version: "v1"`).
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
  ): Validated<Omit<T, "api_version">, LightricksSdkTargets<Omit<T, "api_version">>>;
  safe<T extends AudioToVideoParams>(
    params: T & ExactKeys<T, AudioToVideoParams>,
    options?: ValidateOptions<T>,
  ): ValidateResult<Validated<Omit<T, "api_version">, LightricksSdkTargets<Omit<T, "api_version">>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
