/**
 * Vidu Reference to Image — POST https://api.vidu.com/ent/v2/reference2image
 *
 * Wire notes (verified against https://platform.vidu.com/docs/reference-to-image
 * on 2026-08-13):
 * - `model` and `prompt` are required; `prompt` caps at 2000 characters here
 *   (the video routes allow 5000).
 * - `images` is optional on `viduq2` (0–7 references — with none it is plain
 *   text-to-image) and required on `viduq1` (1–7).
 * - `resolution` is "1080p" only on `viduq1`; `viduq2` adds "2K" and "4K".
 *   `aspect_ratio` is wider on `viduq2` (it adds 21:9, 2:3, 3:2) and both
 *   accept "auto", which matches the first input image.
 * - Async: responds with a task object. Auth is
 *   `Authorization: Token <VIDU_API_KEY>`.
 */

import { z } from "zod";
import { createValidator, type PipelineContext } from "../../core/pipeline";
import { toValidated, type ExactKeys, type Validated } from "../../core/request";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";
import type { ModelInfo } from "../../core/catalog-types";
import type { EndpointConstraints } from "../../core/constraint-types";
import { imageModels, type ViduImageModelId } from "./models";
import {
  DOCS_BASE,
  IMAGE_PROMPT_MAX_CHARS,
  VIDU_BASE_URL,
  VIDU_HEADERS,
  assetSchema,
  payloadSchema,
} from "./shared";
import { imageCostUSD } from "./pricing";

export const REFERENCE2IMAGE_URL = `${VIDU_BASE_URL}/reference2image`;

const SOURCE = `${DOCS_BASE}/reference-to-image`;

/** Aspect ratios per model — `viduq2` is the wider set. */
export const IMAGE_ASPECT_RATIOS = {
  viduq1: ["16:9", "9:16", "1:1", "3:4", "4:3", "auto"],
  viduq2: ["16:9", "9:16", "1:1", "3:4", "4:3", "21:9", "2:3", "3:2", "auto"],
} as const satisfies Record<string, readonly string[]>;

/**
 * `aspect_ratio` on this route — the union of both models' lists, derived from
 * the table above so it cannot drift. `checkModelRules` narrows it per model
 * at runtime (21:9, 2:3 and 3:2 are `viduq2`-only).
 */
export type ViduImageAspectRatio =
  (typeof IMAGE_ASPECT_RATIOS)[keyof typeof IMAGE_ASPECT_RATIOS][number];

/** Resolutions per model. */
export const IMAGE_RESOLUTIONS = {
  viduq1: ["1080p"],
  viduq2: ["1080p", "2K", "4K"],
} as const satisfies Record<string, readonly string[]>;

/**
 * `resolution` on this route — the union of both models' lists. Note the
 * UPPERCASE K: this space ("1080p" | "2K" | "4K") is not the video routes'
 * `ViduResolution`. `checkModelRules` narrows it per model at runtime
 * (`viduq1` is 1080p-only).
 */
export type ViduImageResolution =
  (typeof IMAGE_RESOLUTIONS)[keyof typeof IMAGE_RESOLUTIONS][number];

/** Reference-image count bands per model. */
export const IMAGE_COUNTS = {
  viduq1: { min: 1, max: 7 },
  viduq2: { min: 0, max: 7 },
} as const satisfies Record<string, { min: number; max: number }>;

export interface Reference2ImageParams {
  model: ViduImageModelId | (string & {});
  /** Required; up to 2000 characters. */
  prompt: string;
  /** Reference images: 0–7 on viduq2, 1–7 on viduq1. */
  images?: string[];
  seed?: number;
  /** Default "16:9"; "auto" matches the first input image. 21:9 / 2:3 / 3:2 are viduq2-only. */
  aspect_ratio?: ViduImageAspectRatio;
  /** Default "1080p". viduq2 also offers "2K" and "4K" (uppercase K on this route). */
  resolution?: ViduImageResolution;
  payload?: string;
  callback_url?: string;
}

const imageFromReferenceSchema = z.looseObject({
  model: z.string(),
  prompt: z.string().max(IMAGE_PROMPT_MAX_CHARS),
  images: z.array(assetSchema).optional(),
  seed: z.number().int().optional(),
  aspect_ratio: z.string().optional(),
  resolution: z.string().optional(),
  payload: payloadSchema.optional(),
  callback_url: z.string().optional(),
});

function checkModelRules(
  params: Reference2ImageParams,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (info === undefined) return;
  const model = params.model as keyof typeof IMAGE_COUNTS;
  const counts = IMAGE_COUNTS[model];
  const resolutions: readonly string[] | undefined = IMAGE_RESOLUTIONS[model];
  const ratios: readonly string[] | undefined = IMAGE_ASPECT_RATIOS[model];
  if (counts === undefined) return;

  const count = Array.isArray(params.images) ? params.images.length : 0;
  if (count < counts.min || count > counts.max) {
    ctx.report({
      code: "invalid_shape",
      path: ["images"],
      model,
      message: `\`images\` accepts ${counts.min}–${counts.max} reference images for "${model}"; got ${count}.`,
      meta: { min: counts.min, max: counts.max, count, source: SOURCE },
    });
  }
  if (params.resolution != null && resolutions !== undefined && !resolutions.includes(params.resolution)) {
    ctx.report({
      code: "invalid_enum_value",
      path: ["resolution"],
      model,
      message: `\`resolution\` must be one of ${resolutions.map((v) => JSON.stringify(v)).join(", ")} for "${model}"; got ${JSON.stringify(params.resolution)}.`,
      meta: { allowed: [...resolutions], value: params.resolution, source: SOURCE },
    });
  }
  if (params.aspect_ratio != null && ratios !== undefined && !ratios.includes(params.aspect_ratio)) {
    ctx.report({
      code: "invalid_enum_value",
      path: ["aspect_ratio"],
      model,
      message: `\`aspect_ratio\` must be one of ${ratios.map((v) => JSON.stringify(v)).join(", ")} for "${model}"; got ${JSON.stringify(params.aspect_ratio)}.`,
      meta: { allowed: [...ratios], value: params.aspect_ratio, source: SOURCE },
    });
  }
}

function estimate(
  params: Reference2ImageParams,
  info: ModelInfo | undefined,
  _ctx: PipelineContext,
) {
  if (info === undefined) return {};
  const costUSD = imageCostUSD({
    model: params.model,
    ...(params.resolution !== undefined && { resolution: params.resolution }),
    imageCount: Array.isArray(params.images) ? params.images.length : 0,
  });
  return costUSD === undefined ? {} : { costUSD };
}

/**
 * The one `.toSdk("vidu")` target for this endpoint — Vidu ships no
 * first-party SDK, so this is the wire body. Derived from the `sdk` literal
 * in `finalize`; it must stay an object type with no index signature, or
 * `toSdk` would accept any string.
 */
type ViduSdkTargets<B> = { vidu: () => B };

function finalize(params: Reference2ImageParams): unknown {
  const body = { ...params };
  return toValidated(body, {
    url: REFERENCE2IMAGE_URL,
    method: "POST",
    headers: VIDU_HEADERS,
  }, {
    sdk: { vidu: () => body },
  });
}

const validator = createValidator<Reference2ImageParams, unknown>({
  endpoint: "vidu.imageFromReference",
  schema: imageFromReferenceSchema,
  modelId: (params) => params.model,
  // Route-scoped catalog: the video-only ids warn as unknown_model here.
  catalog: imageModels,
  checks: [checkModelRules],
  estimate,
  finalize,
});

/**
 * Validates raw wire params for Vidu `POST /ent/v2/reference2image`.
 *
 * ```ts
 * const params = vidu.imageFromReference({
 *   model: "viduq2",
 *   prompt: "the same character, now on a rainy street",
 *   images: ["https://example.com/character.png"],
 *   resolution: "2K",
 * });
 * ```
 */
export const imageFromReference = validator as unknown as {
  <T extends Reference2ImageParams>(
    params: T & ExactKeys<T, Reference2ImageParams>,
    options?: ValidateOptions<T>,
  ): Validated<T, ViduSdkTargets<T>>;
  safe<T extends Reference2ImageParams>(
    params: T & ExactKeys<T, Reference2ImageParams>,
    options?: ValidateOptions<T>,
  ): ValidateResult<Validated<T, ViduSdkTargets<T>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
