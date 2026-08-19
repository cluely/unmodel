/**
 * Luma Dream Machine image generation —
 * POST https://api.lumalabs.ai/dream-machine/v1/generations/image
 *
 * Wire notes (verified against https://docs.lumalabs.ai/docs/image-generation
 * and the `lumaai` npm SDK's generations.image resource types on 2026-08-13):
 * - Async job API like the video route (poll GET /generations/{id} or use
 *   `callback_url`), unless `sync: true` is set, in which case the completed
 *   image is returned inline (bounded by `sync_timeout`).
 * - `model` defaults to "photon-1" server-side
 *   (https://docs.lumalabs.ai/docs/image-generation); model-dependent checks
 *   run against that default when it is omitted.
 * - Reference inputs: `image_ref` (guidance, with per-image `weight`),
 *   `style_ref` (style transfer), `character_ref` (identity images), and
 *   `modify_image_ref` (refine an existing image).
 * - No cost estimate: Luma publishes no current USD rate for these models
 *   (see ./models.ts).
 * - Auth is `Authorization: Bearer <LUMAAI_API_KEY>` — unmodel never touches
 *   keys; add the header yourself when fetching.
 */

import { z } from "zod";
import { createValidator, type PipelineContext } from "../../core/pipeline";
import { toValidated, JSON_HEADERS, type ExactKeys, type Validated } from "../../core/request";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";
import type { ModelInfo } from "../../core/catalog-types";
import type { EndpointConstraints } from "../../core/constraint-types";
import { imageModels, type LumaImageModelId } from "./models";
// `./shared`, not `./generations`: two constants used to be worth this
// module's entire graph — the video validator's zod schema, checks and pricing
// table — in an entry that only generates images.
import { LUMA_ASPECT_RATIOS, GENERATIONS_URL, type LumaAspectRatio } from "./shared";

export const IMAGE_GENERATIONS_URL = `${GENERATIONS_URL}/image`;

const IMAGE_GENERATION_DOCS = "https://docs.lumalabs.ai/docs/image-generation";

/**
 * "You can use up to 4 images as references" (`image_ref`) and "you can use up
 * to 4 images of the same person to build one identity" (`character_ref`) —
 * https://docs.lumalabs.ai/docs/image-generation. The OpenAPI schema leaves
 * both arrays unbounded, so these caps come from the guide only. `style_ref`
 * has no documented cap and stays permissive.
 */
export const LUMA_MAX_IMAGE_REFS = 4;
export const LUMA_MAX_IDENTITY_IMAGES = 4;

/**
 * Server-side default when `model` is omitted —
 * https://docs.lumalabs.ai/docs/image-generation.
 */
export const DEFAULT_IMAGE_MODEL_ID = "photon-1";

// ---------------------------------------------------------------------------
// Wire types — mirror the raw JSON body exactly (snake_case).
// ---------------------------------------------------------------------------

/** A weighted image reference. */
export interface LumaImageRef {
  url?: string;
  weight?: number;
}

export interface LumaCharacterRef {
  /** The character identity, defined by one or more images. */
  identity0?: { images?: string[] };
}

export interface ImageGenerationsParams {
  /** Defaults to "photon-1" server-side. */
  model?: LumaImageModelId | (string & {});
  /** The text prompt. */
  prompt?: string;
  aspect_ratio?: LumaAspectRatio;
  /** Output format of the image. */
  format?: "jpg" | "png";
  /** Guidance images with optional weights. */
  image_ref?: LumaImageRef[];
  /** Style-transfer reference images. */
  style_ref?: LumaImageRef[];
  /** Character identity reference images. */
  character_ref?: LumaCharacterRef;
  /** Refine an existing image. */
  modify_image_ref?: LumaImageRef;
  /** Return the completed image inline instead of a job to poll. */
  sync?: boolean;
  /** Timeout (seconds) for `sync` mode. */
  sync_timeout?: number;
  /**
   * POSTed a generation object when the job starts dreaming, completes, or
   * fails.
   */
  callback_url?: string;
  generation_type?: "image";
}

const imageRefSchema = z.looseObject({
  url: z.string().optional(),
  weight: z.number().optional(),
});

const imageGenerationsSchema = z.looseObject({
  model: z.string().optional(),
  prompt: z.string().optional(),
  aspect_ratio: z.enum(LUMA_ASPECT_RATIOS).optional(),
  format: z.enum(["jpg", "png"]).optional(),
  image_ref: z.array(imageRefSchema).optional(),
  style_ref: z.array(imageRefSchema).optional(),
  character_ref: z
    .looseObject({
      identity0: z.looseObject({ images: z.array(z.string()).optional() }).optional(),
    })
    .optional(),
  modify_image_ref: imageRefSchema.optional(),
  sync: z.boolean().optional(),
  sync_timeout: z.number().optional(),
  callback_url: z.string().optional(),
  generation_type: z.literal("image").optional(),
});

/**
 * The two documented reference-count caps. Reported as invalid_shape so a
 * caller who hits a raised limit before this table updates can demote it.
 */
function checkReferenceCounts(
  params: ImageGenerationsParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const imageRefs = params.image_ref;
  if (Array.isArray(imageRefs) && imageRefs.length > LUMA_MAX_IMAGE_REFS) {
    ctx.report({
      code: "invalid_shape",
      path: ["image_ref"],
      message: `\`image_ref\` accepts up to ${LUMA_MAX_IMAGE_REFS} images; got ${imageRefs.length}.`,
      meta: { max: LUMA_MAX_IMAGE_REFS, count: imageRefs.length, source: IMAGE_GENERATION_DOCS },
    });
  }
  const identityImages = params.character_ref?.identity0?.images;
  if (Array.isArray(identityImages) && identityImages.length > LUMA_MAX_IDENTITY_IMAGES) {
    ctx.report({
      code: "invalid_shape",
      path: ["character_ref", "identity0", "images"],
      message: `\`character_ref.identity0.images\` accepts up to ${LUMA_MAX_IDENTITY_IMAGES} images of the same person; got ${identityImages.length}.`,
      meta: {
        max: LUMA_MAX_IDENTITY_IMAGES,
        count: identityImages.length,
        source: IMAGE_GENERATION_DOCS,
      },
    });
  }
}

/**
 * The one `.toSdk("luma")` target for this endpoint — the `lumaai` SDK takes
 * wire-shaped params. Derived from the `sdk` literal in `finalize`; it must
 * stay an object type with no index signature, or `toSdk` would accept any
 * string.
 */
type LumaSdkTargets<B> = { luma: () => B };

function finalize(params: ImageGenerationsParams): unknown {
  const body = { ...params };
  return toValidated(body, {
    url: IMAGE_GENERATIONS_URL,
    method: "POST",
    headers: JSON_HEADERS,
  }, {
    sdk: { luma: () => body },
  });
}

const validator = createValidator<ImageGenerationsParams, unknown>({
  endpoint: "luma.imageGenerations",
  schema: imageGenerationsSchema,
  // model is optional on the wire; checks run against the documented
  // server-side default when omitted.
  modelId: (params) => params.model ?? DEFAULT_IMAGE_MODEL_ID,
  // Route-scoped catalog: ray video models are not valid here and warn as
  // unknown_model.
  catalog: imageModels,
  checks: [checkReferenceCounts],
  // No estimate: no published USD pricing for these models (see ./models.ts).
  finalize,
});

/**
 * Validates raw wire params for Luma Dream Machine
 * `POST /dream-machine/v1/generations/image` (Photon image generation).
 *
 * The returned object's enumerable props are the exact fetch JSON body.
 * `.toSdk("luma")` returns the body unchanged in shape — the `lumaai` SDK's
 * `client.generations.image.create(body)` params are wire-shaped. Auth is
 * your job: add `authorization: Bearer <LUMAAI_API_KEY>` when fetching.
 *
 * ```ts
 * const params = luma.imageGenerations({
 *   model: "photon-1",
 *   prompt: "A tiny robot tending a bonsai tree",
 *   aspect_ratio: "1:1",
 *   format: "png",
 * });
 * ```
 */
export const imageGenerations = validator as unknown as {
  <T extends ImageGenerationsParams>(
    params: T & ExactKeys<T, ImageGenerationsParams>,
    options?: ValidateOptions,
  ): Validated<T, LumaSdkTargets<T>>;
  safe<T extends ImageGenerationsParams>(
    params: T & ExactKeys<T, ImageGenerationsParams>,
    options?: ValidateOptions,
  ): ValidateResult<Validated<T, LumaSdkTargets<T>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
