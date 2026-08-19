/**
 * PixVerse Text-to-Video — POST https://app-api.pixverse.ai/openapi/v2/video/text/generate
 *
 * Wire notes (verified against the request schema on
 * https://docs.platform.pixverse.ai/text-to-video-generation-13016634e0 on
 * 2026-08-13):
 * - `prompt`, `model`, `aspect_ratio`, `duration` and `quality` are all
 *   required by the schema.
 * - `aspect_ratio` is wider on v6 / c1 (it adds 2:3, 3:2 and 21:9); `duration`
 *   is 1–15s on v6/c1 but a fixed value list below that; `generate_audio_switch`
 *   is v5.5+, `generate_multi_clip_switch` is v5.5/v6, and the sound-effect /
 *   lip-sync TTS fields are "v5 and below".
 * - Async: responds `{ ErrCode, ErrMsg, Resp: { video_id } }`; poll
 *   `GET /openapi/v2/video/result/{video_id}`.
 * - Headers: add `API-KEY` and a fresh `Ai-trace-id` UUID yourself — unmodel
 *   never touches credentials and cannot mint a per-request trace id.
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
  LEGACY_ASPECT_RATIOS,
  PIXVERSE_BASE_URL,
  PIXVERSE_HEADERS,
  PIXVERSE_MOTION_MODES,
  PIXVERSE_QUALITIES,
  WIDE_ASPECT_RATIOS,
  checkDuration,
  checkModelGatedFields,
  promptSchema,
  seedSchema,
  type PixverseAspectRatio,
  type PixverseMotionMode,
  type PixverseQualityValue,
} from "./shared";
import { videoCostUSD } from "./pricing";

export const TEXT_TO_VIDEO_URL = `${PIXVERSE_BASE_URL}/video/text/generate`;

const SOURCE = `${DOCS_BASE}/text-to-video-generation-13016634e0`;

export interface TextToVideoParams {
  /** Required; up to 5000 characters. */
  prompt: string;
  model: PixverseModelId | (string & {});
  /** Required. v6 / c1 also accept 2:3, 3:2 and 21:9. */
  aspect_ratio: PixverseAspectRatio;
  /** Required. 1–15 on v6/c1; a fixed list on the older models. */
  duration: number;
  /** Required. */
  quality: PixverseQualityValue;
  /** 0 – 2147483647. */
  seed?: number;
  /** Inline audio. v5.5 / v5.6 / v6 / c1 only; defaults to false. */
  generate_audio_switch?: boolean;
  /** Inline multi-clip output. v5.5 / v6 only; defaults to false. */
  generate_multi_clip_switch?: boolean;
  /** v5 and below. */
  sound_effect_switch?: boolean;
  /** v5 and below; auto-generated when blank. */
  sound_effect_content?: string;
  /** v5 and below; defaults to false. */
  lip_sync_tts_switch?: boolean;
  /** v5 and below; roughly 140 UTF-8 characters. */
  lip_sync_tts_content?: string;
  /** v5 and below; an id from the Speech (Lipsync) TTS list endpoint. */
  lip_sync_tts_speaker_id?: string;
  /**
   * Motion preset. Not in the schema table but sent in the official request
   * examples and priced on the v4.5/v4/v3.5 credit table.
   */
  motion_mode?: PixverseMotionMode;
  /** Camera preset, e.g. "zoom_in" — commented into the official example. */
  camera_movement?: string;
  /** An activated template id. */
  template_id?: number;
}

const videoSchema = z.looseObject({
  prompt: promptSchema,
  model: z.string(),
  aspect_ratio: z.string(),
  duration: z.number().int(),
  quality: z.enum(PIXVERSE_QUALITIES),
  seed: seedSchema.optional(),
  generate_audio_switch: z.boolean().optional(),
  generate_multi_clip_switch: z.boolean().optional(),
  sound_effect_switch: z.boolean().optional(),
  sound_effect_content: z.string().optional(),
  lip_sync_tts_switch: z.boolean().optional(),
  lip_sync_tts_content: z.string().optional(),
  lip_sync_tts_speaker_id: z.string().optional(),
  motion_mode: z.enum(PIXVERSE_MOTION_MODES).optional(),
  camera_movement: z.string().optional(),
  template_id: z.number().int().optional(),
});

/** Per-model `aspect_ratio` narrowing — v6 and c1 get the wide set. */
export const videoConstraints = {
  v6: { enums: { aspect_ratio: WIDE_ASPECT_RATIOS } },
  c1: { enums: { aspect_ratio: WIDE_ASPECT_RATIOS } },
  "v5.6": { enums: { aspect_ratio: LEGACY_ASPECT_RATIOS } },
  "v5.5": { enums: { aspect_ratio: LEGACY_ASPECT_RATIOS } },
  v5: { enums: { aspect_ratio: LEGACY_ASPECT_RATIOS } },
  "v4.5": { enums: { aspect_ratio: LEGACY_ASPECT_RATIOS } },
  v4: { enums: { aspect_ratio: LEGACY_ASPECT_RATIOS } },
  "v3.5": { enums: { aspect_ratio: LEGACY_ASPECT_RATIOS } },
} as const satisfies Readonly<Partial<Record<string, EndpointConstraints>>>;

function estimate(params: TextToVideoParams, info: ModelInfo | undefined, _ctx: PipelineContext) {
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

function finalize(params: TextToVideoParams): unknown {
  const body = { ...params };
  return toValidated(body, {
    url: TEXT_TO_VIDEO_URL,
    method: "POST",
    headers: PIXVERSE_HEADERS,
  }, {
    sdk: { pixverse: () => body },
  });
}

const validator = createValidator<TextToVideoParams, unknown>({
  endpoint: "pixverse.video",
  schema: videoSchema,
  modelId: (params) => params.model,
  catalog: models,
  constraints: videoConstraints,
  checks: [checkDuration(SOURCE), checkModelGatedFields(SOURCE)],
  estimate,
  finalize,
});

/**
 * Validates raw wire params for PixVerse
 * `POST /openapi/v2/video/text/generate`.
 *
 * The returned object's enumerable props are the exact fetch JSON body.
 * `.toSdk("pixverse")` returns it unchanged — PixVerse ships no first-party SDK. Auth
 * and tracing are your job: add `API-KEY` and a fresh `Ai-trace-id` UUID.
 *
 * ```ts
 * const params = pixverse.video({
 *   model: "v6",
 *   prompt: "a neon-lit alley in the rain",
 *   aspect_ratio: "16:9",
 *   quality: "720p",
 *   duration: 5,
 * });
 * const res = await fetch(params.request.url, {
 *   method: params.request.method,
 *   headers: {
 *     ...params.request.headers,
 *     "API-KEY": process.env.PIXVERSE_API_KEY!,
 *     "Ai-trace-id": crypto.randomUUID(),
 *   },
 *   body: JSON.stringify(params),
 * });
 * ```
 */
export const video = validator as unknown as {
  <T extends TextToVideoParams>(
    params: T & ExactKeys<T, TextToVideoParams>,
    options?: ValidateOptions,
  ): Validated<T, PixverseSdkTargets<T>>;
  safe<T extends TextToVideoParams>(
    params: T & ExactKeys<T, TextToVideoParams>,
    options?: ValidateOptions,
  ): ValidateResult<Validated<T, PixverseSdkTargets<T>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
