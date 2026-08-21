/**
 * BytePlus ModelArk image generation —
 * POST https://ark.ap-southeast.bytepluses.com/api/v3/images/generations
 *
 * Wire notes (verified against
 * https://docs.byteplus.com/en/docs/ModelArk/1541523 and the per-model
 * capability matrix at
 * https://docs.byteplus.com/en/docs/ModelArk/1824121#9278b81b on 2026-08-13):
 * - OpenAI-images-flavoured but NOT OpenAI-shaped: the body carries `model`,
 *   `prompt`, `image`, `size`, `response_format`, `watermark` plus ModelArk's
 *   own `sequential_image_generation*`, `stream`, `output_format`,
 *   `background`, `layer_decomposition` and `optimize_prompt_options`. There
 *   is NO `n`, no `quality`, no `style` — and, on the current API, no `seed`
 *   and no `guidance_scale` (those were Seedream 3.0-era params and are not
 *   documented on this endpoint any more), so passing them earns an
 *   `unknown_param` warning.
 * - `size` is per-model: either a resolution keyword (which keyword depends
 *   on the model) or an explicit `"<width>x<height>"` that must satisfy BOTH
 *   the model's total-pixel range and the [1/16, 16] aspect range. Both are
 *   checked here.
 * - This route is SYNCHRONOUS: the POST returns the images (or, with
 *   `stream: true`, an SSE stream of per-image events —
 *   https://docs.byteplus.com/en/docs/ModelArk/1824137). Result URLs expire
 *   24 hours after generation.
 * - ModelArk is region-isolated. `.request.url` targets `ap-southeast-1`
 *   (the documented default); for Dublin use `imageGenerationsUrl("eu-west-1")`
 *   — that region serves this API too.
 * - `model` also accepts a per-account Endpoint ID (`ep-…`), which cannot be
 *   cataloged; such requests validate with an `unknown_model` warning.
 * - Auth is `Authorization: Bearer <ARK_API_KEY>` — unmodel never touches
 *   keys; add the header yourself when fetching.
 */

import { z } from "zod";
import { createValidator, type PipelineContext } from "../../core/pipeline";
import { toValidated, JSON_HEADERS, type Validated, type ExactKeys } from "../../core/request";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";
import type { FutureModelId, ModelInfo } from "../../core/catalog-types";
import type { EndpointConstraints } from "../../core/constraint-types";
import { imageModels } from "./models";
import {
  IMAGE_API_SOURCE,
  IMAGE_BACKGROUNDS,
  IMAGE_INPUT_RULE,
  IMAGE_MODELS_SOURCE,
  IMAGE_OUTPUT_FORMATS,
  IMAGE_RESPONSE_FORMATS,
  IMAGE_SIZE_ASPECT_RANGE,
  LAYER_DECOMPOSITION_INPUT_RULE,
  MAX_IMAGES_RANGE,
  PROMPT_OPTIMIZE_MODES,
  SEQUENTIAL_IMAGE_GENERATION,
  SEQUENTIAL_TOTAL_IMAGES,
  imageConstraints,
  imageShapeRules,
  type BytedanceImageSizeKeyword,
} from "./constraints";
import { arkBaseUrl, checkInlineImage, parsePixelSize, type ArkRegion } from "./shared";
import { imageCostUSD } from "./pricing";

/** Image generation URL for a ModelArk region (default `ap-southeast-1`). */
export function imageGenerationsUrl(region: ArkRegion = "ap-southeast-1"): string {
  return `${arkBaseUrl(region)}/images/generations`;
}

export const IMAGE_GENERATIONS_URL = imageGenerationsUrl();

// ---------------------------------------------------------------------------
// Wire types — Tier A: one arm per documented model id, carrying exactly the
// params that model supports. Params a model rejects are typed `never`.
// ---------------------------------------------------------------------------

/** Prompt optimization settings (`optimize_prompt_options`). */
export interface OptimizePromptOptions {
  /** Default "standard". "fast" trades quality for latency. */
  mode?: "standard" | "fast";
}

/** Prompt optimization for models that document standard mode only. */
export interface StandardOnlyOptimizePromptOptions {
  mode?: "standard";
}

/** Sequential (batch) generation settings. */
export interface SequentialImageGenerationOptions {
  /** 1–15. Input reference images + generated images ≤ 15. Default 15. */
  max_images?: number;
}

/**
 * `size` for image generation: a resolution KEYWORD or an explicit
 * `"<width>x<height>"`.
 *
 * The keyword arm is the union of every model's keywords — it is derived from
 * IMAGE_SIZE_KEYWORDS in ./constraints, which `ImageShapeRule` is typed
 * against, so it cannot drift from the per-model tables. Keywords are PER
 * MODEL and the runtime narrows them (`checkSize`): "1K" is Seedream 5.0 pro /
 * 4.0 only, "3K" is Seedream 5.0 lite only, and "auto" exists only in Seedream
 * 5.0 pro's layer-decomposition mode.
 *
 * The `"<width>x<height>"` arm is genuinely free-form — 1920x1080 and any
 * other explicit resolution is legal — because the API bounds it by rule
 * rather than by list: `checkSize` enforces the model's total-pixel range and
 * the global [1/16, 16] aspect range. `${number}x${number}` keeps that space
 * open while making non-size strings a compile error.
 */
export type BytedanceImageSize = BytedanceImageSizeKeyword | (`${number}x${number}` & {});

interface ImageGenerationsCore {
  /**
   * Text prompt. Required for image generation; optional only in Seedream
   * 5.0 pro's layer decomposition mode.
   */
  prompt?: string;
  /** Reference image(s): HTTPS URL(s) or `data:image/<fmt>;base64,…`. */
  image?: string | string[];
  /** Resolution keyword or `"<width>x<height>"`; allowed values per model. */
  size?: BytedanceImageSize;
  /** How images come back. Default "url" (valid for 24 hours). */
  response_format?: "url" | "b64_json";
  /** Adds an "AI-generated" watermark. Default true. */
  watermark?: boolean;
}

/** Seedream 5.0 pro: layer decomposition, transparent backgrounds, no batch. */
export interface Seedream50ProBody extends ImageGenerationsCore {
  model: "dola-seedream-5-0-pro-260628";
  /** Decompose one input image into a base image plus up to 16 layers. */
  layer_decomposition?: boolean;
  /** Output file format. Default "jpeg". */
  output_format?: "png" | "jpeg";
  /** Alpha channel control; "transparent" requires `output_format: "png"`. */
  background?: "transparent" | "opaque";
  optimize_prompt_options?: OptimizePromptOptions;
  /** Seedream 5.0 lite / 4.5 / 4.0 only. */
  sequential_image_generation?: never;
  /** Seedream 5.0 lite / 4.5 / 4.0 only. */
  sequential_image_generation_options?: never;
  /** Seedream 5.0 lite / 4.5 / 4.0 only. */
  stream?: never;
}

interface Seedream50LiteFields extends ImageGenerationsCore {
  /** Output file format. Default "jpeg". */
  output_format?: "png" | "jpeg";
  /** "auto" lets the model return a related batch. Default "disabled". */
  sequential_image_generation?: "auto" | "disabled";
  sequential_image_generation_options?: SequentialImageGenerationOptions;
  /** Emit each image as it finishes (SSE). Default false. */
  stream?: boolean;
  /** Seedream 5.0 lite documents standard mode only. */
  optimize_prompt_options?: StandardOnlyOptimizePromptOptions;
  /** Seedream 5.0 pro only. */
  layer_decomposition?: never;
  /** Seedream 5.0 pro only. */
  background?: never;
}

/** Seedream 5.0 lite, spelled as the Model list's primary id. */
export interface Seedream50Body extends Seedream50LiteFields {
  model: "seedream-5-0-260128";
}

/** Seedream 5.0 lite, spelled with the explicit `-lite-` segment. */
export interface Seedream50LiteBody extends Seedream50LiteFields {
  model: "seedream-5-0-lite-260128";
}

/** Seedream 4.5: batch generation, jpeg output only, standard prompt mode. */
export interface Seedream45Body extends ImageGenerationsCore {
  model: "seedream-4-5-251128";
  sequential_image_generation?: "auto" | "disabled";
  sequential_image_generation_options?: SequentialImageGenerationOptions;
  stream?: boolean;
  optimize_prompt_options?: StandardOnlyOptimizePromptOptions;
  /** Seedream 5.0 pro / 5.0 lite only — this model always returns jpeg. */
  output_format?: never;
  /** Seedream 5.0 pro only. */
  layer_decomposition?: never;
  /** Seedream 5.0 pro only. */
  background?: never;
}

/** Seedream 4.0: batch generation, jpeg output only, standard + fast modes. */
export interface Seedream40Body extends ImageGenerationsCore {
  model: "seedream-4-0-250828";
  sequential_image_generation?: "auto" | "disabled";
  sequential_image_generation_options?: SequentialImageGenerationOptions;
  stream?: boolean;
  optimize_prompt_options?: OptimizePromptOptions;
  /** Seedream 5.0 pro / 5.0 lite only — this model always returns jpeg. */
  output_format?: never;
  /** Seedream 5.0 pro only. */
  layer_decomposition?: never;
  /** Seedream 5.0 pro only. */
  background?: never;
}

/**
 * Escape hatch for model ids unmodel has no arm for — new Seedream releases,
 * per-account Endpoint IDs (`ep-…`), and `seededit-3-0-i2i-250628`, whose API
 * reference BytePlus has retired (see models.ts).
 */
export interface UnknownImageModelBody<Model extends string> {
  model: FutureModelId<Model, keyof ImageBodyByModel>;
  prompt?: string;
  [key: string]: unknown;
}

/**
 * Closed over documented models by default. Supply a future model or endpoint
 * id to opt into the loose arm: `ImageGenerationsBody<"ep-…">`.
 */
export type ImageGenerationsBody<FutureModel extends string = never> =
  | Seedream50ProBody
  | Seedream50Body
  | Seedream50LiteBody
  | Seedream45Body
  | Seedream40Body
  | UnknownImageModelBody<FutureModel>;

interface ImageBodyByModel {
  "dola-seedream-5-0-pro-260628": Seedream50ProBody;
  "seedream-5-0-260128": Seedream50Body;
  "seedream-5-0-lite-260128": Seedream50LiteBody;
  "seedream-4-5-251128": Seedream45Body;
  "seedream-4-0-250828": Seedream40Body;
}

/** Resolves a model id literal to its exact Tier-A arm. */
type ImageArm<M extends string> = M extends keyof ImageBodyByModel
  ? ImageBodyByModel[M]
  : UnknownImageModelBody<M>;

/** Runtime implementation type; the public alias stays closed by default. */
type AnyImageGenerationsBody = ImageGenerationsBody<string>;
type ImageModelInput = keyof ImageBodyByModel | (string & {});

// ---------------------------------------------------------------------------
// Schema — the loose union of every documented param; per-model narrowing
// happens in constraints.ts (runtime) and the Tier-A arms (types).
// ---------------------------------------------------------------------------

const imageGenerationsSchema = z.looseObject({
  model: z.string(),
  prompt: z.string().optional(),
  image: z.union([z.string(), z.array(z.string())]).optional(),
  size: z.string().optional(),
  layer_decomposition: z.boolean().optional(),
  optimize_prompt_options: z
    .looseObject({ mode: z.enum(PROMPT_OPTIMIZE_MODES).optional() })
    .optional(),
  output_format: z.enum(IMAGE_OUTPUT_FORMATS).optional(),
  background: z.enum(IMAGE_BACKGROUNDS).optional(),
  response_format: z.enum(IMAGE_RESPONSE_FORMATS).optional(),
  sequential_image_generation: z.enum(SEQUENTIAL_IMAGE_GENERATION).optional(),
  sequential_image_generation_options: z
    .looseObject({
      max_images: z
        .number()
        .int()
        .min(MAX_IMAGES_RANGE.min, `max_images must be at least ${MAX_IMAGES_RANGE.min}`)
        .max(MAX_IMAGES_RANGE.max, `max_images must be at most ${MAX_IMAGES_RANGE.max}`)
        .optional(),
    })
    .optional(),
  stream: z.boolean().optional(),
  watermark: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

type AnyRecord = Record<string, unknown>;

function imageList(params: AnyImageGenerationsBody): string[] {
  const image = (params as AnyRecord)["image"];
  if (typeof image === "string") return [image];
  if (Array.isArray(image)) return image.filter((v): v is string => typeof v === "string");
  return [];
}

function imageCount(params: AnyImageGenerationsBody): number {
  const image = (params as AnyRecord)["image"];
  if (typeof image === "string") return 1;
  return Array.isArray(image) ? image.length : 0;
}

function isLayerDecomposition(params: AnyImageGenerationsBody): boolean {
  return (params as AnyRecord)["layer_decomposition"] === true;
}

/** `prompt` is required unless the request is a layer-decomposition request. */
function checkPrompt(
  params: AnyImageGenerationsBody,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  // Unknown model: skip model-dependent checks rather than assume a future
  // Seedream release keeps requiring a prompt.
  if (info === undefined) return;
  const prompt = (params as AnyRecord)["prompt"];
  if (isLayerDecomposition(params)) return;
  if (typeof prompt === "string" && prompt.length > 0) return;
  ctx.report({
    code: "invalid_shape",
    path: ["prompt"],
    model: params.model,
    message:
      "`prompt` is required for image generation; it is optional only in Seedream 5.0 pro's layer decomposition mode (`layer_decomposition: true`).",
    meta: { source: IMAGE_API_SOURCE },
  });
}

/** `size`: a model-specific keyword, or `"<w>x<h>"` inside the model's bounds. */
function checkSize(
  params: AnyImageGenerationsBody,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const size = (params as AnyRecord)["size"];
  if (typeof size !== "string" || info === undefined) return;
  const rule = imageShapeRules[params.model];
  if (rule === undefined) return;

  const pixels = parsePixelSize(size);
  if (pixels === undefined) {
    const allowed: readonly string[] =
      isLayerDecomposition(params) && rule.layerSizeKeywords !== undefined
        ? rule.layerSizeKeywords
        : rule.sizeKeywords;
    if (!allowed.includes(size)) {
      ctx.report({
        code: "invalid_enum_value",
        path: ["size"],
        model: params.model,
        message: `\`size\` must be one of ${allowed.map((v) => JSON.stringify(v)).join(", ")} or a "<width>x<height>" string for "${params.model}"; got ${JSON.stringify(size)}.`,
        meta: { allowed: [...allowed], value: size, source: IMAGE_API_SOURCE },
      });
    }
    return;
  }

  if (isLayerDecomposition(params)) {
    ctx.report({
      code: "invalid_enum_value",
      path: ["size"],
      model: params.model,
      message: `layer decomposition sizes by resolution level only; \`size\` must be one of ${(rule.layerSizeKeywords ?? rule.sizeKeywords).map((v) => JSON.stringify(v)).join(", ")}, not ${JSON.stringify(size)}.`,
      meta: { allowed: [...(rule.layerSizeKeywords ?? rule.sizeKeywords)], value: size, source: IMAGE_API_SOURCE },
    });
    return;
  }

  const total = pixels.width * pixels.height;
  if (total < rule.minPixels || total > rule.maxPixels) {
    ctx.report({
      code: "invalid_enum_value",
      path: ["size"],
      model: params.model,
      message: `\`size\` "${size}" is ${total} pixels; "${params.model}" accepts a total of ${rule.minPixels}–${rule.maxPixels} pixels (width × height).`,
      meta: { pixels: total, minPixels: rule.minPixels, maxPixels: rule.maxPixels, source: IMAGE_API_SOURCE },
    });
  }
  const aspect = pixels.width / pixels.height;
  if (aspect < IMAGE_SIZE_ASPECT_RANGE.min || aspect > IMAGE_SIZE_ASPECT_RANGE.max) {
    ctx.report({
      code: "invalid_enum_value",
      path: ["size"],
      model: params.model,
      message: `\`size\` "${size}" has aspect ratio ${Math.round(aspect * 1000) / 1000}; the accepted range is [1/16, 16].`,
      meta: { aspect, source: IMAGE_API_SOURCE },
    });
  }
}

/** Reference-image count, layer-decomposition/background pairing, and bytes. */
function checkImages(
  params: AnyImageGenerationsBody,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const images = imageList(params);
  const count = imageCount(params);
  const layer = isLayerDecomposition(params);
  const rule = info === undefined ? undefined : imageShapeRules[params.model];

  if (layer && count !== 1) {
    ctx.report({
      code: "invalid_shape",
      path: ["image"],
      model: params.model,
      message: `layer decomposition requires exactly one input \`image\`; got ${count}. "Only one image to be decomposed is supported. Passing multiple images causes an error."`,
      meta: { count, source: IMAGE_API_SOURCE },
    });
  }

  if (rule !== undefined && count > rule.maxReferenceImages) {
    ctx.report({
      code: "unsupported_capability",
      path: ["image"],
      model: params.model,
      message: `"${params.model}" accepts at most ${rule.maxReferenceImages} reference images; got ${count}.`,
      meta: { count, limit: rule.maxReferenceImages, source: IMAGE_API_SOURCE },
    });
  }

  const background = (params as AnyRecord)["background"];
  if (background === "transparent") {
    if ((params as AnyRecord)["output_format"] === "jpeg") {
      ctx.report({
        code: "unsupported_capability",
        path: ["background"],
        model: params.model,
        message:
          'transparent backgrounds are PNG-only: "If `output_format` is set to `jpeg`, the request returns an error."',
        meta: { source: IMAGE_API_SOURCE },
      });
    }
    if (count !== 1) {
      ctx.report({
        code: "unsupported_capability",
        path: ["background"],
        model: params.model,
        message: `\`background\` is "supported only for image-to-image generation with exactly one input image that has an alpha channel"; got ${count} input images.`,
        meta: { count, source: IMAGE_API_SOURCE },
      });
    }
  }

  const inputRule = layer ? LAYER_DECOMPOSITION_INPUT_RULE : IMAGE_INPUT_RULE;
  const single = typeof (params as AnyRecord)["image"] === "string";
  images.forEach((url, index) => {
    checkInlineImage(
      ctx,
      url,
      single ? ["image"] : ["image", index],
      params.model,
      inputRule,
      IMAGE_API_SOURCE,
    );
  });
}

/** Batch-generation pairing rules and the documented 15-image total. */
function checkSequential(
  params: AnyImageGenerationsBody,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const sequential = (params as AnyRecord)["sequential_image_generation"];
  const options = (params as AnyRecord)["sequential_image_generation_options"];
  if (options != null && sequential !== "auto") {
    ctx.report({
      code: "unsupported_param",
      severity: "warning",
      path: ["sequential_image_generation_options"],
      model: params.model,
      message:
        "`sequential_image_generation_options` only takes effect when `sequential_image_generation` is `auto`; it is ignored otherwise.",
      meta: { ignored: true, source: IMAGE_API_SOURCE },
    });
  }
  if (sequential !== "auto") return;

  const maxImages =
    typeof options === "object" && options !== null
      ? (options as AnyRecord)["max_images"]
      : undefined;
  const inputs = imageCount(params);
  if (typeof maxImages === "number" && inputs + maxImages > SEQUENTIAL_TOTAL_IMAGES) {
    ctx.report({
      code: "unsupported_capability",
      path: ["sequential_image_generation_options", "max_images"],
      model: params.model,
      message: `input reference images + generated images must be ≤ ${SEQUENTIAL_TOTAL_IMAGES}; ${inputs} input image(s) leave room for ${Math.max(0, SEQUENTIAL_TOTAL_IMAGES - inputs)}, but max_images is ${maxImages}.`,
      meta: { inputs, maxImages, limit: SEQUENTIAL_TOTAL_IMAGES, source: IMAGE_API_SOURCE },
    });
  }
}

/** `optimize_prompt_options.mode` — "fast" is not on every model. */
function checkPromptOptimizeMode(
  params: AnyImageGenerationsBody,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (info === undefined) return;
  const options = (params as AnyRecord)["optimize_prompt_options"];
  if (typeof options !== "object" || options === null) return;
  const mode = (options as AnyRecord)["mode"];
  if (typeof mode !== "string") return;
  const rule = imageShapeRules[params.model];
  if (rule === undefined || rule.promptOptimizeModes.includes(mode)) return;
  ctx.report({
    code: "invalid_enum_value",
    path: ["optimize_prompt_options", "mode"],
    model: params.model,
    message: `\`optimize_prompt_options.mode\` must be one of ${rule.promptOptimizeModes.map((v) => JSON.stringify(v)).join(", ")} for "${params.model}"; got ${JSON.stringify(mode)}.`,
    meta: { allowed: [...rule.promptOptimizeModes], value: mode, source: IMAGE_MODELS_SOURCE },
  });
}

// ---------------------------------------------------------------------------
// Estimation — worst-case USD per request (see ./pricing.ts).
// ---------------------------------------------------------------------------

function estimate(params: AnyImageGenerationsBody, info: ModelInfo | undefined) {
  const record = params as AnyRecord;
  const options = record["sequential_image_generation_options"];
  const maxImages =
    typeof options === "object" && options !== null
      ? (options as AnyRecord)["max_images"]
      : undefined;
  const costUSD = imageCostUSD(params.model, {
    size: typeof record["size"] === "string" ? (record["size"] as string) : undefined,
    layerDecomposition: record["layer_decomposition"] === true,
    sequential:
      typeof record["sequential_image_generation"] === "string"
        ? (record["sequential_image_generation"] as string)
        : undefined,
    maxImages: typeof maxImages === "number" ? maxImages : undefined,
    inputImages: imageCount(params),
    perImage: info?.cost?.perImage,
  });
  return costUSD === undefined ? {} : { costUSD };
}

/**
 * The one `.toSdk("bytedance")` target for this endpoint — the Volcengine
 * ARK SDK takes wire-shaped params. Derived from the `sdk` literal in
 * `finalize`; it must stay an object type with no index signature, or
 * `toSdk` would accept any string.
 */
type BytedanceSdkTargets<B> = { bytedance: () => B };

function finalize(params: AnyImageGenerationsBody): unknown {
  const body = { ...params };
  return toValidated(body, {
    url: IMAGE_GENERATIONS_URL,
    method: "POST",
    headers: JSON_HEADERS,
  }, {
    sdk: { bytedance: () => body },
  });
}

const validator = createValidator<AnyImageGenerationsBody, unknown>({
  endpoint: "bytedance.image",
  schema: imageGenerationsSchema,
  modelId: (params) => params.model,
  catalog: imageModels,
  constraints: imageConstraints,
  checks: [checkPrompt, checkSize, checkImages, checkSequential, checkPromptOptimizeMode],
  estimate,
  finalize,
});

/**
 * Validates wire params for BytePlus ModelArk
 * `POST /api/v3/images/generations` (Seedream). Known models get their exact
 * param surface at compile time (e.g. `layer_decomposition` is a compile
 * error for Seedream 4.0, `stream` for Seedream 5.0 pro); unknown ids fall
 * back to a loose arm with a runtime `unknown_model` warning.
 *
 * The returned object's enumerable props are the exact fetch JSON body
 * (`model` included — it is a body field on this API). BytePlus ships no
 * official JS SDK, so `.toSdk("bytedance")` returns the wire body unchanged. Auth is
 * your job: add `authorization: Bearer <ARK_API_KEY>` when fetching.
 *
 * ```ts
 * const params = bytedance.image({
 *   model: "seedream-4-0-250828",
 *   prompt: "a paper-craft city skyline at golden hour",
 *   size: "2K",
 *   watermark: false,
 * });
 * const res = await fetch(params.request.url, {
 *   method: params.request.method,
 *   headers: { ...params.request.headers, authorization: `Bearer ${process.env.ARK_API_KEY}` },
 *   body: JSON.stringify(params),
 * });
 * ```
 */
export const image = validator as unknown as {
  <M extends ImageModelInput, T extends ImageArm<M>>(
    params: T & ImageArm<M> & { model: M } & ExactKeys<T, ImageArm<M>>,
    options?: ValidateOptions,
  ): Validated<T, BytedanceSdkTargets<T>>;
  safe<M extends ImageModelInput, T extends ImageArm<M>>(
    params: T & ImageArm<M> & { model: M } & ExactKeys<T, ImageArm<M>>,
    options?: ValidateOptions,
  ): ValidateResult<Validated<T, BytedanceSdkTargets<T>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
