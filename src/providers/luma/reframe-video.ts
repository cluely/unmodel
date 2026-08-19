/**
 * Luma Dream Machine Reframe Video —
 * POST https://api.lumalabs.ai/dream-machine/v1/generations/video/reframe
 *
 * Wire notes (verified against
 * https://docs.lumalabs.ai/docs/reframe-video-image and the OpenAPI
 * definition embedded in https://docs.lumalabs.ai/reference/reframevideo on
 * 2026-08-13):
 * - Expands (outpaints) an existing video into a new aspect ratio. `media`
 *   and `aspect_ratio` are both required, alongside `model`.
 * - The geometry fields (`grid_position_*`, `x_start`/`x_end`,
 *   `y_start`/`y_end`, `resized_*`) are pixel values that place and crop the
 *   source inside the reframed canvas; the target size follows the chosen
 *   aspect ratio (see LUMA_VIDEO_DIMENSIONS in ./pricing.ts).
 * - `prompt` steers what gets generated into the new area; it defaults to ""
 *   server-side.
 * - Async job API: poll GET /generations/{id} or use `callback_url`.
 * - No cost estimate: reframe bills "same as cost of the models", and Luma
 *   publishes no per-second/per-generation USD rate for ray-2 / ray-flash-2
 *   (see ./models.ts).
 * - Auth is `Authorization: Bearer <LUMAAI_API_KEY>` — unmodel never touches
 *   keys; add the header yourself when fetching.
 */

import { z } from "zod";
import { createValidator } from "../../core/pipeline";
import { toValidated, JSON_HEADERS, type ExactKeys, type Validated } from "../../core/request";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";
import type { EndpointConstraints } from "../../core/constraint-types";
import { videoModels, type LumaVideoModelId } from "./models";
import {
  DREAM_MACHINE_BASE_URL,
  LUMA_ASPECT_RATIOS,
  mediaSchema,
  reframeGeometryShape,
  type LumaAspectRatio,
  type LumaMedia,
  type LumaReframeGeometry,
} from "./shared";

export const REFRAME_VIDEO_URL = `${DREAM_MACHINE_BASE_URL}/generations/video/reframe`;

export interface ReframeVideoParams extends LumaReframeGeometry {
  model: LumaVideoModelId | (string & {});
  /** The source video to reframe. */
  media: LumaMedia;
  /** Target aspect ratio of the reframed video. */
  aspect_ratio: LumaAspectRatio;
  /** Steers what is generated into the new area. Defaults to "". */
  prompt?: string;
  /** Optional first frame used to steer the result. */
  first_frame?: LumaMedia;
  /** POSTed a generation object when the job progresses. */
  callback_url?: string;
  /** Defaults to "reframe_video" server-side. */
  generation_type?: "reframe_video";
}

const reframeVideoSchema = z.looseObject({
  model: z.string(),
  media: mediaSchema,
  aspect_ratio: z.enum(LUMA_ASPECT_RATIOS),
  prompt: z.string().optional(),
  first_frame: mediaSchema.optional(),
  callback_url: z.string().optional(),
  generation_type: z.literal("reframe_video").optional(),
  ...reframeGeometryShape,
});

/**
 * The one `.toSdk("luma")` target for this endpoint — the `lumaai` SDK takes
 * wire-shaped params. Derived from the `sdk` literal in `finalize`; it must
 * stay an object type with no index signature, or `toSdk` would accept any
 * string.
 */
type LumaSdkTargets<B> = { luma: () => B };

function finalize(params: ReframeVideoParams): unknown {
  const body = { ...params };
  return toValidated(body, {
    url: REFRAME_VIDEO_URL,
    method: "POST",
    headers: JSON_HEADERS,
  }, {
    sdk: { luma: () => body },
  });
}

const validator = createValidator<ReframeVideoParams, unknown>({
  endpoint: "luma.reframeVideo",
  schema: reframeVideoSchema,
  modelId: (params) => params.model,
  catalog: videoModels,
  finalize,
});

/**
 * Validates raw wire params for Luma Dream Machine
 * `POST /dream-machine/v1/generations/video/reframe`.
 *
 * ```ts
 * const params = luma.reframeVideo({
 *   model: "ray-2",
 *   media: { url: "https://example.com/video.mp4" },
 *   aspect_ratio: "21:9",
 *   prompt: "extend the alley walls",
 * });
 * ```
 */
export const reframeVideo = validator as unknown as {
  <T extends ReframeVideoParams>(
    params: T & ExactKeys<T, ReframeVideoParams>,
    options?: ValidateOptions,
  ): Validated<T, LumaSdkTargets<T>>;
  safe<T extends ReframeVideoParams>(
    params: T & ExactKeys<T, ReframeVideoParams>,
    options?: ValidateOptions,
  ): ValidateResult<Validated<T, LumaSdkTargets<T>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
