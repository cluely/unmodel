/**
 * Runway Text to Video — POST https://api.dev.runwayml.com/v1/text_to_video
 *
 * Wire notes (verified against https://docs.dev.runwayml.com/openapi.json,
 * spec version 2024-11-06, and @runwayml/sdk on 2026-08-13):
 * - Every request must send the `X-Runway-Version: 2024-11-06` header; it is
 *   included in `.request.headers`.
 * - Unlike image_to_video there is no `promptImage`; image context comes via
 *   per-model `references` arrays. `promptText` is required by every model's
 *   arm except seedance2_5.
 * - The endpoint only starts a task and responds `{ id }`; polling
 *   GET /v1/tasks/{id} is out of unmodel's scope.
 * - gen4_turbo (image_to_video-only) and aleph2 (video_to_video-only) have no
 *   arm here — a checker reports them as unsupported_capability.
 * - `promptText` and every reference array are capped per model and enforced
 *   from the shape-rules table in ./constraints.ts.
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
  videoConstraints,
  videoRequired,
  videoShapeRules,
  TEXT_TO_VIDEO_MODELS,
  TEXT_TO_VIDEO_SOURCE,
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
  audioReferenceArraySchema,
  videoReferenceArraySchema,
  imageReferenceArraySchema,
  contentModerationSchema,
  seedSchema,
  type RunwayAudioReference,
  type RunwayVideoReference,
  type RunwayImageReference,
  type RunwayContentModeration,
} from "./shared";
import { videoCostUSD } from "./pricing";

export const TEXT_TO_VIDEO_URL = `${RUNWAY_BASE_URL}/v1/text_to_video`;

// ---------------------------------------------------------------------------
// Wire types — mirror the raw JSON body exactly (camelCase on this API).
// Which fields a given model accepts/requires is per-model; the constraint
// tables enforce it at runtime (see ./constraints.ts).
// ---------------------------------------------------------------------------

export interface TextToVideoParams {
  /** `gen4_turbo` (image-to-video only) and `aleph2` (video-to-video only)
   * have no arm on this route. */
  model: Exclude<RunwayVideoModelId, "gen4_turbo" | "aleph2"> | (string & {});
  /** Required for every model except seedance2_5; caps vary (1000–15000). */
  promptText?: string;
  /** Output ratio "W:H"; allowed values vary per model. */
  ratio?: RunwayVideoRatio;
  /** Output duration in seconds; allowed values vary per model. */
  duration?: number;
  /** gen4.5 only. Integer 0–4294967295. */
  seed?: number;
  /** veo3.1 / veo3.1_fast / seedance models only. Defaults to true. */
  audio?: boolean;
  /** veo3.1 / veo3.1_fast only. */
  negativePrompt?: string;
  /** hailuo3 / grok_imagine_1_5 only. */
  resolution?: RunwayVideoResolution;
  /** gen4.5 only. */
  contentModeration?: RunwayContentModeration;
  /** Image references — hailuo3 / seedance / grok_imagine_1_5 only. */
  references?: RunwayImageReference[];
  /** Video references — hailuo3 / seedance models only. */
  referenceVideos?: RunwayVideoReference[];
  /** Audio references — hailuo3 / seedance / grok_imagine_1_5 only. */
  referenceAudio?: RunwayAudioReference[];
  /** gen4.5 only. */
  outputFormat?: "mp4" | "prores" | "png_sequence";
  /** gen4.5 only, with outputFormat "prores". */
  proresProfile?: "422" | "4444" | "422 Proxy" | "422 LT" | "422 HQ" | "4444 XQ";
}

const videoSchema = z.looseObject({
  model: z.string(),
  promptText: z.string().optional(),
  ratio: z.string().optional(),
  duration: z.number().optional(),
  seed: seedSchema.optional(),
  audio: z.boolean().optional(),
  negativePrompt: z.string().optional(),
  resolution: z.string().optional(),
  contentModeration: contentModerationSchema.optional(),
  references: imageReferenceArraySchema.optional(),
  referenceVideos: videoReferenceArraySchema.optional(),
  referenceAudio: audioReferenceArraySchema.optional(),
  outputFormat: z.enum(["mp4", "prores", "png_sequence"]).optional(),
  proresProfile: z.enum(["422", "4444", "422 Proxy", "422 LT", "422 HQ", "4444 XQ"]).optional(),
});

// ---------------------------------------------------------------------------
// Estimation — credits × $0.01 (see ./pricing.ts for tiers, minimums, and
// what the estimate excludes). No duration → no estimate.
// ---------------------------------------------------------------------------

function estimate(params: TextToVideoParams, info: ModelInfo | undefined, _ctx: PipelineContext) {
  if (info === undefined) return {};
  let flatReferenceCount = 0;
  if (params.model === "grok_imagine_1_5") {
    // 1 credit per image or audio reference.
    flatReferenceCount = (params.references?.length ?? 0) + (params.referenceAudio?.length ?? 0);
  } else if (params.model === "hailuo3") {
    // 2 credits per reference image (video references bill per second of
    // input and are not estimable from a URL).
    flatReferenceCount = params.references?.length ?? 0;
  }
  const costUSD = videoCostUSD({
    model: params.model,
    route: "text_to_video",
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

function finalize(params: TextToVideoParams): unknown {
  const body = { ...params };
  return toValidated(body, {
    url: TEXT_TO_VIDEO_URL,
    method: "POST",
    headers: RUNWAY_HEADERS,
  }, {
    sdk: { runway: () => body },
  });
}

const validator = createValidator<TextToVideoParams, unknown>({
  endpoint: "runway.video",
  schema: videoSchema,
  modelId: (params) => params.model,
  // Route-scoped catalog: image models are not valid here and warn as
  // unknown_model.
  catalog: videoModels,
  constraints: videoConstraints,
  checks: [
    checkRouteSupport(
      "text_to_video",
      TEXT_TO_VIDEO_MODELS,
      MODELS_SOURCE,
      'use the route that model does support — POST /v1/image_to_video for "gen4_turbo", POST /v1/video_to_video for "aleph2" — or a text-capable model like "gen4.5".',
    ),
    checkRequiredParams(videoRequired, TEXT_TO_VIDEO_SOURCE),
    checkShapeRules(videoShapeRules, TEXT_TO_VIDEO_SOURCE),
  ],
  estimate,
  finalize,
});

/**
 * Validates raw wire params for Runway `POST /v1/text_to_video`.
 *
 * The returned object's enumerable props are the exact fetch JSON body.
 * `.request.headers` carries the required `X-Runway-Version` header (plus
 * content-type). `.toSdk("runway")` returns the body unchanged in shape —
 * `@runwayml/sdk`'s `client.textToVideo.create(body)` params are
 * wire-shaped. Auth is your job: add
 * `authorization: Bearer <RUNWAYML_API_SECRET>` when fetching.
 *
 * ```ts
 * const params = runway.video({
 *   model: "gen4.5",
 *   promptText: "A slow dolly shot through a neon-lit alley in the rain",
 *   ratio: "1280:720",
 *   duration: 5,
 * });
 * ```
 */
export const video = validator as unknown as {
  <T extends TextToVideoParams>(
    params: T & ExactKeys<T, TextToVideoParams>,
    options?: ValidateOptions<T>,
  ): Validated<T, RunwaySdkTargets<T>>;
  safe<T extends TextToVideoParams>(
    params: T & ExactKeys<T, TextToVideoParams>,
    options?: ValidateOptions<T>,
  ): ValidateResult<Validated<T, RunwaySdkTargets<T>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
