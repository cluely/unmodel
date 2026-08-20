/**
 * Ideogram 3.0 editing routes — POST https://api.ideogram.ai/v1/ideogram-v3/…
 * (`edit`, `remix`, `reframe`, `replace-background`).
 *
 * Wire notes (verified against the authoritative OpenAPI spec at
 * https://developer.ideogram.ai/openapi.json on 2026-08-13):
 * - All four are multipart/form-data, exactly like `image`: the validated
 *   output's enumerable props are the validated params (including Blobs), and
 *   the raw-fetch path is `.request.url` + `toFormData(params)` as the body.
 *   `.request.headers` stays empty so fetch derives the boundary. Auth is an
 *   `Api-Key` header.
 * - The four param surfaces are genuinely different, which is why they are
 *   four endpoint fns:
 *     edit                 image + mask + prompt; NO resolution/aspect_ratio
 *     remix                image + prompt + image_weight; resolution XOR
 *                          aspect_ratio; the full style surface
 *     reframe              image + resolution (both REQUIRED); NO prompt,
 *                          NO style_type, NO magic_prompt, NO negative_prompt
 *     replace-background   image + prompt; NO resolution/aspect_ratio,
 *                          NO style_type, NO negative_prompt
 * - `style_codes` cannot be combined with `style_reference_images` (nor with
 *   `style_type` on the two routes that expose it) — same rule as image.
 * - Reference images: ≤ 25MB each, whole request ≤ 50MB;
 *   `character_reference_images` currently supports exactly 1 image and its
 *   optional mask array must match in length.
 * - Pricing: the pricing page states the 3.0 per-image rates apply to
 *   "Generate, Remix, Edit, Reframe, and Replace Background" alike, so these
 *   routes reuse the rendering-speed pseudo-models and the character-reference
 *   surcharge table from models.ts.
 * - `seed` and `num_images` carry no upper bound in the current spec, so only
 *   their floors are enforced (see image.ts).
 */

import { z } from "zod";
import { createValidator, type PipelineContext } from "../../core/pipeline";
import { toValidated, type ExactKeys, type Validated } from "../../core/request";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";
import type { ModelInfo } from "../../core/catalog-types";
import type { EndpointConstraints } from "../../core/constraint-types";
import { models, RENDERING_SPEED_TO_MODEL_ID, CHARACTER_REFERENCE_PER_IMAGE } from "./models";
import {
  RENDERING_SPEEDS,
  MAGIC_PROMPT_OPTIONS,
  STYLE_TYPES,
  ASPECT_RATIOS,
  RESOLUTIONS,
  STYLE_PRESETS,
  type IdeogramAspectRatio,
  type IdeogramColorPalette,
  type IdeogramMagicPromptOption,
  type IdeogramRenderingSpeed,
  type IdeogramResolution,
  type IdeogramStylePreset,
  type IdeogramStyleType,
} from "./image";

const V3_BASE_URL = "https://api.ideogram.ai/v1/ideogram-v3";

export const IDEOGRAM_V3_EDIT_URL = `${V3_BASE_URL}/edit`;
export const IDEOGRAM_V3_REMIX_URL = `${V3_BASE_URL}/remix`;
export const IDEOGRAM_V3_REFRAME_URL = `${V3_BASE_URL}/reframe`;
export const IDEOGRAM_V3_REPLACE_BACKGROUND_URL = `${V3_BASE_URL}/replace-background`;

const OPENAPI_URL = "https://developer.ideogram.ai/openapi.json";

/** ≤ 25MB per reference image; the whole request must stay under 50MB. */
const MAX_REFERENCE_IMAGE_BYTES = 25 * 1024 * 1024;
const MAX_REQUEST_BYTES = 50 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Wire types
// ---------------------------------------------------------------------------

/** Fields the editing routes share with `image`. */
interface IdeogramEditCommon {
  /** The image being edited (≤ 25MB; JPEG/PNG/WebP). REQUIRED. */
  image: Blob;
  /** Number of images to generate. Default 1. Billed per image. */
  num_images?: number;
  /** Random seed for reproducible generation. */
  seed?: number;
  /** Latency/fidelity tier; also selects the per-image price. Default "DEFAULT". */
  rendering_speed?: IdeogramRenderingSpeed;
  /** Predefined artistic style preset. */
  style_preset?: IdeogramStylePreset;
  /** Preset palette name OR explicit members (never both). */
  color_palette?: IdeogramColorPalette;
  /** 8-hex-char style codes. Cannot be used with style_reference_images. */
  style_codes?: string[];
  /** Style reference images (JPEG/PNG/WebP, ≤ 25MB each, request ≤ 50MB). */
  style_reference_images?: Blob[];
}

export interface EditParams extends IdeogramEditCommon {
  /**
   * Black-and-white mask the same size as `image`; black regions mark what to
   * edit. REQUIRED.
   */
  mask: Blob;
  /** The prompt describing the edited result. REQUIRED. */
  prompt: string;
  /** Whether MagicPrompt rewrites the prompt. */
  magic_prompt?: IdeogramMagicPromptOption;
  /** Style type to generate with. Cannot be combined with style_codes. */
  style_type?: IdeogramStyleType;
  /** Character reference images — currently exactly 1; billed at the character rate. */
  character_reference_images?: Blob[];
  /** Grayscale masks; must match character_reference_images in count. */
  character_reference_images_mask?: Blob[];
}

export interface RemixParams extends IdeogramEditCommon {
  /** The prompt to use to generate the image. REQUIRED. */
  prompt: string;
  /** How strongly the output should resemble the input image. Default 50. */
  image_weight?: number;
  /** Exact output resolution. Cannot be combined with aspect_ratio. */
  resolution?: IdeogramResolution;
  /** Aspect ratio (determines resolution). Cannot be combined with resolution. */
  aspect_ratio?: IdeogramAspectRatio;
  /** Whether MagicPrompt rewrites the prompt. */
  magic_prompt?: IdeogramMagicPromptOption;
  /** What to exclude; the prompt takes precedence over this. */
  negative_prompt?: string;
  /** Style type to generate with. Cannot be combined with style_codes. */
  style_type?: IdeogramStyleType;
  /** Character reference images — currently exactly 1; billed at the character rate. */
  character_reference_images?: Blob[];
  /** Grayscale masks; must match character_reference_images in count. */
  character_reference_images_mask?: Blob[];
}

export interface ReframeParams extends IdeogramEditCommon {
  /** Target resolution for the reframed image. REQUIRED on this route. */
  resolution: IdeogramResolution;
}

export interface ReplaceBackgroundParams extends IdeogramEditCommon {
  /** The prompt describing the desired new background. REQUIRED. */
  prompt: string;
  /** Whether MagicPrompt rewrites the prompt. */
  magic_prompt?: IdeogramMagicPromptOption;
}

// ---------------------------------------------------------------------------
// Schemas (loose: unknown keys pass through with a warning). Enum-ish fields
// stay z.string() so a bad value reports invalid_enum_value from the checks.
// ---------------------------------------------------------------------------

const commonShape = {
  image: z.instanceof(Blob, { message: "image must be a Blob" }),
  num_images: z.number().int().min(1, "num_images must be at least 1").optional(),
  seed: z.number().int().min(0, "seed must be a non-negative integer").optional(),
  rendering_speed: z.string().optional(),
  style_preset: z.string().optional(),
  color_palette: z.looseObject({}).optional(),
  style_codes: z
    .array(
      z
        .string()
        .regex(/^[0-9a-fA-F]{8}$/, "each style code must be an 8 character hexadecimal string"),
    )
    .optional(),
  style_reference_images: z.array(z.instanceof(Blob)).optional(),
};

const characterShape = {
  character_reference_images: z.array(z.instanceof(Blob)).optional(),
  character_reference_images_mask: z.array(z.instanceof(Blob)).optional(),
};

const editSchema = z.looseObject({
  ...commonShape,
  ...characterShape,
  mask: z.instanceof(Blob, { message: "mask must be a Blob" }),
  prompt: z.string(),
  magic_prompt: z.string().optional(),
  style_type: z.string().optional(),
});

const remixSchema = z.looseObject({
  ...commonShape,
  ...characterShape,
  prompt: z.string(),
  image_weight: z.number().int().optional(),
  resolution: z.string().optional(),
  aspect_ratio: z.string().optional(),
  magic_prompt: z.string().optional(),
  negative_prompt: z.string().optional(),
  style_type: z.string().optional(),
});

const reframeSchema = z.looseObject({
  ...commonShape,
  resolution: z.string(),
});

const replaceBackgroundSchema = z.looseObject({
  ...commonShape,
  prompt: z.string(),
  magic_prompt: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

interface EnumCheck {
  param: string;
  allowed: readonly string[];
}

const COMMON_ENUMS: readonly EnumCheck[] = [
  { param: "rendering_speed", allowed: RENDERING_SPEEDS },
  { param: "style_preset", allowed: STYLE_PRESETS },
];

function makeEnumCheck(extra: readonly EnumCheck[]) {
  const checks = [...COMMON_ENUMS, ...extra];
  return (params: object, _info: ModelInfo | undefined, ctx: PipelineContext): void => {
    const record = params as Record<string, unknown>;
    for (const { param, allowed } of checks) {
      const value = record[param];
      if (value == null || (typeof value === "string" && allowed.includes(value))) continue;
      const listed =
        allowed.length > 8
          ? `${allowed.slice(0, 8).map((v) => JSON.stringify(v)).join(", ")}, … (${allowed.length} values; see meta.allowed)`
          : allowed.map((v) => JSON.stringify(v)).join(", ");
      ctx.report({
        code: "invalid_enum_value",
        path: [param],
        message: `\`${param}\` must be one of ${listed}; got ${JSON.stringify(value)}.`,
        meta: { allowed: [...allowed], value, source: OPENAPI_URL },
      });
    }
  };
}

/** `style_codes` cannot be combined with style_reference_images / style_type. */
function checkStyleExclusivity(
  params: object,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const record = params as Record<string, unknown>;
  if (record.style_codes == null) return;
  for (const conflicting of ["style_reference_images", "style_type"]) {
    if (record[conflicting] != null) {
      ctx.report({
        code: "invalid_shape",
        path: ["style_codes"],
        message: `\`style_codes\` cannot be used in conjunction with \`${conflicting}\`.`,
        meta: { source: OPENAPI_URL },
      });
    }
  }
}

/** remix only: `aspect_ratio` cannot be used with `resolution`. */
function checkRemixSizing(
  params: RemixParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (params.aspect_ratio != null && params.resolution != null) {
    ctx.report({
      code: "invalid_shape",
      path: ["aspect_ratio"],
      message:
        "`aspect_ratio` cannot be used in conjunction with `resolution`; specify one or the other.",
      meta: { source: OPENAPI_URL },
    });
  }
}

/** Character reference: currently exactly 1 image; masks must match in count. */
function checkCharacterReferences(
  params: object,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const record = params as {
    character_reference_images?: Blob[];
    character_reference_images_mask?: Blob[];
  };
  const references = record.character_reference_images;
  const masks = record.character_reference_images_mask;
  if (references != null && references.length > 1) {
    ctx.report({
      code: "invalid_shape",
      path: ["character_reference_images"],
      message: `\`character_reference_images\` currently only supports 1 character reference image; got ${references.length}.`,
      meta: { count: references.length, source: OPENAPI_URL },
    });
  }
  if (masks != null && masks.length !== (references?.length ?? 0)) {
    ctx.report({
      code: "invalid_shape",
      path: ["character_reference_images_mask"],
      message: `\`character_reference_images_mask\` must match the number of \`character_reference_images\` (${references?.length ?? 0}); got ${masks.length}.`,
      meta: { masks: masks.length, references: references?.length ?? 0, source: OPENAPI_URL },
    });
  }
}

const BLOB_FIELDS = ["image", "mask"] as const;
const BLOB_ARRAY_FIELDS = [
  "style_reference_images",
  "character_reference_images",
  "character_reference_images_mask",
] as const;

/** ≤ 25MB per reference image and ≤ 50MB for the whole multipart request. */
function checkImageSizes(params: object, _info: ModelInfo | undefined, ctx: PipelineContext): void {
  const record = params as Record<string, unknown>;
  let totalBytes = 0;
  const note = (bytes: number, path: Array<string | number>): void => {
    totalBytes += bytes;
    if (bytes <= MAX_REFERENCE_IMAGE_BYTES) return;
    ctx.report({
      code: "media_too_large",
      path,
      message: `image is ${bytes} bytes; ${ctx.endpoint} caps each image at ${MAX_REFERENCE_IMAGE_BYTES} bytes (25MB).`,
      meta: { bytes, limit: MAX_REFERENCE_IMAGE_BYTES, source: OPENAPI_URL },
    });
  };
  for (const field of BLOB_FIELDS) {
    const blob = record[field];
    if (blob instanceof Blob) note(blob.size, [field]);
  }
  for (const field of BLOB_ARRAY_FIELDS) {
    const blobs = record[field];
    if (!Array.isArray(blobs)) continue;
    blobs.forEach((blob, index) => {
      if (blob instanceof Blob) note(blob.size, [field, index]);
    });
  }
  if (totalBytes > MAX_REQUEST_BYTES) {
    ctx.report({
      code: "media_too_large",
      message: `images total ${totalBytes} bytes; the whole request must stay under ${MAX_REQUEST_BYTES} bytes (50MB).`,
      meta: { bytes: totalBytes, limit: MAX_REQUEST_BYTES, source: OPENAPI_URL },
    });
  }
}

// ---------------------------------------------------------------------------
// Estimation — same per-image rates as image; the character-reference
// surcharge applies on the routes that accept character references.
// ---------------------------------------------------------------------------

function estimate(params: object, info: ModelInfo | undefined) {
  const record = params as { num_images?: number; rendering_speed?: string; character_reference_images?: Blob[] };
  const count = record.num_images ?? 1;
  if ((record.character_reference_images?.length ?? 0) > 0) {
    const rate = CHARACTER_REFERENCE_PER_IMAGE[record.rendering_speed ?? "DEFAULT"];
    return rate === undefined ? {} : { costUSD: rate * count };
  }
  const perImage = info?.cost?.perImage;
  return perImage === undefined ? {} : { costUSD: perImage * count };
}

/**
 * The one `.toSdk("ideogram")` target for this endpoint — Ideogram publishes
 * no official JS SDK, so this is the multipart source. Derived from the
 * `sdk` literal in `finalize`; it must stay an object type with no index
 * signature, or `toSdk` would accept any string.
 */
type IdeogramSdkTargets<B> = { ideogram: () => B };

function finalizeTo(url: string) {
  return (params: object): unknown => {
    const body = { ...params };
    return toValidated(body, {
      url,
      method: "POST",
      // Deliberately NOT application/json: multipart endpoint — fetch derives
      // the boundary from the FormData body.
      headers: {},
    }, {
      sdk: { ideogram: () => body },
    });
  };
}

function modelIdFor(params: object): string | undefined {
  const speed = (params as { rendering_speed?: string }).rendering_speed ?? "DEFAULT";
  return RENDERING_SPEED_TO_MODEL_ID[speed];
}

const editValidator = createValidator<EditParams, unknown>({
  endpoint: "ideogram.imageEdit",
  schema: editSchema,
  modelId: modelIdFor,
  catalog: models,
  checks: [
    makeEnumCheck([
      { param: "magic_prompt", allowed: MAGIC_PROMPT_OPTIONS },
      { param: "style_type", allowed: STYLE_TYPES },
    ]),
    checkStyleExclusivity,
    checkCharacterReferences,
    checkImageSizes,
  ],
  estimate,
  finalize: finalizeTo(IDEOGRAM_V3_EDIT_URL),
});

const remixValidator = createValidator<RemixParams, unknown>({
  endpoint: "ideogram.imageEditRemix",
  schema: remixSchema,
  modelId: modelIdFor,
  catalog: models,
  checks: [
    makeEnumCheck([
      { param: "magic_prompt", allowed: MAGIC_PROMPT_OPTIONS },
      { param: "style_type", allowed: STYLE_TYPES },
      { param: "resolution", allowed: RESOLUTIONS },
      { param: "aspect_ratio", allowed: ASPECT_RATIOS },
    ]),
    checkStyleExclusivity,
    checkRemixSizing,
    checkCharacterReferences,
    checkImageSizes,
  ],
  estimate,
  finalize: finalizeTo(IDEOGRAM_V3_REMIX_URL),
});

const reframeValidator = createValidator<ReframeParams, unknown>({
  endpoint: "ideogram.imageEditReframe",
  schema: reframeSchema,
  modelId: modelIdFor,
  catalog: models,
  checks: [
    makeEnumCheck([{ param: "resolution", allowed: RESOLUTIONS }]),
    checkStyleExclusivity,
    checkImageSizes,
  ],
  estimate,
  finalize: finalizeTo(IDEOGRAM_V3_REFRAME_URL),
});

const replaceBackgroundValidator = createValidator<ReplaceBackgroundParams, unknown>({
  endpoint: "ideogram.imageEditReplaceBackground",
  schema: replaceBackgroundSchema,
  modelId: modelIdFor,
  catalog: models,
  checks: [
    makeEnumCheck([{ param: "magic_prompt", allowed: MAGIC_PROMPT_OPTIONS }]),
    checkStyleExclusivity,
    checkImageSizes,
  ],
  estimate,
  finalize: finalizeTo(IDEOGRAM_V3_REPLACE_BACKGROUND_URL),
});

interface IdeogramEditValidator<P> {
  <T extends P>(
    params: T & ExactKeys<T, P>,
    options?: ValidateOptions,
  ): Validated<T, IdeogramSdkTargets<T>>;
  safe<T extends P>(
    params: T & ExactKeys<T, P>,
    options?: ValidateOptions,
  ): ValidateResult<Validated<T, IdeogramSdkTargets<T>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
}

/**
 * Validates params for Ideogram `POST /v1/ideogram-v3/edit` — mask-driven
 * inpainting. `image`, `mask` and `prompt` are required; this route has no
 * `resolution` / `aspect_ratio` (the output matches the input).
 *
 * Multipart endpoint: send `.request.url` + `ideogram.toFormData(validated)`
 * as the body, never `JSON.stringify`. Auth is your job: add an `Api-Key`
 * header when fetching.
 */
export const imageEdit = editValidator as unknown as IdeogramEditValidator<EditParams>;

/**
 * Validates params for Ideogram `POST /v1/ideogram-v3/remix` — regenerates
 * the image from `prompt`, with `image_weight` controlling how much of the
 * input survives. Accepts `resolution` XOR `aspect_ratio`. Multipart
 * endpoint — see `imageEdit`.
 */
export const imageEditRemix = remixValidator as unknown as IdeogramEditValidator<RemixParams>;

/**
 * Validates params for Ideogram `POST /v1/ideogram-v3/reframe` — re-crops and
 * extends the image to a new `resolution` (REQUIRED). No `prompt`,
 * `style_type`, `magic_prompt` or `negative_prompt` on this route. Multipart
 * endpoint — see `imageEdit`.
 */
export const imageEditReframe = reframeValidator as unknown as IdeogramEditValidator<ReframeParams>;

/**
 * Validates params for Ideogram `POST /v1/ideogram-v3/replace-background` —
 * replaces the background with the scene described by `prompt`. Multipart
 * endpoint — see `imageEdit`.
 */
export const imageEditReplaceBackground =
  replaceBackgroundValidator as unknown as IdeogramEditValidator<ReplaceBackgroundParams>;
