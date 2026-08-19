import type { EndpointConstraints, FamilyRule } from "../../core/constraint-types";
import type { ModelInfo } from "../../core/catalog-types";
import { models } from "../../catalog/google.gen";
import { generateVideosModels } from "./veo-models";

const catalog: Record<string, ModelInfo> = models;

/** Docs backing each media rule; attached as `meta.source` on media issues. */
export const GOOGLE_MEDIA_DOC_URLS = {
  image: "https://ai.google.dev/gemini-api/docs/image-understanding",
  audio: "https://ai.google.dev/gemini-api/docs/audio",
  video: "https://ai.google.dev/gemini-api/docs/video-understanding",
} as const;

/**
 * Inline media rides in the JSON body, and Google caps the TOTAL request
 * (prompts + all inline bytes) at 100MB — so any single inline part over
 * 100MB is certainly over. Sources:
 * - https://ai.google.dev/gemini-api/docs/files ("Always use the Files API
 *   when the total request size ... is larger than 100 MB")
 * - https://ai.google.dev/gemini-api/docs/file-input-methods ("100 MB per
 *   request or payload (50 MB for PDFs)")
 * NOTE: the audio page (GOOGLE_MEDIA_DOC_URLS.audio) still says 20MB —
 * Google's docs conflict; we chose the permissive bound to avoid false
 * positives. The API is the final arbiter.
 */
export const INLINE_MEDIA_MAX_BYTES = 100 * 1024 * 1024;

/**
 * PDFs have a stricter inline/request cap than other media: "For PDF files,
 * the limit is 50 MB." Sources: same two pages as INLINE_MEDIA_MAX_BYTES.
 */
export const INLINE_PDF_MAX_BYTES = 50 * 1024 * 1024;

/**
 * "258 tokens if both dimensions <= 384 pixels. Larger images are tiled …
 * each costing 258 tokens." We estimate one tile per image (lower bound).
 * Source: GOOGLE_MEDIA_DOC_URLS.image
 */
export const GEMINI_IMAGE_TOKENS = 258;

/** "Max length: 9.5 hours of audio per prompt." Source: GOOGLE_MEDIA_DOC_URLS.audio */
export const GEMINI_AUDIO_MAX_DURATION_SECONDS = 9.5 * 3600;

/**
 * "Models with a 1M context window can process videos up to 1 hour long at
 * default media resolution." Source: GOOGLE_MEDIA_DOC_URLS.video
 */
export const GEMINI_1M_VIDEO_MAX_DURATION_SECONDS = 3600;

/**
 * Documented image MIME subtypes. The image-understanding page
 * (GOOGLE_MEDIA_DOC_URLS.image) lists only png/jpeg/webp/heic/heif, but the
 * current REST reference's `Blob.mimeType` docs additionally list image/gif
 * and image/avif (https://ai.google.dev/api/caching#Blob) — the pages
 * conflict; we allow the permissive superset to avoid false positives.
 * NOTE: sniffImage cannot sniff avif, so format enforcement for avif only
 * applies via the declared MIME type.
 */
export const GEMINI_IMAGE_FORMATS = ["png", "jpeg", "webp", "heic", "heif", "gif", "avif"] as const;

/**
 * Documented audio MIME subtypes (wav, mp3, aiff, aac, ogg, flac);
 * "mpeg" added because MP3 files are conventionally sent as audio/mpeg.
 * Source: GOOGLE_MEDIA_DOC_URLS.audio
 */
export const GEMINI_AUDIO_FORMATS = ["wav", "mp3", "mpeg", "aiff", "aac", "ogg", "flac"] as const;

/**
 * Documented video MIME subtypes; "quicktime" added because .mov files are
 * conventionally sent as video/quicktime. Source: GOOGLE_MEDIA_DOC_URLS.video
 */
export const GEMINI_VIDEO_FORMATS = [
  "mp4",
  "mpeg",
  "mov",
  "quicktime",
  "avi",
  "x-flv",
  "mpg",
  "webm",
  "wmv",
  "3gpp",
] as const;

/**
 * Per-model constraint table. Empty today: everything Google documents for
 * generateContent is family-wide (see the rules below), and per-model video
 * duration limits are only published in terms of context-window size.
 *
 * NOTE: the image/speech/generationConfig rules below are NOT expressed here
 * because they all target keys nested under `generationConfig`, which the
 * pipeline's generic Layer-3 pass (top-level keys only) never sees — they are
 * applied by dedicated checks in ./generate-content.
 */
export const generateContentConstraints: Readonly<Partial<Record<string, EndpointConstraints>>> = {};

// ---------------------------------------------------------------------------
// generationConfig — documented numeric ranges and enums.
//
// Source: the REST reference's GenerationConfig message
// (GENERATE_CONTENT_API_DOCS_URL). Only bounds the docs actually STATE are
// encoded; topP / topK / presencePenalty / frequencyPenalty / candidateCount
// carry no documented range ("the default value varies by model"), so they
// stay permissive.
// ---------------------------------------------------------------------------

/** REST reference for generateContent (GenerationConfig, SpeechConfig, ImageConfig, …). */
export const GENERATE_CONTENT_API_DOCS_URL = "https://ai.google.dev/api/generate-content";

/** "Values can range from [0.0, 2.0]." — GenerationConfig.temperature */
export const GEMINI_TEMPERATURE_RANGE = { min: 0, max: 2 } as const;

/** "The number must be in the range of [0, 20]." — GenerationConfig.logprobs */
export const GEMINI_LOGPROBS_RANGE = { min: 0, max: 20 } as const;

/** "The set of character sequences (up to 5) that will stop output generation." */
export const GEMINI_MAX_STOP_SEQUENCES = 5;

/**
 * `enum (Modality)` minus MODALITY_UNSPECIFIED. The guides' REST samples also
 * send mixed case ("Image", "Text"), so the check compares case-insensitively.
 */
export const GEMINI_RESPONSE_MODALITIES = ["TEXT", "IMAGE", "AUDIO"] as const;

/**
 * `enum (ThinkingLevel)`. "Recommended for Gemini 3 or later models. Use with
 * earlier models results in an error."
 */
export const GEMINI_THINKING_LEVELS = [
  "THINKING_LEVEL_UNSPECIFIED",
  "MINIMAL",
  "LOW",
  "MEDIUM",
  "HIGH",
] as const;

/** `enum (MediaResolution)`. */
export const GEMINI_MEDIA_RESOLUTIONS = [
  "MEDIA_RESOLUTION_UNSPECIFIED",
  "MEDIA_RESOLUTION_LOW",
  "MEDIA_RESOLUTION_MEDIUM",
  "MEDIA_RESOLUTION_HIGH",
] as const;

// ---------------------------------------------------------------------------
// Gemini native image generation (Nano Banana) — generateContent with
// responseModalities IMAGE plus generationConfig.imageConfig (equivalently
// generationConfig.responseFormat.image).
// ---------------------------------------------------------------------------

/** The generateContent image-generation guide (model tables + REST samples). */
export const GEMINI_IMAGE_GENERATION_DOCS_URL =
  "https://ai.google.dev/gemini-api/docs/generate-content/image-generation";

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

/**
 * proto-JSON enum names for the SAME values under
 * `generationConfig.responseFormat.image`, whose `aspectRatio` / `imageSize`
 * the REST reference types as `enum (AspectRatio)` / `enum (ImageSize)` even
 * though the guide's REST samples pass the plain "16:9" / "2K" spellings.
 * The pages conflict, so both spellings validate.
 * Source: GENERATE_CONTENT_API_DOCS_URL (AspectRatio / ImageSize enums).
 */
export const GEMINI_IMAGE_ASPECT_RATIO_ENUM_NAMES: Readonly<Record<string, string>> = {
  "1:1": "ASPECT_RATIO_ONE_BY_ONE",
  "1:4": "ASPECT_RATIO_ONE_BY_FOUR",
  "4:1": "ASPECT_RATIO_FOUR_BY_ONE",
  "1:8": "ASPECT_RATIO_ONE_BY_EIGHT",
  "8:1": "ASPECT_RATIO_EIGHT_BY_ONE",
  "2:3": "ASPECT_RATIO_TWO_BY_THREE",
  "3:2": "ASPECT_RATIO_THREE_BY_TWO",
  "3:4": "ASPECT_RATIO_THREE_BY_FOUR",
  "4:3": "ASPECT_RATIO_FOUR_BY_THREE",
  "4:5": "ASPECT_RATIO_FOUR_BY_FIVE",
  "5:4": "ASPECT_RATIO_FIVE_BY_FOUR",
  "9:16": "ASPECT_RATIO_NINE_BY_SIXTEEN",
  "16:9": "ASPECT_RATIO_SIXTEEN_BY_NINE",
  "21:9": "ASPECT_RATIO_TWENTY_ONE_BY_NINE",
};

/** proto-JSON enum names for `responseFormat.image.imageSize`. */
export const GEMINI_IMAGE_SIZE_ENUM_NAMES: Readonly<Record<string, string>> = {
  "512": "IMAGE_SIZE_FIVE_TWELVE",
  "1K": "IMAGE_SIZE_ONE_K",
  "2K": "IMAGE_SIZE_TWO_K",
  "4K": "IMAGE_SIZE_FOUR_K",
};

/** Per-model image-generation capability, from the guide's resolution tables. */
export interface GeminiImageRule {
  /** Aspect ratios the model's table lists. */
  aspectRatios: readonly string[];
  /**
   * Image sizes the model's table lists. `undefined` means the model has a
   * single fixed output resolution and takes no `imageSize` at all.
   */
  imageSizes?: readonly string[];
}

/** Ratios shared by Nano Banana Pro / Nano Banana (their tables omit the 1:4/4:1/1:8/8:1 extremes). */
const GEMINI_IMAGE_CORE_RATIOS = [
  "1:1",
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
 * Per-model aspect-ratio / image-size tables, transcribed from the
 * "Aspect ratios and image size" tables on GEMINI_IMAGE_GENERATION_DOCS_URL:
 *
 * - 3.1 Flash Image: all 14 ratios, 512/1K/2K/4K.
 * - 3.1 Flash Lite Image: all 14 ratios, 512/1K only (no 2K/4K columns).
 * - 3 Pro Image: 10 ratios, 1K/2K/4K (no 512 column). NOTE: that table is
 *   headed "3.1 Pro Image" while the page's Model IDs and Model selection
 *   sections both name only `gemini-3-pro-image` ("can generate images of up
 *   to 4K resolutions") — read as a heading typo for the one Pro image model
 *   the Gemini API documents.
 * - 2.5 Flash Image: 10 ratios, single fixed resolution — its table has no
 *   size columns and the guide's REST sample for it passes aspectRatio only,
 *   so `imageSize` is denied for it.
 *
 * `-preview` ids share their GA sibling's table (the docs list only the GA id).
 */
export const GEMINI_IMAGE_MODEL_RULES: Readonly<Partial<Record<string, GeminiImageRule>>> = {
  "gemini-3.1-flash-image": {
    aspectRatios: GEMINI_IMAGE_ASPECT_RATIOS,
    imageSizes: GEMINI_IMAGE_SIZES,
  },
  "gemini-3.1-flash-image-preview": {
    aspectRatios: GEMINI_IMAGE_ASPECT_RATIOS,
    imageSizes: GEMINI_IMAGE_SIZES,
  },
  "gemini-3.1-flash-lite-image": {
    aspectRatios: GEMINI_IMAGE_ASPECT_RATIOS,
    imageSizes: ["512", "1K"],
  },
  "gemini-3-pro-image": {
    aspectRatios: GEMINI_IMAGE_CORE_RATIOS,
    imageSizes: ["1K", "2K", "4K"],
  },
  "gemini-3-pro-image-preview": {
    aspectRatios: GEMINI_IMAGE_CORE_RATIOS,
    imageSizes: ["1K", "2K", "4K"],
  },
  "gemini-2.5-flash-image": { aspectRatios: GEMINI_IMAGE_CORE_RATIOS },
};

/**
 * `imageConfig` keys @google/genai@2.17.0 itself documents as "This field is
 * not supported in Gemini API", and which the REST reference's ImageConfig
 * message (aspectRatio + imageSize only) likewise omits.
 * Sources: GENERATE_CONTENT_API_DOCS_URL (ImageConfig) and the SDK docstrings.
 */
export const GEMINI_IMAGE_CONFIG_VERTEX_ONLY_KEYS = [
  "outputMimeType",
  "outputCompressionQuality",
  "imageOutputOptions",
  "prominentPeople",
] as const;

// ---------------------------------------------------------------------------
// Gemini TTS (generateContent with responseModalities AUDIO + speechConfig).
// ---------------------------------------------------------------------------

/** The generateContent speech-generation guide (voices, limits, REST samples). */
export const GEMINI_TTS_DOCS_URL =
  "https://ai.google.dev/gemini-api/docs/generate-content/speech-generation";

/** The three TTS model ids on the guide's "Supported models" table. */
export const GEMINI_TTS_MODEL_IDS = [
  "gemini-3.1-flash-tts-preview",
  "gemini-2.5-flash-preview-tts",
  "gemini-2.5-pro-preview-tts",
] as const;

/** "TTS models support the following 30 voice options in the voice_name field". */
export const GEMINI_TTS_VOICES = [
  "Zephyr",
  "Puck",
  "Charon",
  "Kore",
  "Fenrir",
  "Leda",
  "Orus",
  "Aoede",
  "Callirrhoe",
  "Autonoe",
  "Enceladus",
  "Iapetus",
  "Umbriel",
  "Algieba",
  "Despina",
  "Erinome",
  "Algenib",
  "Rasalgethi",
  "Laomedeia",
  "Achernar",
  "Alnilam",
  "Schedar",
  "Gacrux",
  "Pulcherrima",
  "Achird",
  "Zubenelgenubi",
  "Vindemiatrix",
  "Sadachbia",
  "Sadaltager",
  "Sulafat",
] as const;

/** "you'll need a multiSpeakerVoiceConfig object with each speaker (up to 2)". */
export const GEMINI_TTS_MAX_SPEAKERS = 2;

/**
 * "A TTS session has a context window limit of 32k tokens." models.dev
 * carries 8192 for these ids; the docs win — see ./tts-models.
 */
export const GEMINI_TTS_CONTEXT_TOKENS = 32768;

/**
 * "TTS does not support streaming for models older than version 3.1
 * (streaming is supported for gemini-3.1-flash-tts-preview and newer)."
 * Consumers building `:streamGenerateContent` URLs can gate on this set;
 * unmodel only validates the unary route, so it is informational.
 */
export const GEMINI_TTS_STREAMING_MODEL_IDS = ["gemini-3.1-flash-tts-preview"] as const;

// ---------------------------------------------------------------------------
// Imagen (generateImages / models.{model}:predict) constraints.
//
// NOTE: like the Veo tables below, these deny/enum entries target keys of the
// nested `parameters` wire object, so ./generate-images applies them in a
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

/**
 * `parameters` keys that exist on Vertex AI but have NO Gemini API wire form:
 * @google/genai@2.17.0's mldev converter throws client-side
 * ("<param> parameter is only supported in Gemini Enterprise Agent Platform
 * mode, not in Gemini Developer API mode") for each of them, and the Imagen
 * guide's parameter list omits them all.
 * Sources: IMAGEN_DOCS_URL + the SDK's generateImagesConfigToMldev converter.
 */
const IMAGEN_VERTEX_ONLY_DENY: Record<string, { reason: string; source: string }> = {
  storageUri: {
    reason:
      "`storageUri` (SDK outputGcsUri) is Vertex AI-only; the Gemini API has no Cloud Storage output.",
    source: IMAGEN_DOCS_URL,
  },
  negativePrompt: {
    reason: "`negativePrompt` is Vertex AI-only; the Gemini API rejects it.",
    source: IMAGEN_DOCS_URL,
  },
  seed: {
    reason: "`seed` is Vertex AI-only; the Gemini API rejects it.",
    source: IMAGEN_DOCS_URL,
  },
  addWatermark: {
    reason:
      "`addWatermark` is Vertex AI-only; every Gemini API Imagen output carries a SynthID watermark unconditionally.",
    source: IMAGEN_DOCS_URL,
  },
  enhancePrompt: {
    reason: "`enhancePrompt` is Vertex AI-only; the Gemini API rejects it.",
    source: IMAGEN_DOCS_URL,
  },
};

/**
 * Per-model Imagen constraint table (applied to the nested `parameters`).
 * Only `imageSize`/`sampleImageSize` differs between the three ids:
 * "imageSize: … This is only supported for the Standard and Ultra models."
 * — the SDK's `GenerateImagesConfig.imageSize` docstring allows it for every
 * Imagen 4 model, so the Fast deny below is a documented NARROWING.
 */
export const generateImagesConstraints: Readonly<Partial<Record<string, EndpointConstraints>>> = {
  "imagen-4.0-fast-generate-001": {
    deny: {
      sampleImageSize: {
        reason:
          "`sampleImageSize` (SDK imageSize) is only supported for the Standard and Ultra Imagen models.",
        source: IMAGEN_DOCS_URL,
      },
    },
  },
};

export const generateImagesFamilyRules: readonly FamilyRule[] = [
  {
    family: "Imagen models",
    match: (modelId) => modelId.startsWith("imagen-"),
    deny: IMAGEN_VERTEX_ONLY_DENY,
    enums: {
      aspectRatio: [...IMAGEN_ASPECT_RATIOS],
      sampleImageSize: [...IMAGEN_IMAGE_SIZES],
      personGeneration: [...IMAGEN_PERSON_GENERATION],
      sampleCount: [...IMAGEN_SAMPLE_COUNTS],
    },
  },
];

// ---------------------------------------------------------------------------
// Veo (generateVideos / models.{model}:predictLongRunning) constraints.
//
// NOTE: these deny/enum tables target keys of the nested `parameters` wire
// object, not top-level body keys — the pipeline's generic Layer-3 pass never
// sees them (top-level keys are only model/instances/parameters/webhookConfig),
// so ./generate-videos applies them to `parameters` in a dedicated check.
// ---------------------------------------------------------------------------

/** Veo docs backing every Veo constraint below. */
export const VEO_DOCS_URL = "https://ai.google.dev/gemini-api/docs/veo";

/**
 * Gemini Omni Flash — the non-Veo video-output model in the generated google
 * catalog. Two first-party pages bound it (both re-verified 2026-08-13):
 * - https://ai.google.dev/gemini-api/docs/models/gemini-omni-flash —
 *   "Output video: 3s-10s (720p, 24 FPS)"
 * - https://ai.google.dev/gemini-api/docs/omni — `"Set the aspect_ratio to
 *   "9:16" to create portrait videos."`, with 16:9 the landscape default;
 *   duration is "integers between 3 and 10, followed by 's'".
 */
export const GEMINI_OMNI_FLASH_DOCS_URL =
  "https://ai.google.dev/gemini-api/docs/models/gemini-omni-flash";

const VEO_ASPECT_RATIOS = ["16:9", "9:16"] as const;

/** "Output video: 3s-10s" → the integer seconds 3…10 (GEMINI_OMNI_FLASH_DOCS_URL). */
const GEMINI_OMNI_FLASH_DURATIONS = [3, 4, 5, 6, 7, 8, 9, 10] as const;

/**
 * "Image input: Any image resolution and aspect ratio up to 20MB file size"
 * — the Veo 2 entry of the "Model versions" section on VEO_DOCS_URL. It is
 * the only per-model image cap the Veo docs state.
 */
export const VEO_2_IMAGE_MAX_BYTES = 20 * 1024 * 1024;

/**
 * Per-model Veo constraint table (applied to the nested `parameters` object).
 * Sources: the "Veo API parameters and specifications" table on VEO_DOCS_URL
 * (re-verified 2026-08-13).
 *
 * - `resolution`: Veo 2 has no resolution parameter at all. Veo 3.1 Lite
 *   stops at 1080p. For Veo 3 / Veo 3.1 (standard + fast) the parameters
 *   table lists 720p/1080p/4k — the page's feature-comparison table omits 4k
 *   for Veo 3; we allow the permissive superset to avoid false positives.
 * - `durationSeconds`: Veo 3.x: 4, 6, or 8. Veo 2: the parameters table says
 *   5/6/8 while the feature table says "5-8 seconds" — permissive [5,6,7,8].
 * - `personGeneration`: Veo 3.x accepts allow_all (text-to-video/extension)
 *   and allow_adult (image-driven modes; also the ONLY value allowed in
 *   EU/UK/CH/MENA, which is why "text-to-video ⇒ allow_all only" is NOT
 *   enforced); dont_allow is Veo 2-only. Veo 2 accepts all three values.
 * - `sampleCount`: "Videos per request: 1" for every Veo 3.x model; Veo 2
 *   allows 1 or 2.
 * - `media.image`: Veo 2's documented 20MB input-image cap.
 */
export const generateVideosConstraints: Readonly<Partial<Record<string, EndpointConstraints>>> = {
  "veo-2.0-generate-001": {
    deny: {
      resolution: {
        reason: "Veo 2 does not support the `resolution` parameter (output is 720p).",
        source: VEO_DOCS_URL,
      },
    },
    enums: {
      durationSeconds: [5, 6, 7, 8],
      personGeneration: ["allow_all", "allow_adult", "dont_allow"],
      sampleCount: [1, 2],
    },
    media: { image: { maxBytes: VEO_2_IMAGE_MAX_BYTES } },
  },
  "veo-3.0-generate-001": { enums: { resolution: ["720p", "1080p", "4k"] } },
  "veo-3.0-fast-generate-001": { enums: { resolution: ["720p", "1080p", "4k"] } },
  "veo-3.1-generate-preview": { enums: { resolution: ["720p", "1080p", "4k"] } },
  "veo-3.1-fast-generate-preview": { enums: { resolution: ["720p", "1080p", "4k"] } },
  "veo-3.1-lite-generate-preview": { enums: { resolution: ["720p", "1080p"] } },
  /**
   * The one catalogued video-output model that is NOT a Veo id. Its bounds
   * come from GEMINI_OMNI_FLASH_DOCS_URL / the omni guide, mapped onto this
   * endpoint's `parameters` spellings:
   * - `durationSeconds`: "Output video: 3s-10s" (the omni guide states the
   *   same window as "integers between 3 and 10").
   * - `resolution`: "(720p, 24 FPS)" — 720p is the only documented output.
   * - `aspectRatio`: 16:9 (landscape, default) and 9:16 (portrait).
   * - `sampleCount`: DOCUMENTED-UNCERTAINTY. Neither page publishes a
   *   videos-per-request knob for Omni — its native surface is the
   *   Interactions API, which returns one video per interaction and has no
   *   multi-sample field at all. The conservative [1] is therefore an
   *   inference, not a quote; it is the same value every Veo 3.x model carries
   *   and it keeps an absurd `sampleCount` from validating silently. Widen it
   *   the moment Google publishes a number.
   */
  "gemini-omni-flash-preview": {
    enums: {
      durationSeconds: [...GEMINI_OMNI_FLASH_DURATIONS],
      aspectRatio: [...VEO_ASPECT_RATIOS],
      resolution: ["720p"],
      sampleCount: [1],
    },
  },
};

/**
 * Docs URL backing the `parameters` tables of a generateVideos model — used as
 * `meta.source` on the issues ./generate-videos raises, so an Omni issue does
 * not cite the Veo page.
 */
export function generateVideosDocsUrl(modelId: string): string {
  return modelId.startsWith("gemini-omni-flash") ? GEMINI_OMNI_FLASH_DOCS_URL : VEO_DOCS_URL;
}


/**
 * NOTE: both rules below are PREFIX-matched on `veo-`, so they bound only the
 * Veo line. Non-Veo video models (today: `gemini-omni-flash-preview`) must
 * carry a per-model entry in `generateVideosConstraints` above, and
 * ./generate-videos raises `unsupported_capability` for any catalogued
 * video-output id that ends up with no applicable constraints at all — so a
 * future non-Veo id fails visibly rather than validating anything.
 */
export const generateVideosFamilyRules: readonly FamilyRule[] = [
  {
    // Duration / person / videos-per-request rules shared by every Veo 3.x
    // model. Matches only cataloged ids so genuinely unknown models keep the
    // "model-dependent checks were skipped" semantics of unknown_model.
    family: "Veo 3.x video models",
    match: (modelId) => generateVideosModels[modelId] !== undefined && modelId.startsWith("veo-3"),
    enums: {
      durationSeconds: [4, 6, 8],
      personGeneration: ["allow_all", "allow_adult"],
      sampleCount: [1],
    },
  },
  {
    // Every Veo model generates 16:9 (default) or 9:16 — source: VEO_DOCS_URL.
    family: "Veo video models",
    match: (modelId) => generateVideosModels[modelId] !== undefined && modelId.startsWith("veo-"),
    enums: { aspectRatio: [...VEO_ASPECT_RATIOS] },
  },
];

export const generateContentFamilyRules: readonly FamilyRule[] = [
  {
    // "Models with a 1M context window can process videos up to 1 hour long
    // at default media resolution" — https://ai.google.dev/gemini-api/docs/video-understanding
    // Smaller-context models have no documented per-model number, so no rule.
    family: "1M-context video-capable Gemini models",
    match: (modelId) => {
      const info = catalog[modelId];
      return (
        info !== undefined &&
        modelId.startsWith("gemini") &&
        info.limit.context >= 1_000_000 &&
        info.modalities.input.includes("video")
      );
    },
    media: {
      video: { maxDurationSeconds: GEMINI_1M_VIDEO_MAX_DURATION_SECONDS },
    },
  },
  {
    // Format allowlists + inline size cap shared by every Gemini model.
    // Sources: GOOGLE_MEDIA_DOC_URLS.image / .audio / .video
    family: "Gemini models",
    match: (modelId) => modelId.startsWith("gemini"),
    imageTokens: GEMINI_IMAGE_TOKENS,
    media: {
      image: { maxBytes: INLINE_MEDIA_MAX_BYTES, formats: GEMINI_IMAGE_FORMATS },
      audio: {
        maxBytes: INLINE_MEDIA_MAX_BYTES,
        maxDurationSeconds: GEMINI_AUDIO_MAX_DURATION_SECONDS,
        formats: GEMINI_AUDIO_FORMATS,
      },
      video: { maxBytes: INLINE_MEDIA_MAX_BYTES, formats: GEMINI_VIDEO_FORMATS },
    },
  },
];
