/**
 * Kling Omni Image — POST https://api-singapore.klingai.com/v1/images/omni-image
 *
 * Wire notes (verified against
 * https://kling.ai/document-api/api/image/3-0-omni/image-omni on 2026-08-13):
 * - The route for the two Omni image models, `kling-image-o1` (the default)
 *   and `kling-v3-omni` — the census's "Kling Image O1" and "Kling Image 3.0
 *   Omni".
 * - References ride in `image_list` (`[{ image }]`) and `element_list`
 *   (`[{ element_id }]`) rather than the single `image` field of
 *   `/v1/images/generations`.
 * - `result_type` picks a single image or a `series`; `series_amount` (2–9 or
 *   "auto") sizes the series. `resolution` adds a "4k" tier here, and
 *   `aspect_ratio` defaults to "auto" (match the input).
 * - Async: responds with a task object. Auth is `Authorization: Bearer <key>`.
 */

import { z } from "zod";
import { createValidator, type PipelineContext } from "../../core/pipeline";
import { toValidated, type ExactKeys, type Validated } from "../../core/request";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";
import type { ModelInfo } from "../../core/catalog-types";
import type { EndpointConstraints } from "../../core/constraint-types";
import { omniImageModels, type KlingOmniImageModelId } from "./models";
import { DOCS_BASE, KLING_BASE_URL, KLING_HEADERS, type KlingWatermarkInfo } from "./shared";
import { elementListSchema, watermarkInfoSchema } from "./v1-routes";
import { KLING_IMAGE_ASPECT_RATIOS } from "./image";
import { imageCostUSD, type ImageMode } from "./pricing";

export const OMNI_IMAGE_URL = `${KLING_BASE_URL}/v1/images/omni-image`;

const SOURCE = `${DOCS_BASE}/api/image/3-0-omni/image-omni`;

/** Server-side default when `model_name` is omitted. */
export const DEFAULT_OMNI_IMAGE_MODEL = "kling-image-o1";

/** `resolution` values on this route — it adds a 4K tier. */
export const OMNI_IMAGE_RESOLUTIONS = ["1k", "2k", "4k"] as const;
/** `resolution` on `/v1/images/omni-image` — a closed enum, zod-enforced. */
export type KlingOmniImageResolution = (typeof OMNI_IMAGE_RESOLUTIONS)[number];

/** `result_type`: a single image or a consistent series. */
export const OMNI_RESULT_TYPES = ["single", "series"] as const;

/** `series_amount`: 2–9, or "auto". */
export const OMNI_SERIES_AMOUNTS = ["2", "3", "4", "5", "6", "7", "8", "9", "auto"] as const;

/** `aspect_ratio` here also accepts "auto" (match the first input image). */
export const OMNI_IMAGE_ASPECT_RATIOS = [...KLING_IMAGE_ASPECT_RATIOS, "auto"] as const;

export interface OmniImageParams {
  /** Defaults to "kling-image-o1". */
  model_name?: KlingOmniImageModelId | (string & {});
  /** Required. */
  prompt: string;
  /** Reference images: `[{ image: "<url or base64>" }]`. */
  image_list?: Array<{ image: string }>;
  /** Elements to keep consistent, by id. */
  element_list?: Array<{ element_id: string | number }>;
  /** "1k" (default), "2k" or "4k" — this route is the one with a 4K tier. */
  resolution?: KlingOmniImageResolution;
  /** "single" (default) or "series". */
  result_type?: (typeof OMNI_RESULT_TYPES)[number];
  /** Number of images. Defaults to 1. */
  n?: number;
  /** Series size: "2"–"9" or "auto". Defaults to "4". */
  series_amount?: string | number;
  /** Defaults to "auto" — match the first input image. */
  aspect_ratio?: (typeof OMNI_IMAGE_ASPECT_RATIOS)[number];
  watermark_info?: KlingWatermarkInfo;
  callback_url?: string;
  external_task_id?: string;
}

const omniImageSchema = z.looseObject({
  model_name: z.string().optional(),
  prompt: z.string().min(1),
  image_list: z.array(z.looseObject({ image: z.string().min(1) })).optional(),
  element_list: elementListSchema.optional(),
  resolution: z.enum(OMNI_IMAGE_RESOLUTIONS).optional(),
  result_type: z.enum(OMNI_RESULT_TYPES).optional(),
  n: z.number().int().min(1).optional(),
  series_amount: z.union([z.string(), z.number().int()]).optional(),
  aspect_ratio: z.enum(OMNI_IMAGE_ASPECT_RATIOS).optional(),
  watermark_info: watermarkInfoSchema.optional(),
  callback_url: z.string().optional(),
  external_task_id: z.string().optional(),
});

function checkSeriesAmount(
  params: OmniImageParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (params.series_amount == null) return;
  const value = String(params.series_amount);
  if ((OMNI_SERIES_AMOUNTS as readonly string[]).includes(value)) return;
  ctx.report({
    code: "invalid_enum_value",
    path: ["series_amount"],
    message: `\`series_amount\` must be one of ${OMNI_SERIES_AMOUNTS.map((v) => JSON.stringify(v)).join(", ")}; got ${JSON.stringify(params.series_amount)}.`,
    meta: { allowed: [...OMNI_SERIES_AMOUNTS], value: params.series_amount, source: SOURCE },
  });
}

function imageMode(params: OmniImageParams): ImageMode {
  const references =
    (Array.isArray(params.image_list) ? params.image_list.length : 0) +
    (Array.isArray(params.element_list) ? params.element_list.length : 0);
  if (references === 0) return "text-to-image";
  return "image-to-image";
}

function estimate(params: OmniImageParams, info: ModelInfo | undefined, _ctx: PipelineContext) {
  if (info === undefined) return {};
  const costUSD = imageCostUSD({
    model: params.model_name ?? DEFAULT_OMNI_IMAGE_MODEL,
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

function finalize(params: OmniImageParams): unknown {
  const body = { ...params };
  return toValidated(body, {
    url: OMNI_IMAGE_URL,
    method: "POST",
    headers: KLING_HEADERS,
  }, {
    sdk: { kling: () => body },
  });
}

const validator = createValidator<OmniImageParams, unknown>({
  endpoint: "kling.imageOmni",
  schema: omniImageSchema,
  modelId: (params) => params.model_name ?? DEFAULT_OMNI_IMAGE_MODEL,
  catalog: omniImageModels,
  checks: [checkSeriesAmount],
  estimate,
  finalize,
});

/**
 * Validates raw wire params for Kling `POST /v1/images/omni-image`.
 *
 * ```ts
 * const params = kling.imageOmni({
 *   model_name: "kling-v3-omni",
 *   prompt: "the same character, four consistent poses",
 *   image_list: [{ image: "https://example.com/character.png" }],
 *   result_type: "series",
 *   series_amount: "4",
 * });
 * ```
 */
export const imageOmni = validator as unknown as {
  <T extends OmniImageParams>(
    params: T & ExactKeys<T, OmniImageParams>,
    options?: ValidateOptions,
  ): Validated<T, KlingSdkTargets<T>>;
  safe<T extends OmniImageParams>(
    params: T & ExactKeys<T, OmniImageParams>,
    options?: ValidateOptions,
  ): ValidateResult<Validated<T, KlingSdkTargets<T>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
