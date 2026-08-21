/**
 * Vidu Text to Video — POST https://api.vidu.com/ent/v2/text2video
 *
 * Wire notes (verified against https://platform.vidu.com/docs/text-to-video on
 * 2026-08-13):
 * - `model` and `prompt` are required; everything else is optional with a
 *   documented default. Only four models have an arm here — the img2video-only
 *   variants (`viduq3-pro-fast`, the q2-pro/turbo family, `viduq1-classic`,
 *   `vidu2.0`) are reported as unsupported_capability.
 * - `audio` (direct audio-video generation) is q3-only and defaults to true
 *   there; `bgm` is unavailable on q3 and is ignored at 9–10s on q2;
 *   `movement_amplitude` and `style` "do not take effect" on q2/q3. Params the
 *   API accepts and drops are reported as `ignored` deny rules — warnings, not
 *   errors.
 * - Async: the response is a task object; poll the Get Generation API or set
 *   `callback_url`. Auth is `Authorization: Token <VIDU_API_KEY>`.
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
  VIDU_ASPECT_RATIOS,
  VIDU_BASE_URL,
  VIDU_HEADERS,
  VIDU_MOVEMENT_AMPLITUDES,
  VIDU_STYLES,
  checkRouteSupport,
  payloadSchema,
  promptSchema,
  type RouteSupport,
  type ViduAspectRatio,
  type ViduMovementAmplitude,
  type ViduResolution,
  type ViduStyle,
} from "./shared";
import { videoCostUSD } from "./pricing";

export const TEXT2VIDEO_URL = `${VIDU_BASE_URL}/text2video`;

const SOURCE = `${DOCS_BASE}/text-to-video`;

/** Models with a text2video arm, and what each accepts. */
export const TEXT2VIDEO_SUPPORT: RouteSupport = {
  "viduq3-pro": { resolutions: ["540p", "720p", "1080p"], duration: { min: 1, max: 16 } },
  "viduq3-turbo": { resolutions: ["540p", "720p", "1080p"], duration: { min: 1, max: 16 } },
  viduq2: { resolutions: ["540p", "720p", "1080p"], duration: { min: 1, max: 10 } },
  viduq1: { resolutions: ["1080p"], duration: { min: 5, max: 5 }, durations: [5] },
};

export interface Text2VideoParams {
  model: ViduModelId | (string & {});
  /** Required; up to 5000 characters. */
  prompt: string;
  /** "general" (default) or "anime". Not effective on q2 / q3. */
  style?: ViduStyle;
  /** Seconds; bounds vary per model (default 5). */
  duration?: number;
  seed?: number;
  /** Default "16:9". 3:4 and 4:3 are q2/q3-only. */
  aspect_ratio?: ViduAspectRatio;
  /**
   * Default "720p" (viduq1: "1080p"). Autocomplete over every documented
   * value; `TEXT2VIDEO_SUPPORT` narrows it per model at runtime (360p is
   * img2video/reference2video-only, viduq1 is 1080p-only).
   */
  resolution?: ViduResolution;
  /** Default "auto". Not effective on q2 / q3. */
  movement_amplitude?: ViduMovementAmplitude;
  /** Background music. Default false; unavailable on q3. */
  bgm?: boolean;
  /** Direct audio-video generation. q3 only; defaults to true there. */
  audio?: boolean;
  /** Passthrough data echoed back on the task; up to 1048576 characters. */
  payload?: string;
  /** Off-peak mode: cheaper, completes within 48 hours. Default false. */
  off_peak?: boolean;
  callback_url?: string;
}

const videoSchema = z.looseObject({
  model: z.string(),
  prompt: promptSchema,
  style: z.enum(VIDU_STYLES).optional(),
  duration: z.number().int().optional(),
  seed: z.number().int().optional(),
  aspect_ratio: z.enum(VIDU_ASPECT_RATIOS).optional(),
  resolution: z.string().optional(),
  movement_amplitude: z.enum(VIDU_MOVEMENT_AMPLITUDES).optional(),
  bgm: z.boolean().optional(),
  audio: z.boolean().optional(),
  payload: payloadSchema.optional(),
  off_peak: z.boolean().optional(),
  callback_url: z.string().optional(),
});

/**
 * Params a given model accepts and then ignores. Every rule is flagged
 * `ignored`, so it warns rather than failing a request the API does fulfil.
 */
export const videoConstraints = {
  "viduq3-pro": q3Ignored(),
  "viduq3-turbo": q3Ignored(),
  viduq2: q2Ignored(),
} as const satisfies Readonly<Partial<Record<string, EndpointConstraints>>>;

function q3Ignored(): EndpointConstraints {
  return {
    deny: {
      style: { reason: "`style` is not effective on the q3 models.", source: SOURCE, ignored: true },
      movement_amplitude: {
        reason: "`movement_amplitude` does not take effect on the q3 models.",
        source: SOURCE,
        ignored: true,
      },
      bgm: {
        reason: "BGM is not available on the q3 models.",
        source: SOURCE,
        ignored: true,
      },
    },
  };
}

function q2Ignored(): EndpointConstraints {
  return {
    deny: {
      style: { reason: "`style` is not effective on the q2 models.", source: SOURCE, ignored: true },
      movement_amplitude: {
        reason: "`movement_amplitude` does not take effect on the q2 models.",
        source: SOURCE,
        ignored: true,
      },
      audio: {
        reason: "direct audio-video generation (`audio`) is only supported by the q3 models.",
        source: SOURCE,
        ignored: true,
      },
    },
  };
}

function estimate(params: Text2VideoParams, info: ModelInfo | undefined, _ctx: PipelineContext) {
  if (info === undefined) return {};
  const costUSD = videoCostUSD({
    model: params.model,
    route: "text2video",
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

function finalize(params: Text2VideoParams): unknown {
  const body = { ...params };
  return toValidated(body, {
    url: TEXT2VIDEO_URL,
    method: "POST",
    headers: VIDU_HEADERS,
  }, {
    sdk: { vidu: () => body },
  });
}

const validator = createValidator<Text2VideoParams, unknown>({
  endpoint: "vidu.video",
  schema: videoSchema,
  modelId: (params) => params.model,
  catalog: videoModels,
  constraints: videoConstraints,
  checks: [checkRouteSupport("text2video", TEXT2VIDEO_SUPPORT, SOURCE)],
  estimate,
  finalize,
});

/**
 * Validates raw wire params for Vidu `POST /ent/v2/text2video`.
 *
 * The returned object's enumerable props are the exact fetch JSON body.
 * `.toSdk("vidu")` returns it unchanged — Vidu ships no first-party SDK. Auth is
 * your job: add `authorization: Token <VIDU_API_KEY>` when fetching.
 *
 * ```ts
 * const params = vidu.video({
 *   model: "viduq3-pro",
 *   prompt: "An astronaut walks through fog in ultra-realistic fashion photography style",
 *   resolution: "1080p",
 *   duration: 8,
 * });
 * ```
 */
export const video = validator as unknown as {
  <T extends Text2VideoParams>(
    params: T & ExactKeys<T, Text2VideoParams>,
    options?: ValidateOptions<T>,
  ): Validated<T, ViduSdkTargets<T>>;
  safe<T extends Text2VideoParams>(
    params: T & ExactKeys<T, Text2VideoParams>,
    options?: ValidateOptions<T>,
  ): ValidateResult<Validated<T, ViduSdkTargets<T>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
