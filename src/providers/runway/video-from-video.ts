/**
 * Runway Video to Video — POST https://api.dev.runwayml.com/v1/video_to_video
 *
 * This is Runway's video-*editing* route: Aleph 2 (`aleph2`) restyles and
 * outpaints an existing clip, and the seedance / hailuo / gemini arms take an
 * input video plus references.
 *
 * Wire notes (verified against https://docs.dev.runwayml.com/openapi.json,
 * spec version 2024-11-06, on 2026-08-13):
 * - Every request must send the `X-Runway-Version: 2024-11-06` header; it is
 *   included in `.request.headers`.
 * - The input video field is per model: `aleph2` and `gemini_omni_flash` take
 *   `videoUri`, every seedance/hailuo arm takes `promptVideo`. unmodel never
 *   rewrites wire params, so sending the wrong one is reported as an
 *   unsupported_param rather than silently renamed.
 * - `aleph2` alone takes `keyframes` (1–5 timed guidance images, each pinned
 *   either by absolute `seconds` or by fractional `at`, with an optional
 *   `range` edit window) and `targetAspectRatio` (expand/outpaint). Its
 *   `ratio` field is marked deprecated in the spec and carries no enum.
 * - `aleph2` has no `duration`: the output length follows the input video,
 *   which "must be 30 seconds or shorter".
 * - The endpoint only starts a task and responds `{ id }`; polling
 *   GET /v1/tasks/{id} is out of unmodel's scope.
 * - Auth is `Authorization: Bearer <RUNWAYML_API_SECRET>` — unmodel never
 *   touches keys; add it yourself when fetching.
 */

import { z } from "zod";
import { createValidator, type PipelineContext } from "../../core/pipeline";
import { toValidated, type ExactKeys, type Validated } from "../../core/request";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";
import type { ModelInfo } from "../../core/catalog-types";
import type { EndpointConstraints } from "../../core/constraint-types";
import { videoModels, type RunwayVideoModelId } from "./models";
import {
  videoFromVideoConstraints,
  videoFromVideoRequired,
  videoFromVideoShapeRules,
  VIDEO_TO_VIDEO_MODELS,
  VIDEO_TO_VIDEO_SOURCE,
  MODELS_SOURCE,
  type RunwayVideoRatio,
  type RunwayVideoResolution,
  type RunwayTargetAspectRatio,
} from "./constraints";
import {
  RUNWAY_BASE_URL,
  RUNWAY_HEADERS,
  checkRequiredParams,
  checkRouteSupport,
  checkShapeRules,
  audioReferenceArraySchema,
  videoReferenceArraySchema,
  imageReferenceArraySchema,
  contentModerationSchema,
  imageUriSchema,
  videoUriSchema,
  seedSchema,
  type RunwayAudioReference,
  type RunwayVideoReference,
  type RunwayImageReference,
  type RunwayContentModeration,
} from "./shared";
import { videoCostUSD } from "./pricing";

export const VIDEO_TO_VIDEO_URL = `${RUNWAY_BASE_URL}/v1/video_to_video`;

// ---------------------------------------------------------------------------
// Wire types — mirror the raw JSON body exactly (camelCase on this API).
// ---------------------------------------------------------------------------

/** An optional edit window; the keyframe's timestamp must fall inside it. */
export interface RunwayKeyframeRange {
  /** Whole seconds from the start of the input video. */
  start_seconds: number;
  /** Exclusive end, in whole seconds. */
  end_seconds: number;
}

/**
 * A timed guidance image for `aleph2`. Pin it either by absolute `seconds`
 * (0–30) or by fractional `at` (0–1) — exactly one of the two, per the spec's
 * two-variant union. "All keyframes must either set a range or none may."
 */
export type RunwayVideoKeyframe =
  | { uri: string; seconds: number; range?: RunwayKeyframeRange }
  | { uri: string; at: number; range?: RunwayKeyframeRange };

export interface VideoToVideoParams {
  model: RunwayVideoModelId | (string & {});
  /** Input video — `aleph2` / `gemini_omni_flash` only. Must be ≤30s. */
  videoUri?: string;
  /** Input video — seedance / hailuo arms only. */
  promptVideo?: string;
  /** Prompt text; length caps vary per model (1000–15000 chars). */
  promptText?: string;
  /** `aleph2` only: 1–5 timed guidance images. */
  keyframes?: RunwayVideoKeyframe[];
  /** `aleph2` only: expand/outpaint target, e.g. "16:9". */
  targetAspectRatio?: RunwayTargetAspectRatio;
  /** Output ratio "W:H"; allowed values vary per model. Deprecated on aleph2. */
  ratio?: RunwayVideoRatio;
  /** Output duration in seconds; not a param of aleph2 / gemini_omni_flash. */
  duration?: number;
  /** `aleph2` only. Integer 0–4294967295. */
  seed?: number;
  /** seedance arms only. Defaults to true. */
  audio?: boolean;
  /** `seedance2_5` only. */
  mode?: "reference" | "extend";
  /** `hailuo3` only. */
  resolution?: RunwayVideoResolution;
  /** `aleph2` only. */
  contentModeration?: RunwayContentModeration;
  /** Image references — seedance / hailuo / gemini_omni_flash arms. */
  references?: RunwayImageReference[];
  /** Video references — seedance / hailuo arms only. */
  referenceVideos?: RunwayVideoReference[];
  /** Audio references — seedance / hailuo arms only. */
  referenceAudio?: RunwayAudioReference[];
  /** `aleph2` only. Non-mp4 adds 5 credits per second of output. */
  outputFormat?: "mp4" | "prores" | "png_sequence";
  /** `aleph2` only, with outputFormat "prores". Defaults to "4444". */
  proresProfile?: "422" | "4444" | "422 Proxy" | "422 LT" | "422 HQ" | "4444 XQ";
}

const keyframeRangeSchema = z.looseObject({
  start_seconds: z.number().int().min(0),
  end_seconds: z.number().int().positive(),
});

const videoKeyframeSchema = z.union([
  z.looseObject({
    uri: imageUriSchema,
    seconds: z.number().min(0).max(30),
    range: keyframeRangeSchema.optional(),
  }),
  z.looseObject({
    uri: imageUriSchema,
    at: z.number().min(0).max(1),
    range: keyframeRangeSchema.optional(),
  }),
]);

const videoFromVideoSchema = z.looseObject({
  model: z.string(),
  videoUri: videoUriSchema.optional(),
  promptVideo: videoUriSchema.optional(),
  promptText: z.string().optional(),
  keyframes: z.array(videoKeyframeSchema).optional(),
  targetAspectRatio: z.string().optional(),
  ratio: z.string().optional(),
  duration: z.number().optional(),
  seed: seedSchema.optional(),
  audio: z.boolean().optional(),
  mode: z.enum(["reference", "extend"]).optional(),
  resolution: z.string().optional(),
  contentModeration: contentModerationSchema.optional(),
  references: imageReferenceArraySchema.optional(),
  referenceVideos: videoReferenceArraySchema.optional(),
  referenceAudio: audioReferenceArraySchema.optional(),
  outputFormat: z.enum(["mp4", "prores", "png_sequence"]).optional(),
  proresProfile: z.enum(["422", "4444", "422 Proxy", "422 LT", "422 HQ", "4444 XQ"]).optional(),
});

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

/**
 * "All keyframes must either set a range or none may" — openapi.json. A mixed
 * array is rejected by the API, so it is rejected here.
 */
function checkKeyframeRanges(
  params: VideoToVideoParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const keyframes = params.keyframes;
  if (!Array.isArray(keyframes) || keyframes.length === 0) return;
  const withRange = keyframes.filter(
    (frame) => typeof frame === "object" && frame !== null && frame.range != null,
  ).length;
  if (withRange === 0 || withRange === keyframes.length) return;
  ctx.report({
    code: "invalid_shape",
    path: ["keyframes"],
    model: params.model,
    message: `All keyframes must either set a \`range\` or none may; got ${withRange} of ${keyframes.length} with a range.`,
    meta: { source: VIDEO_TO_VIDEO_SOURCE },
  });
}

// ---------------------------------------------------------------------------
// Estimation — credits × $0.01. aleph2 and gemini_omni_flash have no
// `duration` param, so those requests get no estimate (see ./pricing.ts).
// ---------------------------------------------------------------------------

function estimate(params: VideoToVideoParams, info: ModelInfo | undefined, _ctx: PipelineContext) {
  if (info === undefined) return {};
  // hailuo3 bills 2 credits per reference image on top of the per-second rate.
  const flatReferenceCount = params.model === "hailuo3" ? (params.references?.length ?? 0) : 0;
  const costUSD = videoCostUSD({
    model: params.model,
    route: "video_to_video",
    duration: params.duration,
    audio: params.audio,
    resolution: params.resolution,
    ratio: params.ratio,
    flatReferenceCount,
    ...(params.outputFormat !== undefined && { outputFormat: params.outputFormat }),
  });
  return costUSD === undefined ? {} : { costUSD };
}

/**
 * The one `.toSdk("runway")` target for this endpoint — the `@runwayml/sdk`
 * client takes wire-shaped params. Derived from the `sdk` literal in
 * `finalize`; it must stay an object type with no index signature, or
 * `toSdk` would accept any string.
 */
type RunwaySdkTargets<B> = { runway: () => B };

function finalize(params: VideoToVideoParams): unknown {
  const body = { ...params };
  return toValidated(body, {
    url: VIDEO_TO_VIDEO_URL,
    method: "POST",
    headers: RUNWAY_HEADERS,
  }, {
    sdk: { runway: () => body },
  });
}

const validator = createValidator<VideoToVideoParams, unknown>({
  endpoint: "runway.videoFromVideo",
  schema: videoFromVideoSchema,
  modelId: (params) => params.model,
  // Route-scoped catalog: image models are not valid here and warn as
  // unknown_model.
  catalog: videoModels,
  constraints: videoFromVideoConstraints,
  checks: [
    checkRouteSupport(
      "video_to_video",
      VIDEO_TO_VIDEO_MODELS,
      MODELS_SOURCE,
      'use POST /v1/image_to_video or /v1/text_to_video, or an editing model like "aleph2".',
    ),
    checkRequiredParams(videoFromVideoRequired, VIDEO_TO_VIDEO_SOURCE),
    checkShapeRules(videoFromVideoShapeRules, VIDEO_TO_VIDEO_SOURCE),
    checkKeyframeRanges,
  ],
  estimate,
  finalize,
});

/**
 * Validates raw wire params for Runway `POST /v1/video_to_video` — the
 * video-editing route (Aleph 2 restyle/outpaint, seedance/hailuo video-driven
 * generation).
 *
 * The returned object's enumerable props are the exact fetch JSON body.
 * `.request.headers` carries the required `X-Runway-Version` header (plus
 * content-type). `.toSdk("runway")` returns the body unchanged in shape —
 * `@runwayml/sdk`'s `client.videoToVideo.create(body)` params are
 * wire-shaped. Auth is your job: add
 * `authorization: Bearer <RUNWAYML_API_SECRET>` when fetching.
 *
 * ```ts
 * const params = runway.videoFromVideo({
 *   model: "aleph2",
 *   videoUri: "https://example.com/clip.mp4",
 *   promptText: "make it a rainy neon night",
 *   targetAspectRatio: "21:9",
 * });
 * ```
 */
export const videoFromVideo = validator as unknown as {
  <T extends VideoToVideoParams>(
    params: T & ExactKeys<T, VideoToVideoParams>,
    options?: ValidateOptions,
  ): Validated<T, RunwaySdkTargets<T>>;
  safe<T extends VideoToVideoParams>(
    params: T & ExactKeys<T, VideoToVideoParams>,
    options?: ValidateOptions,
  ): ValidateResult<Validated<T, RunwaySdkTargets<T>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
