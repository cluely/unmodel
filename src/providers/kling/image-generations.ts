/**
 * Kling Image Generation — POST https://api-singapore.klingai.com/v1/images/generations
 *
 * Wire notes (verified against
 * https://kling.ai/document-api/api/image/3-0-omni/image-generation on
 * 2026-08-13):
 * - One route covers text-to-image, image-to-image and reference-driven
 *   generation: pass `image` (an HTTPS URL or base64) to condition on a
 *   picture, `image_reference` to say whether it is a `subject` or a `face`,
 *   and `element_list` to pin Elements.
 * - `model_name` defaults to `kling-v1`; `resolution` to "1k"; `n` to 1;
 *   `aspect_ratio` to "16:9"; `image_fidelity` to 0.5 and `human_fidelity` to
 *   0.45 (both 0–1).
 * - This is the Kolors/Kling Image family — the census's "Kolors 2.1" is
 *   `kling-v2-1` here. The Omni image models live on a separate route (see
 *   ./omni-image.ts).
 * - Async: responds with a task object; poll
 *   `GET /v1/images/generations/{id}`. Auth is `Authorization: Bearer <key>`.
 */

import { z } from "zod";
import { createValidator, type PipelineContext } from "../../core/pipeline";
import { toValidated, type ExactKeys, type Validated } from "../../core/request";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";
import type { ModelInfo } from "../../core/catalog-types";
import type { EndpointConstraints } from "../../core/constraint-types";
import { imageModels, type KlingImageModelId } from "./models";
import { DOCS_BASE, KLING_BASE_URL, KLING_HEADERS, type KlingWatermarkInfo } from "./shared";
import { elementListSchema, watermarkInfoSchema } from "./v1-routes";
import { imageCostUSD, type ImageMode } from "./pricing";

export const IMAGE_GENERATIONS_URL = `${KLING_BASE_URL}/v1/images/generations`;

const SOURCE = `${DOCS_BASE}/api/image/3-0-omni/image-generation`;

/** Server-side default when `model_name` is omitted. */
export const DEFAULT_IMAGE_MODEL = "kling-v1";

/** Documented `aspect_ratio` values on the image routes. */
export const KLING_IMAGE_ASPECT_RATIOS = [
  "16:9",
  "9:16",
  "1:1",
  "4:3",
  "3:4",
  "3:2",
  "2:3",
  "21:9",
] as const;
export type KlingImageAspectRatio = (typeof KLING_IMAGE_ASPECT_RATIOS)[number];

/** Documented `resolution` values on this route. */
export const KLING_IMAGE_RESOLUTIONS = ["1k", "2k"] as const;
/** `resolution` on `/v1/images/generations` — a closed enum, zod-enforced. */
export type KlingImageResolution = (typeof KLING_IMAGE_RESOLUTIONS)[number];

/** `image_reference` — what the reference image is being used for. */
export const KLING_IMAGE_REFERENCES = ["subject", "face"] as const;

export interface ImageGenerationsParams {
  /** Defaults to "kling-v1". */
  model_name?: KlingImageModelId | (string & {});
  /** Required. */
  prompt: string;
  negative_prompt?: string;
  /** Reference image: an HTTPS URL or base64. */
  image?: string;
  /** Whether `image` is a subject or a face reference. */
  image_reference?: (typeof KLING_IMAGE_REFERENCES)[number];
  /** 0–1. Defaults to 0.5. */
  image_fidelity?: number;
  /** 0–1. Defaults to 0.45. */
  human_fidelity?: number;
  /** Elements to keep consistent, by id. */
  element_list?: Array<{ element_id: string | number }>;
  /** "1k" (default) or "2k". The 4K tier is omni-image only. */
  resolution?: KlingImageResolution;
  /** Number of images. Defaults to 1. */
  n?: number;
  /** Defaults to "16:9". */
  aspect_ratio?: KlingImageAspectRatio;
  watermark_info?: KlingWatermarkInfo;
  callback_url?: string;
  external_task_id?: string;
}

const imageGenerationsSchema = z.looseObject({
  model_name: z.string().optional(),
  prompt: z.string().min(1),
  negative_prompt: z.string().optional(),
  image: z.string().optional(),
  image_reference: z.enum(KLING_IMAGE_REFERENCES).optional(),
  image_fidelity: z.number().min(0).max(1).optional(),
  human_fidelity: z.number().min(0).max(1).optional(),
  element_list: elementListSchema.optional(),
  resolution: z.enum(KLING_IMAGE_RESOLUTIONS).optional(),
  n: z.number().int().min(1).optional(),
  aspect_ratio: z.enum(KLING_IMAGE_ASPECT_RATIOS).optional(),
  watermark_info: watermarkInfoSchema.optional(),
  callback_url: z.string().optional(),
  external_task_id: z.string().optional(),
});

/**
 * Which price column a request lands in. Only two apply on this route: the
 * pricing page's "Multi-image to Image" column belongs to the separate
 * `POST /v1/images/multi-image2image` endpoint, not to `element_list` here.
 */
function imageMode(params: ImageGenerationsParams): ImageMode {
  const elements = Array.isArray(params.element_list) ? params.element_list.length : 0;
  return params.image != null || elements > 0 ? "image-to-image" : "text-to-image";
}

function estimate(
  params: ImageGenerationsParams,
  info: ModelInfo | undefined,
  _ctx: PipelineContext,
) {
  if (info === undefined) return {};
  const costUSD = imageCostUSD({
    model: params.model_name ?? DEFAULT_IMAGE_MODEL,
    ...(params.resolution !== undefined && { resolution: params.resolution }),
    ...(params.n !== undefined && { n: params.n }),
    mode: imageMode(params),
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

function finalize(params: ImageGenerationsParams): unknown {
  const body = { ...params };
  return toValidated(body, {
    url: IMAGE_GENERATIONS_URL,
    method: "POST",
    headers: KLING_HEADERS,
  }, {
    sdk: { kling: () => body },
  });
}

const validator = createValidator<ImageGenerationsParams, unknown>({
  endpoint: "kling.imageGenerations",
  schema: imageGenerationsSchema,
  modelId: (params) => params.model_name ?? DEFAULT_IMAGE_MODEL,
  // Route-scoped catalog: the video ids and the Omni image ids warn as
  // unknown_model here.
  catalog: imageModels,
  estimate,
  finalize,
});

/**
 * Validates raw wire params for Kling `POST /v1/images/generations`.
 *
 * ```ts
 * const params = kling.imageGenerations({
 *   model_name: "kling-v2-1",
 *   prompt: "a lighthouse at dusk, painterly",
 *   aspect_ratio: "16:9",
 *   resolution: "2k",
 *   n: 2,
 * });
 * ```
 */
export const imageGenerations = validator as unknown as {
  <T extends ImageGenerationsParams>(
    params: T & ExactKeys<T, ImageGenerationsParams>,
    options?: ValidateOptions,
  ): Validated<T, KlingSdkTargets<T>>;
  safe<T extends ImageGenerationsParams>(
    params: T & ExactKeys<T, ImageGenerationsParams>,
    options?: ValidateOptions,
  ): ValidateResult<Validated<T, KlingSdkTargets<T>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
