/**
 * Runway Image to Video — POST https://api.dev.runwayml.com/v1/image_to_video
 *
 * Wire notes (verified against https://docs.dev.runwayml.com/openapi.json,
 * spec version 2024-11-06, and @runwayml/sdk on 2026-08-13):
 * - Every request must send the `X-Runway-Version: 2024-11-06` header; it is
 *   included in `.request.headers`.
 * - The request body is a strict per-model union in the spec; unmodel keeps
 *   one loose shape and enforces per-model required fields, ratio/duration
 *   enums, and unsupported params via the constraint tables.
 * - The endpoint only starts a task and responds `{ id }`; polling
 *   GET /v1/tasks/{id} is out of unmodel's scope.
 * - Per-model prompt-image rules ARE enforced: how many images the arm takes,
 *   whether each needs a `position`, and which positions are legal (most arms
 *   take exactly one image that must be `position: "first"`; veo3.1 takes up
 *   to two "first"/"last"; the seedance arms take an unbounded array).
 * - `promptText` is capped per model (1000 chars on the gen4/veo arms, 15000
 *   on seedance2_5) and enforced from the same table.
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
  imageToVideoConstraints,
  imageToVideoRequired,
  imageToVideoShapeRules,
  IMAGE_TO_VIDEO_MODELS,
  IMAGE_TO_VIDEO_SOURCE,
  MODELS_SOURCE,
  type RunwayVideoRatio,
  type RunwayVideoResolution,
} from "./constraints";
import {
  RUNWAY_BASE_URL,
  RUNWAY_HEADERS,
  checkRequiredParams,
  checkRouteSupport,
  checkShapeRules,
  promptImageCount,
  promptImageSchema,
  audioReferenceArraySchema,
  contentModerationSchema,
  seedSchema,
  type RunwayPromptImage,
  type RunwayAudioReference,
  type RunwayContentModeration,
} from "./shared";
import { videoCostUSD } from "./pricing";

export const IMAGE_TO_VIDEO_URL = `${RUNWAY_BASE_URL}/v1/image_to_video`;

// ---------------------------------------------------------------------------
// Wire types — mirror the raw JSON body exactly (camelCase on this API).
// Which fields a given model accepts/requires is per-model; the constraint
// tables enforce it at runtime (see ./constraints.ts).
// ---------------------------------------------------------------------------

export interface ImageToVideoParams {
  model: RunwayVideoModelId | (string & {});
  /** Required by every model on this route: first frame / keyframes / refs. */
  promptImage: string | RunwayPromptImage[];
  /** Prompt text; length caps vary per model (1000–15000 chars). */
  promptText?: string;
  /** Output ratio "W:H"; allowed values vary per model. */
  ratio?: RunwayVideoRatio;
  /** Output duration in seconds; allowed values vary per model. */
  duration?: number;
  /** gen4.5 / gen4_turbo only. Integer 0–4294967295. */
  seed?: number;
  /** veo3.1 / veo3.1_fast / seedance models only. Defaults to true. */
  audio?: boolean;
  /** veo3.1 / veo3.1_fast only. */
  negativePrompt?: string;
  /** hailuo3 / happyhorse_1_0 / grok_imagine_1_5 only. */
  resolution?: RunwayVideoResolution;
  /** gen4.5 / gen4_turbo only. */
  contentModeration?: RunwayContentModeration;
  /** hailuo3 / seedance models only. */
  referenceAudio?: RunwayAudioReference[];
  /** gen4.5 only. */
  outputFormat?: "mp4" | "prores" | "png_sequence";
  /** gen4.5 only, with outputFormat "prores". */
  proresProfile?: "422" | "4444" | "422 Proxy" | "422 LT" | "422 HQ" | "4444 XQ";
}

const imageToVideoSchema = z.looseObject({
  model: z.string(),
  promptImage: promptImageSchema,
  promptText: z.string().optional(),
  ratio: z.string().optional(),
  duration: z.number().optional(),
  seed: seedSchema.optional(),
  audio: z.boolean().optional(),
  negativePrompt: z.string().optional(),
  resolution: z.string().optional(),
  contentModeration: contentModerationSchema.optional(),
  referenceAudio: audioReferenceArraySchema.optional(),
  outputFormat: z.enum(["mp4", "prores", "png_sequence"]).optional(),
  proresProfile: z.enum(["422", "4444", "422 Proxy", "422 LT", "422 HQ", "4444 XQ"]).optional(),
});

// ---------------------------------------------------------------------------
// Estimation — credits × $0.01 (see ./pricing.ts for tiers, minimums, and
// what the estimate excludes). No duration → no estimate.
// ---------------------------------------------------------------------------

function estimate(params: ImageToVideoParams, info: ModelInfo | undefined, _ctx: PipelineContext) {
  if (info === undefined) return {};
  let flatReferenceCount = 0;
  if (params.model === "grok_imagine_1_5") {
    // 1 credit per image or audio reference, including the start frame.
    flatReferenceCount = promptImageCount(params.promptImage) + (params.referenceAudio?.length ?? 0);
  } else if (params.model === "hailuo3") {
    // 2 credits per reference image. hailuo3's promptImage takes up to 9
    // entries here, so every entry is charged (worst case).
    flatReferenceCount = promptImageCount(params.promptImage);
  }
  const costUSD = videoCostUSD({
    model: params.model,
    route: "image_to_video",
    duration: params.duration,
    audio: params.audio,
    resolution: params.resolution,
    ratio: params.ratio,
    flatReferenceCount,
    // gemini_omni_flash image-to-video adds 1 credit for the first frame.
    flatExtraCredits: params.model === "gemini_omni_flash" ? 1 : 0,
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

function finalize(params: ImageToVideoParams): unknown {
  const body = { ...params };
  return toValidated(body, {
    url: IMAGE_TO_VIDEO_URL,
    method: "POST",
    headers: RUNWAY_HEADERS,
  }, {
    sdk: { runway: () => body },
  });
}

const validator = createValidator<ImageToVideoParams, unknown>({
  endpoint: "runway.imageToVideo",
  schema: imageToVideoSchema,
  modelId: (params) => params.model,
  // Route-scoped catalog: image models are not valid here and warn as
  // unknown_model.
  catalog: videoModels,
  constraints: imageToVideoConstraints,
  checks: [
    checkRouteSupport(
      "image_to_video",
      IMAGE_TO_VIDEO_MODELS,
      MODELS_SOURCE,
      'use the route that model does support, e.g. POST /v1/video_to_video for "aleph2".',
    ),
    checkRequiredParams(imageToVideoRequired, IMAGE_TO_VIDEO_SOURCE),
    checkShapeRules(imageToVideoShapeRules, IMAGE_TO_VIDEO_SOURCE),
  ],
  estimate,
  finalize,
});

/**
 * Validates raw wire params for Runway `POST /v1/image_to_video`.
 *
 * The returned object's enumerable props are the exact fetch JSON body.
 * `.request.headers` carries the required `X-Runway-Version` header (plus
 * content-type). `.toSdk("runway")` returns the body unchanged in shape —
 * `@runwayml/sdk`'s `client.imageToVideo.create(body)` params are
 * wire-shaped. Auth is your job: add
 * `authorization: Bearer <RUNWAYML_API_SECRET>` when fetching.
 *
 * ```ts
 * const params = runway.imageToVideo({
 *   model: "gen4_turbo",
 *   promptImage: "https://example.com/frame.png",
 *   ratio: "1280:720",
 *   duration: 5,
 * });
 * const res = await fetch(params.request.url, {
 *   method: params.request.method,
 *   headers: {
 *     ...params.request.headers,
 *     authorization: `Bearer ${process.env.RUNWAYML_API_SECRET}`,
 *   },
 *   body: JSON.stringify(params),
 * });
 * const { id } = await res.json(); // poll GET /v1/tasks/{id}
 * ```
 */
export const imageToVideo = validator as unknown as {
  <T extends ImageToVideoParams>(
    params: T & ExactKeys<T, ImageToVideoParams>,
    options?: ValidateOptions,
  ): Validated<T, RunwaySdkTargets<T>>;
  safe<T extends ImageToVideoParams>(
    params: T & ExactKeys<T, ImageToVideoParams>,
    options?: ValidateOptions,
  ): ValidateResult<Validated<T, RunwaySdkTargets<T>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
