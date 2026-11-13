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
 *   ("1k" | "2k" | "1.5k").
 * - `quality` ("low" | "medium" | "auto", default "auto") is
 *   grok-imagine-image-2.0's: "The parameter is only supported for
 *   `grok-imagine-image-2.0`." (images/generation guide, 2026-11-12). On any
 *   other id it draws an `unsupported_param` warning ({@link checkQualitySupport}).
 * - `model` is optional on the wire and xAI documents no server-side default,
 *   so an omitted model simply skips the model-dependent checks and produces
 *   no cost estimate. Documented aliases (`IMAGE_MODEL_ALIASES` in
 *   ./models.ts) validate and price as the row they serve.
 * - "Configure output count (up to 10 images per request)" — `n` caps at 10.
 * - Per-image pricing regardless of prompt length, by `resolution` and, on
 *   2.0, by served quality (see ./models.ts IMAGE_RATES).
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
import {
  imageModels,
  IMAGE_MEDIUM_RATES,
  IMAGE_MODEL_ALIASES,
  IMAGE_MODEL_IDS,
  IMAGE_RATES,
  type XaiImageGenerationModelId,
} from "./models";

export const IMAGE_GENERATIONS_URL = "https://api.x.ai/v1/images/generations";

const IMAGE_DOCS = "https://docs.x.ai/developers/model-capabilities/imagine";
const IMAGE_REFERENCE = "https://docs.x.ai/developers/rest-api-reference/inference/images";
const IMAGE_GENERATION_DOCS = "https://docs.x.ai/developers/model-capabilities/images/generation";

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

/**
 * Documented `resolution` values, REST reference order: "* `resolution`
 * ("1k" | "2k" | "1.5k")" —
 * https://docs.x.ai/developers/rest-api-reference/inference/images
 * (2026-11-12); the OpenAPI `ImageResolution` enum is the same three. Default
 * "1k" ("`1k` (default when omitted)" — the generation guide).
 */
export const IMAGE_RESOLUTIONS = ["1k", "2k", "1.5k"] as const;
export type XaiImageResolution = (typeof IMAGE_RESOLUTIONS)[number];
const DEFAULT_IMAGE_RESOLUTION: XaiImageResolution = "1k";

/**
 * Documented `quality` values: "Allowed values are `low`, `medium`, and
 * `auto`. When omitted, the default is `auto`, which lets the service choose
 * the quality for each request." —
 * https://docs.x.ai/developers/model-capabilities/images/generation (2026-11-12).
 */
export const IMAGE_QUALITIES = ["low", "medium", "auto"] as const;
export type XaiImageQuality = (typeof IMAGE_QUALITIES)[number];

/** Documented `response_format` values ("Can be url or b64_json"). */
export const IMAGE_RESPONSE_FORMATS = ["url", "b64_json"] as const;
export type XaiImageResponseFormat = (typeof IMAGE_RESPONSE_FORMATS)[number];

// ---------------------------------------------------------------------------
// Wire types — mirror the raw JSON body exactly (snake_case).
// ---------------------------------------------------------------------------

/**
 * `storage_options.public_url` in its object form — mirrors the OpenAPI
 * `PublicUrlOptions` exactly (https://docs.x.ai/openapi.json, 2026-11-12).
 */
export interface XaiPublicUrlOptions {
  /**
   * Seconds until the public URL expires: "Must be between 3600 (1 hour) and
   * 2592000 (30 days)." Omitted, it inherits the file's `expires_after`, else
   * never expires.
   */
  expires_after?: number;
}

/** Where generated files land — the REST reference's `storage_options`. */
export interface XaiStorageOptions {
  /** Required within the object. */
  filename: string;
  /** Seconds until expiry (max 2592000 on the video routes). */
  expires_after?: number;
  /**
   * Serve the stored file from a public URL: `true` = a public URL with
   * defaults; an object = explicit expiry. "* `public_url` (boolean | object)"
   * — https://docs.x.ai/developers/rest-api-reference/inference/videos and
   * .../images (2026-11-12); the OpenAPI `PublicUrlInput` is `oneOf boolean |
   * PublicUrlOptions`.
   */
  public_url?: boolean | XaiPublicUrlOptions;
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
  /** Output size tier: "1k" (default), "1.5k" or "2k". */
  resolution?: XaiImageResolution;
  /**
   * grok-imagine-image-2.0 only. Default "auto", which "currently uses `low`
   * for image generation"; images bill at the quality they are served at.
   */
  quality?: XaiImageQuality;
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
  quality: z.enum(IMAGE_QUALITIES).optional(),
  storage_options: z
    .looseObject({
      filename: z.string(),
      expires_after: z.number().int().optional(),
      public_url: z
        .union([z.boolean(), z.looseObject({ expires_after: z.number().int().optional() })])
        .optional(),
    })
    .optional(),
  user: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

/** Every `model` value the route accepts: the catalog ids and their documented aliases. */
const ACCEPTED_IMAGE_MODELS: readonly string[] = [
  ...IMAGE_MODEL_IDS,
  ...Object.keys(IMAGE_MODEL_ALIASES),
];
const ACCEPTED_IMAGE_MODEL_SET = new Set<string>(ACCEPTED_IMAGE_MODELS);

/**
 * The catalog row a request's `model` names: the id itself, or the row a
 * documented alias serves.
 */
function resolveImageModel(model: string | undefined): string | undefined {
  return model !== undefined && Object.hasOwn(IMAGE_MODEL_ALIASES, model)
    ? IMAGE_MODEL_ALIASES[model as keyof typeof IMAGE_MODEL_ALIASES]
    : model;
}

function checkModelEnum(
  params: ImageGenerationsParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (params.model === undefined || ACCEPTED_IMAGE_MODEL_SET.has(params.model)) return;
  ctx.report({
    code: "invalid_enum_value",
    path: ["model"],
    model: params.model,
    message: `\`model\` must be one of ${ACCEPTED_IMAGE_MODELS.map((v) => JSON.stringify(v)).join(", ")}; got ${JSON.stringify(params.model)}.`,
    meta: { allowed: [...ACCEPTED_IMAGE_MODELS], value: params.model, source: IMAGE_DOCS },
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

/** The one id `quality` is documented for. */
const QUALITY_MODEL = "grok-imagine-image-2.0";

/**
 * `quality` on any other id: "The parameter is only supported for
 * `grok-imagine-image-2.0`." (images/generation guide, 2026-11-12). A warning,
 * not an error: xAI documents no 400 for it, and does not say the field is
 * ignored either, so the issue claims neither. Keyed on the resolved row, so
 * the documented alias warns too; an omitted model is never gated.
 */
function checkQualitySupport(
  params: ImageGenerationsParams,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (params.quality === undefined || info === undefined || info.id === QUALITY_MODEL) return;
  // "After **November 2, 2026**, requests to `grok-imagine-image-quality` are
  // served by `grok-imagine-image-2.0` with `quality` set to `low`."
  // (https://docs.x.ai/developers/migration/imagine-image-quality-nov-2)
  const retired =
    info.id === "grok-imagine-image-quality"
      ? ` The retired slug is served by ${JSON.stringify(QUALITY_MODEL)} with \`quality\` set to "low".`
      : "";
  ctx.report({
    code: "unsupported_param",
    severity: "warning",
    path: ["quality"],
    model: params.model,
    message:
      `\`quality\` is documented for ${JSON.stringify(QUALITY_MODEL)} only ("The parameter is only ` +
      "supported for `grok-imagine-image-2.0`.\"); xAI does not document what " +
      `${JSON.stringify(params.model)} does with it.${retired} Set ` +
      `\`model: ${JSON.stringify(QUALITY_MODEL)}\` to choose a quality.`,
    meta: { value: params.quality, source: IMAGE_GENERATION_DOCS },
  });
}

// ---------------------------------------------------------------------------
// Estimation — per-image pricing ("Each generated image incurs a fixed fee")
// by `resolution` and, on grok-imagine-image-2.0, by `quality`: n × the rate
// in ./models.ts IMAGE_RATES (or IMAGE_MEDIUM_RATES). A resolution the id has
// no published rate for prices nothing rather than borrowing a neighbour's.
// ---------------------------------------------------------------------------

function estimate(
  params: ImageGenerationsParams,
  info: ModelInfo | undefined,
  _ctx: PipelineContext,
) {
  if (info === undefined || !Object.hasOwn(IMAGE_RATES, info.id)) return {};
  const id = info.id as XaiImageGenerationModelId;
  const rates: Readonly<Partial<Record<string, number>>> =
    (params.quality === "medium" ? IMAGE_MEDIUM_RATES[id] : undefined) ?? IMAGE_RATES[id];
  const perImage = rates[params.resolution ?? DEFAULT_IMAGE_RESOLUTION];
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
  modelId: (params) => resolveImageModel(params.model),
  // Route-scoped catalog: chat and video ids are not valid here and warn as
  // unknown_model.
  catalog: imageModels,
  checks: [checkModelEnum, checkN, checkQualitySupport],
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
 * Cost is the published per-image rate at the requested `resolution` (and,
 * on grok-imagine-image-2.0, `quality`) × `n` — e.g. grok-imagine-image-2.0
 * at 2k and quality "low": $0.06/image.
 *
 * ```ts
 * const params = xai.image({
 *   model: "grok-imagine-image-2.0",
 *   prompt: "A collage of London landmarks in a stenciled street-art style",
 *   aspect_ratio: "16:9",
 *   resolution: "2k",
 *   quality: "low",
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
