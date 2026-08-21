/**
 * PixVerse Image-to-Video — POST https://app-api.pixverse.ai/openapi/v2/video/img/generate
 *
 * Wire notes (verified against the request schema on
 * https://docs.platform.pixverse.ai/image-to-video-generation-13016633e0 on
 * 2026-08-13):
 * - `duration`, `img_id`, `model`, `prompt` and `quality` are required.
 *   `img_id` comes from `POST /openapi/v2/image/upload` (multipart, field
 *   `image`); `img_ids` is the multi-image variant and is only for multi-image
 *   templates.
 * - There is no `aspect_ratio` here — the input image sets it (confirmed by
 *   the V6 parameter matrix, which marks aspect_ratio ❌ for i2v).
 * - The same version gates as text-to-video apply: `generate_audio_switch` is
 *   v5.5+, `generate_multi_clip_switch` is v5.5/v6, and the sound-effect /
 *   lip-sync TTS fields are "v5 and below" (or with a `template_id`).
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
  PIXVERSE_BASE_URL,
  PIXVERSE_HEADERS,
  PIXVERSE_MOTION_MODES,
  PIXVERSE_QUALITIES,
  checkDuration,
  checkModelGatedFields,
  promptSchema,
  seedSchema,
  type PixverseMotionMode,
  type PixverseQualityValue,
} from "./shared";
import { videoCostUSD } from "./pricing";

export const IMAGE_TO_VIDEO_URL = `${PIXVERSE_BASE_URL}/video/img/generate`;

const SOURCE = `${DOCS_BASE}/image-to-video-generation-13016633e0`;

export interface ImageToVideoParams {
  /** Required. From `POST /openapi/v2/image/upload`. */
  img_id: number;
  /** Required; up to 5000 characters. */
  prompt: string;
  model: PixverseModelId | (string & {});
  /** Required. 1–15 on v6/c1; a fixed list on the older models. */
  duration: number;
  /** Required. */
  quality: PixverseQualityValue;
  /** 0 – 2147483647. */
  seed?: number;
  /** Multi-image templates only, e.g. `[123, 456]`. */
  img_ids?: number[];
  /** An activated template id. */
  template_id?: number;
  /** Inline audio. v5.5 / v5.6 / v6 / c1 only; defaults to false. */
  generate_audio_switch?: boolean;
  /** Inline multi-clip output. v5.5 / v6 only; defaults to false. */
  generate_multi_clip_switch?: boolean;
  /** v5 and below, or with a `template_id`. */
  sound_effect_switch?: boolean;
  sound_effect_content?: string;
  lip_sync_tts_switch?: boolean;
  /** Roughly 140 UTF-8 characters. */
  lip_sync_tts_content?: string;
  lip_sync_tts_speaker_id?: string;
  /** Motion preset; sent uncommented in the official request example. */
  motion_mode?: PixverseMotionMode;
  /** Camera preset, e.g. "zoom_in". */
  camera_movement?: string;
  /** Terms to steer the generation away from. */
  negative_prompt?: string;
}

const videoFromImageSchema = z.looseObject({
  img_id: z.number().int(),
  prompt: promptSchema,
  model: z.string(),
  duration: z.number().int(),
  quality: z.enum(PIXVERSE_QUALITIES),
  seed: seedSchema.optional(),
  img_ids: z.array(z.number().int()).optional(),
  template_id: z.number().int().optional(),
  generate_audio_switch: z.boolean().optional(),
  generate_multi_clip_switch: z.boolean().optional(),
  sound_effect_switch: z.boolean().optional(),
  sound_effect_content: z.string().optional(),
  lip_sync_tts_switch: z.boolean().optional(),
  lip_sync_tts_content: z.string().optional(),
  lip_sync_tts_speaker_id: z.string().optional(),
  motion_mode: z.enum(PIXVERSE_MOTION_MODES).optional(),
  camera_movement: z.string().optional(),
  negative_prompt: z.string().optional(),
});

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
    ...(params.motion_mode !== undefined && { motionMode: params.motion_mode }),
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
  checks: [checkDuration(SOURCE), checkModelGatedFields(SOURCE), checkMultiImage],
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
