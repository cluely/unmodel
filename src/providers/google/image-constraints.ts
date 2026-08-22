/**
 * Imagen's and Gemini image generation's value spaces, on an **import-free**
 * leaf.
 *
 * The same reason `./tts-constraints.ts` and `./audio-constraints.ts` exist:
 * `./constraints.ts` value-imports `src/catalog/google.gen.ts` and the Veo
 * table, so anything that reaches for one aspect-ratio list through it pays
 * ~24 KiB of generated rows for five strings. `unmodel/google/values` and
 * `./image-params.ts` read them from here; `./constraints.ts` re-exports every
 * name so the wire modules and their tests are unchanged.
 */

/**
 * Every aspect ratio the REST reference's `ImageConfig.aspectRatio` documents.
 * WIDENED vs the SDK: @google/genai@2.17.0's `ImageConfig.aspectRatio`
 * docstring lists only 1:1, 2:3, 3:2, 3:4, 4:3, 9:16, 16:9 and 21:9 — it is
 * missing the documented 1:4, 4:1, 1:8, 8:1, 4:5 and 5:4.
 * Source: GENERATE_CONTENT_API_DOCS_URL (ImageConfig).
 */
export const GEMINI_IMAGE_ASPECT_RATIOS = [
  "1:1",
  "1:4",
  "4:1",
  "1:8",
  "8:1",
  "2:3",
  "3:2",
  "3:4",
  "4:3",
  "4:5",
  "5:4",
  "9:16",
  "16:9",
  "21:9",
] as const;

/**
 * Every size the REST reference's `ImageConfig.imageSize` documents
 * ("Supported values are 512, 1K, 2K, 4K"). WIDENED vs the SDK, whose
 * docstring omits "512". Source: GENERATE_CONTENT_API_DOCS_URL (ImageConfig).
 */
export const GEMINI_IMAGE_SIZES = ["512", "1K", "2K", "4K"] as const;

// ---------------------------------------------------------------------------
// Imagen (image / models.{model}:predict) constraints.
//
// NOTE: like the Veo tables below, these deny/enum entries target keys of the
// nested `parameters` wire object, so ./image applies them in a
// dedicated check rather than through the pipeline's Layer-3 pass.
// ---------------------------------------------------------------------------

/** Imagen docs backing every Imagen constraint below. */
export const IMAGEN_DOCS_URL = "https://ai.google.dev/gemini-api/docs/imagen";

/** "aspectRatio … Supported values are "1:1", "3:4", "4:3", "9:16", and "16:9"." */
export const IMAGEN_ASPECT_RATIOS = ["1:1", "3:4", "4:3", "9:16", "16:9"] as const;

/** "imageSize … The supported values are 1K and 2K." (wire key: sampleImageSize) */
export const IMAGEN_IMAGE_SIZES = ["1K", "2K"] as const;

/**
 * "personGeneration … dont_allow / allow_adult (default) / allow_all".
 * The SCREAMING_CASE spellings are accepted too: @google/genai's
 * `PersonGeneration` enum is DONT_ALLOW/ALLOW_ADULT/ALLOW_ALL and its mldev
 * converter forwards the value to `parameters.personGeneration` verbatim, so
 * both first-party spellings reach the same wire field.
 */
export const IMAGEN_PERSON_GENERATION = [
  "dont_allow",
  "allow_adult",
  "allow_all",
  "DONT_ALLOW",
  "ALLOW_ADULT",
  "ALLOW_ALL",
] as const;

/** "numberOfImages: The number of images to generate, from 1 to 4 (inclusive)." */
export const IMAGEN_SAMPLE_COUNTS = [1, 2, 3, 4] as const;

/** "Note: Maximum prompt length is 480 tokens." */
export const IMAGEN_MAX_PROMPT_TOKENS = 480;
