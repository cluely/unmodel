/**
 * Bria FIBO Edit — POST https://engine.prod.bria-api.com/v2/image/edit
 *
 * Wire notes (verified 2026-08-13 against
 * https://docs.bria.ai/_bundle/image-editing.yaml — the bundled OpenAPI the
 * docs site serves — and https://docs.bria.ai/image-editing):
 * - `images` is the only required field and "must contain exactly one item"
 *   (a public URL or a base64 image). The edit itself comes from `instruction`
 *   (natural language) or `structured_instruction` (a JSON **string**, for
 *   programmatic control).
 * - An optional black-and-white `mask` scopes the edit — "Black areas will be
 *   preserved, white areas will be edited. The input image and the input mask
 *   must be of the same size."
 * - The knobs differ from the generate routes: `guidance_scale` is 3–5
 *   (default 5) and `steps_num` is 20–50 (default 30) rather than 35–50, and
 *   `model_version` is `FIBO-edit` rather than `FIBO`.
 * - ASYNC BY DEFAULT (`sync: false`): the POST answers 202 with a `status_url`
 *   to poll, or set `webhook_url`. Polling is transport — out of scope.
 * - NOT modeled here: the ~20 task-specific editing routes (`/v2/erase`,
 *   `/v2/expand`, `/v2/gen_fill`, `/v2/remove_background`, `/v2/relight`, …),
 *   each with its own schema and price.
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
  BRIA_EDITING_SPEC_URL,
  BRIA_OUTPUT_TYPES,
  checkBriaEnum,
  checkBriaImages,
  checkBriaIntegerRange,
  checkBriaWebhook,
  checkStructuredJsonString,
  type BriaCommonParams,
} from "./shared";

export const BRIA_IMAGE_EDIT_URL = `${BRIA_API_BASE_URL}/image/edit`;

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
  /** The source image (URL or base64). REQUIRED — exactly one item. */
  images: string[];
  /** Natural-language edit instruction ("make the sky blue"). */
  instruction?: string;
  /** JSON **string** edit instruction, for programmatic control. */
  structured_instruction?: string;
  /** Black-and-white mask (URL or base64), same size as the image. */
  mask?: string;
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
  checkBriaImages(ctx, params.images, BRIA_EDITING_SPEC_URL, "exactly-one");
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
 * (FIBO Edit: instruction- or mask-driven editing of a single image).
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
