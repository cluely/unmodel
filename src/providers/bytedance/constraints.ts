/**
 * Per-model constraint tables for the BytePlus ModelArk generation routes.
 *
 * ModelArk publishes one request schema per route and then narrows it per
 * model in prose ("Supported models: …") plus a capability matrix. These
 * tables encode that narrowing so a param a model rejects fails loudly here
 * instead of asynchronously (or, worse, silently) on the API.
 *
 * Ground truth (verified 2026-08-13):
 *   https://docs.byteplus.com/en/docs/ModelArk/1541523  image generation API
 *   https://docs.byteplus.com/en/docs/ModelArk/1824121  image capability matrix
 *   https://docs.byteplus.com/en/docs/ModelArk/1520757  video task API
 *   https://docs.byteplus.com/en/docs/ModelArk/2298881  video capability matrix
 */

import type { DenyRule, EndpointConstraints } from "../../core/constraint-types";
import type { ArkImageRule } from "./shared";

export const IMAGE_API_SOURCE = "https://docs.byteplus.com/en/docs/ModelArk/1541523";
export const IMAGE_MODELS_SOURCE = "https://docs.byteplus.com/en/docs/ModelArk/1824121#9278b81b";
export const VIDEO_API_SOURCE = "https://docs.byteplus.com/en/docs/ModelArk/1520757";
export const VIDEO_MODELS_SOURCE = "https://docs.byteplus.com/en/docs/ModelArk/2298881#e7b4c498";

function denyTable(
  entries: Readonly<Record<string, string>>,
  source: string,
): Record<string, DenyRule> {
  const out: Record<string, DenyRule> = {};
  for (const [param, reason] of Object.entries(entries)) out[param] = { reason, source };
  return out;
}

// ---------------------------------------------------------------------------
// Image generation — POST /api/v3/images/generations
// ---------------------------------------------------------------------------

/** `response_format` values — image generation API. */
export const IMAGE_RESPONSE_FORMATS = ["url", "b64_json"] as const;
/** `output_format` values (Seedream 5.0 pro / 5.0 lite only). */
export const IMAGE_OUTPUT_FORMATS = ["png", "jpeg"] as const;
/** `background` values (Seedream 5.0 pro only). */
export const IMAGE_BACKGROUNDS = ["transparent", "opaque"] as const;
/** `sequential_image_generation` values. */
export const SEQUENTIAL_IMAGE_GENERATION = ["auto", "disabled"] as const;
/** `optimize_prompt_options.mode` values. */
export const PROMPT_OPTIMIZE_MODES = ["standard", "fast"] as const;

/** "Value range: [1, 15]" — `sequential_image_generation_options.max_images`. */
export const MAX_IMAGES_RANGE = { min: 1, max: 15 } as const;

/**
 * "Number of input reference images + number of generated images ≤ 15."
 * — image generation API, `max_images`.
 */
export const SEQUENTIAL_TOTAL_IMAGES = 15;

/**
 * Documented single-image input bounds for the image generation route
 * ("Single-image input requirements"). Formats are jpeg/png/webp/bmp/tiff/
 * gif/heic/heif — every format unmodel can sniff is allowed, so no format
 * rule is carried.
 */
export const IMAGE_INPUT_RULE: ArkImageRule = {
  maxBytes: 30 * 1024 * 1024,
  minDimension: 14,
  minDimensionExclusive: true,
  maxPixels: 36_000_000,
  minPixels: 196,
  minAspect: 1 / 16,
  maxAspect: 16,
};

/**
 * Layer-decomposition input bounds (Seedream 5.0 pro, `layer_decomposition:
 * true`): png/jpeg only, and a much higher pixel floor.
 */
export const LAYER_DECOMPOSITION_INPUT_RULE: ArkImageRule = {
  maxBytes: 30 * 1024 * 1024,
  minPixels: 262_144,
  maxPixels: 36_000_000,
  minAspect: 1 / 16,
  maxAspect: 16,
};

/**
 * Every resolution keyword `size` accepts, unioned across the per-model tables
 * in `imageShapeRules` below ("auto" exists only in layer-decomposition mode).
 * `ImageShapeRule` is typed against this list, so a keyword added to a model's
 * table without being added here is a compile error — which is what keeps the
 * `BytedanceImageSize` autocomplete union (image-generations.ts) from drifting
 * away from the values the runtime actually accepts.
 */
export const IMAGE_SIZE_KEYWORDS = ["1K", "1.5K", "2K", "3K", "4K", "auto"] as const;

/** One documented `size` resolution keyword. */
export type BytedanceImageSizeKeyword = (typeof IMAGE_SIZE_KEYWORDS)[number];

/** Per-model narrowing that neither `deny` nor `enums` can express. */
export interface ImageShapeRule {
  /** `size` keywords accepted for image generation. */
  readonly sizeKeywords: readonly BytedanceImageSizeKeyword[];
  /** `size` keywords accepted in layer-decomposition mode, when supported. */
  readonly layerSizeKeywords?: readonly BytedanceImageSizeKeyword[];
  /** Inclusive width × height bounds for a `"<w>x<h>"` size. */
  readonly minPixels: number;
  readonly maxPixels: number;
  /** Max reference images accepted in `image`. */
  readonly maxReferenceImages: number;
  /** `optimize_prompt_options.mode` values this model supports. */
  readonly promptOptimizeModes: readonly string[];
}

/**
 * `size` ranges and reference-image caps per model. Aspect ratio bounds are
 * [1/16, 16] for every model, so they live in one constant.
 */
export const IMAGE_SIZE_ASPECT_RANGE = { min: 1 / 16, max: 16 } as const;

export const imageShapeRules: Readonly<Partial<Record<string, ImageShapeRule>>> = {
  "dola-seedream-5-0-pro-260628": {
    sizeKeywords: ["1K", "1.5K", "2K"],
    // Layer decomposition additionally accepts `auto` and defaults to it.
    layerSizeKeywords: ["1K", "1.5K", "2K", "auto"],
    // [1280x720 (921,600), 2048x2048x1.1025 (4,624,220)]
    minPixels: 921_600,
    maxPixels: 4_624_220,
    maxReferenceImages: 10,
    promptOptimizeModes: ["standard", "fast"],
  },
  "seedream-5-0-260128": {
    sizeKeywords: ["2K", "3K", "4K"],
    // [2560x1440 (3,686,400), 4096x4096 (16,777,216)]
    minPixels: 3_686_400,
    maxPixels: 16_777_216,
    maxReferenceImages: 14,
    // "Seedream 5.0 lite and Seedream 4.5 do not currently support" fast mode.
    promptOptimizeModes: ["standard"],
  },
  "seedream-5-0-lite-260128": {
    sizeKeywords: ["2K", "3K", "4K"],
    minPixels: 3_686_400,
    maxPixels: 16_777_216,
    maxReferenceImages: 14,
    promptOptimizeModes: ["standard"],
  },
  "seedream-4-5-251128": {
    sizeKeywords: ["2K", "4K"],
    minPixels: 3_686_400,
    maxPixels: 16_777_216,
    maxReferenceImages: 14,
    promptOptimizeModes: ["standard"],
  },
  "seedream-4-0-250828": {
    sizeKeywords: ["1K", "2K", "4K"],
    // [1280x720 (921,600), 4096x4096 (16,777,216)]
    minPixels: 921_600,
    maxPixels: 16_777_216,
    maxReferenceImages: 14,
    promptOptimizeModes: ["standard", "fast"],
  },
};

const SEQUENTIAL_ONLY = {
  sequential_image_generation:
    "sequential image generation is supported by Seedream 5.0 lite / 4.5 / 4.0 only",
  sequential_image_generation_options:
    "sequential image generation is supported by Seedream 5.0 lite / 4.5 / 4.0 only",
  stream: "streaming output is supported by Seedream 5.0 lite / 4.5 / 4.0 only",
} as const;

const PRO_ONLY = {
  layer_decomposition: "layer decomposition is a Seedream 5.0 pro capability",
  background: "`background` (alpha channel control) is supported by Seedream 5.0 pro only",
} as const;

const OUTPUT_FORMAT_ONLY = {
  output_format:
    "`output_format` is supported by Seedream 5.0 pro and Seedream 5.0 lite only; this model always returns jpeg",
} as const;

export const imageConstraints: Readonly<Partial<Record<string, EndpointConstraints>>> = {
  "dola-seedream-5-0-pro-260628": {
    deny: denyTable(SEQUENTIAL_ONLY, IMAGE_API_SOURCE),
    enums: {
      response_format: IMAGE_RESPONSE_FORMATS,
      output_format: IMAGE_OUTPUT_FORMATS,
      background: IMAGE_BACKGROUNDS,
    },
  },
  "seedream-5-0-260128": {
    deny: denyTable(PRO_ONLY, IMAGE_MODELS_SOURCE),
    enums: {
      response_format: IMAGE_RESPONSE_FORMATS,
      output_format: IMAGE_OUTPUT_FORMATS,
      sequential_image_generation: SEQUENTIAL_IMAGE_GENERATION,
    },
  },
  "seedream-5-0-lite-260128": {
    deny: denyTable(PRO_ONLY, IMAGE_MODELS_SOURCE),
    enums: {
      response_format: IMAGE_RESPONSE_FORMATS,
      output_format: IMAGE_OUTPUT_FORMATS,
      sequential_image_generation: SEQUENTIAL_IMAGE_GENERATION,
    },
  },
  "seedream-4-5-251128": {
    deny: { ...denyTable(PRO_ONLY, IMAGE_MODELS_SOURCE), ...denyTable(OUTPUT_FORMAT_ONLY, IMAGE_API_SOURCE) },
    enums: {
      response_format: IMAGE_RESPONSE_FORMATS,
      sequential_image_generation: SEQUENTIAL_IMAGE_GENERATION,
    },
  },
  "seedream-4-0-250828": {
    deny: { ...denyTable(PRO_ONLY, IMAGE_MODELS_SOURCE), ...denyTable(OUTPUT_FORMAT_ONLY, IMAGE_API_SOURCE) },
    enums: {
      response_format: IMAGE_RESPONSE_FORMATS,
      sequential_image_generation: SEQUENTIAL_IMAGE_GENERATION,
    },
  },
  // seededit-3-0-i2i-250628 carries no rules on purpose: BytePlus retired its
  // API reference (docs 1666946 / 1824691 now resolve to an empty document),
  // so its param surface is undocumented and unmodel does not guess it.
};

// ---------------------------------------------------------------------------
// Video generation tasks — POST /api/v3/contents/generations/tasks
// ---------------------------------------------------------------------------

/** `ratio` values — "16:9, 4:3, 1:1, 3:4, 9:16, 21:9, and adaptive". */
export const VIDEO_RATIOS = ["16:9", "4:3", "1:1", "3:4", "9:16", "21:9", "adaptive"] as const;
/** `service_tier` values. */
export const SERVICE_TIERS = ["default", "flex"] as const;
/** `output_format` values (Dreamina Seedance 2.5 only). */
export const VIDEO_OUTPUT_FORMATS = ["mp4", "mov"] as const;
/** `omni_reference_task_type` values (Dreamina Seedance 2.5 only). */
export const OMNI_REFERENCE_TASK_TYPES = ["auto", "reference", "edit", "extend"] as const;
/** `content[].role` values. */
export const CONTENT_ROLES = [
  "first_frame",
  "last_frame",
  "reference_image",
  "reference_video",
  "reference_audio",
] as const;

/** "Value range: [-1, 2147483647]" — `seed`. */
export const VIDEO_SEED_RANGE = { min: -1, max: 2_147_483_647 } as const;
/** "Value range: [3600, 259200]" — `execution_expires_after`. */
export const EXECUTION_EXPIRES_RANGE = { min: 3600, max: 259_200 } as const;
/** "Value range: [0, 9]" — `priority`. */
export const PRIORITY_RANGE = { min: 0, max: 9 } as const;
/** "the length cannot exceed 64 characters" — `safety_identifier`. */
export const SAFETY_IDENTIFIER_MAX_LENGTH = 64;
/** Every Seedance model outputs 24 fps — used to convert `frames` to seconds. */
export const VIDEO_FPS = 24;
/** "All integer values in the range [29, 289] that fit the format 25 + 4n". */
export const FRAMES_RANGE = { min: 29, max: 289, base: 25, step: 4 } as const;

/**
 * Documented single-image input bounds for the video route ("Requirements for
 * uploading a single image"): [300, 6000] px per side, aspect [0.4, 2.5],
 * ≤ 30 MB.
 */
export const VIDEO_IMAGE_INPUT_RULE: ArkImageRule = {
  maxBytes: 30 * 1024 * 1024,
  minDimension: 300,
  maxDimension: 6000,
  minAspect: 0.4,
  maxAspect: 2.5,
};

/** Per-model narrowing for the video task route. */
export interface VideoShapeRule {
  /** Inclusive `duration` bounds in seconds. */
  readonly minDuration: number;
  readonly maxDuration: number;
  /** Whether `duration: -1` (model picks the length) is documented. */
  readonly allowsAutoDuration: boolean;
  /** Max `reference_image` items; 0 when omni reference is unsupported. */
  readonly maxReferenceImages: number;
  /** Max `reference_video` items; 0 when video input is unsupported. */
  readonly maxReferenceVideos: number;
  /** Max `reference_audio` items; 0 when audio input is unsupported. */
  readonly maxReferenceAudio: number;
  /** Whether a `last_frame` image is accepted (first+last-frame i2v). */
  readonly supportsLastFrame: boolean;
  /** Whether reference audio may be the only non-text input. */
  readonly supportsAudioOnlyReference: boolean;
  /** Whether `ratio: "adaptive"` is accepted for text-to-video. */
  readonly supportsAdaptiveRatioForTextToVideo: boolean;
  /** Whether image-to-video forces `ratio: "adaptive"`. */
  readonly forcesAdaptiveRatioForImageToVideo: boolean;
}

const SEEDANCE_20_SHAPE: VideoShapeRule = {
  minDuration: 4,
  maxDuration: 15,
  allowsAutoDuration: true,
  maxReferenceImages: 9,
  maxReferenceVideos: 3,
  maxReferenceAudio: 3,
  supportsLastFrame: true,
  // "Audio-only input is not supported; include at least one reference image
  // or video."
  supportsAudioOnlyReference: false,
  supportsAdaptiveRatioForTextToVideo: true,
  forcesAdaptiveRatioForImageToVideo: false,
};

export const videoShapeRules: Readonly<Partial<Record<string, VideoShapeRule>>> = {
  "dreamina-seedance-2-5-260628": {
    minDuration: 4,
    maxDuration: 30,
    allowsAutoDuration: true,
    maxReferenceImages: 30,
    maxReferenceVideos: 10,
    maxReferenceAudio: 10,
    supportsLastFrame: true,
    supportsAudioOnlyReference: true,
    supportsAdaptiveRatioForTextToVideo: true,
    // "Automatically preserves the aspect ratio of the first-frame image →
    // Defaults to and only supports `adaptive`."
    forcesAdaptiveRatioForImageToVideo: true,
  },
  "dreamina-seedance-2-0-260128": SEEDANCE_20_SHAPE,
  "dreamina-seedance-2-0-fast-260128": SEEDANCE_20_SHAPE,
  "dreamina-seedance-2-0-mini-260615": SEEDANCE_20_SHAPE,
  "seedance-1-5-pro-251215": {
    minDuration: 4,
    maxDuration: 12,
    allowsAutoDuration: true,
    maxReferenceImages: 0,
    maxReferenceVideos: 0,
    maxReferenceAudio: 0,
    supportsLastFrame: true,
    supportsAudioOnlyReference: false,
    supportsAdaptiveRatioForTextToVideo: true,
    forcesAdaptiveRatioForImageToVideo: false,
  },
  "seedance-1-0-pro-250528": {
    minDuration: 2,
    maxDuration: 12,
    // The `-1` behaviour table covers the 2.x and 1.5 pro models only.
    allowsAutoDuration: false,
    maxReferenceImages: 0,
    maxReferenceVideos: 0,
    maxReferenceAudio: 0,
    supportsLastFrame: true,
    supportsAudioOnlyReference: false,
    // "Only supports specifying an available aspect ratio → does not support
    // `adaptive`" for text-to-video (image-to-video does support it).
    supportsAdaptiveRatioForTextToVideo: false,
    forcesAdaptiveRatioForImageToVideo: false,
  },
  "seedance-1-0-pro-fast-251015": {
    minDuration: 2,
    maxDuration: 12,
    allowsAutoDuration: false,
    maxReferenceImages: 0,
    maxReferenceVideos: 0,
    maxReferenceAudio: 0,
    // Capability matrix: image-to-video first+last frames is ✗ for this model.
    supportsLastFrame: false,
    supportsAudioOnlyReference: false,
    supportsAdaptiveRatioForTextToVideo: false,
    forcesAdaptiveRatioForImageToVideo: false,
  },
};

const LEGACY_ONLY = {
  seed: "`seed` is supported by Seedance 1.5 pro / 1.0 pro / 1.0 pro fast only",
  camera_fixed: "`camera_fixed` is supported by Seedance 1.5 pro / 1.0 pro / 1.0 pro fast only",
} as const;

const FRAMES_ONLY = {
  frames: "`frames` is supported by Seedance 1.0 pro and 1.0 pro fast only; use `duration`",
} as const;

const DRAFT_ONLY = {
  draft: "draft mode is a Seedance 1.5 pro capability",
} as const;

const SEEDANCE_25_ONLY = {
  omni_reference_task_type: "`omni_reference_task_type` is a Dreamina Seedance 2.5 parameter",
  output_format:
    "`output_format` (mp4/mov) is a Dreamina Seedance 2.5 parameter; other models always output mp4",
} as const;

const PRIORITY_ONLY = {
  priority: "`priority` is supported by Dreamina Seedance 2.5 and the 2.0 series only",
} as const;

const AUDIO_ONLY = {
  generate_audio:
    "`generate_audio` is supported by Dreamina Seedance 2.5, the 2.0 series and Seedance 1.5 pro only; Seedance 1.0 always generates silent video",
} as const;

const seedance2xDeny: Record<string, DenyRule> = {
  ...denyTable(LEGACY_ONLY, VIDEO_API_SOURCE),
  ...denyTable(FRAMES_ONLY, VIDEO_API_SOURCE),
  ...denyTable(DRAFT_ONLY, VIDEO_API_SOURCE),
};

const seedance20Deny: Record<string, DenyRule> = {
  ...seedance2xDeny,
  ...denyTable(SEEDANCE_25_ONLY, VIDEO_API_SOURCE),
};

/** Seedance 1.0 pro / pro fast: `frames` and `seed`/`camera_fixed` ARE theirs. */
const seedance10Deny: Record<string, DenyRule> = {
  ...denyTable(DRAFT_ONLY, VIDEO_API_SOURCE),
  ...denyTable(SEEDANCE_25_ONLY, VIDEO_API_SOURCE),
  ...denyTable(PRIORITY_ONLY, VIDEO_API_SOURCE),
  ...denyTable(AUDIO_ONLY, VIDEO_API_SOURCE),
};

export const videoConstraints: Readonly<
  Partial<Record<string, EndpointConstraints>>
> = {
  "dreamina-seedance-2-5-260628": {
    deny: seedance2xDeny,
    enums: {
      resolution: ["480p", "720p"],
      ratio: VIDEO_RATIOS,
      output_format: VIDEO_OUTPUT_FORMATS,
      omni_reference_task_type: OMNI_REFERENCE_TASK_TYPES,
      // "flex … Dreamina Seedance 2.5 and Dreamina Seedance 2.0 series models
      // are not currently supported."
      service_tier: ["default"],
    },
  },
  "dreamina-seedance-2-0-260128": {
    deny: seedance20Deny,
    enums: {
      resolution: ["480p", "720p", "1080p", "4k"],
      ratio: VIDEO_RATIOS,
      service_tier: ["default"],
    },
  },
  "dreamina-seedance-2-0-fast-260128": {
    deny: seedance20Deny,
    enums: {
      resolution: ["480p", "720p"],
      ratio: VIDEO_RATIOS,
      service_tier: ["default"],
    },
  },
  "dreamina-seedance-2-0-mini-260615": {
    deny: seedance20Deny,
    enums: {
      resolution: ["480p", "720p"],
      ratio: VIDEO_RATIOS,
      service_tier: ["default"],
    },
  },
  "seedance-1-5-pro-251215": {
    deny: {
      ...denyTable(FRAMES_ONLY, VIDEO_API_SOURCE),
      ...denyTable(SEEDANCE_25_ONLY, VIDEO_API_SOURCE),
      ...denyTable(PRIORITY_ONLY, VIDEO_API_SOURCE),
    },
    enums: {
      resolution: ["480p", "720p", "1080p"],
      ratio: VIDEO_RATIOS,
      service_tier: SERVICE_TIERS,
    },
  },
  "seedance-1-0-pro-250528": {
    deny: seedance10Deny,
    enums: {
      resolution: ["480p", "720p", "1080p"],
      ratio: VIDEO_RATIOS,
      service_tier: SERVICE_TIERS,
    },
  },
  "seedance-1-0-pro-fast-251015": {
    deny: seedance10Deny,
    enums: {
      resolution: ["480p", "720p", "1080p"],
      ratio: VIDEO_RATIOS,
      service_tier: SERVICE_TIERS,
    },
  },
};
