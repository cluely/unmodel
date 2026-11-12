/**
 * Bria FIBO Edit — POST https://engine.prod.bria-api.com/v2/image/edit
 *
 * Wire notes (verified 2026-11-12 against
 * https://docs.bria.ai/_bundle/image-editing.yaml — the bundled OpenAPI the
 * docs site serves — and https://docs.bria.ai/whats-new/fibo-2.md). The route
 * runs Fibo 2: "Instruction-based editing now runs on Fibo 2, with no code
 * changes." (https://docs.bria.ai/image-editing-overview.md).
 * - `images` is the only required field and takes 1 to 4 ordered images
 *   (public URLs or base64) — "**Accepts 1 to 4 images.** Requests with more
 *   than 4 images will return an error." (`minItems: 1`, `maxItems: 4`). The
 *   edit itself comes from `instruction` (natural language) or
 *   `structured_instruction` (a JSON **string**, for programmatic control).
 * - An optional black-and-white `mask` scopes the edit — "Black areas will be
 *   preserved, white areas will be edited. The input image and the input mask
 *   must be of the same size." — and is "**Only supported when `images`
 *   contains exactly one item.**"
 * - `aspect_ratio` takes the same 21 values as POST /v2/image/generate and
 *   defaults to the first image's ratio. The spec's 422 cases for the twelve
 *   Fibo 2 ratios (a tailored `model_id`, `original_vgl`, `new_vgl`) are
 *   fields the schema does not declare, so no rule hangs off them here.
 * - The knobs differ from the generate routes: `guidance_scale` is 3–5
 *   (default 5) and `steps_num` is 20–50 (default 30) rather than 35–50, and
 *   `model_version` is `FIBO-edit` rather than `FIBO`. The 2026-11-12 bundle
 *   lists none of these, nor `negative_prompt`, while Bria's Fibo 2
 *   page says "Same API, nothing to change in your code." They stay typed,
 *   with their earlier bounds, until a keyed request settles whether the
 *   server still reads them.
 * - ASYNC BY DEFAULT (`sync: false`): the POST answers 202 with a `status_url`
 *   to poll, or set `webhook_url`. Polling is transport — out of scope.
 * - NOT modeled here: the ~20 task-specific editing routes under the editing
 *   bundle's server `https://engine.prod.bria-api.com/v2/image/edit`
 *   (`/v2/image/edit/erase`, `/v2/image/edit/expand`,
 *   `/v2/image/edit/gen_fill`, `/v2/image/edit/remove_background`,
 *   `/v2/image/edit/relight`, …), each with its own schema and price.
 * - Auth is an `api_token` header — unmodel never touches keys.
 */

import { z } from "zod";
import { createValidator, type PipelineContext } from "../../core/pipeline";
import { toValidated, JSON_HEADERS, type Validated, type ExactKeys } from "../../core/request";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";
import type { ModelInfo } from "../../core/catalog-types";
import type { EndpointConstraints } from "../../core/constraint-types";
import { models } from "./models";
import {
  BRIA_API_BASE_URL,
  BRIA_ASPECT_RATIOS,
  BRIA_EDITING_SPEC_URL,
  BRIA_OUTPUT_TYPES,
  checkBriaEnum,
  checkBriaImages,
  checkBriaIntegerRange,
  checkBriaWebhook,
  checkStructuredJsonString,
  type BriaAspectRatio,
  type BriaCommonParams,
} from "./shared";

export const BRIA_IMAGE_EDIT_URL = `${BRIA_API_BASE_URL}/image/edit`;

/**
 * `images` bounds on the edit route — "minItems: 1 / maxItems: 4" (read
 * 2026-11-12); more than four answers 422 "Unsupported number of input
 * images."
 */
export const BRIA_EDIT_IMAGES_MIN = 1;
export const BRIA_EDIT_IMAGES_MAX = 4;

/** `model_version` enum on the edit route (default FIBO-edit). */
export const BRIA_EDIT_MODEL_VERSIONS = ["FIBO-edit"] as const;
export type BriaEditModelVersion = (typeof BRIA_EDIT_MODEL_VERSIONS)[number];

/** `guidance_scale` bounds (default 5). */
export const BRIA_EDIT_GUIDANCE_SCALE_MIN = 3;
export const BRIA_EDIT_GUIDANCE_SCALE_MAX = 5;

/** `steps_num` bounds on the edit route (default 30) — wider than generate's. */
export const BRIA_EDIT_STEPS_MIN = 20;
export const BRIA_EDIT_STEPS_MAX = 50;

export interface ImageEditParams extends BriaCommonParams {
  /**
   * The source/reference images (URL or base64). REQUIRED — 1 to 4 items, in
   * order; the instruction refers to them as "image 1", "image 2" and so on.
   */
  images: string[];
  /** Natural-language edit instruction ("make the sky blue"). */
  instruction?: string;
  /** JSON **string** edit instruction, for programmatic control. */
  structured_instruction?: string;
  /**
   * Black-and-white mask (URL or base64), same size as the image. Only with a
   * single-item `images` — a multi-image request with a mask returns 422.
   */
  mask?: string;
  /**
   * Output aspect ratio. Default: the first image's own ratio. CLOSED enum —
   * the same 21 values as POST /v2/image/generate. On a single-image edit
   * "the model was not trained to change aspect ratio dramatically from the
   * source image — results may degrade if the requested aspect ratio differs
   * significantly from the input image's own aspect ratio"; multi-image edits
   * "fully support all listed aspect ratios".
   */
  aspect_ratio?: BriaAspectRatio;
  /** Concepts to exclude from the edited image. */
  negative_prompt?: string;
  /** Adherence to the instruction, 3–5. Default 5. */
  guidance_scale?: number;
  /** Diffusion steps, 20–50. Default 30. */
  steps_num?: number;
  /** Pin the edit model. Default "FIBO-edit". */
  model_version?: BriaEditModelVersion | (string & {});
}

const editSchema = z.looseObject({
  images: z.array(z.unknown()),
  instruction: z.string().optional(),
  structured_instruction: z.unknown().optional(),
  mask: z.string().optional(),
  aspect_ratio: z.string().optional(),
  negative_prompt: z.string().optional(),
  guidance_scale: z.number().int().optional(),
  steps_num: z.number().int().optional(),
  model_version: z.string().optional(),
  seed: z.number().int().optional(),
  sync: z.boolean().optional(),
  webhook_url: z.string().optional(),
  output_type: z.string().optional(),
  ip_signal: z.boolean().optional(),
  prompt_content_moderation: z.boolean().optional(),
  visual_input_content_moderation: z.boolean().optional(),
  visual_output_content_moderation: z.boolean().optional(),
});

function checkEdit(
  params: ImageEditParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  checkBriaImages(ctx, params.images, BRIA_EDITING_SPEC_URL, {
    minItems: BRIA_EDIT_IMAGES_MIN,
    maxItems: BRIA_EDIT_IMAGES_MAX,
  });
  checkMaskSingleImage(params, ctx);
  checkBriaEnum(ctx, ["aspect_ratio"], params.aspect_ratio, BRIA_ASPECT_RATIOS, BRIA_EDITING_SPEC_URL);
  checkStructuredJsonString(
    ctx,
    "structured_instruction",
    params.structured_instruction,
    BRIA_EDITING_SPEC_URL,
  );
  if (params.instruction == null && params.structured_instruction == null) {
    ctx.report({
      code: "invalid_shape",
      severity: "warning",
      path: ["instruction"],
      message:
        "an edit request carries its edit in `instruction` (natural language) or `structured_instruction` (JSON string); neither is set, so the request describes no edit.",
      meta: { source: BRIA_EDITING_SPEC_URL },
    });
  }
  checkBriaIntegerRange(
    ctx,
    ["guidance_scale"],
    params.guidance_scale,
    BRIA_EDIT_GUIDANCE_SCALE_MIN,
    BRIA_EDIT_GUIDANCE_SCALE_MAX,
    BRIA_EDITING_SPEC_URL,
  );
  checkBriaIntegerRange(
    ctx,
    ["steps_num"],
    params.steps_num,
    BRIA_EDIT_STEPS_MIN,
    BRIA_EDIT_STEPS_MAX,
    BRIA_EDITING_SPEC_URL,
    " (the edit route's step range differs from the generate route's 35–50).",
  );
  checkBriaEnum(ctx, ["output_type"], params.output_type, BRIA_OUTPUT_TYPES, BRIA_EDITING_SPEC_URL);
  checkBriaEnum(
    ctx,
    ["model_version"],
    params.model_version,
    BRIA_EDIT_MODEL_VERSIONS,
    BRIA_EDITING_SPEC_URL,
    ' The edit route pins "FIBO-edit"; "FIBO" belongs to POST /v2/image/generate.',
  );
  checkBriaWebhook(ctx, params.webhook_url, BRIA_EDITING_SPEC_URL);
}

/**
 * `mask` is "**Only supported when `images` contains exactly one item.** If
 * `images` contains more than one item, including a `mask` will return an
 * error." — the 422 reads "Mask input is not supported for multi-image
 * requests." (image-editing.yaml, read 2026-11-12).
 */
function checkMaskSingleImage(params: ImageEditParams, ctx: PipelineContext): void {
  if (params.mask == null || !Array.isArray(params.images) || params.images.length <= 1) return;
  ctx.report({
    code: "invalid_shape",
    path: ["mask"],
    message: `\`mask\` is only supported when \`images\` holds exactly one item; got ${params.images.length} images. Send the mask with a single image, or drop it for a multi-image edit — those take \`instruction\` or \`structured_instruction\` alone.`,
    meta: { count: params.images.length, source: BRIA_EDITING_SPEC_URL },
  });
}

function estimate(_params: ImageEditParams, info: ModelInfo | undefined) {
  const perImage = info?.cost?.perImage;
  return perImage === undefined ? {} : { costUSD: perImage };
}

/**
 * The one `.toSdk("bria")` target for this endpoint — Bria ships no official
 * JS SDK, so this is the wire body. Derived from the `sdk` literal in
 * `finalize`; it must stay an object type with no index signature, or
 * `toSdk` would accept any string.
 */
type BriaSdkTargets<B> = { bria: () => B };

function finalize(params: ImageEditParams): unknown {
  const body = { ...params };
  return toValidated(body, {
    url: BRIA_IMAGE_EDIT_URL,
    method: "POST",
    headers: JSON_HEADERS,
  }, {
    sdk: { bria: () => body },
  });
}

const validator = createValidator<ImageEditParams, unknown>({
  endpoint: "bria.imageEdit",
  schema: editSchema,
  modelId: (params) =>
    params.model_version === undefined || params.model_version === "FIBO-edit"
      ? "FIBO-edit"
      : params.model_version,
  catalog: models,
  checks: [checkEdit],
  estimate,
  finalize,
});

/**
 * Validates params for `POST https://engine.prod.bria-api.com/v2/image/edit`
 * (Fibo 2 Edit: instruction- or mask-driven editing of one to four images; a
 * mask applies to single-image requests only).
 *
 * ```ts
 * const params = bria.imageEdit({
 *   images: ["https://example.com/product.png"],
 *   instruction: "make the background a warm terracotta wall",
 *   guidance_scale: 5,
 * });
 * ```
 */
export const imageEdit = validator as unknown as {
  <T extends ImageEditParams>(
    params: T & ExactKeys<T, ImageEditParams>,
    options?: ValidateOptions<T>,
  ): Validated<T, BriaSdkTargets<T>>;
  safe<T extends ImageEditParams>(
    params: T & ExactKeys<T, ImageEditParams>,
    options?: ValidateOptions<T>,
  ): ValidateResult<Validated<T, BriaSdkTargets<T>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
