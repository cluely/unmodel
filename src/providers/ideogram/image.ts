/**
 * Ideogram 3.0 generate — POST https://api.ideogram.ai/v1/ideogram-v3/generate
 *
 * Wire notes (verified against
 * https://developer.ideogram.ai/api-reference/api-reference/generate-v3 and
 * the authoritative OpenAPI spec at https://developer.ideogram.ai/openapi.json
 * on 2026-08-13):
 * - This is a multipart/form-data endpoint (per the OpenAPI spec it is the
 *   only request content type). The validated output's enumerable props are
 *   the validated params (including reference-image Blobs) — do NOT
 *   JSON.stringify them. The raw-fetch path is `.request.url` +
 *   `toFormData(params)` as the body; fetch derives the multipart
 *   content-type (with boundary) from the FormData, which is why
 *   `.request.headers` is empty.
 * - Auth is an `Api-Key` header — unmodel never touches keys; add it
 *   yourself when fetching.
 * - There is no `model` wire param: the billable tier is `rendering_speed`
 *   (FLASH/TURBO/DEFAULT/QUALITY, default DEFAULT), which unmodel maps to a
 *   per-speed catalog pseudo-model for pricing (see models.ts).
 * - `aspect_ratio` and `resolution` cannot be used together.
 * - `style_codes` cannot be used with `style_reference_images` or
 *   `style_type`.
 * - Reference images: JPEG/PNG/WebP, ≤ 25MB each, whole request ≤ 50MB;
 *   `character_reference_images` currently supports exactly 1 image (billed
 *   at the separate character-reference rate) and the optional mask array
 *   must match its length. Formats are not sniffed here — only sizes are
 *   checked.
 * - Ideogram 4.0 lives on its own routes with a different param surface
 *   (text_prompt/json_prompt, ResolutionV4) — see `imageV4` in
 *   image-v4.ts. The 3.0 editing routes (edit/remix/reframe/
 *   replace-background) are in edit.ts.
 * - `seed` and `num_images` carry NO upper bound in the current spec
 *   (`Seed` and `NumImages` are bare integers); unmodel enforces only the
 *   floors so it never rejects a value the docs permit.
 * - Ideogram publishes no official JS SDK; `.toSdk("ideogram")` returns the validated
 *   params unchanged (the wire shape IS the integration shape).
 */

import { z } from "zod";
import { createValidator, type PipelineContext } from "../../core/pipeline";
import { toValidated, type ExactKeys, type Validated } from "../../core/request";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";
import type { ModelInfo } from "../../core/catalog-types";
import type { EndpointConstraints } from "../../core/constraint-types";
import {
  models,
  RENDERING_SPEED_TO_MODEL_ID,
  CHARACTER_REFERENCE_PER_IMAGE,
} from "./models";

export const IDEOGRAM_V3_GENERATE_URL = "https://api.ideogram.ai/v1/ideogram-v3/generate";

const GENERATE_DOCS_URL = "https://developer.ideogram.ai/api-reference/api-reference/generate-v3";

// ---------------------------------------------------------------------------
// Enums — copied verbatim from the OpenAPI spec (components RenderingSpeed,
// AspectRatioV3, ResolutionV3, MagicPromptOption, StyleTypeV3, StylePresetV3,
// ColorPalettePresetName), 2026-08-13.
// ---------------------------------------------------------------------------

/** Rendering speed tiers; server default is "DEFAULT". */
export const RENDERING_SPEEDS = ["FLASH", "TURBO", "DEFAULT", "QUALITY"] as const;
export type IdeogramRenderingSpeed = (typeof RENDERING_SPEEDS)[number];

export const MAGIC_PROMPT_OPTIONS = ["AUTO", "ON", "OFF"] as const;
export type IdeogramMagicPromptOption = (typeof MAGIC_PROMPT_OPTIONS)[number];

/** Style types; server default is "GENERAL". */
export const STYLE_TYPES = ["AUTO", "GENERAL", "REALISTIC", "DESIGN", "FICTION"] as const;
export type IdeogramStyleType = (typeof STYLE_TYPES)[number];

/** Aspect ratios; server default is "1x1". Cannot be combined with resolution. */
export const ASPECT_RATIOS = [
  "1x3",
  "3x1",
  "1x2",
  "2x1",
  "9x16",
  "16x9",
  "10x16",
  "16x10",
  "2x3",
  "3x2",
  "3x4",
  "4x3",
  "4x5",
  "5x4",
  "1x1",
] as const;
export type IdeogramAspectRatio = (typeof ASPECT_RATIOS)[number];

/** The 69 resolutions supported by Ideogram 3.0. */
export const RESOLUTIONS = [
  "512x1536",
  "576x1408",
  "576x1472",
  "576x1536",
  "640x1344",
  "640x1408",
  "640x1472",
  "640x1536",
  "704x1152",
  "704x1216",
  "704x1280",
  "704x1344",
  "704x1408",
  "704x1472",
  "736x1312",
  "768x1088",
  "768x1216",
  "768x1280",
  "768x1344",
  "800x1280",
  "832x960",
  "832x1024",
  "832x1088",
  "832x1152",
  "832x1216",
  "832x1248",
  "864x1152",
  "896x960",
  "896x1024",
  "896x1088",
  "896x1120",
  "896x1152",
  "960x832",
  "960x896",
  "960x1024",
  "960x1088",
  "1024x832",
  "1024x896",
  "1024x960",
  "1024x1024",
  "1088x768",
  "1088x832",
  "1088x896",
  "1088x960",
  "1120x896",
  "1152x704",
  "1152x832",
  "1152x864",
  "1152x896",
  "1216x704",
  "1216x768",
  "1216x832",
  "1248x832",
  "1280x704",
  "1280x768",
  "1280x800",
  "1312x736",
  "1344x640",
  "1344x704",
  "1344x768",
  "1408x576",
  "1408x640",
  "1408x704",
  "1472x576",
  "1472x640",
  "1472x704",
  "1536x512",
  "1536x576",
  "1536x640",
] as const;
export type IdeogramResolution = (typeof RESOLUTIONS)[number];

/** The 62 predefined style presets. */
export const STYLE_PRESETS = [
  "80S_ILLUSTRATION",
  "90S_NOSTALGIA",
  "ABSTRACT_ORGANIC",
  "ANALOG_NOSTALGIA",
  "ART_BRUT",
  "ART_DECO",
  "ART_POSTER",
  "AURA",
  "AVANT_GARDE",
  "BAUHAUS",
  "BLUEPRINT",
  "BLURRY_MOTION",
  "BRIGHT_ART",
  "C4D_CARTOON",
  "CHILDRENS_BOOK",
  "COLLAGE",
  "COLORING_BOOK_I",
  "COLORING_BOOK_II",
  "CUBISM",
  "DARK_AURA",
  "DOODLE",
  "DOUBLE_EXPOSURE",
  "DRAMATIC_CINEMA",
  "EDITORIAL",
  "EMOTIONAL_MINIMAL",
  "ETHEREAL_PARTY",
  "EXPIRED_FILM",
  "FLAT_ART",
  "FLAT_VECTOR",
  "FOREST_REVERIE",
  "GEO_MINIMALIST",
  "GLASS_PRISM",
  "GOLDEN_HOUR",
  "GRAFFITI_I",
  "GRAFFITI_II",
  "HALFTONE_PRINT",
  "HIGH_CONTRAST",
  "HIPPIE_ERA",
  "ICONIC",
  "JAPANDI_FUSION",
  "JAZZY",
  "LONG_EXPOSURE",
  "MAGAZINE_EDITORIAL",
  "MINIMAL_ILLUSTRATION",
  "MIXED_MEDIA",
  "MONOCHROME",
  "NIGHTLIFE",
  "OIL_PAINTING",
  "OLD_CARTOONS",
  "PAINT_GESTURE",
  "POP_ART",
  "RETRO_ETCHING",
  "RIVIERA_POP",
  "SPOTLIGHT_80S",
  "STYLIZED_RED",
  "SURREAL_COLLAGE",
  "TRAVEL_POSTER",
  "VINTAGE_GEO",
  "VINTAGE_POSTER",
  "WATERCOLOR",
  "WEIRD",
  "WOODBLOCK_PRINT",
] as const;
export type IdeogramStylePreset = (typeof STYLE_PRESETS)[number];

export const COLOR_PALETTE_PRESETS = [
  "EMBER",
  "FRESH",
  "JUNGLE",
  "MAGIC",
  "MELON",
  "MOSAIC",
  "PASTEL",
  "ULTRAMARINE",
] as const;
export type IdeogramColorPalettePreset = (typeof COLOR_PALETTE_PRESETS)[number];

// ---------------------------------------------------------------------------
// Wire types — mirror the multipart form fields exactly (snake_case).
// ---------------------------------------------------------------------------

export interface IdeogramColorPaletteMember {
  /** Hex color, "#RGB" or "#RRGGBB". */
  color_hex: string;
  /** Optional weight, 0.05–1.0 inclusive. */
  color_weight?: number;
}

/**
 * A color palette: EITHER a preset `name` OR explicit `members` — never both
 * (OpenAPI oneOf ColorPaletteWithPresetName | ColorPaletteWithMembers).
 */
export type IdeogramColorPalette =
  | { name: IdeogramColorPalettePreset; members?: never }
  | { members: IdeogramColorPaletteMember[]; name?: never };

export interface GenerateParams {
  /** The prompt to use to generate the image. */
  prompt: string;
  /** Random seed for reproducible generation. The spec states no upper bound. */
  seed?: number;
  /** Exact output resolution. Cannot be combined with aspect_ratio. */
  resolution?: IdeogramResolution;
  /** Aspect ratio (determines resolution). Default "1x1". Cannot be combined with resolution. */
  aspect_ratio?: IdeogramAspectRatio;
  /** Latency/fidelity tier; also selects the per-image price. Default "DEFAULT". */
  rendering_speed?: IdeogramRenderingSpeed;
  /** Whether MagicPrompt rewrites the prompt. */
  magic_prompt?: IdeogramMagicPromptOption;
  /** What to exclude; the prompt takes precedence over this. */
  negative_prompt?: string;
  /** Number of images to generate. Default 1. Billed per image. */
  num_images?: number;
  /** Preset palette name OR explicit members (never both). */
  color_palette?: IdeogramColorPalette;
  /** 8-hex-char style codes. Cannot be used with style_reference_images or style_type. */
  style_codes?: string[];
  /** Style type to generate with. Default "GENERAL". */
  style_type?: IdeogramStyleType;
  /** Predefined artistic style preset. */
  style_preset?: IdeogramStylePreset;
  /** "model/<model_name>/version/<version_name>"; resolves model + style. */
  custom_model_uri?: string;
  /** Style reference images (JPEG/PNG/WebP, ≤ 25MB each, request ≤ 50MB). */
  style_reference_images?: Blob[];
  /** Character reference images — currently exactly 1; billed at the character-reference rate. */
  character_reference_images?: Blob[];
  /** Grayscale masks; must match character_reference_images in count and dimensions. */
  character_reference_images_mask?: Blob[];
  /** Opt into post-generation copyright detection (adds latency). */
  enable_copyright_detection?: boolean | null;
}

// ---------------------------------------------------------------------------
// Schema (loose: unknown keys pass through with a warning). Enum-ish fields
// stay z.string() here so a bad value reports invalid_enum_value (from the
// checks below) rather than invalid_shape.
// ---------------------------------------------------------------------------

const generateSchema = z.looseObject({
  prompt: z.string(),
  // The OpenAPI `Seed` component is a bare integer with NO documented upper
  // bound (it once carried 0–2147483647). Only the floor implied by "random
  // seed" is enforced, so unmodel never rejects a seed the docs allow.
  seed: z.number().int().min(0, "seed must be a non-negative integer").optional(),
  resolution: z.string().optional(),
  aspect_ratio: z.string().optional(),
  rendering_speed: z.string().optional(),
  magic_prompt: z.string().optional(),
  negative_prompt: z.string().optional(),
  // `NumImages` is likewise a bare integer (default 1) in the current spec —
  // no documented maximum, so only the count floor is enforced.
  num_images: z.number().int().min(1, "num_images must be at least 1").optional(),
  color_palette: z.looseObject({}).optional(),
  style_codes: z
    .array(
      z
        .string()
        .regex(/^[0-9a-fA-F]{8}$/, "each style code must be an 8 character hexadecimal string"),
    )
    .optional(),
  style_type: z.string().optional(),
  style_preset: z.string().optional(),
  custom_model_uri: z.string().optional(),
  style_reference_images: z.array(z.instanceof(Blob)).optional(),
  character_reference_images: z.array(z.instanceof(Blob)).optional(),
  character_reference_images_mask: z.array(z.instanceof(Blob)).optional(),
  enable_copyright_detection: z.boolean().nullable().optional(),
});

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

const ENUM_CHECKS: ReadonlyArray<{
  param: "resolution" | "aspect_ratio" | "rendering_speed" | "magic_prompt" | "style_type" | "style_preset";
  allowed: readonly string[];
}> = [
  { param: "resolution", allowed: RESOLUTIONS },
  { param: "aspect_ratio", allowed: ASPECT_RATIOS },
  { param: "rendering_speed", allowed: RENDERING_SPEEDS },
  { param: "magic_prompt", allowed: MAGIC_PROMPT_OPTIONS },
  { param: "style_type", allowed: STYLE_TYPES },
  { param: "style_preset", allowed: STYLE_PRESETS },
];

function checkEnums(
  params: GenerateParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const record = params as unknown as Record<string, unknown>;
  for (const { param, allowed } of ENUM_CHECKS) {
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
      meta: { allowed: [...allowed], value, source: GENERATE_DOCS_URL },
    });
  }
}

/** `aspect_ratio` "cannot be used in conjunction with resolution". */
function checkResolutionExclusivity(
  params: GenerateParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (params.aspect_ratio != null && params.resolution != null) {
    ctx.report({
      code: "invalid_shape",
      path: ["aspect_ratio"],
      message: "`aspect_ratio` cannot be used in conjunction with `resolution`; specify one or the other.",
      meta: { source: GENERATE_DOCS_URL },
    });
  }
}

/** `style_codes` cannot be combined with style_reference_images or style_type. */
function checkStyleExclusivity(
  params: GenerateParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (params.style_codes == null) return;
  for (const conflicting of ["style_reference_images", "style_type"] as const) {
    if (params[conflicting] != null) {
      ctx.report({
        code: "invalid_shape",
        path: ["style_codes"],
        message: `\`style_codes\` cannot be used in conjunction with \`${conflicting}\`.`,
        meta: { source: GENERATE_DOCS_URL },
      });
    }
  }
}

/** Character reference: currently exactly 1 image; masks must match in count. */
function checkCharacterReferences(
  params: GenerateParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const references = params.character_reference_images;
  const masks = params.character_reference_images_mask;
  if (references != null && references.length > 1) {
    ctx.report({
      code: "invalid_shape",
      path: ["character_reference_images"],
      message: `\`character_reference_images\` currently only supports 1 character reference image; got ${references.length}.`,
      meta: { count: references.length, source: GENERATE_DOCS_URL },
    });
  }
  if (masks != null && masks.length !== (references?.length ?? 0)) {
    ctx.report({
      code: "invalid_shape",
      path: ["character_reference_images_mask"],
      message: `\`character_reference_images_mask\` must match the number of \`character_reference_images\` (${references?.length ?? 0}); got ${masks.length}.`,
      meta: { masks: masks.length, references: references?.length ?? 0, source: GENERATE_DOCS_URL },
    });
  }
}

const COLOR_HEX_PATTERN = /^#(?:[0-9a-fA-F]{3}){1,2}$/;
/** color_weight bounds from the OpenAPI spec (minimum 0.05, maximum 1). */
const MIN_COLOR_WEIGHT = 0.05;
const MAX_COLOR_WEIGHT = 1;

/** color_palette: preset `name` XOR explicit `members`, validated per the OpenAPI shapes. */
function checkColorPalette(
  params: GenerateParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const palette = params.color_palette as
    | { name?: unknown; members?: unknown }
    | null
    | undefined;
  if (palette == null) return;
  const hasName = palette.name != null;
  const hasMembers = palette.members != null;

  if (hasName === hasMembers) {
    ctx.report({
      code: "invalid_shape",
      path: ["color_palette"],
      message:
        "`color_palette` must specify EITHER a preset `name` OR explicit `members` — exactly one of the two.",
      meta: { source: GENERATE_DOCS_URL },
    });
    return;
  }

  if (hasName) {
    const name = palette.name;
    if (typeof name !== "string" || !(COLOR_PALETTE_PRESETS as readonly string[]).includes(name)) {
      ctx.report({
        code: "invalid_enum_value",
        path: ["color_palette", "name"],
        message: `\`color_palette.name\` must be one of ${COLOR_PALETTE_PRESETS.map((v) => JSON.stringify(v)).join(", ")}; got ${JSON.stringify(name)}.`,
        meta: { allowed: [...COLOR_PALETTE_PRESETS], value: name, source: GENERATE_DOCS_URL },
      });
    }
    return;
  }

  if (!Array.isArray(palette.members)) {
    ctx.report({
      code: "invalid_shape",
      path: ["color_palette", "members"],
      message: "`color_palette.members` must be an array of { color_hex, color_weight? } objects.",
      meta: { source: GENERATE_DOCS_URL },
    });
    return;
  }
  palette.members.forEach((member: unknown, index: number) => {
    const entry = member as { color_hex?: unknown; color_weight?: unknown } | null;
    if (typeof entry?.color_hex !== "string" || !COLOR_HEX_PATTERN.test(entry.color_hex)) {
      ctx.report({
        code: "invalid_shape",
        path: ["color_palette", "members", index, "color_hex"],
        message: `\`color_hex\` must be a hex color like "#3f2a1e" or "#f00"; got ${JSON.stringify(entry?.color_hex)}.`,
        meta: { source: GENERATE_DOCS_URL },
      });
    }
    const weight = entry?.color_weight;
    if (
      weight != null &&
      (typeof weight !== "number" || weight < MIN_COLOR_WEIGHT || weight > MAX_COLOR_WEIGHT)
    ) {
      ctx.report({
        code: "invalid_shape",
        path: ["color_palette", "members", index, "color_weight"],
        message: `\`color_weight\` must be a number between 0.05 and 1.0 inclusive; got ${JSON.stringify(weight)}.`,
        meta: { source: GENERATE_DOCS_URL },
      });
    }
  });
}

const CUSTOM_MODEL_URI_PATTERN = /^model\/[^/]+\/version\/[^/]+$/;

function checkCustomModelUri(
  params: GenerateParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const uri = params.custom_model_uri;
  if (uri == null || CUSTOM_MODEL_URI_PATTERN.test(uri)) return;
  ctx.report({
    code: "invalid_shape",
    path: ["custom_model_uri"],
    message: `\`custom_model_uri\` must have the format "model/<model_name>/version/<version_name>"; got ${JSON.stringify(uri)}.`,
    meta: { source: GENERATE_DOCS_URL },
  });
}

/** ≤ 25MB per reference image; the whole request must stay under 50MB. */
const MAX_REFERENCE_IMAGE_BYTES = 25 * 1024 * 1024;
const MAX_REQUEST_BYTES = 50 * 1024 * 1024;

const FILE_ARRAY_FIELDS = [
  "style_reference_images",
  "character_reference_images",
  "character_reference_images_mask",
] as const;

function checkReferenceImageSizes(
  params: GenerateParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  let totalBytes = 0;
  for (const field of FILE_ARRAY_FIELDS) {
    const blobs = params[field];
    if (!Array.isArray(blobs)) continue;
    blobs.forEach((blob, index) => {
      if (!(blob instanceof Blob)) return;
      totalBytes += blob.size;
      if (blob.size > MAX_REFERENCE_IMAGE_BYTES) {
        ctx.report({
          code: "media_too_large",
          path: [field, index],
          message: `image is ${blob.size} bytes; ${ctx.endpoint} caps each reference image at ${MAX_REFERENCE_IMAGE_BYTES} bytes (25MB).`,
          meta: { bytes: blob.size, limit: MAX_REFERENCE_IMAGE_BYTES, source: GENERATE_DOCS_URL },
        });
      }
    });
  }
  if (totalBytes > MAX_REQUEST_BYTES) {
    ctx.report({
      code: "media_too_large",
      message: `reference images total ${totalBytes} bytes; the whole request must stay under ${MAX_REQUEST_BYTES} bytes (50MB).`,
      meta: { bytes: totalBytes, limit: MAX_REQUEST_BYTES, source: GENERATE_DOCS_URL },
    });
  }
}

// ---------------------------------------------------------------------------
// Estimation — billed per generated image; the rate depends on the rendering
// speed (catalog cost.perImage) and jumps to the character-reference rate
// when character_reference_images is used. No published rate exists for
// FLASH + character reference, so that combination gets no estimate.
// ---------------------------------------------------------------------------

function estimate(params: GenerateParams, info: ModelInfo | undefined, _ctx: PipelineContext) {
  const count = params.num_images ?? 1;
  const usesCharacterReference = (params.character_reference_images?.length ?? 0) > 0;
  if (usesCharacterReference) {
    const speed = params.rendering_speed ?? "DEFAULT";
    const rate = CHARACTER_REFERENCE_PER_IMAGE[speed];
    return rate === undefined ? {} : { costUSD: rate * count };
  }
  const perImage = info?.cost?.perImage;
  return perImage === undefined ? {} : { costUSD: perImage * count };
}

// ---------------------------------------------------------------------------
// FormData helper + finalize
// ---------------------------------------------------------------------------

const FILE_FIELD_SET = new Set<string>(FILE_ARRAY_FIELDS);

/**
 * Builds the multipart/form-data body for any Ideogram route (generate, the
 * 3.0 editing routes, the 4.0 routes) from validated params: scalars are
 * stringified (matching the documented `-F rendering_speed="TURBO"` curl
 * form), single-file fields (`image`, `mask`) and reference-image Blob arrays
 * become file parts, `style_codes` is appended item-by-item, and object
 * fields (`color_palette`, `json_prompt`) become one JSON-string part each.
 * Null/undefined fields are omitted.
 *
 * ```ts
 * const params = ideogram.image({ prompt: "a cat", rendering_speed: "TURBO" });
 * await fetch(params.request.url, {
 *   method: "POST",
 *   headers: { "Api-Key": process.env.IDEOGRAM_API_KEY! },
 *   body: ideogram.toFormData(params),
 * });
 * ```
 */
export function toFormData(params: object): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(params)) {
    if (value == null) continue;
    if (FILE_FIELD_SET.has(key)) {
      for (const blob of value as Blob[]) form.append(key, blob);
      continue;
    }
    // Single-file fields (`image`, `mask` on the editing routes) must be
    // appended as file parts, not JSON-stringified by the object branch below.
    if (value instanceof Blob) {
      form.append(key, value);
      continue;
    }
    if (Array.isArray(value)) {
      // style_codes (and any unknown array param): repeated fields.
      for (const item of value) {
        form.append(key, typeof item === "string" ? item : JSON.stringify(item));
      }
      continue;
    }
    if (typeof value === "object") {
      // color_palette (and any unknown object param): one JSON-string part.
      form.append(key, JSON.stringify(value));
      continue;
    }
    form.append(key, String(value));
  }
  return form;
}

/**
 * The one `.toSdk("ideogram")` target for this endpoint — Ideogram publishes
 * no official JS SDK, so this is the multipart source. Derived from the
 * `sdk` literal in `finalize`; it must stay an object type with no index
 * signature, or `toSdk` would accept any string.
 */
type IdeogramSdkTargets<B> = { ideogram: () => B };

function finalize(params: GenerateParams): unknown {
  const body = { ...params };
  // Ideogram has no official JS SDK; the wire shape is the integration shape.
  return toValidated(body, {
    url: IDEOGRAM_V3_GENERATE_URL,
    method: "POST",
    // Deliberately NOT application/json: this is a multipart endpoint, and
    // fetch must derive the multipart boundary from the FormData body itself.
    headers: {},
  }, {
    sdk: { ideogram: () => body },
  });
}

const validator = createValidator<GenerateParams, unknown>({
  endpoint: "ideogram.image",
  schema: generateSchema,
  // No model wire param: the billable tier is rendering_speed (default
  // DEFAULT), mapped to a per-speed catalog pseudo-model for pricing.
  // Unknown speeds resolve to no model — checkEnums reports them.
  modelId: (params) => RENDERING_SPEED_TO_MODEL_ID[params.rendering_speed ?? "DEFAULT"],
  catalog: models,
  checks: [
    checkEnums,
    checkResolutionExclusivity,
    checkStyleExclusivity,
    checkCharacterReferences,
    checkColorPalette,
    checkCustomModelUri,
    checkReferenceImageSizes,
  ],
  estimate,
  finalize,
});

/**
 * Validates params for Ideogram `POST /v1/ideogram-v3/generate` (Ideogram
 * 3.0 image generation).
 *
 * This is a multipart endpoint: the validated output's enumerable props are
 * the validated params (including reference-image Blobs), and the raw-fetch
 * path is `.request.url` + `toFormData(validated)` as the body — never
 * `JSON.stringify`. `.toSdk("ideogram")` returns the params unchanged (Ideogram
 * publishes no official JS SDK). Auth is your job: add an `Api-Key` header
 * when fetching.
 *
 * Cost estimation prices `num_images` × the per-image rate of the selected
 * `rendering_speed` (character-reference requests use the higher published
 * character-reference rate), enabling `maxCostUSD` enforcement.
 */
export const image = validator as unknown as {
  <T extends GenerateParams>(
    params: T & ExactKeys<T, GenerateParams>,
    options?: ValidateOptions<T>,
  ): Validated<T, IdeogramSdkTargets<T>>;
  safe<T extends GenerateParams>(
    params: T & ExactKeys<T, GenerateParams>,
    options?: ValidateOptions<T>,
  ): ValidateResult<Validated<T, IdeogramSdkTargets<T>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
