/**
 * Kling Image to Video — POST https://api-singapore.klingai.com/v1/videos/image2video
 *
 * Exported as `kling.videoFromImage`: the PRIMARY image-to-video validator.
 *
 * Wire notes (verified against
 * https://kling.ai/document-api/apiReference/model/imageToVideo,
 * https://kling.ai/document-api/api/video/1-0/image-to-video and the
 * capability map on 2026-08-13):
 * - The `model_name`-in-the-body route, and the corroborated one — see
 *   ./video.ts for why the path-addressed family ships EXPERIMENTAL as
 *   `kling.videoV3FromImage` (./video-v3-from-image.ts). Its model enum is wider
 *   than text2video's: it adds `kling-v1-5` and `kling-v2-1`, which are
 *   image-to-video-only.
 * - `image` is the start frame and `image_tail` the end frame (both an HTTPS
 *   URL or base64). `static_mask` / `dynamic_masks` drive motion brush,
 *   `element_list` and `voice_list` carry Elements and voices.
 * - There is no `aspect_ratio` here — the input image sets the frame.
 * - The same capability gates as text2video apply (`sound`, `cfg_scale`,
 *   `camera_control`, `multi_shot`), plus the shared shot-pairing rules.
 * - Async: responds with a task object; poll
 *   `GET /v1/videos/image2video/{id}`. Auth is `Authorization: Bearer <key>`.
 *
 * PER-MODEL VALUE SPACE. As on text2video, a literal `model_name` narrows
 * `mode`, `duration`, `sound`, `cfg_scale`, `camera_control` and `multi_shot`
 * to that model's own `V1_MODEL_RULES` row — the row `checkV1Support` reports
 * against and the row `./unified-video.ts` derives its nine `kling-v*` rows
 * from. See {@link ImageToVideoArm} and `V1CapabilityArm` in ./v1-routes.
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
  KLING_BASE_URL,
  KLING_HEADERS,
  KLING_MODES,
  KLING_SOUND,
  type KlingMode,
  type KlingWatermarkInfo,
} from "./shared";
import {
  DEFAULT_V1_MODEL,
  KLING_SHOT_TYPES,
  cameraControlSchema,
  checkV1Shape,
  checkV1Support,
  elementListSchema,
  v1PromptSchema,
  multiPromptSchema,
  watermarkInfoSchema,
  type KlingCameraControl,
  type KlingShot,
  type KlingShotType,
  type KlingV1Duration,
  type V1CapabilityArm,
  type V1NarrowedKey,
  type V1RuleModelId,
} from "./v1-routes";
import { MODE_RESOLUTION, videoCostUSD } from "./pricing";

export const IMAGE2VIDEO_URL = `${KLING_BASE_URL}/v1/videos/image2video`;

const SOURCE = `${DOCS_BASE}/apiReference/model/imageToVideo`;

/** `model_name` values this route accepts. */
export const IMAGE2VIDEO_MODELS = [
  "kling-v1",
  "kling-v1-5",
  "kling-v1-6",
  "kling-v2-master",
  "kling-v2-1",
  "kling-v2-1-master",
  "kling-v2-5-turbo",
  "kling-v2-6",
  "kling-v3",
] as const;

/**
 * A `model_name` this route serves AND the capability map bounds — the ids
 * that get a per-model body arm below. This enum is TEXT2VIDEO_MODELS plus
 * `kling-v1-5` and `kling-v2-1`, which are image-to-video-only.
 */
export type ImageToVideoModelId = Extract<(typeof IMAGE2VIDEO_MODELS)[number], V1RuleModelId>;

/** One motion-brush trajectory point. */
export interface KlingTrajectoryPoint {
  x: number;
  y: number;
}

/** A motion-brush mask plus the path its region should travel. */
export interface KlingDynamicMask {
  mask: string;
  trajectories: KlingTrajectoryPoint[];
}

/**
 * The WIDE body — every documented value of every model on this route. A
 * literal `model_name` gets {@link ImageToVideoArm} instead; this is what a
 * run-time id, a post-snapshot id and an omitted `model_name` fall back to.
 */
export interface ImageToVideoParams {
  /** Defaults to "kling-v1". */
  model_name?: KlingV1VideoModelId | (string & {});
  /** Start frame: an HTTPS URL or base64. */
  image?: string;
  /** End frame. */
  image_tail?: string;
  multi_shot?: boolean;
  shot_type?: KlingShotType;
  /** Up to 2500 characters. */
  prompt?: string;
  multi_prompt?: KlingShot[];
  /** Up to 2500 characters. */
  negative_prompt?: string;
  /** Elements to keep consistent, by id. */
  element_list?: Array<{ element_id: string | number }>;
  /** Voices referenced from the prompt. */
  voice_list?: unknown[];
  /** Native audio. Defaults to "off". */
  sound?: "on" | "off";
  /** 0–1. Defaults to 0.5. Not supported on the kling-v2.x models. */
  cfg_scale?: number;
  /** std = 720P, pro = 1080P, 4k = 4K. Defaults to "std". */
  mode?: KlingMode;
  /** Motion-brush static region. */
  static_mask?: string;
  /** Motion-brush moving regions. */
  dynamic_masks?: KlingDynamicMask[];
  /** kling-v1 only (720P, 5s). */
  camera_control?: KlingCameraControl;
  /**
   * Seconds, as a string. Defaults to "5". The union is the widest documented
   * range (kling-v3's 3–15s), which is what a run-time or post-snapshot
   * `model_name` gets; a LITERAL one is narrowed to its own `V1_MODEL_RULES`
   * row at compile time — every model but kling-v3 and kling-v2-6 offers only
   * "5" and "10".
   */
  duration?: KlingV1Duration;
  watermark_info?: KlingWatermarkInfo;
  callback_url?: string;
  external_task_id?: string;
}

/**
 * Resolves a `model_name` literal to its exact body — the image2video twin of
 * `TextToVideoArm`, off the same `V1_MODEL_RULES` row. See that type for why
 * the check is non-distributive and why the six keys are restated rather than
 * intersected.
 *
 * There is no `aspect_ratio` on this route at all (the input image sets the
 * frame), so the one field `V1CapabilityArm` deliberately leaves wide does not
 * arise here.
 */
export type ImageToVideoArm<M extends string> = [M] extends [ImageToVideoModelId]
  ? Omit<ImageToVideoParams, "model_name" | V1NarrowedKey> & {
      model_name?: M;
    } & V1CapabilityArm<M & ImageToVideoModelId>
  : ImageToVideoParams;

/** What `model_name` may be: a catalogued id, or any string at run time. */
type ImageToVideoModelInput = NonNullable<ImageToVideoParams["model_name"]>;

const videoFromImageSchema = z.looseObject({
  model_name: z.string().optional(),
  image: z.string().optional(),
  image_tail: z.string().optional(),
  multi_shot: z.boolean().optional(),
  shot_type: z.enum(KLING_SHOT_TYPES).optional(),
  prompt: v1PromptSchema.optional(),
  multi_prompt: multiPromptSchema.optional(),
  negative_prompt: v1PromptSchema.optional(),
  element_list: elementListSchema.optional(),
  voice_list: z.array(z.unknown()).optional(),
  sound: z.enum(KLING_SOUND).optional(),
  cfg_scale: z.number().min(0).max(1).optional(),
  mode: z.enum(KLING_MODES).optional(),
  static_mask: z.string().optional(),
  dynamic_masks: z
    .array(
      z.looseObject({
        mask: z.string(),
        trajectories: z.array(z.looseObject({ x: z.number().int(), y: z.number().int() })),
      }),
    )
    .optional(),
  camera_control: cameraControlSchema.optional(),
  duration: z.string().optional(),
  watermark_info: watermarkInfoSchema.optional(),
  callback_url: z.string().optional(),
  external_task_id: z.string().optional(),
});

/** Documented caps: up to 3 Elements and up to 2 voices per task. */
export const MAX_ELEMENT_LIST = 3;
export const MAX_VOICE_LIST = 2;

/**
 * The route's own pairing rules: at least one frame, the three
 * mutually-exclusive motion inputs, and the element/voice caps.
 */
function checkImageInput(
  params: ImageToVideoParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  // "At least one of `image` or `image_tail` must be provided; both cannot be empty".
  if (params.image == null && params.image_tail == null) {
    ctx.report({
      code: "invalid_shape",
      path: ["image"],
      message: "at least one of `image` (start frame) or `image_tail` (end frame) is required.",
      meta: { source: SOURCE },
    });
  }

  // "`image_tail`, `dynamic_masks`/`static_mask`, and `camera_control` are
  // mutually exclusive — only one can be used at a time."
  const exclusive: string[] = [];
  if (params.image_tail != null) exclusive.push("image_tail");
  if (params.dynamic_masks != null || params.static_mask != null) {
    exclusive.push("dynamic_masks/static_mask");
  }
  if (params.camera_control != null) exclusive.push("camera_control");
  if (exclusive.length > 1) {
    ctx.report({
      code: "unsupported_param",
      path: ["image_tail"],
      message: `\`image_tail\`, \`dynamic_masks\`/\`static_mask\` and \`camera_control\` are mutually exclusive; got ${exclusive.join(" + ")}.`,
      meta: { conflicting: exclusive, source: SOURCE },
    });
  }

  if (Array.isArray(params.element_list) && params.element_list.length > MAX_ELEMENT_LIST) {
    ctx.report({
      code: "invalid_shape",
      path: ["element_list"],
      message: `\`element_list\` supports up to ${MAX_ELEMENT_LIST} reference elements; got ${params.element_list.length}.`,
      meta: { max: MAX_ELEMENT_LIST, count: params.element_list.length, source: SOURCE },
    });
  }
  if (Array.isArray(params.voice_list)) {
    if (params.voice_list.length > MAX_VOICE_LIST) {
      ctx.report({
        code: "invalid_shape",
        path: ["voice_list"],
        message: `a task can reference up to ${MAX_VOICE_LIST} voices; got ${params.voice_list.length}.`,
        meta: { max: MAX_VOICE_LIST, count: params.voice_list.length, source: SOURCE },
      });
    }
    // "element_list and voice_list are mutually exclusive and cannot coexist".
    if (Array.isArray(params.element_list) && params.element_list.length > 0 && params.voice_list.length > 0) {
      ctx.report({
        code: "unsupported_param",
        path: ["voice_list"],
        message: "`element_list` and `voice_list` are mutually exclusive and cannot coexist.",
        meta: { source: SOURCE },
      });
    }
  }
}

function estimate(params: ImageToVideoParams, info: ModelInfo | undefined, _ctx: PipelineContext) {
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

function finalize(params: ImageToVideoParams): unknown {
  const body = { ...params };
  return toValidated(body, {
    url: IMAGE2VIDEO_URL,
    method: "POST",
    headers: KLING_HEADERS,
  }, {
    sdk: { kling: () => body },
  });
}

const validator = createValidator<ImageToVideoParams, unknown>({
  endpoint: "kling.videoFromImage",
  schema: videoFromImageSchema,
  modelId: (params) => params.model_name ?? DEFAULT_V1_MODEL,
  catalog: v1VideoModels,
  checks: [
    checkV1Support("image2video", IMAGE2VIDEO_MODELS, SOURCE),
    checkV1Shape(SOURCE),
    checkImageInput,
  ],
  estimate,
  finalize,
});

/**
 * Validates raw wire params for Kling `POST /v1/videos/image2video`.
 *
 * ```ts
 * const params = kling.videoFromImage({
 *   model_name: "kling-v2-1",
 *   image: "https://example.com/frame.png",
 *   prompt: "she turns to the window as the train moves",
 *   mode: "pro",
 *   duration: "5",
 * });
 * ```
 */
export const videoFromImage = validator as unknown as {
  <M extends ImageToVideoModelInput, T extends ImageToVideoArm<M>>(
    params: T & ImageToVideoArm<M> & { model_name?: M } & ExactKeys<T, ImageToVideoArm<M>>,
    options?: ValidateOptions<T>,
  ): Validated<T, KlingSdkTargets<T>>;
  safe<M extends ImageToVideoModelInput, T extends ImageToVideoArm<M>>(
    params: T & ImageToVideoArm<M> & { model_name?: M } & ExactKeys<T, ImageToVideoArm<M>>,
    options?: ValidateOptions<T>,
  ): ValidateResult<Validated<T, KlingSdkTargets<T>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
