/**
 * Luma Dream Machine Reframe Image —
 * POST https://api.lumalabs.ai/dream-machine/v1/generations/image/reframe
 *
 * Wire notes (verified against
 * https://docs.lumalabs.ai/docs/reframe-video-image and the OpenAPI
 * definition embedded in https://docs.lumalabs.ai/reference/reframeimage on
 * 2026-08-13):
 * - The Photon counterpart of the video reframe route: expands (outpaints) an
 *   existing image into a new aspect ratio. `media`, `aspect_ratio` and
 *   `model` are required.
 * - Unlike the video route this one also takes `format` ("jpg" | "png") and
 *   has no `first_frame`.
 * - Target sizes follow the chosen aspect ratio — see LUMA_IMAGE_DIMENSIONS in
 *   ./pricing.ts for the documented map.
 * - Async job API: poll GET /generations/{id} or use `callback_url`.
 * - No cost estimate: Luma publishes no current USD rate for photon-1 /
 *   photon-flash-1 (see ./models.ts).
 * - Auth is `Authorization: Bearer <LUMAAI_API_KEY>` — unmodel never touches
 *   keys; add the header yourself when fetching.
 */

import { z } from "zod";
import { createValidator } from "../../core/pipeline";
import { toValidated, JSON_HEADERS, type ExactKeys, type Validated } from "../../core/request";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";
import type { EndpointConstraints } from "../../core/constraint-types";
import { imageModels, type LumaImageModelId } from "./models";
import {
  DREAM_MACHINE_BASE_URL,
  LUMA_ASPECT_RATIOS,
  mediaSchema,
  reframeGeometryShape,
  type LumaAspectRatio,
  type LumaMedia,
  type LumaReframeGeometry,
} from "./shared";

export const REFRAME_IMAGE_URL = `${DREAM_MACHINE_BASE_URL}/generations/image/reframe`;

export interface ReframeImageParams extends LumaReframeGeometry {
  model: LumaImageModelId | (string & {});
  /** The source image to reframe. */
  media: LumaMedia;
  /** Target aspect ratio of the reframed image. */
  aspect_ratio: LumaAspectRatio;
  /** Steers what is generated into the new area. Defaults to "". */
  prompt?: string;
  /** Output format. Defaults to "jpg". */
  format?: "jpg" | "png";
  /** POSTed a generation object when the job progresses. */
  callback_url?: string;
  /** Defaults to "reframe_image" server-side. */
  generation_type?: "reframe_image";
}

const reframeImageSchema = z.looseObject({
  model: z.string(),
  media: mediaSchema,
  aspect_ratio: z.enum(LUMA_ASPECT_RATIOS),
  prompt: z.string().optional(),
  format: z.enum(["jpg", "png"]).optional(),
  callback_url: z.string().optional(),
  generation_type: z.literal("reframe_image").optional(),
  ...reframeGeometryShape,
});

/**
 * The one `.toSdk("luma")` target for this endpoint — the `lumaai` SDK takes
 * wire-shaped params. Derived from the `sdk` literal in `finalize`; it must
 * stay an object type with no index signature, or `toSdk` would accept any
 * string.
 */
type LumaSdkTargets<B> = { luma: () => B };

function finalize(params: ReframeImageParams): unknown {
  const body = { ...params };
  return toValidated(body, {
    url: REFRAME_IMAGE_URL,
    method: "POST",
    headers: JSON_HEADERS,
  }, {
    sdk: { luma: () => body },
  });
}

const validator = createValidator<ReframeImageParams, unknown>({
  endpoint: "luma.imageEditReframe",
  schema: reframeImageSchema,
  modelId: (params) => params.model,
  catalog: imageModels,
  finalize,
});

/**
 * Validates raw wire params for Luma Dream Machine
 * `POST /dream-machine/v1/generations/image/reframe`.
 *
 * ```ts
 * const params = luma.imageEditReframe({
 *   model: "photon-1",
 *   media: { url: "https://example.com/image.jpg" },
 *   aspect_ratio: "16:9",
 *   format: "png",
 * });
 * ```
 */
export const imageEditReframe = validator as unknown as {
  <T extends ReframeImageParams>(
    params: T & ExactKeys<T, ReframeImageParams>,
    options?: ValidateOptions<T>,
  ): Validated<T, LumaSdkTargets<T>>;
  safe<T extends ReframeImageParams>(
    params: T & ExactKeys<T, ReframeImageParams>,
    options?: ValidateOptions<T>,
  ): ValidateResult<Validated<T, LumaSdkTargets<T>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
