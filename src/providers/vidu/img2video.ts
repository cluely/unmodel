/**
 * Vidu Image to Video — POST https://api.vidu.com/ent/v2/img2video
 *
 * Wire notes (verified against https://platform.vidu.com/docs/image-to-video on
 * 2026-08-13):
 * - `model` and `images` are required; `images` takes exactly ONE start-frame
 *   image (public URL or base64 data URI, png/jpeg/jpg/webp, ≤50MB, aspect
 *   ratio between 1:4 and 4:1; the whole POST body must stay under 20MB).
 * - There is no `aspect_ratio` on this route — the input image sets it.
 * - `audio` defaults to false but to true on q3; `voice_id` only takes effect
 *   when `audio` is true and is "not effective" on q3; `bgm` is unavailable on
 *   q3; `movement_amplitude` does not take effect on q2/q3. Ignored-by-the-API
 *   params warn rather than fail.
 * - `is_rec: true` makes the model write its own prompt (ignoring `prompt`)
 *   and adds 10 credits, which the cost estimate does not include.
 * - Auth is `Authorization: Token <VIDU_API_KEY>`.
 */

import { z } from "zod";
import { createValidator, type PipelineContext } from "../../core/pipeline";
import { toValidated, type ExactKeys, type Validated } from "../../core/request";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";
import type { ModelInfo } from "../../core/catalog-types";
import type { EndpointConstraints } from "../../core/constraint-types";
import { videoModels, type ViduModelId } from "./models";
import {
  DOCS_BASE,
  VIDU_AUDIO_TYPES,
  VIDU_BASE_URL,
  VIDU_HEADERS,
  VIDU_MOVEMENT_AMPLITUDES,
  assetSchema,
  checkArrayLength,
  checkRouteSupport,
  payloadSchema,
  promptSchema,
  type RouteSupport,
  type ViduAudioType,
  type ViduMovementAmplitude,
  type ViduResolution,
} from "./shared";
import { videoCostUSD } from "./pricing";

export const IMG2VIDEO_URL = `${VIDU_BASE_URL}/img2video`;

const SOURCE = `${DOCS_BASE}/image-to-video`;

/** Models with an img2video arm, and what each accepts. */
export const IMG2VIDEO_SUPPORT: RouteSupport = {
  "viduq3-pro-fast": { resolutions: ["720p", "1080p"], duration: { min: 1, max: 16 } },
  "viduq3-pro": { resolutions: ["540p", "720p", "1080p"], duration: { min: 1, max: 16 } },
  "viduq3-turbo": { resolutions: ["540p", "720p", "1080p"], duration: { min: 1, max: 16 } },
  "viduq2-pro-fast": { resolutions: ["720p", "1080p"], duration: { min: 1, max: 10 } },
  "viduq2-pro": { resolutions: ["540p", "720p", "1080p"], duration: { min: 1, max: 10 } },
  "viduq2-turbo": { resolutions: ["540p", "720p", "1080p"], duration: { min: 1, max: 10 } },
  viduq1: { resolutions: ["1080p"], duration: { min: 5, max: 5 }, durations: [5] },
  "viduq1-classic": { resolutions: ["1080p"], duration: { min: 5, max: 5 }, durations: [5] },
  // vidu2.0: 4s offers 360p/720p/1080p, 8s only 720p — the union is listed
  // here and the duration-specific narrowing is checked below.
  "vidu2.0": { resolutions: ["360p", "720p", "1080p"], duration: { min: 4, max: 8 }, durations: [4, 8] },
};

/** Every img2video model accepts exactly one start-frame image. */
const IMAGE_COUNTS = Object.fromEntries(
  Object.keys(IMG2VIDEO_SUPPORT).map((model) => [model, { min: 1, max: 1 }]),
);

export interface Img2VideoParams {
  model: ViduModelId | (string & {});
  /** Exactly one start-frame image: public URL or base64 data URI. */
  images: string[];
  /** Up to 5000 characters. Ignored when `is_rec` is true. */
  prompt?: string;
  /** Voice character; only takes effect when `audio` is true. Not on q3. */
  voice_id?: string;
  /** Let the model write the prompt. Adds 10 credits per task. */
  is_rec?: boolean;
  /** Background music. Default false; unavailable on q3. */
  bgm?: boolean;
  /** Direct audio-video generation. Default false, but true on q3. */
  audio?: boolean;
  /** Required when `audio` is true; defaults to "all". */
  audio_type?: ViduAudioType;
  /** Seconds; bounds vary per model (default 5, or 4 on vidu2.0). */
  duration?: number;
  seed?: number;
  /**
   * Default "720p" (viduq1: "1080p"; vidu2.0 at 4s: "360p"). Autocomplete over
   * every documented value; `IMG2VIDEO_SUPPORT` narrows it per model at
   * runtime, and vidu2.0 narrows again by duration.
   */
  resolution?: ViduResolution;
  /** Default "auto". Not effective on q2 / q3. */
  movement_amplitude?: ViduMovementAmplitude;
  payload?: string;
  /** Off-peak mode. Default false. */
  off_peak?: boolean;
  callback_url?: string;
}

const img2videoSchema = z.looseObject({
  model: z.string(),
  images: z.array(assetSchema),
  prompt: promptSchema.optional(),
  voice_id: z.string().optional(),
  is_rec: z.boolean().optional(),
  bgm: z.boolean().optional(),
  audio: z.boolean().optional(),
  audio_type: z.enum(VIDU_AUDIO_TYPES).optional(),
  duration: z.number().int().optional(),
  seed: z.number().int().optional(),
  resolution: z.string().optional(),
  movement_amplitude: z.enum(VIDU_MOVEMENT_AMPLITUDES).optional(),
  payload: payloadSchema.optional(),
  off_peak: z.boolean().optional(),
  callback_url: z.string().optional(),
});

/**
 * vidu2.0 narrows further by duration: "4s: default 360p, options 360p, 720p,
 * 1080p" but "8s: default 720p, options 720p".
 */
function checkVidu2Resolution(
  params: Img2VideoParams,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (info === undefined || params.model !== "vidu2.0") return;
  if (params.duration !== 8 || params.resolution == null) return;
  if (params.resolution === "720p") return;
  ctx.report({
    code: "invalid_enum_value",
    path: ["resolution"],
    model: params.model,
    message: `\`resolution\` must be "720p" for "vidu2.0" at 8 seconds; got ${JSON.stringify(params.resolution)}.`,
    meta: { allowed: ["720p"], value: params.resolution, duration: 8, source: SOURCE },
  });
}

export const img2videoConstraints = {
  "viduq3-pro-fast": q3Ignored(),
  "viduq3-pro": q3Ignored(),
  "viduq3-turbo": q3Ignored(),
  "viduq2-pro-fast": q2Ignored(),
  "viduq2-pro": q2Ignored(),
  "viduq2-turbo": q2Ignored(),
} as const satisfies Readonly<Partial<Record<string, EndpointConstraints>>>;

function q3Ignored(): EndpointConstraints {
  return {
    deny: {
      voice_id: {
        reason: "`voice_id` is not effective on the Q3 series.",
        source: SOURCE,
        ignored: true,
      },
      bgm: { reason: "BGM is not available on the q3 models.", source: SOURCE, ignored: true },
      movement_amplitude: {
        reason: "`movement_amplitude` does not take effect on the q3 models.",
        source: SOURCE,
        ignored: true,
      },
    },
  };
}

function q2Ignored(): EndpointConstraints {
  return {
    deny: {
      movement_amplitude: {
        reason: "`movement_amplitude` does not take effect on the q2 models.",
        source: SOURCE,
        ignored: true,
      },
    },
  };
}

function estimate(params: Img2VideoParams, info: ModelInfo | undefined, _ctx: PipelineContext) {
  if (info === undefined) return {};
  const costUSD = videoCostUSD({
    model: params.model,
    route: "img2video",
    ...(params.resolution !== undefined && { resolution: params.resolution }),
    ...(params.duration !== undefined && { duration: params.duration }),
    ...(params.off_peak !== undefined && { off_peak: params.off_peak }),
  });
  return costUSD === undefined ? {} : { costUSD };
}

/**
 * The one `.toSdk("vidu")` target for this endpoint — Vidu ships no
 * first-party SDK, so this is the wire body. Derived from the `sdk` literal
 * in `finalize`; it must stay an object type with no index signature, or
 * `toSdk` would accept any string.
 */
type ViduSdkTargets<B> = { vidu: () => B };

function finalize(params: Img2VideoParams): unknown {
  const body = { ...params };
  return toValidated(body, {
    url: IMG2VIDEO_URL,
    method: "POST",
    headers: VIDU_HEADERS,
  }, {
    sdk: { vidu: () => body },
  });
}

const validator = createValidator<Img2VideoParams, unknown>({
  endpoint: "vidu.img2video",
  schema: img2videoSchema,
  modelId: (params) => params.model,
  catalog: videoModels,
  constraints: img2videoConstraints,
  checks: [
    checkRouteSupport("img2video", IMG2VIDEO_SUPPORT, SOURCE),
    checkArrayLength("images", IMAGE_COUNTS, SOURCE),
    checkVidu2Resolution,
  ],
  estimate,
  finalize,
});

/**
 * Validates raw wire params for Vidu `POST /ent/v2/img2video`.
 *
 * ```ts
 * const params = vidu.img2video({
 *   model: "viduq3-pro",
 *   images: ["https://example.com/start.png"],
 *   prompt: "the camera drifts left as the neon signs flicker",
 *   duration: 5,
 * });
 * ```
 */
export const img2video = validator as unknown as {
  <T extends Img2VideoParams>(
    params: T & ExactKeys<T, Img2VideoParams>,
    options?: ValidateOptions,
  ): Validated<T, ViduSdkTargets<T>>;
  safe<T extends Img2VideoParams>(
    params: T & ExactKeys<T, Img2VideoParams>,
    options?: ValidateOptions,
  ): ValidateResult<Validated<T, ViduSdkTargets<T>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
