/**
 * PixVerse Image-to-Video — POST https://app-api.pixverse.ai/openapi/v2/video/img/generate
 *
 * Wire notes (verified against the request schema on
 * https://docs.platform.pixverse.ai/image-to-video-and-video-templates-13016633e0
 * on 2026-11-12):
 * - `duration`, `model`, `prompt` and `quality` are required, and the image
 *   field follows the schema's `anyOf`: "Normal image generation requires
 *   img_id" (and sends no `template_id`), while a template task sends
 *   `template_id` plus "the image field and count required by that template
 *   (img_id or ordered img_ids)". `img_id` comes from
 *   `POST /openapi/v2/image/upload` (multipart, field `image`).
 * - `prompt` is capped at 2048 characters here, against 5000 on text-to-video.
 * - There is no `aspect_ratio` here — the input image sets it, and the schema
 *   has no such property.
 * - The version gates are text-to-video's: `generate_audio_switch` is v5.5+,
 *   `generate_multi_clip_switch` is v5.5/v6, `template_id` is refused on
 *   v6-max, and the sound-effect / lip-sync fields are "v5 and below". Two
 *   template rules sit on top: a `template_id` lifts the sound-effect /
 *   lip-sync gate (the template decides), and a `true` multi-clip switch is
 *   refused beside one.
 * - `motion_mode`, `camera_movement`, `negative_prompt` and
 *   `lip_sync_tts_switch` are not in the schema and stay typed; the
 *   error-details page's `MOTION_MODE_MODEL_UNSUPPORTED` and
 *   `CAMERA_MOVEMENT_MODEL_UNSUPPORTED` show the API reads the first two, and
 *   this page's 2026-05-14 archive carried `lip_sync_tts_switch` (commented
 *   out) in its request example
 *   (https://web.archive.org/web/20260514194912/https://docs.platform.pixverse.ai/image-to-video-generation-13016633e0).
 * - Headers: add `API-KEY` and a fresh `Ai-trace-id` UUID yourself.
 */

import { z } from "zod";
import { createValidator, type PipelineContext } from "../../core/pipeline";
import { toValidated, type ExactKeys, type Validated } from "../../core/request";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";
import type { ModelInfo } from "../../core/catalog-types";
import type { EndpointConstraints } from "../../core/constraint-types";
import { models, type PixverseModelId } from "./models";
import {
  DOCS_BASE,
  MULTI_CLIP_MODELS,
  PIXVERSE_BASE_URL,
  PIXVERSE_HEADERS,
  PIXVERSE_MOTION_MODES,
  PIXVERSE_QUALITIES,
  checkDuration,
  checkModelGatedFields,
  imagePromptSchema,
  seedSchema,
  type PixverseMotionMode,
  type PixverseQualityValue,
} from "./shared";
import { videoCostUSD } from "./pricing";

export const IMAGE_TO_VIDEO_URL = `${PIXVERSE_BASE_URL}/video/img/generate`;

const SOURCE = `${DOCS_BASE}/image-to-video-and-video-templates-13016633e0`;

/** The fields every image-to-video request carries, whichever image field it sends. */
interface ImageToVideoFields {
  /** Required; up to 2048 characters. */
  prompt: string;
  model: PixverseModelId | (string & {});
  /** Required. 1–15 on v6-max/v6/c1; a fixed list on the older models. */
  duration: number;
  /** Required. */
  quality: PixverseQualityValue;
  /** 0 – 2147483647. */
  seed?: number;
  /**
   * The id of a webhook configured in your PixVerse account — not a callback
   * URL. Omit it when polling the task.
   */
  webhook_id?: string;
  /** A multi-image template's ordered image ids, e.g. `[123, 456]`; sent instead of `img_id`. */
  img_ids?: number[];
  /** Inline audio. v5.5 / v5.6 / v6 / c1 / v6-max only; defaults to false. */
  generate_audio_switch?: boolean;
  /** Inline multi-clip output. v5.5 / v6 only, and not with a `template_id`; defaults to false. */
  generate_multi_clip_switch?: boolean;
  /** v5 and below, or with a `template_id`. */
  sound_effect_switch?: boolean;
  /** v5 and below, or with a `template_id`. */
  sound_effect_content?: string;
  /** The lip-sync switch, as this schema spells it. v5 and below, or with a `template_id`. */
  lip_sync_switch?: boolean;
  /** The lip-sync switch, as text-to-video spells it. v5 and below, or with a `template_id`. */
  lip_sync_tts_switch?: boolean;
  /** v5 and below, or with a `template_id`; roughly 140 UTF-8 characters. */
  lip_sync_tts_content?: string;
  /** v5 and below, or with a `template_id`. */
  lip_sync_tts_speaker_id?: string;
  /**
   * Motion preset. Not in the schema; a model that lacks the mode answers
   * `MOTION_MODE_MODEL_UNSUPPORTED`.
   */
  motion_mode?: PixverseMotionMode;
  /**
   * Camera preset, e.g. "zoom_in". Not in the schema; a model that lacks the
   * movement answers `CAMERA_MOVEMENT_MODEL_UNSUPPORTED`.
   */
  camera_movement?: string;
  /** Terms to steer the generation away from. */
  negative_prompt?: string;
}

/** Ordinary image-to-video: one uploaded image, and no template. */
interface ImageToVideoFromImage extends ImageToVideoFields {
  /** Required. From `POST /openapi/v2/image/upload`. */
  img_id: number;
  template_id?: never;
}

/** A template task: the template decides which image field it takes, and how many. */
interface ImageToVideoFromTemplate extends ImageToVideoFields {
  /** An activated template id. Not on v6-max. */
  template_id: number;
  /** A single-image template's image. A multi-image template takes `img_ids` instead. */
  img_id?: number;
}

/**
 * The request body, as the schema's `anyOf` shapes it: `img_id` without
 * `template_id`, or `template_id` with whichever image field its template
 * takes.
 */
export type ImageToVideoParams = ImageToVideoFromImage | ImageToVideoFromTemplate;

const videoFromImageSchema = z.looseObject({
  img_id: z.number().int().optional(),
  prompt: imagePromptSchema,
  model: z.string(),
  duration: z.number().int(),
  quality: z.enum(PIXVERSE_QUALITIES),
  seed: seedSchema.optional(),
  webhook_id: z.string().optional(),
  img_ids: z.array(z.number().int()).optional(),
  template_id: z.number().int().optional(),
  generate_audio_switch: z.boolean().optional(),
  generate_multi_clip_switch: z.boolean().optional(),
  sound_effect_switch: z.boolean().optional(),
  sound_effect_content: z.string().optional(),
  lip_sync_switch: z.boolean().optional(),
  lip_sync_tts_switch: z.boolean().optional(),
  lip_sync_tts_content: z.string().optional(),
  lip_sync_tts_speaker_id: z.string().optional(),
  motion_mode: z.enum(PIXVERSE_MOTION_MODES).optional(),
  camera_movement: z.string().optional(),
  negative_prompt: z.string().optional(),
});

/**
 * The first arm of the schema's `anyOf`: without a `template_id`, `img_id` is
 * required ("Uploaded image ID. Required for ordinary image generation.").
 */
function checkImageId(
  params: ImageToVideoParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (params.img_id != null || params.template_id != null) return;
  ctx.report({
    code: "invalid_shape",
    path: ["img_id"],
    model: params.model,
    message:
      "`img_id` is required unless `template_id` is set — upload the image with POST /openapi/v2/image/upload and pass the id it returns, or name the template this request fills.",
    meta: { source: SOURCE },
  });
}

/**
 * `img_ids` is documented as "only for multi-image templates", so it needs a
 * `template_id` alongside it.
 */
function checkMultiImage(
  params: ImageToVideoParams,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (info === undefined) return;
  if (!Array.isArray(params.img_ids) || params.img_ids.length === 0) return;
  if (params.template_id != null) return;
  ctx.report({
    code: "unsupported_param",
    path: ["img_ids"],
    model: params.model,
    message:
      "`img_ids` is only for multi-image templates — pass the `template_id` it belongs to, or send a single `img_id`.",
    meta: { source: SOURCE },
  });
}

/**
 * The second arm of the schema's request-body `allOf`: a `true` multi-clip
 * switch needs `model` v5.5 / v6 *and* no `template_id` ("Enable multi-clip
 * generation with V5.5 or V6. Not supported with other models or
 * template_id."). The model half is `checkModelGatedFields`'s, so this reports
 * only the template half, and never a second issue on the same field.
 */
function checkMultiClipTemplate(
  params: ImageToVideoParams,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (info === undefined) return;
  if (params.generate_multi_clip_switch !== true || params.template_id == null) return;
  if (!(MULTI_CLIP_MODELS as readonly string[]).includes(params.model)) return;
  ctx.report({
    code: "unsupported_param",
    path: ["generate_multi_clip_switch"],
    model: params.model,
    message:
      "`generate_multi_clip_switch` is not supported with `template_id` — PixVerse documents multi-clip as \"Not supported with other models or template_id\"; drop the switch or the template.",
    meta: { source: SOURCE },
  });
}

function estimate(params: ImageToVideoParams, info: ModelInfo | undefined, _ctx: PipelineContext) {
  if (info === undefined) return {};
  const costUSD = videoCostUSD({
    model: params.model,
    quality: params.quality,
    duration: params.duration,
    ...(params.generate_audio_switch !== undefined && { audio: params.generate_audio_switch }),
    ...(params.generate_multi_clip_switch !== undefined && {
      multiClip: params.generate_multi_clip_switch,
    }),
  });
  return costUSD === undefined ? {} : { costUSD };
}

/**
 * The one `.toSdk("pixverse")` target for this endpoint — PixVerse ships no
 * first-party SDK, so this is the wire body. Derived from the `sdk` literal
 * in `finalize`; it must stay an object type with no index signature, or
 * `toSdk` would accept any string.
 */
type PixverseSdkTargets<B> = { pixverse: () => B };

function finalize(params: ImageToVideoParams): unknown {
  const body = { ...params };
  return toValidated(body, {
    url: IMAGE_TO_VIDEO_URL,
    method: "POST",
    headers: PIXVERSE_HEADERS,
  }, {
    sdk: { pixverse: () => body },
  });
}

const validator = createValidator<ImageToVideoParams, unknown>({
  endpoint: "pixverse.videoFromImage",
  schema: videoFromImageSchema,
  modelId: (params) => params.model,
  catalog: models,
  checks: [
    checkDuration(SOURCE),
    checkModelGatedFields(SOURCE, { templateLiftsLegacyAudio: true }),
    checkMultiClipTemplate,
    checkImageId,
    checkMultiImage,
  ],
  estimate,
  finalize,
});

/**
 * Validates raw wire params for PixVerse
 * `POST /openapi/v2/video/img/generate`.
 *
 * ```ts
 * const params = pixverse.videoFromImage({
 *   model: "v6",
 *   img_id: 12345,
 *   prompt: "the camera pushes in as the neon flickers",
 *   quality: "720p",
 *   duration: 5,
 * });
 * ```
 */
export const videoFromImage = validator as unknown as {
  <T extends ImageToVideoParams>(
    params: T & ExactKeys<T, ImageToVideoParams>,
    options?: ValidateOptions<T>,
  ): Validated<T, PixverseSdkTargets<T>>;
  safe<T extends ImageToVideoParams>(
    params: T & ExactKeys<T, ImageToVideoParams>,
    options?: ValidateOptions<T>,
  ): ValidateResult<Validated<T, PixverseSdkTargets<T>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
