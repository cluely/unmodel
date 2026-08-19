/**
 * Kling Text to Video — POST https://api-singapore.klingai.com/v1/videos/text2video
 *
 * Exported as `kling.textToVideo`: the PRIMARY text-to-video validator.
 *
 * Wire notes (verified against
 * https://kling.ai/document-api/apiReference/model/textToVideo,
 * https://kling.ai/document-api/api/video/1-0/text-to-video and the capability
 * map on 2026-08-13):
 * - This is the `model_name`-in-the-body route, and the only Kling video route
 *   any reachable source corroborates: the endpoint line reads
 *   `POST https://api-singapore.klingai.com/v1/videos/text2video` and the
 *   polling route `GET /v1/videos/text2video/{task_id}`. A second,
 *   path-addressed family exists in the doc site's JS bundle but nothing can
 *   corroborate it — it ships as the EXPERIMENTAL `kling.textToVideoV3` (see
 *   ./text-to-video.ts), and its id spellings differ (`kling-3.0` there vs
 *   `kling-v3` here).
 * - `model_name` defaults to `kling-v1`, `mode` to `std` (720P), `duration` to
 *   "5" (a STRING on this route), `aspect_ratio` to "16:9", `sound` to "off"
 *   and `cfg_scale` to 0.5.
 * - `prompt` and `negative_prompt` cap at 2500 characters. Multi-shot rides on
 *   `multi_shot` + `shot_type` + `multi_prompt` (up to 6 storyboards of ≤512
 *   characters), and turning it on makes `prompt` inert.
 * - `cfg_scale` is documented as unsupported on the kling-v2.x models, and
 *   `camera_control` only on kling-v1 (720P, 5s) — both enforced from the
 *   capability map.
 * - Async: responds with a task object; poll
 *   `GET /v1/videos/text2video/{id}`. Auth is `Authorization: Bearer <key>`.
 */

import { z } from "zod";
import { createValidator, type PipelineContext } from "../../core/pipeline";
import { toValidated, type ExactKeys, type Validated } from "../../core/request";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";
import type { ModelInfo } from "../../core/catalog-types";
import type { EndpointConstraints } from "../../core/constraint-types";
import { v1VideoModels, type KlingV1VideoModelId } from "./models";
import {
  DOCS_BASE,
  KLING_ASPECT_RATIOS,
  KLING_BASE_URL,
  KLING_HEADERS,
  KLING_MODES,
  KLING_SOUND,
  type KlingAspectRatio,
  type KlingMode,
  type KlingWatermarkInfo,
} from "./shared";
import {
  DEFAULT_V1_MODEL,
  KLING_SHOT_TYPES,
  cameraControlSchema,
  checkV1Shape,
  checkV1Support,
  v1PromptSchema,
  multiPromptSchema,
  watermarkInfoSchema,
  type KlingCameraControl,
  type KlingShot,
  type KlingShotType,
  type KlingV1Duration,
} from "./v1-routes";
import { MODE_RESOLUTION, videoCostUSD } from "./pricing";

export const TEXT2VIDEO_URL = `${KLING_BASE_URL}/v1/videos/text2video`;

const SOURCE = `${DOCS_BASE}/apiReference/model/textToVideo`;

/** `model_name` values this route accepts. */
export const TEXT2VIDEO_MODELS = [
  "kling-v1",
  "kling-v1-6",
  "kling-v2-master",
  "kling-v2-1-master",
  "kling-v2-5-turbo",
  "kling-v2-6",
  "kling-v3",
] as const;

export interface TextToVideoParams {
  /** Defaults to "kling-v1". */
  model_name?: KlingV1VideoModelId | (string & {});
  /** Multi-shot generation; makes `prompt` inert. Defaults to false. */
  multi_shot?: boolean;
  /** Required when `multi_shot` is true. */
  shot_type?: KlingShotType;
  /** Up to 2500 characters. Required unless multi_shot + customize. */
  prompt?: string;
  /** Storyboards; required when `multi_shot` is true and `shot_type` is customize. */
  multi_prompt?: KlingShot[];
  /** Up to 2500 characters. */
  negative_prompt?: string;
  /** Native audio. Defaults to "off"; kling-v3 / kling-v2-6 only. */
  sound?: "on" | "off";
  /** 0–1. Defaults to 0.5. Not supported on the kling-v2.x models. */
  cfg_scale?: number;
  /** std = 720P, pro = 1080P, 4k = 4K. Defaults to "std". */
  mode?: KlingMode;
  /** kling-v1 only (720P, 5s). */
  camera_control?: KlingCameraControl;
  /** Defaults to "16:9". */
  aspect_ratio?: KlingAspectRatio;
  /**
   * Seconds, as a string. Defaults to "5". The union is the widest documented
   * range (kling-v3's 3–15s); `V1_MODEL_RULES` narrows it per `model_name` at
   * runtime — every other model here offers only "5" and "10".
   */
  duration?: KlingV1Duration;
  watermark_info?: KlingWatermarkInfo;
  callback_url?: string;
  external_task_id?: string;
}

const text2videoSchema = z.looseObject({
  model_name: z.string().optional(),
  multi_shot: z.boolean().optional(),
  shot_type: z.enum(KLING_SHOT_TYPES).optional(),
  prompt: v1PromptSchema.optional(),
  multi_prompt: multiPromptSchema.optional(),
  negative_prompt: v1PromptSchema.optional(),
  sound: z.enum(KLING_SOUND).optional(),
  cfg_scale: z.number().min(0).max(1).optional(),
  mode: z.enum(KLING_MODES).optional(),
  camera_control: cameraControlSchema.optional(),
  aspect_ratio: z.enum(KLING_ASPECT_RATIOS).optional(),
  duration: z.string().optional(),
  watermark_info: watermarkInfoSchema.optional(),
  callback_url: z.string().optional(),
  external_task_id: z.string().optional(),
});

function estimate(params: TextToVideoParams, info: ModelInfo | undefined, _ctx: PipelineContext) {
  if (info === undefined) return {};
  const duration = params.duration === undefined ? undefined : Number(params.duration);
  const costUSD = videoCostUSD({
    model: params.model_name ?? DEFAULT_V1_MODEL,
    resolution: MODE_RESOLUTION[params.mode ?? "std"] ?? "720p",
    ...(duration !== undefined && Number.isFinite(duration) && { duration }),
    ...(params.sound !== undefined && { audio: params.sound === "on" }),
  });
  return costUSD === undefined ? {} : { costUSD };
}

/**
 * The one `.toSdk("kling")` target for this endpoint — Kling ships no
 * official JS SDK, so this is the wire body. Derived from the `sdk` literal
 * in `finalize`; it must stay an object type with no index signature, or
 * `toSdk` would accept any string.
 */
type KlingSdkTargets<B> = { kling: () => B };

function finalize(params: TextToVideoParams): unknown {
  const body = { ...params };
  return toValidated(body, {
    url: TEXT2VIDEO_URL,
    method: "POST",
    headers: KLING_HEADERS,
  }, {
    sdk: { kling: () => body },
  });
}

const validator = createValidator<TextToVideoParams, unknown>({
  endpoint: "kling.textToVideo",
  schema: text2videoSchema,
  modelId: (params) => params.model_name ?? DEFAULT_V1_MODEL,
  catalog: v1VideoModels,
  checks: [
    checkV1Support("text2video", TEXT2VIDEO_MODELS, SOURCE),
    checkV1Shape(SOURCE),
  ],
  estimate,
  finalize,
});

/**
 * Validates raw wire params for Kling `POST /v1/videos/text2video`.
 *
 * The returned object's enumerable props are the exact fetch JSON body —
 * `model_name` is a BODY field on this route, so nothing is stripped. Auth is
 * your job: add `authorization: Bearer <key>` when fetching.
 *
 * ```ts
 * const params = kling.textToVideo({
 *   model_name: "kling-v2-6",
 *   prompt: "A slow push-in through a rainy neon alley",
 *   mode: "pro",
 *   duration: "10",
 * });
 * ```
 */
export const textToVideo = validator as unknown as {
  <T extends TextToVideoParams>(
    params: T & ExactKeys<T, TextToVideoParams>,
    options?: ValidateOptions,
  ): Validated<T, KlingSdkTargets<T>>;
  safe<T extends TextToVideoParams>(
    params: T & ExactKeys<T, TextToVideoParams>,
    options?: ValidateOptions,
  ): ValidateResult<Validated<T, KlingSdkTargets<T>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
