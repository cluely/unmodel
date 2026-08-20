/**
 * Recraft image-editing endpoints —
 * POST https://external.api.recraft.ai/v1/images/{imageToImage,inpaint,
 * outpaint,replaceBackground,generateBackground}
 *
 * Wire notes (ground truth for every rule below:
 * https://www.recraft.ai/docs/api-reference/endpoints, re-verified 2026-08-13
 * — it documents each route's params, its model compatibility and its input
 * limits. Recraft's Swagger document at
 * https://external.api.recraft.ai/doc/spec/api/api.yaml is NOT a source here:
 * it is an internal backend spec that declares no paths and none of these
 * request schemas):
 * - DUAL-FORMAT endpoints. Every image field has a JSON counterpart:
 *   `image` ⇄ `image_url`, `mask` ⇄ `mask_url` (a public URL or a `data:`
 *   URL). unmodel models both on one params type and enforces
 *   "exactly one of the pair", because sending both is ambiguous and sending
 *   neither is a 4xx. Pass Blobs and post `toFormData(validated)`; pass URLs
 *   and post `JSON.stringify(validated)` with a JSON content-type.
 * - Model compatibility is NOT uniform and is the main reason these are five
 *   endpoint fns rather than one: imageToImage accepts the V3 **and** V4
 *   lines, while inpaint / outpaint / replaceBackground / generateBackground
 *   are documented "available with Recraft V3, Recraft V3 Vector models only"
 *   and default to `recraftv3` (the generations route defaults to
 *   `recraftv4_1`).
 * - `strength` is REQUIRED on imageToImage (0 = almost identical to the input,
 *   1 = minimal similarity) and does not exist on the other four routes.
 * - Outpainting takes EITHER per-side margins (`expand_*`, 0–4096 each) OR a
 *   target `size`, never both, and `zoom_out_percentage` (0–100, exclusive
 *   upper bound) can accompany either or stand alone; at least one of the
 *   three must be present.
 * - Input-image limits ("< 10 MB, < 16 MP, max dimension < 4096 px, min
 *   dimension ≥ 256 px") are documented per route; only the byte limit is
 *   checkable from a Blob without decoding it, so that is what is enforced.
 * - Auth is `Authorization: Bearer <token>` — unmodel never touches keys.
 * - Billing is per generated image; the pricing page itemizes the V3 rows for
 *   these operations at exactly the V3 generation rates ($0.04 raster /
 *   $0.08 vector), so the catalog's per-image rate is the estimate.
 */

import { z } from "zod";
import { createValidator, type PipelineContext } from "../../core/pipeline";
import { toValidated, JSON_HEADERS, type ExactKeys, type Validated } from "../../core/request";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";
import type { ModelInfo } from "../../core/catalog-types";
import type { EndpointConstraints } from "../../core/constraint-types";
import {
  models,
  IMAGE_TO_IMAGE_MODELS,
  V3_ONLY_MODELS,
  type RecraftModelId,
} from "./models";
import { STYLE_NAMES_BY_MODEL, type RecraftStyleName } from "./styles";
import type { RecraftControls, RecraftSize, RecraftTextLayoutElement } from "./image";

const IMAGES_BASE_URL = "https://external.api.recraft.ai/v1/images";

export const IMAGE_TO_IMAGE_URL = `${IMAGES_BASE_URL}/imageToImage`;
export const INPAINT_URL = `${IMAGES_BASE_URL}/inpaint`;
export const OUTPAINT_URL = `${IMAGES_BASE_URL}/outpaint`;
export const REPLACE_BACKGROUND_URL = `${IMAGES_BASE_URL}/replaceBackground`;
export const GENERATE_BACKGROUND_URL = `${IMAGES_BASE_URL}/generateBackground`;

const ENDPOINTS_DOCS_URL = "https://www.recraft.ai/docs/api-reference/endpoints";
const APPENDIX_DOCS_URL = "https://www.recraft.ai/docs/api-reference/appendix";

/** Default `model` on imageToImage — same as the generations route. */
export const DEFAULT_IMAGE_TO_IMAGE_MODEL_ID = "recraftv4_1";
/** Default `model` on the V3-only editing routes. */
export const DEFAULT_V3_EDIT_MODEL_ID = "recraftv3";

/** "must be less than 10 MB in size" — every editing route's input image. */
export const MAX_INPUT_IMAGE_BYTES = 10 * 1024 * 1024;

/** `expand_*` bounds on the outpaint route (docs: "must be in range [0, 4096]"). */
export const MAX_OUTPAINT_EXPAND_PIXELS = 4096;

// ---------------------------------------------------------------------------
// Wire types
// ---------------------------------------------------------------------------

/** Fields every editing route shares, per the endpoints doc's param tables. */
interface RecraftTransformCommon {
  /** Multipart: the image to modify. Mutually exclusive with `image_url`. */
  image?: Blob;
  /** JSON: a public URL or `data:` URL. Mutually exclusive with `image`. */
  image_url?: string;
  /** A text description of areas to change. REQUIRED. */
  prompt: string;
  /** Number of images, 1–6. Default 1. Billed per image. */
  n?: number | null;
  /** Curated style name; per-route model compatibility applies. */
  style?: RecraftStyleName | (string & {}) | null;
  /** Style UUID used as a visual reference. Cannot be combined with `style`. */
  style_id?: string | null;
  /** Undesired elements. */
  negative_prompt?: string | null;
  /** Seed for reproducible generation. */
  random_seed?: number | null;
  /** "url" (default) or "b64_json". */
  response_format?: "url" | "b64_json" | null;
  /** Spatial/textual attributes for text elements. */
  text_layout?: RecraftTextLayoutElement[] | null;
  /** Generation tweaks; artistic_level / no_text are V3-only. */
  controls?: RecraftControls | null;
}

export interface ImageToImageParams extends RecraftTransformCommon {
  /** Defaults to "recraftv4_1" server-side. V3 and V4 models only (no V2). */
  model?: (typeof IMAGE_TO_IMAGE_MODELS)[number] | (string & {}) | null;
  /** REQUIRED. 0 = almost identical to the input, 1 = minimal similarity. */
  strength: number;
}

export interface InpaintParams extends RecraftTransformCommon {
  /** Defaults to "recraftv3" server-side. recraftv3 / recraftv3_vector only. */
  model?: (typeof V3_ONLY_MODELS)[number] | (string & {}) | null;
  /** Multipart: grayscale mask, white = inpaint. Mutually exclusive with `mask_url`. */
  mask?: Blob;
  /** JSON: URL or `data:` URL of the mask. Mutually exclusive with `mask`. */
  mask_url?: string;
}

/** generateBackground takes the same params as inpaint (image + mask + prompt). */
export type GenerateBackgroundParams = InpaintParams;

export interface OutpaintParams extends RecraftTransformCommon {
  /** Defaults to "recraftv3" server-side. recraftv3 / recraftv3_vector only. */
  model?: (typeof V3_ONLY_MODELS)[number] | (string & {}) | null;
  /** Pixels to add on the left, 0–4096. Cannot be combined with `size`. */
  expand_left?: number | null;
  /** Pixels to add on the right, 0–4096. Cannot be combined with `size`. */
  expand_right?: number | null;
  /** Pixels to add on the top, 0–4096. Cannot be combined with `size`. */
  expand_top?: number | null;
  /** Pixels to add on the bottom, 0–4096. Cannot be combined with `size`. */
  expand_bottom?: number | null;
  /**
   * Target "WxH" / "w:h" for the result. Cannot be combined with `expand_*`.
   * Shares the generations route's `RecraftSize` vocabulary; this route is
   * `recraftv3` / `recraftv3_vector` only, so the V2/V3 WxH table and the 14
   * shared aspect ratios are the meaningful presets. NOTE: unlike the
   * generations route, the API is not documented well enough here to check the
   * VALUE at runtime — only the `size` ⇄ `expand_*` exclusivity is enforced
   * (see `checkOutpaintGeometry`).
   */
  size?: RecraftSize | null;
  /** Scale the source down by 0–100 (exclusive) percent before outpainting. */
  zoom_out_percentage?: number | null;
}

export interface ReplaceBackgroundParams extends RecraftTransformCommon {
  /** Defaults to "recraftv3" server-side. recraftv3 / recraftv3_vector only. */
  model?: (typeof V3_ONLY_MODELS)[number] | (string & {}) | null;
}

// ---------------------------------------------------------------------------
// Schemas (loose: unknown keys pass through with a warning).
// ---------------------------------------------------------------------------

const colorSchema = z.looseObject({
  rgb: z.array(z.number().int().min(0).max(255)).length(3, "rgb must be exactly 3 integers in 0-255"),
  weight: z.number().min(0).max(1).optional(),
});

const commonShape = {
  image: z.instanceof(Blob).optional(),
  image_url: z.string().optional(),
  prompt: z.string(),
  n: z.number().int().min(1).max(6, "n must be between 1 and 6").nullable().optional(),
  model: z.string().nullable().optional(),
  style: z.string().nullable().optional(),
  style_id: z.string().nullable().optional(),
  negative_prompt: z.string().nullable().optional(),
  random_seed: z.number().int().nullable().optional(),
  response_format: z.string().nullable().optional(),
  text_layout: z
    .array(
      z.looseObject({
        text: z.string().min(1, "text must be a non-empty word"),
        bbox: z
          .array(z.tuple([z.number(), z.number()]))
          .length(4, "bbox must have exactly 4 [x, y] points"),
      }),
    )
    .nullable()
    .optional(),
  controls: z
    .looseObject({
      colors: z.array(colorSchema).nullable().optional(),
      background_color: colorSchema.nullable().optional(),
      artistic_level: z
        .number()
        .int()
        .min(0)
        .max(5, "artistic_level must be in the range [0..5]")
        .nullable()
        .optional(),
      no_text: z.boolean().nullable().optional(),
    })
    .nullable()
    .optional(),
};

const imageToImageSchema = z.looseObject({
  ...commonShape,
  strength: z.number().min(0, "strength must lie in [0, 1]").max(1, "strength must lie in [0, 1]"),
});

const maskShape = {
  mask: z.instanceof(Blob).optional(),
  mask_url: z.string().optional(),
};

const inpaintSchema = z.looseObject({ ...commonShape, ...maskShape });

const expandPixels = z
  .number()
  .int()
  .min(0, `expand_* must be in range [0, ${MAX_OUTPAINT_EXPAND_PIXELS}]`)
  .max(MAX_OUTPAINT_EXPAND_PIXELS, `expand_* must be in range [0, ${MAX_OUTPAINT_EXPAND_PIXELS}]`)
  .nullable()
  .optional();

const outpaintSchema = z.looseObject({
  ...commonShape,
  expand_left: expandPixels,
  expand_right: expandPixels,
  expand_top: expandPixels,
  expand_bottom: expandPixels,
  size: z.string().nullable().optional(),
  zoom_out_percentage: z
    .number()
    .min(0, "zoom_out_percentage must be in range [0, 100)")
    .lt(100, "zoom_out_percentage must be in range [0, 100)")
    .nullable()
    .optional(),
});

const replaceBackgroundSchema = z.looseObject(commonShape);

// ---------------------------------------------------------------------------
// Shared checks
// ---------------------------------------------------------------------------

const RESPONSE_FORMATS = ["url", "b64_json"] as const;

function makeResolveModel(fallback: string) {
  return (params: { model?: string | null }): string => params.model ?? fallback;
}

/** Exactly one of a multipart Blob field and its `_url` JSON counterpart. */
function checkFilePair(
  params: Record<string, unknown>,
  blobField: string,
  urlField: string,
  required: boolean,
  ctx: PipelineContext,
): void {
  const hasBlob = params[blobField] != null;
  const hasUrl = params[urlField] != null;
  if (hasBlob && hasUrl) {
    ctx.report({
      code: "invalid_shape",
      path: [urlField],
      message: `\`${blobField}\` (multipart) and \`${urlField}\` (JSON) are two encodings of the same input — pass one, not both.`,
      meta: { source: ENDPOINTS_DOCS_URL },
    });
    return;
  }
  if (required && !hasBlob && !hasUrl) {
    ctx.report({
      code: "invalid_shape",
      path: [blobField],
      message: `\`${blobField}\` (multipart) or \`${urlField}\` (JSON) is required.`,
      meta: { source: ENDPOINTS_DOCS_URL },
    });
  }
}

function checkImageSource(
  params: RecraftTransformCommon,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  checkFilePair(params as unknown as Record<string, unknown>, "image", "image_url", true, ctx);
}

function checkMaskSource(
  params: InpaintParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  checkFilePair(params as unknown as Record<string, unknown>, "mask", "mask_url", true, ctx);
}

/** "must be less than 10 MB in size" — the only limit checkable from a Blob. */
function checkImageBytes(
  params: RecraftTransformCommon,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const record = params as unknown as Record<string, unknown>;
  for (const field of ["image", "mask"] as const) {
    const blob = record[field];
    if (!(blob instanceof Blob)) continue;
    if (blob.size <= MAX_INPUT_IMAGE_BYTES) continue;
    ctx.report({
      code: "media_too_large",
      path: [field],
      message: `\`${field}\` is ${blob.size} bytes; Recraft caps editing inputs at ${MAX_INPUT_IMAGE_BYTES} bytes (10 MB).`,
      meta: { bytes: blob.size, limit: MAX_INPUT_IMAGE_BYTES, source: ENDPOINTS_DOCS_URL },
    });
  }
}

function checkResponseFormat(
  params: RecraftTransformCommon,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const format = params.response_format;
  if (format == null || (RESPONSE_FORMATS as readonly string[]).includes(format)) return;
  ctx.report({
    code: "invalid_enum_value",
    path: ["response_format"],
    message: `\`response_format\` must be one of "url", "b64_json"; got ${JSON.stringify(format)}.`,
    meta: { allowed: [...RESPONSE_FORMATS], value: format, source: ENDPOINTS_DOCS_URL },
  });
}

function checkStyleExclusivity(
  params: RecraftTransformCommon,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (params.style != null && params.style_id != null) {
    ctx.report({
      code: "invalid_shape",
      path: ["style_id"],
      message: "`style` and `style_id` cannot be used together; specify one or the other.",
      meta: { source: "https://www.recraft.ai/docs/api-reference/styles" },
    });
  }
}

/**
 * Per-route `model` allow-list. Every editing route documents an explicit
 * compatibility list that is narrower than the generations route's.
 */
function makeModelCheck(allowed: readonly string[], fallback: string) {
  const set = new Set<string>(allowed);
  return (
    params: { model?: string | null },
    _info: ModelInfo | undefined,
    ctx: PipelineContext,
  ): void => {
    const model = params.model ?? fallback;
    if (set.has(model)) return;
    ctx.report({
      code: "invalid_enum_value",
      path: ["model"],
      model,
      message: `\`model\` must be one of ${allowed.map((v) => JSON.stringify(v)).join(", ")} on ${ctx.endpoint}; got ${JSON.stringify(model)}.`,
      meta: { allowed: [...allowed], value: model, source: ENDPOINTS_DOCS_URL },
    });
  };
}

function makeStyleCheck(fallback: string) {
  return (
    params: RecraftTransformCommon & { model?: string | null },
    info: ModelInfo | undefined,
    ctx: PipelineContext,
  ): void => {
    const style = params.style;
    if (style == null || info === undefined) return;
    const model = params.model ?? fallback;
    const allowed = STYLE_NAMES_BY_MODEL[model];
    if (allowed === undefined || allowed.includes(style)) return;
    ctx.report({
      code: "invalid_enum_value",
      path: ["style"],
      model,
      message: `\`style\` ${JSON.stringify(style)} is not a curated style for "${model}"; the per-model style lists are documented at https://www.recraft.ai/docs/api-reference/styles (allowed values in meta.allowed).`,
      meta: {
        allowed: [...allowed],
        value: style,
        source: "https://www.recraft.ai/docs/api-reference/styles",
      },
    });
  };
}

function makePromptLengthCheck(fallback: string) {
  return (
    params: RecraftTransformCommon & { model?: string | null },
    info: ModelInfo | undefined,
    ctx: PipelineContext,
  ): void => {
    const limit = info?.limit.characters;
    if (limit === undefined) return;
    const actual = params.prompt.length;
    if (actual <= limit) return;
    const model = params.model ?? fallback;
    ctx.report({
      code: "over_output_limit",
      path: ["prompt"],
      model,
      message: `\`prompt\` is ${actual} characters; "${model}" caps the prompt at ${limit} characters.`,
      meta: { limitCharacters: limit, actualCharacters: actual, source: APPENDIX_DOCS_URL },
    });
  };
}

/** `expand_*` and `size` are mutually exclusive; one of the three is required. */
function checkOutpaintGeometry(
  params: OutpaintParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const expands = [
    params.expand_left,
    params.expand_right,
    params.expand_top,
    params.expand_bottom,
  ];
  const hasExpand = expands.some((v) => v != null);
  const hasSize = params.size != null;
  const hasZoom = params.zoom_out_percentage != null;

  if (hasExpand && hasSize) {
    ctx.report({
      code: "invalid_shape",
      path: ["size"],
      message: "`size` cannot be combined with `expand_left`/`expand_right`/`expand_top`/`expand_bottom`.",
      meta: { source: ENDPOINTS_DOCS_URL },
    });
  }
  if (!hasExpand && !hasSize && !hasZoom) {
    ctx.report({
      code: "invalid_shape",
      path: ["size"],
      message:
        "at least one of `size`, `expand_left`/`expand_right`/`expand_top`/`expand_bottom`, or `zoom_out_percentage` must be specified.",
      meta: { source: ENDPOINTS_DOCS_URL },
    });
  }
}

// ---------------------------------------------------------------------------
// Estimation — billed per generated image (catalog cost.perImage × n).
// ---------------------------------------------------------------------------

function estimate(params: { n?: number | null }, info: ModelInfo | undefined) {
  const perImage = info?.cost?.perImage;
  if (perImage === undefined) return {};
  return { costUSD: perImage * (params.n ?? 1) };
}

/**
 * The one `.toSdk("recraft")` target for this endpoint — Recraft's
 * documented SDK path is the OpenAI client, whose params are wire-shaped.
 * Derived from the `sdk` literal in `finalize`; it must stay an object type
 * with no index signature, or `toSdk` would accept any string.
 */
type RecraftSdkTargets<B> = { recraft: () => B };

/**
 * These routes accept multipart OR JSON. `.request.headers` therefore stays
 * empty for the Blob path (fetch must derive the multipart boundary itself);
 * when the caller uses the `_url` JSON form the headers carry the JSON
 * content-type. `.toSdk("recraft")` returns the body unchanged.
 */
function finalizeTo(url: string) {
  return (params: object): unknown => {
    const body = { ...params };
    const usesBlob = Object.values(body).some((value) => value instanceof Blob);
    return toValidated(body, {
      url,
      method: "POST",
      headers: usesBlob ? {} : JSON_HEADERS,
    }, {
      sdk: { recraft: () => body },
    });
  };
}

/**
 * Builds the multipart/form-data body for a Recraft editing request: `image`
 * and `mask` Blobs become file parts, objects/arrays (`controls`,
 * `text_layout`) become JSON-string parts, everything else is stringified,
 * and null/undefined fields are omitted.
 *
 * ```ts
 * const params = recraft.imageEdit({ image: file, prompt: "winter", strength: 0.2 });
 * await fetch(params.request.url, {
 *   method: params.request.method,
 *   headers: { authorization: `Bearer ${process.env.RECRAFT_API_TOKEN}` },
 *   body: recraft.toFormData(params),
 * });
 * ```
 */
export function toFormData(params: object): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(params)) {
    if (value == null) continue;
    if (value instanceof Blob) form.append(key, value);
    else if (typeof value === "object") form.append(key, JSON.stringify(value));
    else form.append(key, String(value));
  }
  return form;
}

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

const imageToImageValidator = createValidator<ImageToImageParams, unknown>({
  endpoint: "recraft.imageEdit",
  schema: imageToImageSchema,
  modelId: makeResolveModel(DEFAULT_IMAGE_TO_IMAGE_MODEL_ID),
  catalog: models,
  checks: [
    checkImageSource,
    checkImageBytes,
    checkResponseFormat,
    checkStyleExclusivity,
    makeModelCheck(IMAGE_TO_IMAGE_MODELS, DEFAULT_IMAGE_TO_IMAGE_MODEL_ID),
    makeStyleCheck(DEFAULT_IMAGE_TO_IMAGE_MODEL_ID),
    makePromptLengthCheck(DEFAULT_IMAGE_TO_IMAGE_MODEL_ID),
  ],
  estimate,
  finalize: finalizeTo(IMAGE_TO_IMAGE_URL),
});

/** Checks shared by the four `recraftv3`-only editing routes. */
const V3_EDIT_CHECKS: ReadonlyArray<
  (
    params: RecraftTransformCommon & { model?: string | null },
    info: ModelInfo | undefined,
    ctx: PipelineContext,
  ) => void
> = [
  checkImageSource,
  checkImageBytes,
  checkResponseFormat,
  checkStyleExclusivity,
  makeModelCheck(V3_ONLY_MODELS, DEFAULT_V3_EDIT_MODEL_ID),
  makeStyleCheck(DEFAULT_V3_EDIT_MODEL_ID),
  makePromptLengthCheck(DEFAULT_V3_EDIT_MODEL_ID),
];

const inpaintValidator = createValidator<InpaintParams, unknown>({
  endpoint: "recraft.imageEditInpaint",
  schema: inpaintSchema,
  modelId: makeResolveModel(DEFAULT_V3_EDIT_MODEL_ID),
  catalog: models,
  checks: [...V3_EDIT_CHECKS, checkMaskSource],
  estimate,
  finalize: finalizeTo(INPAINT_URL),
});

const generateBackgroundValidator = createValidator<GenerateBackgroundParams, unknown>({
  endpoint: "recraft.imageEditGenerateBackground",
  schema: inpaintSchema,
  modelId: makeResolveModel(DEFAULT_V3_EDIT_MODEL_ID),
  catalog: models,
  checks: [...V3_EDIT_CHECKS, checkMaskSource],
  estimate,
  finalize: finalizeTo(GENERATE_BACKGROUND_URL),
});

const outpaintValidator = createValidator<OutpaintParams, unknown>({
  endpoint: "recraft.imageEditOutpaint",
  schema: outpaintSchema,
  modelId: makeResolveModel(DEFAULT_V3_EDIT_MODEL_ID),
  catalog: models,
  checks: [...V3_EDIT_CHECKS, checkOutpaintGeometry],
  estimate,
  finalize: finalizeTo(OUTPAINT_URL),
});

const replaceBackgroundValidator = createValidator<ReplaceBackgroundParams, unknown>({
  endpoint: "recraft.imageEditReplaceBackground",
  schema: replaceBackgroundSchema,
  modelId: makeResolveModel(DEFAULT_V3_EDIT_MODEL_ID),
  catalog: models,
  checks: V3_EDIT_CHECKS,
  estimate,
  finalize: finalizeTo(REPLACE_BACKGROUND_URL),
});

interface RecraftTransformValidator<P> {
  <T extends P>(
    params: T & ExactKeys<T, P>,
    options?: ValidateOptions,
  ): Validated<T, RecraftSdkTargets<T>>;
  safe<T extends P>(
    params: T & ExactKeys<T, P>,
    options?: ValidateOptions,
  ): ValidateResult<Validated<T, RecraftSdkTargets<T>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
}

/**
 * Validates params for Recraft `POST /v1/images/imageToImage` — creates an
 * image similar to the input, with `strength` (REQUIRED, 0–1) setting how far
 * it may drift. Accepts the V3 **and** V4 model lines; defaults to
 * `recraftv4_1`.
 *
 * Pass `image` (a Blob) and post `recraft.toFormData(validated)`, or pass
 * `image_url` and post `JSON.stringify(validated)` — `.request.headers`
 * carries the JSON content-type only on the URL path. Auth is your job: add
 * an `authorization: Bearer <token>` header.
 */
export const imageEdit =
  imageToImageValidator as unknown as RecraftTransformValidator<ImageToImageParams>;

/**
 * Validates params for Recraft `POST /v1/images/inpaint` — regenerates the
 * white regions of `mask` from `prompt`. Documented for `recraftv3` /
 * `recraftv3_vector` only (default `recraftv3`); other model ids are reported
 * as `invalid_enum_value`. See `imageEdit` for the fetch recipe.
 */
export const imageEditInpaint = inpaintValidator as unknown as RecraftTransformValidator<InpaintParams>;

/**
 * Validates params for Recraft `POST /v1/images/generateBackground` —
 * same request shape as `inpaint`, generating a background in the masked
 * regions. `recraftv3` / `recraftv3_vector` only.
 */
export const imageEditGenerateBackground =
  generateBackgroundValidator as unknown as RecraftTransformValidator<GenerateBackgroundParams>;

/**
 * Validates params for Recraft `POST /v1/images/outpaint` — extends the image
 * beyond its borders. Specify the new area with `expand_*` margins OR a
 * target `size` (never both), optionally with `zoom_out_percentage`; at least
 * one of the three is required. `recraftv3` / `recraftv3_vector` only.
 */
export const imageEditOutpaint = outpaintValidator as unknown as RecraftTransformValidator<OutpaintParams>;

/**
 * Validates params for Recraft `POST /v1/images/replaceBackground` — detects
 * the background and regenerates it from `prompt`. `recraftv3` /
 * `recraftv3_vector` only.
 */
export const imageEditReplaceBackground =
  replaceBackgroundValidator as unknown as RecraftTransformValidator<ReplaceBackgroundParams>;

export type { RecraftModelId };
