/**
 * Recraft image generation — POST https://external.api.recraft.ai/v1/images/generations
 *
 * Wire notes (ground truth: https://www.recraft.ai/docs/api-reference/endpoints,
 * .../styles, .../pricing and .../appendix, re-verified 2026-08-13):
 * - Seven params the API accepts are absent from the rendered parameter
 *   table: `substyle`, `creativity`, `image_format`, `upscale`, `block_nsfw`,
 *   `calculate_features` and `expire`. They are typed here so they validate
 *   instead of warning as unknown params, and their provenance is recorded
 *   per param. Recraft's Swagger document
 *   (https://external.api.recraft.ai/doc/spec/api/api.yaml) is an INTERNAL
 *   backend spec — re-downloaded 2026-08-13: zero paths, no /v1/images
 *   request schema — so it backs only `upscale` (its `UpscaleMode` enum) and
 *   `substyle` (the style suffixes of its `ImageType` enum). The `creativity`
 *   and `image_format` value lists come from an earlier revision of that
 *   document and are not re-verifiable against anything Recraft publishes
 *   today; they are kept because they are narrower than passing anything
 *   through, and are flagged as such on the rules that use them.
 * - OpenAI-images-flavored JSON body. Auth is `Authorization: Bearer <token>`
 *   — unmodel never touches keys; add the header yourself when fetching.
 * - `model` defaults to `recraftv4_1` server-side; model-dependent checks run
 *   against that default when `model` is omitted.
 * - The current API takes curated style NAMES in `style` (e.g. "Photorealism",
 *   "Vector art") — the old `style`/`substyle` enum pairs are gone from the
 *   docs. Styles are V2/V3-only; the per-model name lists live in styles.ts
 *   and the style ↔ model cross-check reports invalid_enum_value.
 * - `style` and `style_id` cannot be used together (docs: "Specify one or the
 *   other, not both").
 * - `size` is "WxH" or "w:h". The appendix publishes explicit WxH sets per
 *   raster model group and the same 14 aspect ratios for every model; vector
 *   models are listed with aspect ratios only, so explicit WxH values on
 *   vector models are passed through unvalidated.
 * - Max prompt length is per-model (10,000 chars for V4/V4.1, 1,000 for
 *   V2/V3 — appendix); a breach is reported as `over_output_limit` with a
 *   characters-explicit message (there is no character-specific issue code).
 * - `text_layout[].text` must use the documented character allowlist; that
 *   allowlist is not re-encoded here (only the word/bbox shape is checked).
 * - Two specialized variants (/generations/raster, /generations/vector)
 *   accept the same body but constrain model/style to one output type; they
 *   are not modeled separately — use the base endpoint.
 * - Billing: per generated image (n × per-image rate; see models.ts).
 */

import { z } from "zod";
import { createValidator, type PipelineContext } from "../../core/pipeline";
import { toValidated, JSON_HEADERS, type ExactKeys, type Validated } from "../../core/request";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";
import type { ModelInfo } from "../../core/catalog-types";
import type { EndpointConstraints } from "../../core/constraint-types";
import { models, type RecraftModelId } from "./models";
import { imageFamilyRules } from "./constraints";
import { STYLE_NAMES_BY_MODEL, type StyleFor } from "./styles";

export const IMAGES_GENERATIONS_URL = "https://external.api.recraft.ai/v1/images/generations";

/**
 * Server-side default when `model` is omitted —
 * https://www.recraft.ai/docs/api-reference/endpoints ("default is
 * `recraftv4_1`"). Model-dependent checks run against this default.
 */
export const DEFAULT_MODEL_ID = "recraftv4_1";

const ENDPOINTS_DOCS_URL = "https://www.recraft.ai/docs/api-reference/endpoints";
const STYLES_DOCS_URL = "https://www.recraft.ai/docs/api-reference/styles";
const APPENDIX_DOCS_URL = "https://www.recraft.ai/docs/api-reference/appendix";

// ---------------------------------------------------------------------------
// Size tables — appendix "List of supported image sizes" (2026-08-13). The
// same 14 aspect ratios apply to every model; explicit WxH values depend on
// the raster model group.
// ---------------------------------------------------------------------------

/** `w:h` aspect values accepted by every model. */
export const ASPECT_RATIOS = [
  "1:1",
  "2:1",
  "1:2",
  "3:2",
  "2:3",
  "4:3",
  "3:4",
  "5:4",
  "4:5",
  "6:10",
  "14:10",
  "10:14",
  "16:9",
  "9:16",
] as const;

/** Explicit sizes for Recraft V4.1 / V4.1 Utility / V4 (standard raster). */
export const V4_STANDARD_SIZES = [
  "1024x1024",
  "1536x768",
  "768x1536",
  "1280x832",
  "832x1280",
  "1216x896",
  "896x1216",
  "1152x896",
  "896x1152",
  "832x1344",
  "1280x896",
  "896x1280",
  "1344x768",
  "768x1344",
] as const;

/** Explicit sizes for Recraft V4.1 Pro / V4.1 Utility Pro / V4 Pro. */
export const V4_PRO_SIZES = [
  "2048x2048",
  "3072x1536",
  "1536x3072",
  "2560x1664",
  "1664x2560",
  "2432x1792",
  "1792x2432",
  "2304x1792",
  "1792x2304",
  "1664x2688",
  "2560x1792",
  "1792x2560",
  "2688x1536",
  "1536x2688",
] as const;

/** Explicit sizes for Recraft V2 / V3 (raster). */
export const V2_V3_SIZES = [
  "1024x1024",
  "2048x1024",
  "1024x2048",
  "1536x1024",
  "1024x1536",
  "1365x1024",
  "1024x1365",
  "1280x1024",
  "1024x1280",
  "1024x1707",
  "1434x1024",
  "1024x1434",
  "1820x1024",
  "1024x1820",
] as const;

/**
 * WxH values the appendix's per-model tables never attribute to a model, but
 * which are the transpose of a listed size (the V2/V3 table lists
 * `1024x1707`, never `1707x1024`). Rejecting a size the API may well accept
 * on the strength of a table that is silent about it would be a false
 * negative, so these are passed through unvalidated on every model.
 */
export const UNATTRIBUTED_SIZE_VALUES = ["1707x1024"] as const;

const UNATTRIBUTED_SIZES = new Set<string>(UNATTRIBUTED_SIZE_VALUES);

/**
 * `size` values, derived from the appendix tables above so the autocomplete
 * cannot drift from the runtime rule in `checkSize`: the 14 aspect ratios
 * every model accepts, every explicit WxH the appendix attributes to a raster
 * model group, and the unattributed pass-through size.
 *
 * The free-form tail is deliberately KEPT but narrowed to the two shapes the
 * wire accepts (`"WxH"` and `"w:h"`): the vector models are documented with
 * aspect ratios only and `checkSize` passes unattributed WxH values through on
 * purpose, so a fully closed union would reject sizes the API accepts. What it
 * does close off is junk — `""` and `"banana"` no longer compile.
 *
 * Not every preset is legal on every model: the explicit WxH sets are
 * per-model-group (see `SIZES_BY_MODEL`), and `checkSize` reports the mismatch
 * as `invalid_enum_value`.
 */
export type RecraftSize =
  | (typeof ASPECT_RATIOS)[number]
  | (typeof V4_STANDARD_SIZES)[number]
  | (typeof V4_PRO_SIZES)[number]
  | (typeof V2_V3_SIZES)[number]
  | (typeof UNATTRIBUTED_SIZE_VALUES)[number]
  | (`${number}x${number}` & {})
  | (`${number}:${number}` & {});

/** Explicit WxH sets per raster model; vector models take aspect ratios only. */
const SIZES_BY_MODEL: Readonly<Record<string, readonly string[]>> = {
  recraftv4_1: V4_STANDARD_SIZES,
  recraftv4_1_utility: V4_STANDARD_SIZES,
  recraftv4: V4_STANDARD_SIZES,
  recraftv4_1_pro: V4_PRO_SIZES,
  recraftv4_1_utility_pro: V4_PRO_SIZES,
  recraftv4_pro: V4_PRO_SIZES,
  recraftv2: V2_V3_SIZES,
  recraftv3: V2_V3_SIZES,
};

// ---------------------------------------------------------------------------
// Wire types — mirror the raw JSON body exactly. Explicit `null` means "use
// the provider default" on nullable fields.
// ---------------------------------------------------------------------------

export interface RecraftColor {
  /** 3 integers in 0–255 (RGB). */
  rgb: number[];
  /** Relative preference in 0.0–1.0; weights across `colors` must sum ≤ 1. */
  weight?: number;
}

export interface RecraftControls {
  /** Preferable colors. All models. */
  colors?: RecraftColor[] | null;
  /** Desired background color. All models. */
  background_color?: RecraftColor | null;
  /** Artistic tone, integer 0–5. V3 models only. */
  artistic_level?: number | null;
  /** Do not embed text layouts. V3 models only. */
  no_text?: boolean | null;
}

export interface RecraftTextLayoutElement {
  /** A single word using the documented character allowlist. */
  text: string;
  /** Exactly 4 [x, y] points, relative coordinates ((0,0) top-left, (1,1) bottom-right). */
  bbox: number[][];
}

/**
 * `substyle` values. The rendered endpoints page does not document
 * `substyle`, so these are the style suffixes of the `ImageType` enum in
 * Recraft's internal Swagger document (`digital_illustration_pixel_art` →
 * `pixel_art`), which is where the pairs `style` + `substyle` come from.
 * Typed here rather than dropped into `unknown_param`.
 */
export const SUBSTYLES = [
  "2d_art_poster", "3d", "80s", "glow", "grain", "hand_drawn", "infantile_sketch", "kawaii",
  "pixel_art", "psychedelic", "seamless", "voxel", "watercolor", "broken_line", "colored_outline",
  "colored_shapes", "colored_shapes_gradient", "doodle_fill", "doodle_offset_fill", "offset_fill",
  "outline", "outline_gradient", "cartoon", "doodle_line_art", "engraving", "flat_2", "line_art",
  "linocut", "b_and_w", "enterprise", "hard_flash", "hdr", "motion_blur", "natural_light",
  "studio_portrait", "line_circuit", "2d_art_poster_2", "engraving_color", "hand_drawn_outline",
  "handmade_3d", "plastic", "pictogram", "antiquarian", "bold_fantasy", "child_book", "cover",
  "crosshatch", "digital_engraving", "expressionism", "freehand_details", "grain_20",
  "graphic_intensity", "hard_comics", "long_shadow", "modern_folk", "multicolor", "neon_calm",
  "noir", "nostalgic_pastel", "outline_details", "pastel_gradient", "pastel_sketch", "pop_art",
  "pop_renaissance", "street_art", "tablet_sketch", "urban_glow", "urban_sketching",
  "young_adult_book", "young_adult_book_2", "evening_light", "faded_nostalgia", "forest_life",
  "mystic_naturalism", "natural_tones", "organic_calm", "real_life_glow", "retro_realism",
  "retro_snapshot", "urban_drama", "village_realism", "warm_folk", "bold_stroke", "chemistry",
  "colored_stencil", "cosmics", "cutout", "depressive", "editorial", "emotional_flat",
  "marker_outline", "mosaic", "naivector", "roundish_flat", "segmented_colors", "sharp_contrast",
  "thin", "vector_photo", "vivid_shapes", "emblem_graffiti", "emblem_pop_art", "emblem_punk",
  "emblem_stamp", "emblem_vintage",
] as const;
export type RecraftSubstyle = (typeof SUBSTYLES)[number];

/** `image_format` values. No jpeg. Legacy list — see LEGACY_SPEC_SOURCE. */
export const IMAGE_FORMATS = ["webp", "png"] as const;
export type RecraftImageFormat = (typeof IMAGE_FORMATS)[number];

/** `upscale` values — the `UpscaleMode` enum of Recraft's Swagger document. */
export const UPSCALE_MODES = ["upscale4mp", "upscale16mp"] as const;
export type RecraftUpscaleMode = (typeof UPSCALE_MODES)[number];

/**
 * `creativity` values — a named tier, not a number. Legacy list; no source
 * Recraft publishes today declares it (see LEGACY_SPEC_SOURCE).
 */
export const CREATIVITY_LEVELS = ["simple", "standard", "eccentric"] as const;
export type RecraftCreativity = (typeof CREATIVITY_LEVELS)[number];

/**
 * `model` input: the known ids plus the open tail for runtime-built ones, and
 * the CONSTRAINT of `M` below. It has to carry the id literals rather than be a
 * bare `string`, or `model`'s own completion list collapses — the same reason
 * openai's images callable constrains its `M` to `ImagesModelInput`.
 */
type RecraftModelInput = RecraftModelId | (string & {});

/**
 * The generations wire body. `M` is the `model` literal, inferred at the call
 * site so `style` resolves to that model's own curated list (`StyleFor<M>`,
 * styles.ts) instead of pooling all four lists into one union — the styles are
 * per-model and `checkStyleForModel` rejects a cross-model name at runtime, so
 * the pooled union completed 111 names on a model that accepts 66, seven of
 * which compiled and were then refused.
 *
 * `M` is bound by `model` alone: `model?: M | null` is the inference site, and
 * the callable must NOT re-state it as an extra `& { model?: M }` intersection
 * arm — that intersection is normalized before completion and leaves `model`
 * itself completing nothing (measured: 17 ids → 1).
 *
 * `M` defaults to the whole `RecraftModelInput` union, so the plain
 * `GenerationsParams` type is byte-for-byte what it was: `model` completes all
 * 17 ids and `style` the pooled 111 with its open tail. That default is also
 * the degraded arm — `model` omitted, `null`, runtime-built, or an id with no
 * style table — which keeps JS-shaped and future ids callable.
 */
export interface GenerationsParams<M extends RecraftModelInput = RecraftModelInput> {
  /** Text description of the desired image(s). Max length is per-model (see models.ts). */
  prompt: string;
  /** Number of images, 1–6. Default 1. Billed per image. */
  n?: number | null;
  /** Defaults to "recraftv4_1" server-side. */
  model?: M | null;
  /** Curated style name (V2/V3 models only). Cannot be combined with style_id. */
  style?: StyleFor<M> | null;
  /** Style sub-variant (undocumented; see SUBSTYLES); pairs with `style`. */
  substyle?: RecraftSubstyle | (string & {}) | null;
  /** Style UUID used as a visual reference (V2/V3 models only). Cannot be combined with style. */
  style_id?: string | null;
  /**
   * "WxH" or "w:h"; auto-selected from the prompt when omitted. The presets
   * are the appendix's per-model WxH tables plus the 14 shared aspect ratios —
   * see `RecraftSize` for why the free-form tail stays.
   */
  size?: RecraftSize | null;
  /** Undesired elements (V2/V3 models only). */
  negative_prompt?: string | null;
  /** Seed for reproducible generation. */
  random_seed?: number | null;
  /** "url" (default) or "b64_json". */
  response_format?: "url" | "b64_json" | null;
  /** Spatial/textual attributes for text elements (V3 models only). */
  text_layout?: RecraftTextLayoutElement[] | null;
  /** Generation tweaks; artistic_level / no_text are V3-only. */
  controls?: RecraftControls | null;
  /** Creativity tier: "simple" | "standard" | "eccentric" (undocumented param). */
  creativity?: RecraftCreativity | (string & {}) | null;
  /** Raster output container: "webp" or "png" (undocumented param). */
  image_format?: RecraftImageFormat | (string & {}) | null;
  /** Post-generation upscale tier (Swagger `UpscaleMode`). */
  upscale?: RecraftUpscaleMode | (string & {}) | null;
  /** Reject NSFW results server-side. */
  block_nsfw?: boolean | null;
  /** Return image feature vectors alongside the result. */
  calculate_features?: boolean | null;
  /** Opt the generated image into the default expiry policy. */
  expire?: boolean | null;
}

// ---------------------------------------------------------------------------
// Schema (loose: unknown keys pass through with a warning).
// ---------------------------------------------------------------------------

const colorSchema = z.looseObject({
  rgb: z
    .array(z.number().int().min(0).max(255))
    .length(3, "rgb must be exactly 3 integers in 0-255"),
  weight: z.number().min(0).max(1).optional(),
});

const generationsSchema = z.looseObject({
  prompt: z.string(),
  n: z.number().int().min(1).max(6, "n must be between 1 and 6").nullable().optional(),
  model: z.string().nullable().optional(),
  style: z.string().nullable().optional(),
  substyle: z.string().nullable().optional(),
  style_id: z.string().nullable().optional(),
  size: z.string().nullable().optional(),
  creativity: z.string().nullable().optional(),
  image_format: z.string().nullable().optional(),
  upscale: z.string().nullable().optional(),
  block_nsfw: z.boolean().nullable().optional(),
  calculate_features: z.boolean().nullable().optional(),
  expire: z.boolean().nullable().optional(),
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
});

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

const RESPONSE_FORMATS = ["url", "b64_json"] as const;
const ASPECT_RATIO_SET = new Set<string>(ASPECT_RATIOS);

function resolvedModelId(params: GenerationsParams): string {
  return params.model ?? DEFAULT_MODEL_ID;
}

function checkResponseFormat(
  params: GenerationsParams,
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

/**
 * Recraft's internal backend Swagger document. NOT the public /v1/images
 * spec — as of 2026-08-13 it declares zero paths and no request schema for
 * this endpoint — but it still declares two of the enums below.
 */
const SPEC_URL = "https://external.api.recraft.ai/doc/spec/api/api.yaml";
/** Enum values kept from an earlier revision of SPEC_URL; unverifiable today. */
const LEGACY_SPEC_SOURCE = `${SPEC_URL} (earlier revision — neither the document served on 2026-08-13 nor any recraft.ai docs page declares this param)`;

/**
 * Enum params the API accepts that the rendered parameter table omits. A bad
 * value reports `invalid_enum_value` instead of silently reaching the API;
 * each rule carries the source its value list actually came from.
 */
const SPEC_ENUM_CHECKS: ReadonlyArray<{
  param: "substyle" | "creativity" | "image_format" | "upscale";
  allowed: readonly string[];
  source: string;
}> = [
  { param: "substyle", allowed: SUBSTYLES, source: `${SPEC_URL} (\`ImageType\` enum suffixes)` },
  { param: "creativity", allowed: CREATIVITY_LEVELS, source: LEGACY_SPEC_SOURCE },
  { param: "image_format", allowed: IMAGE_FORMATS, source: LEGACY_SPEC_SOURCE },
  { param: "upscale", allowed: UPSCALE_MODES, source: `${SPEC_URL} (\`UpscaleMode\` enum)` },
];

function checkSpecEnums(
  params: GenerationsParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const record = params as unknown as Record<string, unknown>;
  for (const { param, allowed, source } of SPEC_ENUM_CHECKS) {
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
      meta: { allowed: [...allowed], value, source },
    });
  }
}

/** `style` and `style_id` cannot be used together — styles doc. */
function checkStyleExclusivity(
  params: GenerationsParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (params.style != null && params.style_id != null) {
    ctx.report({
      code: "invalid_shape",
      path: ["style_id"],
      message: "`style` and `style_id` cannot be used together; specify one or the other.",
      meta: { source: STYLES_DOCS_URL },
    });
  }
}

/**
 * The style table widened to a plain string-keyed lookup. `STYLE_NAMES_BY_MODEL`
 * is `as const` so it can serve as the type source for `StyleFor<M>`; this check
 * indexes it with a RESOLVED model id (a `string`, possibly the server-side
 * default or an id unmodel has never heard of), so the widening lives here — on
 * the one consumer that wants it — rather than back on the table.
 */
const STYLE_NAMES: Readonly<Record<string, readonly string[]>> = STYLE_NAMES_BY_MODEL;

/**
 * Style ↔ model cross-check: a curated style name must belong to the selected
 * model's list (styles are per-model; e.g. "Vector art" is a V2/V3 Vector
 * style and is rejected for recraftv3). V4/V4.1 models are handled by the
 * family deny rule, not here.
 *
 * `GenerationsParams`'s `style?: StyleFor<M>` now catches the same mismatch at
 * compile time for a literal `model`; this stays the enforcement for JS callers
 * and for runtime-built model ids, where the type degrades to the pooled union.
 */
function checkStyleForModel(
  params: GenerationsParams,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const style = params.style;
  if (style == null || info === undefined) return;
  const model = resolvedModelId(params);
  const allowed = STYLE_NAMES[model];
  if (allowed === undefined || allowed.includes(style)) return;
  ctx.report({
    code: "invalid_enum_value",
    path: ["style"],
    model,
    message: `\`style\` ${JSON.stringify(style)} is not a curated style for "${model}"; the per-model style lists are documented at ${STYLES_DOCS_URL} (allowed values in meta.allowed).`,
    meta: { allowed: [...allowed], value: style, source: STYLES_DOCS_URL },
  });
}

/**
 * `size` must be "WxH" or "w:h". Aspect values come from a fixed 14-entry set
 * shared by all models; explicit WxH values are validated against the model's
 * documented set for raster models (vector models are listed with aspect
 * ratios only, so their WxH values pass through unvalidated).
 */
function checkSize(
  params: GenerationsParams,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const size = params.size;
  if (size == null) return;
  const model = resolvedModelId(params);

  if (/^\d+:\d+$/.test(size)) {
    if (!ASPECT_RATIO_SET.has(size)) {
      ctx.report({
        code: "invalid_enum_value",
        path: ["size"],
        model,
        message: `\`size\` aspect ${JSON.stringify(size)} is not supported; supported aspects: ${ASPECT_RATIOS.join(", ")}.`,
        meta: { allowed: [...ASPECT_RATIOS], value: size, source: APPENDIX_DOCS_URL },
      });
    }
    return;
  }

  if (/^\d+x\d+$/.test(size)) {
    if (info === undefined) return; // unknown model: no size table to check against
    if (UNATTRIBUTED_SIZES.has(size)) return; // transpose of a listed size, in no table
    const allowed = SIZES_BY_MODEL[model];
    if (allowed === undefined || allowed.includes(size)) return;
    ctx.report({
      code: "invalid_enum_value",
      path: ["size"],
      model,
      message: `\`size\` ${JSON.stringify(size)} is not supported by "${model}"; supported sizes: ${allowed.join(", ")}.`,
      meta: { allowed: [...allowed], value: size, source: APPENDIX_DOCS_URL },
    });
    return;
  }

  ctx.report({
    code: "invalid_enum_value",
    path: ["size"],
    model,
    message: `\`size\` ${JSON.stringify(size)} is not valid; use "WxH" (e.g. "1024x1024") or "w:h" (e.g. "16:9").`,
    meta: { value: size, violations: ["format"], source: APPENDIX_DOCS_URL },
  });
}

/**
 * Per-model prompt cap (catalog `limit.characters`; appendix "Maximum prompt
 * length"). Reported as `over_output_limit` with a characters-explicit
 * message and meta { limitCharacters, actualCharacters } — there is no
 * character-specific issue code.
 */
function checkPromptLength(
  params: GenerationsParams,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const limit = info?.limit.characters;
  if (limit === undefined) return;
  const actual = params.prompt.length;
  if (actual <= limit) return;
  const model = resolvedModelId(params);
  ctx.report({
    code: "over_output_limit",
    path: ["prompt"],
    model,
    message: `\`prompt\` is ${actual} characters; "${model}" caps the prompt at ${limit} characters.`,
    meta: { limitCharacters: limit, actualCharacters: actual, source: APPENDIX_DOCS_URL },
  });
}

const V3_MODELS = new Set<string>(["recraftv3", "recraftv3_vector"]);

/**
 * `controls` sub-fields: `artistic_level` and `no_text` are V3-only (nested,
 * so the top-level deny table can't express them); the weights across
 * `controls.colors` must not exceed 1.0.
 */
function checkControls(
  params: GenerationsParams,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const controls = params.controls;
  if (controls == null) return;
  const model = resolvedModelId(params);

  if (info !== undefined && !V3_MODELS.has(model)) {
    for (const field of ["artistic_level", "no_text"] as const) {
      if (controls[field] != null) {
        ctx.report({
          code: "unsupported_param",
          path: ["controls", field],
          model,
          message: `\`controls.${field}\` is supported by Recraft V3 models only; "${model}" rejects it.`,
          meta: { source: ENDPOINTS_DOCS_URL },
        });
      }
    }
  }

  if (Array.isArray(controls.colors)) {
    const total = controls.colors.reduce((sum, color) => sum + (color?.weight ?? 0), 0);
    if (total > 1) {
      ctx.report({
        code: "invalid_shape",
        path: ["controls", "colors"],
        message: `the sum of \`weight\` across \`controls.colors\` must not exceed 1.0; got ${total}.`,
        meta: { totalWeight: total, source: ENDPOINTS_DOCS_URL },
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Estimation — billed per generated image (catalog cost.perImage × n).
// ---------------------------------------------------------------------------

function estimate(params: GenerationsParams, info: ModelInfo | undefined, _ctx: PipelineContext) {
  const perImage = info?.cost?.perImage;
  if (perImage === undefined) return {};
  return { costUSD: perImage * (params.n ?? 1) };
}

// ---------------------------------------------------------------------------
// Finalize: wire body + .toSdk("recraft") + .request
// ---------------------------------------------------------------------------

/**
 * The one `.toSdk("recraft")` target for this endpoint — Recraft's
 * documented SDK path is the OpenAI client, whose params are wire-shaped.
 * Derived from the `sdk` literal in `finalize`; it must stay an object type
 * with no index signature, or `toSdk` would accept any string.
 */
type RecraftSdkTargets<B> = { recraft: () => B };

function finalize(params: GenerationsParams): unknown {
  const body = { ...params };
  // Recraft is OpenAI-images-flavored: the official integration path is the
  // OpenAI SDK pointed at baseURL https://external.api.recraft.ai/v1, with
  // non-standard params (style_id, controls, text_layout, ...) passed via
  // `extra_body`. The wire body IS the SDK shape, so toSdk("recraft") returns it
  // unchanged.
  return toValidated(body, {
    url: IMAGES_GENERATIONS_URL,
    method: "POST",
    headers: JSON_HEADERS,
  }, {
    sdk: { recraft: () => body },
  });
}

const validator = createValidator<GenerationsParams, unknown>({
  endpoint: "recraft.image",
  schema: generationsSchema,
  // model is optional on the wire; checks run against the documented
  // server-side default (recraftv4_1) when omitted.
  modelId: resolvedModelId,
  catalog: models,
  familyRules: imageFamilyRules,
  checks: [
    checkResponseFormat,
    checkSpecEnums,
    checkStyleExclusivity,
    checkStyleForModel,
    checkSize,
    checkPromptLength,
    checkControls,
  ],
  estimate,
  finalize,
});

/**
 * Validates raw wire params for Recraft
 * `POST /v1/images/generations`.
 *
 * The returned object's enumerable props are the exact fetch JSON body.
 * `.toSdk("recraft")` returns the body unchanged — Recraft's documented SDK path is
 * the OpenAI SDK with `baseURL: "https://external.api.recraft.ai/v1"` and
 * non-standard params in `extra_body`. Auth is your job: add an
 * `authorization: Bearer <token>` header when fetching.
 *
 * ```ts
 * const params = recraft.image({
 *   prompt: "race car on a track",
 *   model: "recraftv3",
 *   style: "Photorealism",
 *   size: "1820x1024",
 * });
 * const res = await fetch(params.request.url, {
 *   method: params.request.method,
 *   headers: { ...params.request.headers, authorization: `Bearer ${process.env.RECRAFT_API_TOKEN}` },
 *   body: JSON.stringify(params),
 * });
 * ```
 */
export const image = validator as unknown as {
  <M extends RecraftModelInput, T extends GenerationsParams<M>>(
    params: T & GenerationsParams<M> & ExactKeys<T, GenerationsParams>,
    options?: ValidateOptions,
  ): Validated<T, RecraftSdkTargets<T>>;
  safe<M extends RecraftModelInput, T extends GenerationsParams<M>>(
    params: T & GenerationsParams<M> & ExactKeys<T, GenerationsParams>,
    options?: ValidateOptions,
  ): ValidateResult<Validated<T, RecraftSdkTargets<T>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
