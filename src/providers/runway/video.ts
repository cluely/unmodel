/**
 * Runway Text to Video — POST https://api.dev.runwayml.com/v1/text_to_video
 *
 * Wire notes (verified against https://docs.dev.runwayml.com/openapi.json,
 * spec version 2024-11-06, and @runwayml/sdk on 2026-08-13):
 * - Every request must send the `X-Runway-Version: 2024-11-06` header; it is
 *   included in `.request.headers`.
 * - Unlike image_to_video there is no `promptImage`; image context comes via
 *   per-model `references` arrays. `promptText` is required by every model's
 *   arm except seedance2_5 and the Kling 3.0 / O3 arms (which require `ratio`).
 * - The endpoint only starts a task and responds `{ id, estimatedCost }`
 *   (`estimatedCost.credits`: "The maximum credits this task may charge");
 *   polling GET /v1/tasks/{id} is out of unmodel's scope.
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
  type RunwayVideoOutputFormat,
  VIDEO_OUTPUT_FORMATS,
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
  providerSettingsSchema,
  cfgScaleSchema,
  contentModerationSchema,
  seedSchema,
  videoDurationSchema,
  type RunwayAudioReference,
  type RunwayVideoReference,
  type RunwayImageReference,
  type RunwayProviderSettings,
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
  /**
   * Required for every model except seedance2_5 and the Kling 3.0 / O3 arms;
   * caps vary (1000–26000).
   */
  promptText?: string;
  /** Output ratio "W:H" (or `auto_<tier>`); allowed values vary per model. */
  ratio?: RunwayVideoRatio;
  /**
   * Output duration in seconds; allowed values vary per model. `"auto"` (the
   * model chooses) on the gemini_omni_flash_1.x arms.
   */
  duration?: number | "auto";
  /** gen4.5 / veo3.1 / seedance / h3_max only. Integer 0–4294967295. */
  seed?: number;
  /** veo3.1 / seedance / Kling 3.0 / O3 / wan3 arms only. */
  audio?: boolean;
  /** veo3.1 / veo3.1_fast only. */
  negativePrompt?: string;
  /** hailuo3 / grok_imagine_1_5 / h3_max only. */
  resolution?: RunwayVideoResolution;
  /** gen4.5 only. */
  contentModeration?: RunwayContentModeration;
  /** Image references — hailuo3 / seedance / grok_imagine_1_5 / wan3 / kling_4 / gemini_omni_flash_1.x. */
  references?: RunwayImageReference[];
  /** Video references — hailuo3 / seedance / wan3 / kling_4 / gemini_omni_flash_1.x. */
  referenceVideos?: RunwayVideoReference[];
  /** Audio references — hailuo3 / seedance / grok_imagine_1_5 / wan3 only. */
  referenceAudio?: RunwayAudioReference[];
  /** kling2.5_turbo_pro / Kling 3.0 only: 0–1, default 0.5. */
  cfgScale?: number;
  /** Kling 3.0 / O3 multishot settings. */
  providerSettings?: Omit<RunwayProviderSettings, "keepOriginalSound">;
  /** h3_max only. `"balanced"` is the default. */
  promptExpansionMode?: "disabled" | "balanced" | "quality";
  /**
   * gen4.5 (mp4 / ProRes / PNG frames and nine 10-bit and HDR profiles) and
   * seedance2_5 (mp4 | mov) only.
   */
  outputFormat?: RunwayVideoOutputFormat;
  /** gen4.5 only, with outputFormat "prores" or "hdr_prores". */
  proresProfile?: "422" | "4444" | "422 Proxy" | "422 LT" | "422 HQ" | "4444 XQ";
  /**
   * seedance2 / seedance2_fast / seedance2_mini only. `"standard"` (the
   * default) or `"high"`, which "keeps more detail with fewer compression
   * artifacts, at a larger file size" — openapi.json, 2026-11-12. Both bill
   * at the same rate.
   */
  bitrate?: "standard" | "high";
  /**
   * seedance2_5 only: "Generate a cheap 480p preview instead of a
   * full-quality video", always `mp4` and billed at the 480p rate; enhance it
   * to 1080p within 7 days with `draftTaskId` — openapi.json, 2026-11-12.
   */
  draft?: boolean;
  /**
   * seedance2_5 only: "The ID of a succeeded draft task to enhance to 1080p.
   * The draft is regenerated with its original prompt, references, and
   * settings, so no other generation fields may be provided" — send `model`
   * and `draftTaskId` alone (openapi.json, 2026-11-12). A UUID v4.
   */
  draftTaskId?: string;
}

const videoSchema = z.looseObject({
  model: z.string(),
  promptText: z.string().optional(),
  ratio: z.string().optional(),
  duration: videoDurationSchema.optional(),
  seed: seedSchema.optional(),
  audio: z.boolean().optional(),
  negativePrompt: z.string().optional(),
  resolution: z.string().optional(),
  contentModeration: contentModerationSchema.optional(),
  references: imageReferenceArraySchema.optional(),
  referenceVideos: videoReferenceArraySchema.optional(),
  referenceAudio: audioReferenceArraySchema.optional(),
  cfgScale: cfgScaleSchema.optional(),
  providerSettings: providerSettingsSchema.optional(),
  promptExpansionMode: z.string().optional(),
  outputFormat: z.enum(VIDEO_OUTPUT_FORMATS).optional(),
  proresProfile: z.enum(["422", "4444", "422 Proxy", "422 LT", "422 HQ", "4444 XQ"]).optional(),
  bitrate: z.enum(["standard", "high"]).optional(),
  draft: z.boolean().optional(),
  // The spec's `format: uuid` pattern admits version 4 alone.
  draftTaskId: z.uuidv4().optional(),
});

// ---------------------------------------------------------------------------
// Estimation — credits × $0.01 (see ./pricing.ts for tiers, minimums, and
// what the estimate excludes). No duration → no estimate.
// ---------------------------------------------------------------------------

function estimate(params: TextToVideoParams, info: ModelInfo | undefined, _ctx: PipelineContext) {
  if (info === undefined) return {};
  // An enhance bills "at the 1080p rate for the same output duration and
  // input video" as the preview (guides/pricing.md, 2026-11-12) — neither of
  // which the request carries.
  if (params.draftTaskId !== undefined) return {};
  let flatReferenceCount = 0;
  if (params.model === "grok_imagine_1_5") {
    // 1 credit per image or audio reference.
    flatReferenceCount = (params.references?.length ?? 0) + (params.referenceAudio?.length ?? 0);
  } else if (
    params.model === "hailuo3" ||
    params.model === "gemini_omni_flash_1.1" ||
    params.model === "gemini_omni_flash_1.2"
  ) {
    // Per reference image: 2 credits on hailuo3, 1 on Gemini Omni Flash 1.x
    // (video references bill per second of input and are not estimable from
    // a URL).
    flatReferenceCount = params.references?.length ?? 0;
  }
  const costUSD = videoCostUSD({
    model: params.model,
    route: "text_to_video",
    duration: params.duration,
    audio: params.audio,
    resolution: params.resolution,
    ratio: params.ratio,
    inputVideo: (params.referenceVideos?.length ?? 0) > 0,
    flatReferenceCount,
    ...(params.outputFormat !== undefined && { outputFormat: params.outputFormat }),
    ...(params.draft !== undefined && { draft: params.draft }),
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
