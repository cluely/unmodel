/**
 * Curated style names per Recraft model, from the "List of Styles" section of
 * https://www.recraft.ai/docs/api-reference/styles (verified 2026-08-13).
 *
 * The current Recraft API takes a curated style NAME in the `style` param
 * (e.g. "Photorealism", "Vector art") — the old `style`/`substyle` enum pairs
 * (realistic_image / digital_illustration / ...) are gone from the docs.
 * Styles are only supported by V2 / V3 models ("Styles are not yet supported
 * for V4 models"), which the constraint table enforces; this module carries
 * the per-model name lists for the style ↔ model cross-check.
 *
 * "Recraft V3 Raw" is absent from the categorized list but is documented as
 * Recraft V3's default style and as a valid `style` value in the same doc's
 * "Using of styles" section, so it is included for recraftv3.
 */

export const RECRAFT_V3_STYLES = [
  "Recraft V3 Raw",
  // Photorealistic styles
  "Photorealism",
  "Enterprise",
  "Natural light",
  "Studio photo",
  "HDR",
  "Hard flash",
  "Motion blur",
  "Black & white",
  "Evening light",
  "Faded Nostalgia",
  "Forest life",
  "Mystic Naturalism",
  "Natural Tones",
  "Organic Calm",
  "Real-Life Glow",
  "Retro Realism",
  "Retro Snapshot",
  "Urban Drama",
  "Village Realism",
  "Warm Folk",
  "Product photo",
  // Illustration styles
  "Illustration",
  "Hand-drawn",
  "Grain",
  "Bold Sketch",
  "Pencil sketch",
  "Retro Pop",
  "Clay",
  "Risograph",
  "Color engraving",
  "Pixel art",
  "Antiquarian",
  "Bold fantasy",
  "Child book",
  "Cover",
  "Crosshatch",
  "Digital engraving",
  "Expressionism",
  "Freehand details",
  "Grain 2.0",
  "Graphic intensity",
  "Hard Comics",
  "Long shadow",
  "Modern Folk",
  "Multicolor",
  "Neon Calm",
  "Noir",
  "Nostalgic pastel",
  "Outline details",
  "Pastel gradient",
  "Pastel sketch",
  "Pop art",
  "Pop renaissance",
  "Street art",
  "Tablet sketch",
  "Urban Glow",
  "Urban sketching",
  "Young adult book",
  "Young adult book 2",
  "Seamless Digital",
  // Emblem styles
  "Prestige Emblem",
  "Pop Graphic",
  "Stamp",
  "Punk Graphic",
  "Vintage Emblem",
] as const;

export const RECRAFT_V3_VECTOR_STYLES = [
  "Vector art",
  "Line art",
  "Linocut",
  "Color blobs",
  "Engraving",
  "Bold stroke",
  "Chemistry",
  "Colored stencil",
  "Cosmics",
  "Cutout",
  "Depressive",
  "Editorial",
  "Emotional flat",
  "Marker outline",
  "Mosaic",
  "Naivector",
  "Roundish flat",
  "Segmented Colors",
  "Sharp contrast",
  "Thin",
  "Vector Photo",
  "Vivid shapes",
  "Seamless Vector",
] as const;

export const RECRAFT_V2_STYLES = [
  // Photorealistic styles
  "Photorealism",
  "Enterprise",
  "Natural light",
  "Studio photo",
  "HDR",
  "Hard flash",
  "Motion blur",
  "Black & white",
  "Product photo",
  // Illustration styles
  "Illustration",
  "3D render",
  "Glow",
  "Watercolor",
  "Hand-drawn",
  "Kawaii",
  "Grain",
  "Bold Sketch",
  "Pencil sketch",
  "Retro Pop",
  "Clay",
  "Risograph",
  "Psychedelic",
  "Seamless Digital",
  "Color engraving",
  "Pixel art",
  "80's",
  "Voxel art",
] as const;

export const RECRAFT_V2_VECTOR_STYLES = [
  // Vector styles
  "Vector art",
  "Line art",
  "Linocut",
  "Cartoon",
  "Flat 2.0",
  "Color blobs",
  "Vector Kawaii",
  "Doodle Line art",
  "Seamless Vector",
  "Engraving",
  // Icon styles
  "Icon",
  "Outline",
  "Pictogram",
  "Colored outline",
  "Doodle",
  "Colored shape",
  "Gradient outline",
  "Offset doodle",
  "Gradient shape",
  "Broken line",
  "Offset fill",
] as const;

/** Any curated style name unmodel knows, across all V2/V3 models. */
export type RecraftStyleName =
  | (typeof RECRAFT_V3_STYLES)[number]
  | (typeof RECRAFT_V3_VECTOR_STYLES)[number]
  | (typeof RECRAFT_V2_STYLES)[number]
  | (typeof RECRAFT_V2_VECTOR_STYLES)[number];

/**
 * Curated style names keyed by the model ids that support styles at all.
 * Models absent from this map (the whole V4/V4.1 line) reject `style`, which
 * the constraint table reports as unsupported_param.
 *
 * `as const satisfies` rather than a `: Readonly<Record<string, readonly
 * string[]>>` ANNOTATION: the annotation still holds (via `satisfies`, so a
 * malformed entry is still a compile error) but it no longer erases the key
 * union and the value literals, which is what makes this table usable as the
 * type source for `StyleFor<M>`. The two runtime lookups that index it with a
 * resolved `string` model id do the widening locally — see the `STYLE_NAMES`
 * aliases in image.ts / image-edit.ts.
 */
export const STYLE_NAMES_BY_MODEL = {
  recraftv3: RECRAFT_V3_STYLES,
  recraftv3_vector: RECRAFT_V3_VECTOR_STYLES,
  recraftv2: RECRAFT_V2_STYLES,
  recraftv2_vector: RECRAFT_V2_VECTOR_STYLES,
} as const satisfies Readonly<Record<string, readonly string[]>>;

/** The model ids that carry a curated style list. */
export type RecraftStyledModelId = keyof typeof STYLE_NAMES_BY_MODEL;

/**
 * The curated style names the model id `M` actually accepts — the type-level
 * half of `checkStyleForModel`, keyed off the same table the runtime check
 * reads. A style valid for a *different* model no longer compiles, instead of
 * compiling and then failing validation with `invalid_enum_value`.
 *
 * Model ids outside the table degrade to the pooled union plus the open tail:
 * an unknown/future id, a runtime-built `string`, and `model` omitted (M falls
 * back to its `string` constraint) all keep completing every name and stay
 * callable, mirroring the degraded arm the size/model unions already carry.
 */
export type StyleFor<M extends string> = M extends RecraftStyledModelId
  ? (typeof STYLE_NAMES_BY_MODEL)[M][number]
  : RecraftStyleName | (string & {});
