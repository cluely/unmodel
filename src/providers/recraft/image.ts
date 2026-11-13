/**
 * Recraft image generation — POST https://external.api.recraft.ai/v1/images/generations
 *
 * Wire notes (ground truth: https://www.recraft.ai/docs/api-reference/endpoints,
 * .../styles, .../pricing and .../appendix, re-verified 2026-11-12; secondary:
 * the docs-generated https://www.recraft.ai/docs/api-reference/openapi.json
 * and the backend https://external.api.recraft.ai/doc/spec/external-api.yaml
 * it is built from):
 * - `image_format` is on the endpoints table ("Must be one of `webp` or
 *   `png`"), and `upscale` is declared on `GenerateImageRequestBase` in both
 *   specs (`UpscaleMode`). Five more params are typed from the internal spec
 *   this module was first written against
 *   (https://external.api.recraft.ai/doc/spec/api/api.yaml, read 2026-08-13;
 *   "404 page not found" on 2026-11-12): `substyle`, `creativity`,
 *   `block_nsfw`, `calculate_features` and `expire`. No current Recraft
 *   source — neither docs page nor either spec — declares them; their
 *   provenance is recorded on the rules that use them.
 * - OpenAI-images-flavored JSON body. Auth is `Authorization: Bearer <token>`
 *   — unmodel never touches keys; add the header yourself when fetching.
 * - `model` defaults to `recraftv4_1` server-side, unless style references
 *   are attached (→ `recraftv4_styles`) or `style` names a V3 / V2 curated
 *   style (→ that model, V3 first); model-dependent checks run against the
 *   resolved default when `model` is omitted.
 * - `response_format` is `url`, `b64_json` or `multipart`. `multipart` answers
 *   with `multipart/form-data` — a `response` JSON part plus one part per
 *   image — which the OpenAI Python library behind `.toSdk("recraft")` cannot
 *   read ("only reads JSON responses, so use `url` or `b64_json` with it").
 * - The current API takes curated style NAMES in `style` (e.g. "Photorealism",
 *   "Vector art") — the old `style`/`substyle` enum pairs are gone from the
 *   docs. Curated styles are V2/V3-only (the V4 line takes custom styles via
 *   `style_id` / style references); the per-model name lists live in
 *   styles.ts and the style ↔ model cross-check reports invalid_enum_value.
 * - `style` and `style_id` cannot be used together (docs: "Specify one or the
 *   other, not both"), and neither can `style_id` and style references.
 * - Style references: `style_reference_urls` (JSON, 1–10 URLs or data URLs)
 *   creates a style for the request, at $0.005 on top of the images. The
 *   multipart counterpart, `style_references`, takes "multipart file parts,
 *   any field name" — this validator emits a JSON body, so it does not model
 *   that form. The V4 Styles line requires `style_id` or references; V4.1
 *   Flash refuses both (constraints.ts).
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
import {
  ASPECT_RATIOS,
  UNATTRIBUTED_SIZE_VALUES,
  V2_V3_SIZES,
  V4_PRO_SIZES,
  V4_STANDARD_SIZES,
  imageFamilyRules,
  isV4StylesModel,
} from "./constraints";
import { STYLE_NAMES_BY_MODEL, type StyleFor } from "./styles";

// Declared in `./constraints` — an import-free leaf — so that `unmodel/recraft/values`
// and the `*-params` table can read these without this validator, its zod schema
// and its catalog. Re-exported here so every existing caller is unchanged.
export {
  ASPECT_RATIOS,
  UNATTRIBUTED_SIZE_VALUES,
  V2_V3_SIZES,
  V4_PRO_SIZES,
  V4_STANDARD_SIZES,
} from "./constraints";

export const IMAGES_GENERATIONS_URL = "https://external.api.recraft.ai/v1/images/generations";

/**
 * Server-side default when `model` is omitted and neither style references
 * nor a V3 / V2 curated `style` pick another —
 * https://www.recraft.ai/docs/api-reference/models/overview (2026-11-12):
 * "When no `model` is specified, Generate image defaults to `recraftv4_1`."
 * Model-dependent checks run against the resolved default.
 */
export const DEFAULT_MODEL_ID = "recraftv4_1";

/**
 * Server-side default when `model` is omitted and `style_reference_urls` are
 * attached — https://www.recraft.ai/docs/api-reference/models/overview
 * (2026-11-12): "a request with attached style references and no `model`
 * defaults to `recraftv4_styles`."
 */
export const DEFAULT_STYLE_REFERENCES_MODEL_ID = "recraftv4_styles";

/**
 * The style-creation charge a request with style references adds — pricing
 * page (2026-11-12): "Generating with style references also creates a style,
 * which adds $0.005 per request." Once per request, not per image.
 */
export const STYLE_CREATION_USD = 0.005;

const ENDPOINTS_DOCS_URL = "https://www.recraft.ai/docs/api-reference/endpoints";
const STYLES_DOCS_URL = "https://www.recraft.ai/docs/api-reference/styles";
const APPENDIX_DOCS_URL = "https://www.recraft.ai/docs/api-reference/appendix";
const V4_STYLES_DOCS_URL = "https://www.recraft.ai/docs/api-reference/models/recraft-v4-styles";

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

/**
 * Explicit WxH sets per raster model; vector models take aspect ratios only.
 * Each `_raster` alias takes its base model's table.
 */
const SIZES_BY_MODEL: Readonly<Record<string, readonly string[]>> = {
  recraftv4_1: V4_STANDARD_SIZES,
  recraftv4_1_raster: V4_STANDARD_SIZES,
  recraftv4_1_utility: V4_STANDARD_SIZES,
  recraftv4_1_utility_raster: V4_STANDARD_SIZES,
  recraftv4_1_flash: V4_STANDARD_SIZES,
  recraftv4_1_flash_raster: V4_STANDARD_SIZES,
  recraftv4: V4_STANDARD_SIZES,
  recraftv4_raster: V4_STANDARD_SIZES,
  recraftv4_styles: V4_STANDARD_SIZES,
  recraftv4_styles_raster: V4_STANDARD_SIZES,
  recraftv4_1_pro: V4_PRO_SIZES,
  recraftv4_1_pro_raster: V4_PRO_SIZES,
  recraftv4_1_utility_pro: V4_PRO_SIZES,
  recraftv4_1_utility_pro_raster: V4_PRO_SIZES,
  recraftv4_pro: V4_PRO_SIZES,
  recraftv4_pro_raster: V4_PRO_SIZES,
  recraftv4_styles_pro: V4_PRO_SIZES,
  recraftv4_styles_pro_raster: V4_PRO_SIZES,
  recraftv2: V2_V3_SIZES,
  recraftv2_raster: V2_V3_SIZES,
  recraftv3: V2_V3_SIZES,
  recraftv3_raster: V2_V3_SIZES,
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
 * `substyle` values. No current Recraft source documents `substyle`; these
 * are the style suffixes of the `ImageType` enum in the internal spec read on
 * 2026-08-13 (`digital_illustration_pixel_art` → `pixel_art`), which is where
 * the pairs `style` + `substyle` come from — see `INTERNAL_SPEC_SOURCE`.
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

/**
 * `image_format` values — endpoints doc (2026-11-12): "The file format of the
 * returned raster images. Must be one of `webp` or `png`" (OpenAPI
 * `ImageFormat`). No jpeg.
 */
export const IMAGE_FORMATS = ["webp", "png"] as const;
export type RecraftImageFormat = (typeof IMAGE_FORMATS)[number];

/**
 * `style_match` values — endpoints doc (2026-11-12): "Must be one of
 * `regular`, `precise`, `flexible`." (the OpenAPI `StyleMatch` enum). Which
 * of them a model takes is per family — `regular` on V2/V3, `flexible` /
 * `precise` on the V4 line, none on V4.1 Flash — and lives on the family
 * rules in constraints.ts.
 */
export const STYLE_MATCHES = ["regular", "precise", "flexible"] as const;
export type RecraftStyleMatch = (typeof STYLE_MATCHES)[number];

/**
 * `upscale` values — the `UpscaleMode` enum (`upscale4mp`, `upscale16mp`) that
 * types `upscale` on `GenerateImageRequestBase` in both openapi.json and
 * external-api.yaml (2026-11-12). No docs page describes the param.
 */
export const UPSCALE_MODES = ["upscale4mp", "upscale16mp"] as const;
export type RecraftUpscaleMode = (typeof UPSCALE_MODES)[number];

/**
 * `creativity` values — a named tier, not a number. No source Recraft
 * publishes today declares it (see `LEGACY_SPEC_SOURCE`).
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
 * itself completing nothing (measured: every id → 1).
 *
 * `M` defaults to the whole `RecraftModelInput` union, so the plain
 * `GenerationsParams` type is byte-for-byte what it was: `model` completes
 * every cataloged id and `style` the pooled 111 with its open tail. That
 * default is also the degraded arm — `model` omitted, `null`, runtime-built,
 * or an id with no style table — which keeps JS-shaped and future ids callable.
 */
export interface GenerationsParams<M extends RecraftModelInput = RecraftModelInput> {
  /** Text description of the desired image(s). Max length is per-model (see models.ts). */
  prompt: string;
  /** Number of images, 1–6. Default 1. Billed per image. */
  n?: number | null;
  /**
   * Defaults to "recraftv4_1" server-side — "recraftv4_styles" when
   * `style_reference_urls` are attached, or the V3 / V2 model whose curated
   * list holds `style`.
   */
  model?: M | null;
  /** Curated style name (V2/V3 models only). Cannot be combined with style_id. */
  style?: StyleFor<M> | null;
  /**
   * Style sub-variant (undocumented; see SUBSTYLES); pairs with `style`.
   *
   * Closed, unlike the neighbouring `style` and `size`: `checkSpecEnums`
   * refuses an off-list value with `invalid_enum_value` at error severity
   * (`SPEC_ENUM_CHECKS` below names this param and this exact list), so an open
   * tail here bought nothing except turning a compile error into a call-time
   * one. The same reasoning closes `creativity`, `image_format` and `upscale`.
   */
  substyle?: RecraftSubstyle | null;
  /**
   * Style UUID used as a visual reference — every model except V4.1 Flash;
   * the V4 Styles line requires it unless `style_reference_urls` are
   * attached. Cannot be combined with `style` or with `style_reference_urls`.
   */
  style_id?: string | null;
  /**
   * 1–10 URLs or data URLs of style reference images (PNG, JPG, WEBP; 64 MB
   * in total). The server creates a style from them for this request —
   * $0.005 on top of the images — and returns its `style_id`. Every model
   * except V4.1 Flash; cannot be combined with `style_id`.
   */
  style_reference_urls?: string[] | null;
  /**
   * How closely the images match the style: `regular` on V2/V3, `flexible`
   * (default) or `precise` on the V4 line; refused on V4.1 Flash.
   */
  style_match?: RecraftStyleMatch | null;
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
  /**
   * "url" (default), "b64_json" or "multipart" — the last answers with
   * `multipart/form-data`, which the OpenAI SDK path cannot read.
   */
  response_format?: "url" | "b64_json" | "multipart" | null;
  /** Spatial/textual attributes for text elements (V3 models only). */
  text_layout?: RecraftTextLayoutElement[] | null;
  /** Generation tweaks; artistic_level / no_text are V3-only. */
  controls?: RecraftControls | null;
  /**
   * Creativity tier: "simple" | "standard" | "eccentric" (undocumented param).
   *
   * Closed against `CREATIVITY_LEVELS` — see `substyle`. The list comes from an
   * earlier revision of the internal spec (`LEGACY_SPEC_SOURCE`), which is an
   * argument for loosening BOTH layers, not for letting the type accept what
   * `checkSpecEnums` then refuses.
   */
  creativity?: RecraftCreativity | null;
  /** Raster output container: "webp" (default) or "png"; ignored for vector output. Closed — see `substyle`. */
  image_format?: RecraftImageFormat | null;
  /** Post-generation upscale tier (OpenAPI `UpscaleMode`). Closed — see `substyle`. */
  upscale?: RecraftUpscaleMode | null;
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
  style_reference_urls: z
    .array(z.string())
    .min(1, "style_reference_urls must hold 1 to 10 image URLs or data URLs")
    .max(10, "style_reference_urls must hold 1 to 10 image URLs or data URLs")
    .nullable()
    .optional(),
  style_match: z.string().nullable().optional(),
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

/**
 * Endpoints doc (2026-11-12): "Must be one of `url`, `b64_json` or
 * `multipart`" (OpenAPI `ResponseFormat`).
 */
const RESPONSE_FORMATS = ["url", "b64_json", "multipart"] as const;
const ASPECT_RATIO_SET = new Set<string>(ASPECT_RATIOS);

/**
 * The models a curated `style` resolves to when `model` is omitted, in the
 * server's order — styles doc (2026-11-12): "If a style name is supported by
 * multiple models, the API defaults to Recraft V3 (if supported, to Recraft
 * V2 otherwise)."; V3 page: "Without it the API uses `recraftv4_1`, unless
 * `style` names a V3 style." The raster and vector lists are disjoint within
 * each generation, so the first list holding the name is the model.
 */
const STYLE_DEFAULT_MODELS = ["recraftv3", "recraftv3_vector", "recraftv2", "recraftv2_vector"] as const;

function resolvedModelId(params: GenerationsParams): string {
  if (params.model != null) return params.model;
  if (params.style_reference_urls != null) return DEFAULT_STYLE_REFERENCES_MODEL_ID;
  const style = params.style;
  if (style != null) {
    const styled = STYLE_DEFAULT_MODELS.find((id) => STYLE_NAMES[id]?.includes(style));
    if (styled !== undefined) return styled;
  }
  return DEFAULT_MODEL_ID;
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
    message: `\`response_format\` must be one of "url", "b64_json", "multipart"; got ${JSON.stringify(format)}.`,
    meta: { allowed: [...RESPONSE_FORMATS], value: format, source: ENDPOINTS_DOCS_URL },
  });
}

/** The docs-generated OpenAPI — the current spec for this endpoint's request body. */
const OPENAPI_URL = "https://www.recraft.ai/docs/api-reference/openapi.json";
/**
 * The internal backend spec two of the lists below were read from on
 * 2026-08-13. It answers "404 page not found" as of 2026-11-12, and neither
 * current spec nor any docs page declares these params.
 */
const INTERNAL_SPEC_URL = "https://external.api.recraft.ai/doc/spec/api/api.yaml";
const INTERNAL_SPEC_SOURCE = `${INTERNAL_SPEC_URL} (\`ImageType\` enum suffixes, read 2026-08-13; the document is 404 and no current Recraft source declares \`substyle\`, 2026-11-12)`;
/** Enum values kept from an earlier revision of the internal spec; unverifiable today. */
const LEGACY_SPEC_SOURCE = `${INTERNAL_SPEC_URL} (earlier revision — no current Recraft source declares this param, 2026-11-12)`;

/**
 * Enum params outside the docs' style vocabulary. A bad value reports
 * `invalid_enum_value` instead of silently reaching the API; each rule
 * carries the source its value list actually came from.
 */
const SPEC_ENUM_CHECKS: ReadonlyArray<{
  param: "substyle" | "creativity" | "image_format" | "upscale";
  allowed: readonly string[];
  source: string;
}> = [
  { param: "substyle", allowed: SUBSTYLES, source: INTERNAL_SPEC_SOURCE },
  { param: "creativity", allowed: CREATIVITY_LEVELS, source: LEGACY_SPEC_SOURCE },
  { param: "image_format", allowed: IMAGE_FORMATS, source: ENDPOINTS_DOCS_URL },
  { param: "upscale", allowed: UPSCALE_MODES, source: `${OPENAPI_URL} (\`UpscaleMode\` enum)` },
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

/**
 * `style` and `style_id` cannot be used together, and neither can `style_id`
 * and style references — styles doc (2026-11-12): "The two are mutually
 * exclusive: a request with both a `style_id` and style references is
 * rejected."
 */
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
  if (params.style_id != null && params.style_reference_urls != null) {
    ctx.report({
      code: "invalid_shape",
      path: ["style_reference_urls"],
      message:
        "`style_id` and `style_reference_urls` cannot be used together; pass the saved style or the reference images, not both.",
      meta: { source: STYLES_DOCS_URL },
    });
  }
}

/**
 * The V4 Styles line needs a style — model page (2026-11-12): "V4 Styles
 * models **always** require a style: pass `style_reference_urls` (or uploaded
 * `style_references`) or a `style_id`. A request with neither is rejected."
 * The multipart `style_references` form is not one this JSON validator emits,
 * so the two spellings it can carry are the ones the message names.
 */
function checkV4StylesStyle(
  params: GenerationsParams,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (info === undefined) return;
  const model = resolvedModelId(params);
  if (!isV4StylesModel(model)) return;
  if (params.style_id != null || params.style_reference_urls != null) return;
  ctx.report({
    code: "invalid_shape",
    path: ["style_id"],
    model,
    message: `"${model}" always requires a style: pass \`style_id\` (a style from an earlier response or from POST /v1/styles) or \`style_reference_urls\` (1 to 10 reference image URLs or data URLs).`,
    meta: { source: V4_STYLES_DOCS_URL },
  });
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

const V3_MODELS = new Set<string>(["recraftv3", "recraftv3_raster", "recraftv3_vector"]);

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
// Estimation — billed per generated image (catalog cost.perImage × n), plus
// STYLE_CREATION_USD once when style references create a style.
// ---------------------------------------------------------------------------

function estimate(params: GenerationsParams, info: ModelInfo | undefined, _ctx: PipelineContext) {
  const perImage = info?.cost?.perImage;
  if (perImage === undefined) return {};
  const styleCreation = params.style_reference_urls != null ? STYLE_CREATION_USD : 0;
  return { costUSD: perImage * (params.n ?? 1) + styleCreation };
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
    checkV4StylesStyle,
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
    options?: ValidateOptions<T>,
  ): Validated<T, RecraftSdkTargets<T>>;
  safe<M extends RecraftModelInput, T extends GenerationsParams<M>>(
    params: T & GenerationsParams<M> & ExactKeys<T, GenerationsParams>,
    options?: ValidateOptions<T>,
  ): ValidateResult<Validated<T, RecraftSdkTargets<T>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
