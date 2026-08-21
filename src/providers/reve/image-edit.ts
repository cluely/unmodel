/**
 * Reve v1 image editing —
 *   POST https://api.reve.com/v1/image/edit   (instruction + one base image)
 *   POST https://api.reve.com/v1/image/remix  (prompt + 1–6 reference images)
 *
 * Wire notes (verified against https://api.reve.com/console/docs on
 * 2026-08-13):
 * - Both routes are synchronous JSON like `create`: the response carries the
 *   image base64-encoded plus `credits_used` / `credits_remaining`.
 * - Edit takes `edit_instruction` + `reference_image` (a single base64 image);
 *   Remix takes `prompt` + `reference_images` (a list of 1–6 base64 images,
 *   addressable from the prompt with `<img>` index tags). Both cap their text
 *   at 2560 characters.
 * - Each route has its own `version` list — the fast checkpoints
 *   (`latest-fast`, `reve-edit-fast@20251030`, `reve-remix-fast@20251030`)
 *   bill 5 credits instead of 30, so the alias a caller passes changes the
 *   catalog row and the cost estimate.
 * - `aspect_ratio` defaults differ from `create`: Edit reuses the reference
 *   image's ratio, Remix lets the model choose. Both accept only the v1 subset.
 * - Input-image limits (shared with every Reve route): ≤ 40 MB and ≤
 *   33,554,432 px per image, neither dimension over 8192 px, and ≤ 50,331,648
 *   px / 100 MB across all images in one call. unmodel enforces these against
 *   inline base64 images it can decode; `id:`/URL references are not fetched.
 * - Auth is an `Authorization: Bearer …` header — unmodel never touches keys.
 */

import { z } from "zod";
import { createValidator, type PipelineContext } from "../../core/pipeline";
import { toValidated, JSON_HEADERS, type Validated, type ExactKeys } from "../../core/request";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";
import type { ModelInfo } from "../../core/catalog-types";
import type { EndpointConstraints } from "../../core/constraint-types";
import {
  models,
  REVE_EDIT_VERSIONS,
  REVE_REMIX_VERSIONS,
  resolveReveVersion,
  type ReveEditVersion,
  type ReveRemixVersion,
} from "./models";
import {
  REVE_API_BASE_URL,
  REVE_DOCS_URL,
  REVE_V1_ASPECT_RATIOS,
  checkAspectRatio,
  checkImageBudget,
  checkPostprocessing,
  checkPromptLength,
  checkTestTimeScaling,
  checkVersion,
  reveEstimateUSD,
  type RevePostprocessingOperation,
  type ReveV1AspectRatio,
} from "./shared";
import { REVE_V1_PROMPT_MAX_LENGTH } from "./image";

export const REVE_EDIT_URL = `${REVE_API_BASE_URL}/v1/image/edit`;
export const REVE_REMIX_URL = `${REVE_API_BASE_URL}/v1/image/remix`;

/** "You must provide between 1 and 6 reference images (inclusive)." — remix. */
export const REVE_REMIX_MIN_REFERENCE_IMAGES = 1;
export const REVE_REMIX_MAX_REFERENCE_IMAGES = 6;

// ---------------------------------------------------------------------------
// Edit
// ---------------------------------------------------------------------------

export interface EditParams {
  /** How to edit the image; ≤ 2560 chars. REQUIRED. */
  edit_instruction: string;
  /** Base64-encoded image to edit. REQUIRED. */
  reference_image: string;
  /**
   * Output aspect ratio (v1 subset). Defaults to the reference image's ratio.
   * CLOSED enum — the v1 endpoints accept only the legacy subset.
   */
  aspect_ratio?: ReveV1AspectRatio;
  /** Model version. Default "latest". */
  version?: ReveEditVersion | (string & {});
  /** Post-generation operations. */
  postprocessing?: RevePostprocessingOperation[];
  /** Extra effort per image, 1–15. Default 1. */
  test_time_scaling?: number;
}

const editSchema = z.looseObject({
  edit_instruction: z.string(),
  reference_image: z.string(),
  aspect_ratio: z.string().optional(),
  version: z.string().optional(),
  postprocessing: z.array(z.unknown()).optional(),
  test_time_scaling: z.number().optional(),
});

function checkEdit(params: EditParams, _info: ModelInfo | undefined, ctx: PipelineContext): void {
  checkPromptLength(ctx, ["edit_instruction"], params.edit_instruction, REVE_V1_PROMPT_MAX_LENGTH);
  checkAspectRatio(ctx, params.aspect_ratio, REVE_V1_ASPECT_RATIOS);
  checkVersion(ctx, params.version, REVE_EDIT_VERSIONS);
  checkPostprocessing(ctx, params.postprocessing);
  checkTestTimeScaling(ctx, params.test_time_scaling);
  checkImageBudget(ctx, [{ path: ["reference_image"], data: params.reference_image }]);
}

function estimateEdit(params: EditParams, info: ModelInfo | undefined) {
  const costUSD = reveEstimateUSD(info?.cost?.perImage, params.test_time_scaling);
  return costUSD === undefined ? {} : { costUSD };
}

/**
 * The one `.toSdk("reve")` target for this endpoint — Reve ships no official
 * JS SDK, so this is the wire body. Derived from the `sdk` literal in
 * `finalize`; it must stay an object type with no index signature, or
 * `toSdk` would accept any string.
 */
type ReveSdkTargets<B> = { reve: () => B };

function finalizeEdit(params: EditParams): unknown {
  const body = { ...params };
  return toValidated(body, {
    url: REVE_EDIT_URL,
    method: "POST",
    headers: JSON_HEADERS,
  }, {
    sdk: { reve: () => body },
  });
}

const editValidator = createValidator<EditParams, unknown>({
  endpoint: "reve.imageEdit",
  schema: editSchema,
  modelId: (params) => resolveReveVersion("edit", params.version),
  catalog: models,
  checks: [checkEdit],
  estimate: estimateEdit,
  finalize: finalizeEdit,
});

/**
 * Validates params for `POST https://api.reve.com/v1/image/edit` (natural-
 * language editing of one base64 image).
 *
 * ```ts
 * const params = reve.imageEdit({
 *   edit_instruction: "make the sky stormy",
 *   reference_image: base64Png,
 *   version: "latest-fast",
 * });
 * ```
 */
export const imageEdit = editValidator as unknown as {
  <T extends EditParams>(
    params: T & ExactKeys<T, EditParams>,
    options?: ValidateOptions<T>,
  ): Validated<T, ReveSdkTargets<T>>;
  safe<T extends EditParams>(
    params: T & ExactKeys<T, EditParams>,
    options?: ValidateOptions<T>,
  ): ValidateResult<Validated<T, ReveSdkTargets<T>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};

// ---------------------------------------------------------------------------
// Remix
// ---------------------------------------------------------------------------

export interface RemixParams {
  /**
   * Text description; may reference `reference_images` entries with xml `img`
   * tags by index. ≤ 2560 chars. REQUIRED.
   */
  prompt: string;
  /** 1–6 base64-encoded reference images. REQUIRED. */
  reference_images: string[];
  /**
   * Output aspect ratio (v1 subset). Default: chosen by the model. CLOSED
   * enum — the v1 endpoints accept only the legacy subset.
   */
  aspect_ratio?: ReveV1AspectRatio;
  /** Model version. Default "latest". */
  version?: ReveRemixVersion | (string & {});
  /** Post-generation operations. */
  postprocessing?: RevePostprocessingOperation[];
  /** Extra effort per image, 1–15. Default 1. */
  test_time_scaling?: number;
}

const remixSchema = z.looseObject({
  prompt: z.string(),
  reference_images: z.array(z.string()),
  aspect_ratio: z.string().optional(),
  version: z.string().optional(),
  postprocessing: z.array(z.unknown()).optional(),
  test_time_scaling: z.number().optional(),
});

function checkRemix(params: RemixParams, _info: ModelInfo | undefined, ctx: PipelineContext): void {
  checkPromptLength(ctx, ["prompt"], params.prompt, REVE_V1_PROMPT_MAX_LENGTH);
  checkAspectRatio(ctx, params.aspect_ratio, REVE_V1_ASPECT_RATIOS);
  checkVersion(ctx, params.version, REVE_REMIX_VERSIONS);
  checkPostprocessing(ctx, params.postprocessing);
  checkTestTimeScaling(ctx, params.test_time_scaling);

  const images = params.reference_images;
  if (!Array.isArray(images)) return;
  if (
    images.length < REVE_REMIX_MIN_REFERENCE_IMAGES ||
    images.length > REVE_REMIX_MAX_REFERENCE_IMAGES
  ) {
    ctx.report({
      code: "invalid_shape",
      path: ["reference_images"],
      message: `\`reference_images\` must hold between ${REVE_REMIX_MIN_REFERENCE_IMAGES} and ${REVE_REMIX_MAX_REFERENCE_IMAGES} images (inclusive); got ${images.length}.`,
      meta: {
        min: REVE_REMIX_MIN_REFERENCE_IMAGES,
        max: REVE_REMIX_MAX_REFERENCE_IMAGES,
        count: images.length,
        source: REVE_DOCS_URL,
      },
    });
  }
  checkImageBudget(
    ctx,
    images.map((data, i) => ({ path: ["reference_images", i], data })),
  );
}

function estimateRemix(params: RemixParams, info: ModelInfo | undefined) {
  const costUSD = reveEstimateUSD(info?.cost?.perImage, params.test_time_scaling);
  return costUSD === undefined ? {} : { costUSD };
}

function finalizeRemix(params: RemixParams): unknown {
  const body = { ...params };
  return toValidated(body, {
    url: REVE_REMIX_URL,
    method: "POST",
    headers: JSON_HEADERS,
  }, {
    sdk: { reve: () => body },
  });
}

const remixValidator = createValidator<RemixParams, unknown>({
  endpoint: "reve.imageEditRemix",
  schema: remixSchema,
  modelId: (params) => resolveReveVersion("remix", params.version),
  catalog: models,
  checks: [checkRemix],
  estimate: estimateRemix,
  finalize: finalizeRemix,
});

/**
 * Validates params for `POST https://api.reve.com/v1/image/remix` (prompt plus
 * 1–6 reference images).
 *
 * ```ts
 * const params = reve.imageEditRemix({
 *   prompt: "the product from <img>0</img> on a marble table",
 *   reference_images: [base64Png],
 * });
 * ```
 */
export const imageEditRemix = remixValidator as unknown as {
  <T extends RemixParams>(
    params: T & ExactKeys<T, RemixParams>,
    options?: ValidateOptions<T>,
  ): Validated<T, ReveSdkTargets<T>>;
  safe<T extends RemixParams>(
    params: T & ExactKeys<T, RemixParams>,
    options?: ValidateOptions<T>,
  ): ValidateResult<Validated<T, ReveSdkTargets<T>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
