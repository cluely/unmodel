/**
 * Recraft image-editing endpoints —
 * POST https://external.api.recraft.ai/v1/images/{imageToImage,inpaint,
 * outpaint,replaceBackground,generateBackground}
 *
 * Wire notes (ground truth for every rule below:
 * https://www.recraft.ai/docs/api-reference/endpoints and the per-route pages
 * under https://www.recraft.ai/docs/api-reference/tools/ (image-to-image,
 * inpainting, outpainting, background), re-verified 2026-11-12 — they
 * document each route's params, its model compatibility and its input limits;
 * the docs-generated https://www.recraft.ai/docs/api-reference/openapi.json
 * types the same request bodies):
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
 * - imageToImage marks `style`, `style_id`, `style_match`, `negative_prompt`
 *   and `text_layout` "**V3 only.**" ("Image to image doesn't take V4 / V4.1
 *   styles"), and the endpoints Controls table marks `artistic_level` /
 *   `no_text` "V3 models only", so the V4 / V4.1 models refuse all seven
 *   (`imageToImageFamilyRules`, `checkImageToImageControls`). With no
 *   `model`, a curated V3 `style` resolves to the V3 model whose list holds
 *   it, as on the generations route.
 * - `image_format` ("`webp` (lossless) or `png`") and `style_match` ("Only
 *   `regular` for V3") are on every route page.
 * - `strength` is REQUIRED on imageToImage (0 = almost identical to the input,
 *   1 = minimal similarity) and does not exist on the other four routes.
 * - Outpainting takes EITHER per-side margins (`expand_*`, 0–4096 each) OR a
 *   target `size`, never both, and `zoom_out_percentage` (0–100, exclusive
 *   upper bound) can accompany either or stand alone; at least one of the
 *   three must be present.
 * - Input-image limits ("The input image must be PNG, JPG, WEBP, or SVG,
 *   under 20 MB, up to 16 MP, with sides between 256 and 4096 px.") are
 *   documented per route; only the byte limit is checkable from a Blob
 *   without decoding it, so that is what is enforced.
 * - `response_format` is `url`, `b64_json` or `multipart` ("`url`,
 *   `b64_json`, or `multipart`" on every route page); `multipart` answers
 *   with `multipart/form-data`, which the OpenAI SDK path cannot read.
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
import type { DenyRule, EndpointConstraints, FamilyRule } from "../../core/constraint-types";
import { IMAGE_FORMATS, type RecraftImageFormat } from "./constraints";
import { models, IMAGE_TO_IMAGE_MODELS, V3_ONLY_MODELS, type RecraftModelId } from "./models";
import { STYLE_NAMES_BY_MODEL, type StyleFor } from "./styles";
import type {
  RecraftControls,
  RecraftSize,
  RecraftStyleMatch,
  RecraftTextLayoutElement,
} from "./image";

const IMAGES_BASE_URL = "https://external.api.recraft.ai/v1/images";

export const IMAGE_TO_IMAGE_URL = `${IMAGES_BASE_URL}/imageToImage`;
export const INPAINT_URL = `${IMAGES_BASE_URL}/inpaint`;
export const OUTPAINT_URL = `${IMAGES_BASE_URL}/outpaint`;
export const REPLACE_BACKGROUND_URL = `${IMAGES_BASE_URL}/replaceBackground`;
export const GENERATE_BACKGROUND_URL = `${IMAGES_BASE_URL}/generateBackground`;

const ENDPOINTS_DOCS_URL = "https://www.recraft.ai/docs/api-reference/endpoints";
const APPENDIX_DOCS_URL = "https://www.recraft.ai/docs/api-reference/appendix";
const IMAGE_TO_IMAGE_DOCS_URL = "https://www.recraft.ai/docs/api-reference/tools/image-to-image";
const INPAINTING_DOCS_URL = "https://www.recraft.ai/docs/api-reference/tools/inpainting";
const OUTPAINTING_DOCS_URL = "https://www.recraft.ai/docs/api-reference/tools/outpainting";
const BACKGROUND_DOCS_URL = "https://www.recraft.ai/docs/api-reference/tools/background";

/** Default `model` on imageToImage — same as the generations route. */
export const DEFAULT_IMAGE_TO_IMAGE_MODEL_ID = "recraftv4_1";
/** Default `model` on the V3-only editing routes. */
export const DEFAULT_V3_EDIT_MODEL_ID = "recraftv3";

/**
 * Every editing route's input image and mask — appendix (2026-11-12): "| File
 * size | Under 20 MB |"; image-to-image page: "under 20 MB, up to 16 MP".
 */
export const MAX_INPUT_IMAGE_BYTES = 20 * 1024 * 1024;

/** `expand_*` bounds on the outpaint route (docs: "must be in range [0, 4096]"). */
export const MAX_OUTPAINT_EXPAND_PIXELS = 4096;

// ---------------------------------------------------------------------------
// Wire types
// ---------------------------------------------------------------------------

/** `model` input on the routes that accept the V3 **and** V4 lines. */
type ImageToImageModelInput = (typeof IMAGE_TO_IMAGE_MODELS)[number] | (string & {});
/** `model` input on the four `recraftv3` / `recraftv3_vector`-only routes. */
type V3OnlyModelInput = (typeof V3_ONLY_MODELS)[number] | (string & {});

/**
 * Fields every editing route shares, per the endpoints doc's param tables.
 *
 * `M` is the route's `model` literal so `style` can resolve to that model's own
 * curated list — see `GenerationsParams` in ./image.ts for why (`makeStyleCheck`
 * below rejects a cross-model name at runtime, and this is the type-level half
 * of the same rule). Each route binds `M` through its own `model` field, whose
 * allow-list is narrower than the generations route's.
 */
interface RecraftTransformCommon<M extends string = string> {
  /** Multipart: the image to modify. Mutually exclusive with `image_url`. */
  image?: Blob;
  /** JSON: a public URL or `data:` URL. Mutually exclusive with `image`. */
  image_url?: string;
  /** A text description of areas to change. REQUIRED. */
  prompt: string;
  /** Number of images, 1–6. Default 1. Billed per image. */
  n?: number | null;
  /** Curated style name; per-route model compatibility applies. V3 only on imageToImage. */
  style?: StyleFor<M> | null;
  /**
   * Style UUID used as a visual reference. Cannot be combined with `style`.
   * V3 only on imageToImage.
   */
  style_id?: string | null;
  /**
   * How closely the result matches the style. One value on these routes:
   * image-to-image page (2026-11-12) "**V3 only**, with `style_id`. Must be
   * `regular`."; inpainting / outpainting / background pages "Only `regular`
   * for V3."
   */
  style_match?: Extract<RecraftStyleMatch, "regular"> | null;
  /** Undesired elements. V3 only on imageToImage. */
  negative_prompt?: string | null;
  /** Seed for reproducible generation. */
  random_seed?: number | null;
  /** "url" (default), "b64_json" or "multipart". */
  response_format?: "url" | "b64_json" | "multipart" | null;
  /**
   * Raster output container — every route page (2026-11-12): "`webp`
   * (lossless) or `png`." Default `webp`; image-to-image adds "Applies to
   * raster output only."
   */
  image_format?: RecraftImageFormat | null;
  /** Spatial/textual attributes for text elements. V3 only on imageToImage. */
  text_layout?: RecraftTextLayoutElement[] | null;
  /** Generation tweaks; artistic_level / no_text are V3-only. */
  controls?: RecraftControls | null;
}

export interface ImageToImageParams<M extends ImageToImageModelInput = ImageToImageModelInput>
  extends RecraftTransformCommon<M> {
  /**
   * Defaults to "recraftv4_1" server-side; checks run against the V3 model
   * whose curated list holds `style` when one is given. V3 and V4 models only
   * (no V2).
   */
  model?: M | null;
  /** REQUIRED. 0 = almost identical to the input, 1 = minimal similarity. */
  strength: number;
}

export interface InpaintParams<M extends V3OnlyModelInput = V3OnlyModelInput>
  extends RecraftTransformCommon<M> {
  /** Defaults to "recraftv3" server-side. recraftv3 / recraftv3_vector only. */
  model?: M | null;
  /** Multipart: grayscale mask, white = inpaint. Mutually exclusive with `mask_url`. */
  mask?: Blob;
  /** JSON: URL or `data:` URL of the mask. Mutually exclusive with `mask`. */
  mask_url?: string;
}

/** generateBackground takes the same params as inpaint (image + mask + prompt). */
export type GenerateBackgroundParams<M extends V3OnlyModelInput = V3OnlyModelInput> =
  InpaintParams<M>;

export interface OutpaintParams<M extends V3OnlyModelInput = V3OnlyModelInput>
  extends RecraftTransformCommon<M> {
  /** Defaults to "recraftv3" server-side. recraftv3 / recraftv3_vector only. */
  model?: M | null;
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

export interface ReplaceBackgroundParams<M extends V3OnlyModelInput = V3OnlyModelInput>
  extends RecraftTransformCommon<M> {
  /** Defaults to "recraftv3" server-side. recraftv3 / recraftv3_vector only. */
  model?: M | null;
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
  style_match: z.string().nullable().optional(),
  negative_prompt: z.string().nullable().optional(),
  random_seed: z.number().int().nullable().optional(),
  response_format: z.string().nullable().optional(),
  image_format: z.string().nullable().optional(),
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

const RESPONSE_FORMATS = ["url", "b64_json", "multipart"] as const;

/**
 * `style_match` on the editing routes — one value on every page (2026-11-12):
 * image-to-image "**V3 only**, with `style_id`. Must be `regular`.";
 * inpainting / outpainting / background "Only `regular` for V3."
 */
const EDIT_STYLE_MATCHES = ["regular"] as const satisfies readonly RecraftStyleMatch[];

const EDIT_ENUMS: ReadonlyArray<
  readonly [param: "image_format" | "style_match", allowed: readonly string[]]
> = [
  ["image_format", IMAGE_FORMATS],
  ["style_match", EDIT_STYLE_MATCHES],
];

/** The model a request runs on — what every model-dependent check keys on. */
type ResolveModel = (params: RecraftTransformCommon & { model?: string | null }) => string;

function makeResolveModel(fallback: string): ResolveModel {
  return (params) => params.model ?? fallback;
}

/**
 * The V3 models a curated `style` resolves to when imageToImage's `model` is
 * omitted, in the generations route's order — styles doc (2026-11-12): "If a
 * style name is supported by multiple models, the API defaults to Recraft
 * V3". The image-to-image page documents only the `recraftv4_1` default and
 * that `style` is "**V3 only.**"; resolving the name as generations does keeps
 * `{ image_url, prompt, strength, style: "Illustration" }` from being refused
 * against a V4.1 default the page never pairs with a style. The raster and
 * vector lists are disjoint, so the first list holding the name is the model.
 */
const IMAGE_TO_IMAGE_STYLE_MODELS = ["recraftv3", "recraftv3_vector"] as const;

function resolveImageToImageModel(params: RecraftTransformCommon & { model?: string | null }): string {
  if (params.model != null) return params.model;
  const style = params.style;
  if (style != null) {
    const styled = IMAGE_TO_IMAGE_STYLE_MODELS.find((id) => STYLE_NAMES[id]?.includes(style));
    if (styled !== undefined) return styled;
  }
  return DEFAULT_IMAGE_TO_IMAGE_MODEL_ID;
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

/** "under 20 MB" — the only input limit checkable from a Blob. */
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
      message: `\`${field}\` is ${blob.size} bytes; Recraft caps editing inputs at ${MAX_INPUT_IMAGE_BYTES} bytes (20 MB).`,
      meta: { bytes: blob.size, limit: MAX_INPUT_IMAGE_BYTES, source: APPENDIX_DOCS_URL },
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
    message: `\`response_format\` must be one of "url", "b64_json", "multipart"; got ${JSON.stringify(format)}.`,
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

/** `image_format` and `style_match` values, sourced to the route's own page. */
function makeEditEnumCheck(source: string) {
  return (
    params: RecraftTransformCommon,
    _info: ModelInfo | undefined,
    ctx: PipelineContext,
  ): void => {
    for (const [param, allowed] of EDIT_ENUMS) {
      const value: unknown = params[param];
      if (value == null || (typeof value === "string" && allowed.includes(value))) continue;
      ctx.report({
        code: "invalid_enum_value",
        path: [param],
        message: `\`${param}\` must be one of ${allowed.map((v) => JSON.stringify(v)).join(", ")} on ${ctx.endpoint}; got ${JSON.stringify(value)}.`,
        meta: { allowed: [...allowed], value, source },
      });
    }
  };
}

/**
 * Per-route `model` allow-list. Every editing route documents an explicit
 * compatibility list that is narrower than the generations route's.
 */
function makeModelCheck(allowed: readonly string[], resolve: ResolveModel) {
  const set = new Set<string>(allowed);
  return (
    params: RecraftTransformCommon & { model?: string | null },
    _info: ModelInfo | undefined,
    ctx: PipelineContext,
  ): void => {
    const model = resolve(params);
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

/**
 * The style table widened to a plain string-keyed lookup. `STYLE_NAMES_BY_MODEL`
 * is `as const` so it can serve as the type source for `StyleFor<M>`; this check
 * indexes it with a RESOLVED model id (a `string`, possibly the route's
 * server-side default or an id unmodel has never heard of), so the widening
 * lives here — on the one consumer that wants it — rather than back on the
 * table. Same shape as the `STYLE_NAMES` alias in ./image.ts.
 */
const STYLE_NAMES: Readonly<Record<string, readonly string[]>> = STYLE_NAMES_BY_MODEL;

/**
 * Style ↔ model cross-check. `RecraftTransformCommon`'s `style?: StyleFor<M>`
 * now catches the same mismatch at compile time for a literal `model`; this
 * stays the enforcement for JS callers and for runtime-built model ids, where
 * the type degrades to the pooled union.
 */
function makeStyleCheck(resolve: ResolveModel) {
  return (
    params: RecraftTransformCommon & { model?: string | null },
    info: ModelInfo | undefined,
    ctx: PipelineContext,
  ): void => {
    const style = params.style;
    if (style == null || info === undefined) return;
    const model = resolve(params);
    const allowed = STYLE_NAMES[model];
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

function makePromptLengthCheck(resolve: ResolveModel) {
  return (
    params: RecraftTransformCommon & { model?: string | null },
    info: ModelInfo | undefined,
    ctx: PipelineContext,
  ): void => {
    const limit = info?.limit.characters;
    if (limit === undefined) return;
    const actual = params.prompt.length;
    if (actual <= limit) return;
    const model = resolve(params);
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

const V3_MODEL_SET = new Set<string>(V3_ONLY_MODELS);
const IMAGE_TO_IMAGE_MODEL_SET = new Set<string>(IMAGE_TO_IMAGE_MODELS);

/**
 * One reason for the five params the image-to-image page (2026-11-12) marks
 * "**V3 only.**" — `style`, `style_id`, `style_match` ("Image to image doesn't
 * take V4 / V4.1 styles"), `negative_prompt` and `text_layout`.
 */
const IMAGE_TO_IMAGE_V3_ONLY: DenyRule = {
  reason:
    'imageToImage takes it on Recraft V3 models only (the image-to-image page marks it "V3 only") — use `recraftv3`, `recraftv3_raster` or `recraftv3_vector`',
  source: IMAGE_TO_IMAGE_DOCS_URL,
};

/**
 * The V4 / V4.1 models imageToImage accepts, and the params they refuse. The
 * match is the route's own allow-list minus V3, so an id the route refuses
 * draws the `model` error alone.
 */
const imageToImageFamilyRules: readonly FamilyRule[] = [
  {
    family: "Recraft V4 / V4.1 models on imageToImage",
    match: (modelId) => IMAGE_TO_IMAGE_MODEL_SET.has(modelId) && !V3_MODEL_SET.has(modelId),
    deny: {
      style: IMAGE_TO_IMAGE_V3_ONLY,
      style_id: IMAGE_TO_IMAGE_V3_ONLY,
      style_match: IMAGE_TO_IMAGE_V3_ONLY,
      negative_prompt: IMAGE_TO_IMAGE_V3_ONLY,
      text_layout: IMAGE_TO_IMAGE_V3_ONLY,
    },
  },
];

/**
 * `controls.artistic_level` and `controls.no_text` are V3-only — endpoints doc
 * Controls table (2026-11-12): "| V3 models only |" — and nested, so the
 * family deny table cannot express them. imageToImage is the one editing
 * route that also takes the V4 line, so it is the one that needs this.
 */
function checkImageToImageControls(
  params: ImageToImageParams,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const controls = params.controls;
  if (controls == null || info === undefined) return;
  const model = resolveImageToImageModel(params);
  if (V3_MODEL_SET.has(model)) return;
  for (const field of ["artistic_level", "no_text"] as const) {
    if (controls[field] == null) continue;
    ctx.report({
      code: "unsupported_param",
      path: ["controls", field],
      model,
      message: `\`controls.${field}\` is supported by Recraft V3 models only; "${model}" rejects it.`,
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
      body: usesBlob ? "form" : "json",
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
  modelId: resolveImageToImageModel,
  catalog: models,
  familyRules: imageToImageFamilyRules,
  checks: [
    checkImageSource,
    checkImageBytes,
    checkResponseFormat,
    makeEditEnumCheck(IMAGE_TO_IMAGE_DOCS_URL),
    checkStyleExclusivity,
    makeModelCheck(IMAGE_TO_IMAGE_MODELS, resolveImageToImageModel),
    makeStyleCheck(resolveImageToImageModel),
    makePromptLengthCheck(resolveImageToImageModel),
    checkImageToImageControls,
  ],
  estimate,
  finalize: finalizeTo(IMAGE_TO_IMAGE_URL),
});

const resolveV3EditModel = makeResolveModel(DEFAULT_V3_EDIT_MODEL_ID);

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
  makeModelCheck(V3_ONLY_MODELS, resolveV3EditModel),
  makeStyleCheck(resolveV3EditModel),
  makePromptLengthCheck(resolveV3EditModel),
];

const inpaintValidator = createValidator<InpaintParams, unknown>({
  endpoint: "recraft.imageEditInpaint",
  schema: inpaintSchema,
  modelId: resolveV3EditModel,
  catalog: models,
  checks: [...V3_EDIT_CHECKS, makeEditEnumCheck(INPAINTING_DOCS_URL), checkMaskSource],
  estimate,
  finalize: finalizeTo(INPAINT_URL),
});

const generateBackgroundValidator = createValidator<GenerateBackgroundParams, unknown>({
  endpoint: "recraft.imageEditGenerateBackground",
  schema: inpaintSchema,
  modelId: resolveV3EditModel,
  catalog: models,
  checks: [...V3_EDIT_CHECKS, makeEditEnumCheck(BACKGROUND_DOCS_URL), checkMaskSource],
  estimate,
  finalize: finalizeTo(GENERATE_BACKGROUND_URL),
});

const outpaintValidator = createValidator<OutpaintParams, unknown>({
  endpoint: "recraft.imageEditOutpaint",
  schema: outpaintSchema,
  modelId: resolveV3EditModel,
  catalog: models,
  checks: [...V3_EDIT_CHECKS, makeEditEnumCheck(OUTPAINTING_DOCS_URL), checkOutpaintGeometry],
  estimate,
  finalize: finalizeTo(OUTPAINT_URL),
});

const replaceBackgroundValidator = createValidator<ReplaceBackgroundParams, unknown>({
  endpoint: "recraft.imageEditReplaceBackground",
  schema: replaceBackgroundSchema,
  modelId: resolveV3EditModel,
  catalog: models,
  checks: [...V3_EDIT_CHECKS, makeEditEnumCheck(BACKGROUND_DOCS_URL)],
  estimate,
  finalize: finalizeTo(REPLACE_BACKGROUND_URL),
});

/**
 * The params of `Route` at model literal `M`. TypeScript has no higher-kinded
 * types, so `RecraftTransformValidator` names its route as a phantom tag and
 * resolves the arm here, instead of taking the params type directly — the
 * params types are now generic in `M` and cannot be passed unapplied.
 */
type TransformArm<Route extends string, M extends string> = Route extends "imageToImage"
  ? ImageToImageParams<M>
  : Route extends "inpaint"
    ? InpaintParams<M>
    : Route extends "outpaint"
      ? OutpaintParams<M>
      : ReplaceBackgroundParams<M>;

/** The `model` ids `Route` accepts — the constraint of its callable's `M`. */
type RouteModelInput<Route extends string> = Route extends "imageToImage"
  ? ImageToImageModelInput
  : V3OnlyModelInput;

/**
 * `M` is bound by `model` alone (`model?: M | null` on each params interface).
 * Do NOT add an `& { model?: M }` arm to `params`: that intersection is
 * normalized before completion and leaves `model` completing nothing. See the
 * `GenerationsParams` doc in ./image.ts.
 */
interface RecraftTransformValidator<Route extends string> {
  <M extends RouteModelInput<Route>, T extends TransformArm<Route, M>>(
    params: T & TransformArm<Route, M> & ExactKeys<T, TransformArm<Route, RouteModelInput<Route>>>,
    options?: ValidateOptions<T>,
  ): Validated<T, RecraftSdkTargets<T>>;
  safe<M extends RouteModelInput<Route>, T extends TransformArm<Route, M>>(
    params: T & TransformArm<Route, M> & ExactKeys<T, TransformArm<Route, RouteModelInput<Route>>>,
    options?: ValidateOptions<T>,
  ): ValidateResult<Validated<T, RecraftSdkTargets<T>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
}

/**
 * Validates params for Recraft `POST /v1/images/imageToImage` — creates an
 * image similar to the input, with `strength` (REQUIRED, 0–1) setting how far
 * it may drift. Accepts the V3 **and** V4 model lines; defaults to
 * `recraftv4_1`. `style`, `style_id`, `style_match`, `negative_prompt`,
 * `text_layout` and `controls.artistic_level` / `no_text` are V3-only here,
 * and refused on the V4 / V4.1 models.
 *
 * Pass `image` (a Blob) and post `recraft.toFormData(validated)`, or pass
 * `image_url` and post `JSON.stringify(validated)` — `.request.headers`
 * carries the JSON content-type only on the URL path. Auth is your job: add
 * an `authorization: Bearer <token>` header.
 */
export const imageEdit =
  imageToImageValidator as unknown as RecraftTransformValidator<"imageToImage">;

/**
 * Validates params for Recraft `POST /v1/images/inpaint` — regenerates the
 * white regions of `mask` from `prompt`. Documented for `recraftv3` /
 * `recraftv3_vector` only (default `recraftv3`); other model ids are reported
 * as `invalid_enum_value`. See `imageEdit` for the fetch recipe.
 */
export const imageEditInpaint = inpaintValidator as unknown as RecraftTransformValidator<"inpaint">;

/**
 * Validates params for Recraft `POST /v1/images/generateBackground` —
 * same request shape as `inpaint`, generating a background in the masked
 * regions. `recraftv3` / `recraftv3_vector` only.
 */
export const imageEditGenerateBackground =
  generateBackgroundValidator as unknown as RecraftTransformValidator<"inpaint">;

/**
 * Validates params for Recraft `POST /v1/images/outpaint` — extends the image
 * beyond its borders. Specify the new area with `expand_*` margins OR a
 * target `size` (never both), optionally with `zoom_out_percentage`; at least
 * one of the three is required. `recraftv3` / `recraftv3_vector` only.
 */
export const imageEditOutpaint = outpaintValidator as unknown as RecraftTransformValidator<"outpaint">;

/**
 * Validates params for Recraft `POST /v1/images/replaceBackground` — detects
 * the background and regenerates it from `prompt`. `recraftv3` /
 * `recraftv3_vector` only.
 */
export const imageEditReplaceBackground =
  replaceBackgroundValidator as unknown as RecraftTransformValidator<"replaceBackground">;

export type { RecraftModelId };
