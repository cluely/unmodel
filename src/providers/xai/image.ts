/**
 * xAI Grok Imagine image generation —
 * POST https://api.x.ai/v1/images/generations
 *
 * Wire notes (verified against
 * https://docs.x.ai/developers/model-capabilities/imagine and the REST
 * reference at https://docs.x.ai/developers/rest-api-reference/inference/images
 * on 2026-08-24; xAI publishes no official JS SDK — the `xai` npm package is a
 * placeholder — so the REST reference is the wire authority):
 * - Synchronous, OpenAI-images-style: the response is `{data: [{url | b64_json,
 *   …}], usage}`. Unlike OpenAI there is no `size` field — shape and size are
 *   `aspect_ratio` (16 documented values incl. "auto") and `resolution`
 *   ("1k" | "2k").
 * - `model` is optional on the wire and xAI documents no server-side default,
 *   so an omitted model simply skips the model-dependent checks and produces
 *   no cost estimate.
 * - "Configure output count (up to 10 images per request)" — `n` caps at 10.
 * - Flat per-image pricing regardless of prompt length; each id's rate is on
 *   the models page (see ./models.ts).
 * - Auth is `Authorization: Bearer <XAI_API_KEY>` — unmodel never touches
 *   keys; add the header yourself when fetching.
 */

import { z } from "zod";
import { createValidator, type PipelineContext } from "../../core/pipeline";
import { JSON_HEADERS, toValidated, type ExactKeys, type Validated } from "../../core/request";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";
import type { ModelInfo } from "../../core/catalog-types";
import type { EndpointConstraints } from "../../core/constraint-types";
import { imageModels, IMAGE_MODEL_IDS, type XaiImageGenerationModelId } from "./models";

export const IMAGE_GENERATIONS_URL = "https://api.x.ai/v1/images/generations";

const IMAGE_DOCS = "https://docs.x.ai/developers/model-capabilities/imagine";
const IMAGE_REFERENCE = "https://docs.x.ai/developers/rest-api-reference/inference/images";

/** "up to 10 images per request" — the imagine capability page. */
export const IMAGE_MAX_N = 10;

/**
 * The documented `aspect_ratio` enum, REST reference order. `"auto"` lets the
 * model pick.
 */
export const IMAGE_ASPECT_RATIOS = [
  "1:1",
  "3:4",
  "4:3",
  "9:16",
  "16:9",
  "2:3",
  "3:2",
  "9:19.5",
  "19.5:9",
  "9:20",
  "20:9",
  "1:2",
  "2:1",
  "21:9",
  "5:2",
  "auto",
] as const;
export type XaiImageAspectRatio = (typeof IMAGE_ASPECT_RATIOS)[number];

/** Documented `resolution` values. */
export const IMAGE_RESOLUTIONS = ["1k", "2k"] as const;
export type XaiImageResolution = (typeof IMAGE_RESOLUTIONS)[number];

/** Documented `response_format` values ("Can be url or b64_json"). */
export const IMAGE_RESPONSE_FORMATS = ["url", "b64_json"] as const;
export type XaiImageResponseFormat = (typeof IMAGE_RESPONSE_FORMATS)[number];

// ---------------------------------------------------------------------------
// Wire types — mirror the raw JSON body exactly (snake_case).
// ---------------------------------------------------------------------------

/** Where generated files land — the REST reference's `storage_options`. */
export interface XaiStorageOptions {
  /** Required within the object. */
  filename: string;
  /** Seconds until expiry (max 2592000 on the video routes). */
  expires_after?: number;
  /** Serve the stored file from a public URL. */
  public_url?: boolean;
}

export interface ImageGenerationsParams {
  /** Prompt for image generation. Required. */
  prompt: string;
  /** Optional on the wire; xAI documents no default, so name one explicitly. */
  model?: XaiImageGenerationModelId | (string & {});
  /** Number of images to generate, up to 10. */
  n?: number;
  /** "url" (default behaviour in the docs' examples) or "b64_json". */
  response_format?: XaiImageResponseFormat;
  aspect_ratio?: XaiImageAspectRatio;
  /** Output size tier: "1k" or "2k". */
  resolution?: XaiImageResolution;
  /** Persist outputs to xAI-managed storage. */
  storage_options?: XaiStorageOptions;
  /** Unique identifier representing your end-user. */
  user?: string;
}

// ---------------------------------------------------------------------------
// Schema (loose: unknown keys pass through with a warning).
// ---------------------------------------------------------------------------

const imageSchema = z.looseObject({
  prompt: z.string().min(1, "prompt is required"),
  model: z.string().optional(),
  n: z.number().int().optional(),
  response_format: z.enum(IMAGE_RESPONSE_FORMATS).optional(),
  aspect_ratio: z.enum(IMAGE_ASPECT_RATIOS).optional(),
  resolution: z.enum(IMAGE_RESOLUTIONS).optional(),
  storage_options: z
    .looseObject({
      filename: z.string(),
      expires_after: z.number().int().optional(),
      public_url: z.boolean().optional(),
    })
    .optional(),
  user: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

const IMAGE_MODEL_ID_SET = new Set<string>(IMAGE_MODEL_IDS);

function checkModelEnum(
  params: ImageGenerationsParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (params.model === undefined || IMAGE_MODEL_ID_SET.has(params.model)) return;
  ctx.report({
    code: "invalid_enum_value",
    path: ["model"],
    model: params.model,
    message: `\`model\` must be one of ${IMAGE_MODEL_IDS.map((v) => JSON.stringify(v)).join(", ")}; got ${JSON.stringify(params.model)}.`,
    meta: { allowed: [...IMAGE_MODEL_IDS], value: params.model, source: IMAGE_DOCS },
  });
}

function checkN(
  params: ImageGenerationsParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const n = params.n;
  if (n === undefined) return;
  if (Number.isInteger(n) && n >= 1 && n <= IMAGE_MAX_N) return;
  ctx.report({
    code: "invalid_shape",
    path: ["n"],
    message: `\`n\` must be an integer between 1 and ${IMAGE_MAX_N} ("up to 10 images per request"); got ${n}.`,
    meta: { min: 1, max: IMAGE_MAX_N, value: n, source: IMAGE_DOCS },
  });
}

// ---------------------------------------------------------------------------
// Estimation — flat per-image pricing ("Each generated image incurs a fixed
// fee"), so the estimate is exact: n × the model's published rate.
// ---------------------------------------------------------------------------

function estimate(
  params: ImageGenerationsParams,
  info: ModelInfo | undefined,
  _ctx: PipelineContext,
) {
  const perImage = info?.cost?.perImage;
  if (perImage === undefined) return {};
  return { costUSD: perImage * (params.n ?? 1) };
}

// ---------------------------------------------------------------------------
// Finalize — the whole params object is the wire body.
// ---------------------------------------------------------------------------

/**
 * Written as a `type` kept in lockstep with the object literal in `finalize`
 * (see `SdkFormatters` in core/request.ts). `openai` is here because the
 * endpoint is OpenAI-SDK compatible: `client.images.generate(body)` with
 * `base_url: "https://api.x.ai/v1"` takes this body (the xAI-only fields ride
 * along as extra params).
 */
type XaiImageSdkTargets<B> = { xai: () => B; openai: () => B };

function finalize(params: ImageGenerationsParams): unknown {
  const body = { ...params };
  return toValidated(
    body,
    { url: IMAGE_GENERATIONS_URL, method: "POST", headers: JSON_HEADERS },
    { sdk: { xai: () => body, openai: () => body } },
  );
}

const validator = createValidator<ImageGenerationsParams, unknown>({
  endpoint: "xai.image",
  schema: imageSchema,
  // Optional on the wire with no documented server default: an omitted model
  // skips the model-dependent checks rather than guessing an id.
  modelId: (params) => params.model,
  // Route-scoped catalog: chat and video ids are not valid here and warn as
  // unknown_model.
  catalog: imageModels,
  checks: [checkModelEnum, checkN],
  estimate,
  promptPath: ["prompt"],
  finalize,
});

/**
 * Validates raw wire params for xAI `POST /v1/images/generations` (Grok
 * Imagine image generation).
 *
 * The returned object's enumerable props are the exact fetch JSON body.
 * `.toSdk("openai")` returns it unchanged in shape — the endpoint is
 * OpenAI-SDK compatible (`client.images.generate` against base_url
 * https://api.x.ai/v1). The call is synchronous: the response carries
 * `data[].url` or `data[].b64_json`. Auth is your job: add
 * `authorization: Bearer <XAI_API_KEY>` when fetching.
 *
 * Cost is the flat published per-image rate × `n` (e.g.
 * grok-imagine-image-2.0 at $0.04/image).
 *
 * ```ts
 * const params = xai.image({
 *   model: "grok-imagine-image-2.0",
 *   prompt: "A collage of London landmarks in a stenciled street-art style",
 *   aspect_ratio: "16:9",
 *   resolution: "2k",
 * });
 * ```
 */
export const image = validator as unknown as {
  <T extends ImageGenerationsParams>(
    params: T & ExactKeys<T, ImageGenerationsParams>,
    options?: ValidateOptions<T>,
  ): Validated<T, XaiImageSdkTargets<T>>;
  safe<T extends ImageGenerationsParams>(
    params: T & ExactKeys<T, ImageGenerationsParams>,
    options?: ValidateOptions<T>,
  ): ValidateResult<Validated<T, XaiImageSdkTargets<T>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
