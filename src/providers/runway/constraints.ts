/**
 * Per-model constraint tables for the Runway API's generation routes,
 * transcribed from the official OpenAPI spec (spec version 2024-11-06):
 * https://docs.dev.runwayml.com/openapi.json — verified 2026-08-13. Each
 * route's request body is a strict per-model union there, so a param absent
 * from a model's arm is rejected (or ignored) by the API; those are the
 * `deny` rules. `enums` carry each arm's documented ratio/duration/
 * resolution/quality values; integer ranges (e.g. duration 2–10) are
 * expanded to explicit lists.
 */

import type { EndpointConstraints, DenyRule } from "../../core/constraint-types";
import type { ModelShapeRules } from "./shared";

export const IMAGE_TO_VIDEO_SOURCE =
  "https://docs.dev.runwayml.com/api#tag/Start-generating/paths/~1v1~1image_to_video/post";
export const TEXT_TO_VIDEO_SOURCE =
  "https://docs.dev.runwayml.com/api#tag/Start-generating/paths/~1v1~1text_to_video/post";
export const VIDEO_TO_VIDEO_SOURCE =
  "https://docs.dev.runwayml.com/api#tag/Start-generating/paths/~1v1~1video_to_video/post";
export const TEXT_TO_IMAGE_SOURCE =
  "https://docs.dev.runwayml.com/api#tag/Start-generating/paths/~1v1~1text_to_image/post";

export const MODELS_SOURCE = "https://docs.dev.runwayml.com/guides/models.md";

/**
 * Which models each route's request union actually has an arm for
 * (openapi.json, verified 2026-08-13). The catalog is provider-wide, so a
 * model can be "known" yet have no arm on the route being called — e.g.
 * `gen4_turbo` is image_to_video-only and `aleph2` is video_to_video-only.
 */
export const IMAGE_TO_VIDEO_MODELS = [
  "gen4.5",
  "gen4_turbo",
  "veo3.1",
  "veo3.1_fast",
  "hailuo3",
  "happyhorse_1_0",
  "seedance2",
  "seedance2_fast",
  "seedance2_mini",
  "seedance2_5",
  "grok_imagine_1_5",
  "gemini_omni_flash",
] as const;

export const TEXT_TO_VIDEO_MODELS = [
  "gen4.5",
  "veo3.1",
  "veo3.1_fast",
  "hailuo3",
  "happyhorse_1_0",
  "seedance2",
  "seedance2_fast",
  "seedance2_mini",
  "seedance2_5",
  "grok_imagine_1_5",
  "gemini_omni_flash",
] as const;

export const VIDEO_TO_VIDEO_MODELS = [
  "aleph2",
  "hailuo3",
  "seedance2",
  "seedance2_fast",
  "seedance2_mini",
  "seedance2_5",
  "gemini_omni_flash",
] as const;

/** [min..max] inclusive integer list (documented integer ranges → enums). */
function intRange(min: number, max: number): number[] {
  return Array.from({ length: max - min + 1 }, (_, i) => min + i);
}

/** Deny rules for params that are not in a model's request schema. */
function notInSchema(route: string, source: string, params: string[]): Record<string, DenyRule> {
  const rules: Record<string, DenyRule> = {};
  for (const param of params) {
    rules[param] = {
      reason: `it is not a parameter of this model's ${route} request schema`,
      source,
    };
  }
  return rules;
}

// ---------------------------------------------------------------------------
// Shared promptText length caps (openapi.json minLength/maxLength per arm).
// Every arm caps prompt length, and the caps differ by an order of magnitude
// across models (1000 for the gen4/veo/aleph family, 15000 for seedance2_5).
// ---------------------------------------------------------------------------

const PT_1K = { min: 1, max: 1000 } as const;
const PT_2500 = { min: 1, max: 2500 } as const;
const PT_3500 = { min: 1, max: 3500 } as const;
const PT_4K = { min: 1, max: 4000 } as const;
const PT_5500 = { min: 1, max: 5500 } as const;
const PT_6K = { min: 1, max: 6000 } as const;
const PT_15K = { min: 1, max: 15000 } as const;
/** happyhorse_1_0 is the one arm with minLength 2. */
const PT_HAPPYHORSE = { min: 2, max: 2500 } as const;

// ---------------------------------------------------------------------------
// Shared ratio enums (openapi.json, verified 2026-08-13)
// ---------------------------------------------------------------------------

const GEN4_VIDEO_RATIOS = [
  "1280:720",
  "720:1280",
  "1104:832",
  "832:1104",
  "960:960",
  "1584:672",
] as const;

const VEO_RATIOS = ["1280:720", "720:1280", "1080:1920", "1920:1080"] as const;

/** seedance2_fast / seedance2_mini full enum; seedance2's 480p/720p tier. */
export const SEEDANCE2_SMALL_RATIOS = [
  "992:432",
  "864:496",
  "752:560",
  "640:640",
  "560:752",
  "496:864",
  "1470:630",
  "1280:720",
  "1112:834",
  "960:960",
  "834:1112",
  "720:1280",
] as const;

const SEEDANCE2_RATIOS = [
  ...SEEDANCE2_SMALL_RATIOS,
  // 1080p tier
  "2206:946",
  "1920:1080",
  "1664:1248",
  "1440:1440",
  "1248:1664",
  "1080:1920",
  // 4K tier
  "3840:1646",
  "3840:2160",
  "3840:2880",
  "3840:3840",
  "2880:3840",
  "2160:3840",
] as const;

const SEEDANCE2_5_RATIOS = [
  "992:432",
  "854:480",
  "752:560",
  "640:640",
  "560:752",
  "480:854",
  "1470:630",
  "1280:720",
  "1112:834",
  "960:960",
  "834:1112",
  "720:1280",
] as const;

const HAILUO3_RATIOS = ["adaptive", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"] as const;

const GEMINI_OMNI_FLASH_RATIOS = ["1280:720", "720:1280"] as const;

/** happyhorse_1_0 on text_to_video (it denies `ratio` on image_to_video). */
const HAPPYHORSE_VIDEO_RATIOS = [
  "1280:720",
  "720:1280",
  "960:960",
  "1108:832",
  "832:1108",
  "1920:1080",
  "1080:1920",
  "1440:1440",
  "1662:1248",
  "1248:1662",
] as const;

/** grok_imagine_1_5 on text_to_video (it denies `ratio` on image_to_video). */
const GROK_IMAGINE_1_5_RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"] as const;

/** gen4.5 narrows to these two on text_to_video only (6 on image_to_video). */
const GEN45_TEXT_TO_VIDEO_RATIOS = ["1280:720", "720:1280"] as const;

// ---------------------------------------------------------------------------
// Shared `resolution` enums. The casing is genuinely per model in the spec —
// hailuo3 uses "2K"/"768P", happyhorse_1_0 "720P"/"1080P" and
// grok_imagine_1_5 lowercase "480p"/"720p"/"1080p" — so the per-model tables
// below stay separate; only the type-level union is shared.
// ---------------------------------------------------------------------------

const HAILUO3_RESOLUTIONS = ["2K", "768P"] as const;
const HAPPYHORSE_RESOLUTIONS = ["720P", "1080P"] as const;
const GROK_IMAGINE_1_5_RESOLUTIONS = ["480p", "720p", "1080p"] as const;

/**
 * `ratio` values across every documented video model on every video route.
 * Which subset a given (route, model) accepts is narrowed at runtime by the
 * `enums` tables below — gen4.5, for one, takes six ratios on image_to_video
 * and only two on text_to_video. The named arms are autocomplete for the
 * documented space; `${number}:${number}` keeps the pixel-pair form open for
 * models unmodel has no arm for yet, while making non-ratio strings a compile
 * error.
 */
export type RunwayVideoRatio =
  | (typeof GEN4_VIDEO_RATIOS)[number]
  | (typeof VEO_RATIOS)[number]
  | (typeof SEEDANCE2_RATIOS)[number]
  | (typeof SEEDANCE2_5_RATIOS)[number]
  | (typeof HAILUO3_RATIOS)[number]
  | (typeof HAPPYHORSE_VIDEO_RATIOS)[number]
  | (typeof GROK_IMAGINE_1_5_RATIOS)[number]
  | (typeof GEMINI_OMNI_FLASH_RATIOS)[number]
  | (`${number}:${number}` & {});

/**
 * `resolution` values across every video model that declares the param. Each
 * model accepts exactly one of the three casings (see above); the runtime
 * tables reject the others, and every model that has no `resolution` at all
 * denies the param outright.
 */
export type RunwayVideoResolution =
  | (typeof HAILUO3_RESOLUTIONS)[number]
  | (typeof HAPPYHORSE_RESOLUTIONS)[number]
  | (typeof GROK_IMAGINE_1_5_RESOLUTIONS)[number];

// ---------------------------------------------------------------------------
// POST /v1/image_to_video
// ---------------------------------------------------------------------------

/**
 * Fields each model's arm marks as required (beyond `model` and the
 * schema-level `promptImage`), enforced by a checker in image-to-video.ts.
 */
export const videoFromImageRequired: Readonly<Partial<Record<string, readonly string[]>>> = {
  "gen4.5": ["promptText", "ratio", "duration"],
  gen4_turbo: ["ratio"],
  "veo3.1": ["ratio"],
  "veo3.1_fast": ["ratio"],
  hailuo3: ["promptText"],
};

/**
 * Shape rules for image_to_video: prompt-length caps, reference-array caps,
 * and the per-model `position` rule on prompt images. Most arms take exactly
 * one first-frame image and *require* `position: "first"` on it; veo3.1 takes
 * up to two with "first"/"last"; the seedance family takes an unbounded array
 * with optional positions; hailuo3 takes up to 9 with no position schema.
 */
export const videoFromImageShapeRules: Readonly<Partial<Record<string, ModelShapeRules>>> = {
  "gen4.5": {
    promptText: PT_1K,
    arrays: { promptImage: { min: 1, max: 1 } },
    promptImagePositions: ["first"],
    promptImagePositionRequired: true,
  },
  gen4_turbo: {
    promptText: PT_1K,
    arrays: { promptImage: { min: 1, max: 1 } },
    promptImagePositions: ["first"],
    promptImagePositionRequired: true,
  },
  "veo3.1": {
    promptText: PT_1K,
    arrays: { promptImage: { min: 1, max: 2 } },
    promptImagePositions: ["first", "last"],
    promptImagePositionRequired: true,
  },
  "veo3.1_fast": {
    promptText: PT_1K,
    arrays: { promptImage: { min: 1, max: 2 } },
    promptImagePositions: ["first", "last"],
    promptImagePositionRequired: true,
  },
  hailuo3: {
    promptText: PT_6K,
    arrays: { promptImage: { min: 1, max: 9 }, referenceAudio: { max: 3 } },
  },
  happyhorse_1_0: {
    promptText: PT_HAPPYHORSE,
    arrays: { promptImage: { min: 1, max: 1 } },
    promptImagePositions: ["first"],
    promptImagePositionRequired: true,
  },
  seedance2: {
    promptText: PT_3500,
    arrays: { referenceAudio: { max: 3 } },
    promptImagePositions: ["first", "last"],
  },
  seedance2_fast: {
    promptText: PT_3500,
    arrays: { referenceAudio: { max: 3 } },
    promptImagePositions: ["first", "last"],
  },
  seedance2_mini: {
    promptText: PT_3500,
    arrays: { referenceAudio: { max: 3 } },
    promptImagePositions: ["first", "last"],
  },
  seedance2_5: {
    promptText: PT_15K,
    arrays: { referenceAudio: { max: 10 } },
    promptImagePositions: ["first", "last"],
  },
  grok_imagine_1_5: {
    promptText: PT_2500,
    arrays: { promptImage: { min: 1, max: 1 } },
    promptImagePositions: ["first"],
    promptImagePositionRequired: true,
  },
  gemini_omni_flash: {
    promptText: PT_4K,
    arrays: { promptImage: { min: 1, max: 1 } },
    promptImagePositions: ["first"],
    promptImagePositionRequired: true,
  },
};

export const videoFromImageConstraints: Readonly<Partial<Record<string, EndpointConstraints>>> = {
  "gen4.5": {
    deny: notInSchema("image_to_video", IMAGE_TO_VIDEO_SOURCE, [
      "audio",
      "negativePrompt",
      "referenceAudio",
      "resolution",
    ]),
    enums: {
      ratio: GEN4_VIDEO_RATIOS,
      duration: intRange(2, 10),
      outputFormat: ["mp4", "prores", "png_sequence"],
      proresProfile: ["422", "4444", "422 Proxy", "422 LT", "422 HQ", "4444 XQ"],
    },
  },
  gen4_turbo: {
    deny: notInSchema("image_to_video", IMAGE_TO_VIDEO_SOURCE, [
      "audio",
      "negativePrompt",
      "outputFormat",
      "proresProfile",
      "referenceAudio",
      "resolution",
    ]),
    enums: { ratio: GEN4_VIDEO_RATIOS, duration: intRange(2, 10) },
  },
  "veo3.1": {
    deny: notInSchema("image_to_video", IMAGE_TO_VIDEO_SOURCE, [
      "contentModeration",
      "outputFormat",
      "proresProfile",
      "referenceAudio",
      "resolution",
      "seed",
    ]),
    enums: { ratio: VEO_RATIOS, duration: [4, 6, 8] },
  },
  "veo3.1_fast": {
    deny: notInSchema("image_to_video", IMAGE_TO_VIDEO_SOURCE, [
      "contentModeration",
      "outputFormat",
      "proresProfile",
      "referenceAudio",
      "resolution",
      "seed",
    ]),
    enums: { ratio: VEO_RATIOS, duration: [4, 6, 8] },
  },
  hailuo3: {
    deny: notInSchema("image_to_video", IMAGE_TO_VIDEO_SOURCE, [
      "audio",
      "contentModeration",
      "negativePrompt",
      "outputFormat",
      "proresProfile",
      "seed",
    ]),
    enums: { resolution: HAILUO3_RESOLUTIONS, duration: intRange(5, 15), ratio: HAILUO3_RATIOS },
  },
  happyhorse_1_0: {
    deny: notInSchema("image_to_video", IMAGE_TO_VIDEO_SOURCE, [
      "audio",
      "contentModeration",
      "negativePrompt",
      "outputFormat",
      "proresProfile",
      "ratio",
      "referenceAudio",
      "seed",
    ]),
    enums: { resolution: HAPPYHORSE_RESOLUTIONS, duration: intRange(3, 15) },
  },
  seedance2: {
    deny: notInSchema("image_to_video", IMAGE_TO_VIDEO_SOURCE, [
      "contentModeration",
      "negativePrompt",
      "outputFormat",
      "proresProfile",
      "resolution",
      "seed",
    ]),
    enums: { duration: intRange(4, 15), ratio: SEEDANCE2_RATIOS },
  },
  seedance2_fast: {
    deny: notInSchema("image_to_video", IMAGE_TO_VIDEO_SOURCE, [
      "contentModeration",
      "negativePrompt",
      "outputFormat",
      "proresProfile",
      "resolution",
      "seed",
    ]),
    enums: { duration: intRange(4, 15), ratio: SEEDANCE2_SMALL_RATIOS },
  },
  seedance2_mini: {
    deny: notInSchema("image_to_video", IMAGE_TO_VIDEO_SOURCE, [
      "contentModeration",
      "negativePrompt",
      "outputFormat",
      "proresProfile",
      "resolution",
      "seed",
    ]),
    enums: { duration: intRange(4, 15), ratio: SEEDANCE2_SMALL_RATIOS },
  },
  seedance2_5: {
    deny: notInSchema("image_to_video", IMAGE_TO_VIDEO_SOURCE, [
      "contentModeration",
      "negativePrompt",
      "outputFormat",
      "proresProfile",
      "resolution",
      "seed",
    ]),
    enums: { duration: intRange(4, 30), ratio: SEEDANCE2_5_RATIOS },
  },
  grok_imagine_1_5: {
    deny: notInSchema("image_to_video", IMAGE_TO_VIDEO_SOURCE, [
      "audio",
      "contentModeration",
      "negativePrompt",
      "outputFormat",
      "proresProfile",
      "ratio",
      "referenceAudio",
      "seed",
    ]),
    enums: { resolution: GROK_IMAGINE_1_5_RESOLUTIONS, duration: intRange(1, 15) },
  },
  gemini_omni_flash: {
    deny: notInSchema("image_to_video", IMAGE_TO_VIDEO_SOURCE, [
      "audio",
      "contentModeration",
      "negativePrompt",
      "outputFormat",
      "proresProfile",
      "referenceAudio",
      "resolution",
      "seed",
    ]),
    enums: { ratio: GEMINI_OMNI_FLASH_RATIOS, duration: intRange(3, 10) },
  },
};

// ---------------------------------------------------------------------------
// POST /v1/text_to_video
// ---------------------------------------------------------------------------

/**
 * Fields each model's arm marks as required (beyond `model`), enforced by a
 * checker in text-to-video.ts. Every arm requires `promptText` except
 * seedance2_5, whose arm marks nothing else required.
 */
export const videoRequired: Readonly<Partial<Record<string, readonly string[]>>> = {
  "gen4.5": ["promptText", "ratio", "duration"],
  "veo3.1": ["promptText", "ratio"],
  "veo3.1_fast": ["promptText", "ratio"],
  hailuo3: ["promptText"],
  happyhorse_1_0: ["promptText"],
  seedance2: ["promptText"],
  seedance2_fast: ["promptText"],
  seedance2_mini: ["promptText"],
  grok_imagine_1_5: ["promptText"],
  gemini_omni_flash: ["promptText"],
};

/** Prompt-length caps and reference-array caps for text_to_video. */
export const videoShapeRules: Readonly<Partial<Record<string, ModelShapeRules>>> = {
  "gen4.5": { promptText: PT_1K },
  "veo3.1": { promptText: PT_1K },
  "veo3.1_fast": { promptText: PT_1K },
  hailuo3: {
    promptText: PT_6K,
    arrays: { references: { max: 9 }, referenceVideos: { max: 3 }, referenceAudio: { max: 3 } },
  },
  happyhorse_1_0: { promptText: PT_HAPPYHORSE },
  seedance2: {
    promptText: PT_3500,
    arrays: { references: { max: 9 }, referenceVideos: { max: 3 }, referenceAudio: { max: 3 } },
  },
  seedance2_fast: {
    promptText: PT_3500,
    arrays: { references: { max: 9 }, referenceVideos: { max: 3 }, referenceAudio: { max: 3 } },
  },
  seedance2_mini: {
    promptText: PT_3500,
    arrays: { references: { max: 9 }, referenceVideos: { max: 3 }, referenceAudio: { max: 3 } },
  },
  seedance2_5: {
    promptText: PT_15K,
    arrays: { references: { max: 30 }, referenceVideos: { max: 10 }, referenceAudio: { max: 10 } },
  },
  grok_imagine_1_5: {
    promptText: PT_2500,
    arrays: { references: { max: 7 }, referenceAudio: { max: 3 } },
  },
  gemini_omni_flash: { promptText: PT_4K },
};

export const videoConstraints: Readonly<Partial<Record<string, EndpointConstraints>>> = {
  "gen4.5": {
    deny: notInSchema("text_to_video", TEXT_TO_VIDEO_SOURCE, [
      "audio",
      "negativePrompt",
      "referenceAudio",
      "referenceVideos",
      "references",
      "resolution",
    ]),
    enums: {
      ratio: GEN45_TEXT_TO_VIDEO_RATIOS,
      duration: intRange(2, 10),
      outputFormat: ["mp4", "prores", "png_sequence"],
      proresProfile: ["422", "4444", "422 Proxy", "422 LT", "422 HQ", "4444 XQ"],
    },
  },
  "veo3.1": {
    deny: notInSchema("text_to_video", TEXT_TO_VIDEO_SOURCE, [
      "contentModeration",
      "outputFormat",
      "proresProfile",
      "referenceAudio",
      "referenceVideos",
      "references",
      "resolution",
      "seed",
    ]),
    enums: { ratio: VEO_RATIOS, duration: [4, 6, 8] },
  },
  "veo3.1_fast": {
    deny: notInSchema("text_to_video", TEXT_TO_VIDEO_SOURCE, [
      "contentModeration",
      "outputFormat",
      "proresProfile",
      "referenceAudio",
      "referenceVideos",
      "references",
      "resolution",
      "seed",
    ]),
    enums: { ratio: VEO_RATIOS, duration: [4, 6, 8] },
  },
  hailuo3: {
    deny: notInSchema("text_to_video", TEXT_TO_VIDEO_SOURCE, [
      "audio",
      "contentModeration",
      "negativePrompt",
      "outputFormat",
      "proresProfile",
      "seed",
    ]),
    enums: { resolution: HAILUO3_RESOLUTIONS, duration: intRange(5, 15), ratio: HAILUO3_RATIOS },
  },
  happyhorse_1_0: {
    deny: notInSchema("text_to_video", TEXT_TO_VIDEO_SOURCE, [
      "audio",
      "contentModeration",
      "negativePrompt",
      "outputFormat",
      "proresProfile",
      "referenceAudio",
      "referenceVideos",
      "references",
      "resolution",
      "seed",
    ]),
    enums: {
      duration: intRange(3, 15),
      ratio: HAPPYHORSE_VIDEO_RATIOS,
    },
  },
  seedance2: {
    deny: notInSchema("text_to_video", TEXT_TO_VIDEO_SOURCE, [
      "contentModeration",
      "negativePrompt",
      "outputFormat",
      "proresProfile",
      "resolution",
      "seed",
    ]),
    enums: { duration: intRange(4, 15), ratio: SEEDANCE2_RATIOS },
  },
  seedance2_fast: {
    deny: notInSchema("text_to_video", TEXT_TO_VIDEO_SOURCE, [
      "contentModeration",
      "negativePrompt",
      "outputFormat",
      "proresProfile",
      "resolution",
      "seed",
    ]),
    enums: { duration: intRange(4, 15), ratio: SEEDANCE2_SMALL_RATIOS },
  },
  seedance2_mini: {
    deny: notInSchema("text_to_video", TEXT_TO_VIDEO_SOURCE, [
      "contentModeration",
      "negativePrompt",
      "outputFormat",
      "proresProfile",
      "resolution",
      "seed",
    ]),
    enums: { duration: intRange(4, 15), ratio: SEEDANCE2_SMALL_RATIOS },
  },
  seedance2_5: {
    deny: notInSchema("text_to_video", TEXT_TO_VIDEO_SOURCE, [
      "contentModeration",
      "negativePrompt",
      "outputFormat",
      "proresProfile",
      "resolution",
      "seed",
    ]),
    enums: { duration: intRange(4, 30), ratio: SEEDANCE2_5_RATIOS },
  },
  grok_imagine_1_5: {
    deny: notInSchema("text_to_video", TEXT_TO_VIDEO_SOURCE, [
      "audio",
      "contentModeration",
      "negativePrompt",
      "outputFormat",
      "proresProfile",
      "referenceVideos",
      "seed",
    ]),
    enums: {
      resolution: GROK_IMAGINE_1_5_RESOLUTIONS,
      duration: intRange(1, 15),
      ratio: GROK_IMAGINE_1_5_RATIOS,
    },
  },
  gemini_omni_flash: {
    deny: notInSchema("text_to_video", TEXT_TO_VIDEO_SOURCE, [
      "audio",
      "contentModeration",
      "negativePrompt",
      "outputFormat",
      "proresProfile",
      "referenceAudio",
      "referenceVideos",
      "references",
      "resolution",
      "seed",
    ]),
    enums: { ratio: GEMINI_OMNI_FLASH_RATIOS, duration: intRange(3, 10) },
  },
};

// ---------------------------------------------------------------------------
// POST /v1/video_to_video — the video-editing route.
//
// Two different input fields split the union: `aleph2` and `gemini_omni_flash`
// take `videoUri`, every seedance/hailuo arm takes `promptVideo`. Sending the
// wrong one is a deny, not a rename — unmodel never rewrites wire params.
// ---------------------------------------------------------------------------

/** `targetAspectRatio` (aleph2 expand/outpaint) — openapi.json. */
export const ALEPH2_TARGET_ASPECT_RATIOS = [
  "16:9",
  "4:3",
  "3:2",
  "1:1",
  "2:3",
  "3:4",
  "9:16",
  "21:9",
] as const;

/**
 * `targetAspectRatio` — aleph2's expand/outpaint target. The spec enumerates
 * exactly these eight; the param is denied on every other video_to_video arm.
 */
export type RunwayTargetAspectRatio = (typeof ALEPH2_TARGET_ASPECT_RATIOS)[number];

/** Fields each model's video_to_video arm marks required (beyond `model`). */
export const videoFromVideoRequired: Readonly<Partial<Record<string, readonly string[]>>> = {
  aleph2: ["videoUri"],
  hailuo3: ["promptVideo", "promptText"],
  seedance2: ["promptVideo"],
  seedance2_fast: ["promptVideo"],
  seedance2_mini: ["promptVideo"],
  seedance2_5: ["promptVideo"],
  gemini_omni_flash: ["videoUri", "promptText"],
};

export const videoFromVideoShapeRules: Readonly<Partial<Record<string, ModelShapeRules>>> = {
  aleph2: { promptText: PT_1K, arrays: { keyframes: { min: 1, max: 5 } } },
  hailuo3: {
    promptText: PT_6K,
    arrays: { references: { max: 9 }, referenceVideos: { max: 2 }, referenceAudio: { max: 3 } },
  },
  seedance2: {
    promptText: PT_3500,
    arrays: { references: { max: 9 }, referenceVideos: { max: 3 }, referenceAudio: { max: 3 } },
  },
  seedance2_fast: {
    promptText: PT_3500,
    arrays: { references: { max: 9 }, referenceVideos: { max: 3 }, referenceAudio: { max: 3 } },
  },
  seedance2_mini: {
    promptText: PT_3500,
    arrays: { references: { max: 9 }, referenceVideos: { max: 3 }, referenceAudio: { max: 3 } },
  },
  seedance2_5: {
    promptText: PT_15K,
    arrays: { references: { max: 30 }, referenceVideos: { max: 9 }, referenceAudio: { max: 10 } },
  },
  gemini_omni_flash: { promptText: PT_4K, arrays: { references: { max: 5 } } },
};

export const videoFromVideoConstraints: Readonly<Partial<Record<string, EndpointConstraints>>> = {
  aleph2: {
    deny: notInSchema("video_to_video", VIDEO_TO_VIDEO_SOURCE, [
      "audio",
      "duration",
      "mode",
      "promptVideo",
      "referenceAudio",
      "referenceVideos",
      "references",
      "resolution",
    ]),
    enums: {
      targetAspectRatio: ALEPH2_TARGET_ASPECT_RATIOS,
      outputFormat: ["mp4", "prores", "png_sequence"],
      proresProfile: ["422", "4444", "422 Proxy", "422 LT", "422 HQ", "4444 XQ"],
    },
    // "The input video to edit. Must be 30 seconds or shorter." — openapi.json.
    // unmodel cannot read a remote URI, so this is published metadata rather
    // than an enforced check.
    media: { video: { maxDurationSeconds: 30 } },
    // `ratio` is present but marked `deprecated: true` with no enum, so it is
    // neither denied nor narrowed — use `targetAspectRatio` instead.
  },
  hailuo3: {
    deny: notInSchema("video_to_video", VIDEO_TO_VIDEO_SOURCE, [
      "audio",
      "contentModeration",
      "keyframes",
      "mode",
      "negativePrompt",
      "outputFormat",
      "proresProfile",
      "seed",
      "targetAspectRatio",
      "videoUri",
    ]),
    enums: { resolution: HAILUO3_RESOLUTIONS, duration: intRange(5, 15), ratio: HAILUO3_RATIOS },
  },
  seedance2: {
    deny: notInSchema("video_to_video", VIDEO_TO_VIDEO_SOURCE, [
      "contentModeration",
      "keyframes",
      "mode",
      "negativePrompt",
      "outputFormat",
      "proresProfile",
      "resolution",
      "seed",
      "targetAspectRatio",
      "videoUri",
    ]),
    enums: { duration: intRange(4, 15), ratio: SEEDANCE2_RATIOS },
  },
  seedance2_fast: {
    deny: notInSchema("video_to_video", VIDEO_TO_VIDEO_SOURCE, [
      "contentModeration",
      "keyframes",
      "mode",
      "negativePrompt",
      "outputFormat",
      "proresProfile",
      "resolution",
      "seed",
      "targetAspectRatio",
      "videoUri",
    ]),
    enums: { duration: intRange(4, 15), ratio: SEEDANCE2_SMALL_RATIOS },
  },
  seedance2_mini: {
    deny: notInSchema("video_to_video", VIDEO_TO_VIDEO_SOURCE, [
      "contentModeration",
      "keyframes",
      "mode",
      "negativePrompt",
      "outputFormat",
      "proresProfile",
      "resolution",
      "seed",
      "targetAspectRatio",
      "videoUri",
    ]),
    enums: { duration: intRange(4, 15), ratio: SEEDANCE2_SMALL_RATIOS },
  },
  seedance2_5: {
    deny: notInSchema("video_to_video", VIDEO_TO_VIDEO_SOURCE, [
      "contentModeration",
      "keyframes",
      "negativePrompt",
      "outputFormat",
      "proresProfile",
      "resolution",
      "seed",
      "targetAspectRatio",
      "videoUri",
    ]),
    // `mode` exists only on this arm, and only on this route.
    enums: {
      mode: ["reference", "extend"],
      duration: intRange(4, 30),
      ratio: SEEDANCE2_5_RATIOS,
    },
  },
  gemini_omni_flash: {
    deny: notInSchema("video_to_video", VIDEO_TO_VIDEO_SOURCE, [
      "audio",
      "contentModeration",
      "duration",
      "keyframes",
      "mode",
      "negativePrompt",
      "outputFormat",
      "promptVideo",
      "proresProfile",
      "ratio",
      "referenceAudio",
      "referenceVideos",
      "resolution",
      "seed",
      "targetAspectRatio",
    ]),
  },
};

// ---------------------------------------------------------------------------
// POST /v1/text_to_image
// ---------------------------------------------------------------------------

const GEN4_IMAGE_RATIOS = [
  "1024:1024",
  "1080:1080",
  "1168:880",
  "1360:768",
  "1440:1080",
  "1080:1440",
  "1808:768",
  "1920:1080",
  "1080:1920",
  "2112:912",
  "1280:720",
  "720:1280",
  "720:720",
  "960:720",
  "720:960",
  "1680:720",
] as const;

const GEMINI_25_FLASH_RATIOS = [
  "1344:768",
  "768:1344",
  "1024:1024",
  "1184:864",
  "864:1184",
  "1536:672",
  "832:1248",
  "1248:832",
  "896:1152",
  "1152:896",
] as const;

const GEMINI_IMAGE3_PRO_RATIOS = [
  ...GEMINI_25_FLASH_RATIOS,
  "2048:2048",
  "1696:2528",
  "2528:1696",
  "1792:2400",
  "2400:1792",
  "1856:2304",
  "2304:1856",
  "1536:2752",
  "2752:1536",
  "3168:1344",
  "4096:4096",
  "3392:5056",
  "5056:3392",
  "3584:4800",
  "4800:3584",
  "3712:4608",
  "4608:3712",
  "3072:5504",
  "5504:3072",
  "6336:2688",
] as const;

const GEMINI_IMAGE31_FLASH_RATIOS = [
  "512:512",
  "416:624",
  "624:416",
  "432:592",
  "592:432",
  "448:576",
  "576:448",
  "384:672",
  "672:384",
  "768:336",
  "256:1024",
  "1024:256",
  "176:1408",
  "1408:176",
  "1024:1024",
  "832:1248",
  "1248:832",
  "864:1184",
  "1184:864",
  "896:1152",
  "1152:896",
  "768:1344",
  "1344:768",
  "1536:672",
  "512:2048",
  "2048:512",
  "352:2816",
  "2816:352",
  "2048:2048",
  "1696:2528",
  "2528:1696",
  "1792:2400",
  "2400:1792",
  "1856:2304",
  "2304:1856",
  "1536:2752",
  "2752:1536",
  "3168:1344",
  "1024:4096",
  "4096:1024",
  "704:5632",
  "5632:704",
  "4096:4096",
  "3392:5056",
  "5056:3392",
  "3584:4800",
  "4800:3584",
  "3712:4608",
  "4608:3712",
  "3072:5504",
  "5504:3072",
  "6336:2688",
  "2048:8192",
  "8192:2048",
  "1408:11264",
  "11264:1408",
] as const;

const GPT_IMAGE_2_RATIOS = [
  "2048:880",
  "1920:1088",
  "1920:1280",
  "1920:1440",
  "1920:1536",
  "1920:1920",
  "1536:1920",
  "1440:1920",
  "1280:1920",
  "1088:1920",
  "2912:1248",
  "2560:1440",
  "2560:1712",
  "2560:1920",
  "2560:2048",
  "2560:2560",
  "2048:2560",
  "1920:2560",
  "1712:2560",
  "1440:2560",
  "3840:1648",
  "3840:2160",
  "3504:2336",
  "3264:2448",
  "3200:2560",
  "2880:2880",
  "2560:3200",
  "2448:3264",
  "2336:3504",
  "2160:3840",
  "auto",
] as const;

const SEEDREAM5_PRO_RATIOS = [
  "1024:1024",
  "1184:896",
  "896:1184",
  "1376:768",
  "768:1376",
  "1296:864",
  "864:1296",
  "2048:2048",
  "2304:1728",
  "1728:2304",
  "2720:1530",
  "1530:2720",
  "2496:1664",
  "1664:2496",
  "auto_1k",
  "auto_2k",
] as const;

const SEEDREAM5_LITE_RATIOS = [
  "2048:2048",
  "2304:1728",
  "1728:2304",
  "2848:1600",
  "1600:2848",
  "2496:1664",
  "1664:2496",
  "3136:1344",
  "3072:3072",
  "3456:2592",
  "2592:3456",
  "4096:2304",
  "2304:4096",
  "3744:2496",
  "2496:3744",
  "4704:2016",
] as const;

const GROK_IMAGINE_IMAGE_2_RATIOS = [
  "1024:1024",
  "1280:720",
  "720:1280",
  "1152:864",
  "864:1152",
  "1248:832",
  "832:1248",
  "1248:576",
  "576:1248",
  "1280:576",
  "576:1280",
  "1408:704",
  "704:1408",
  "2048:2048",
  "2816:1584",
  "1584:2816",
  "2368:1776",
  "1776:2368",
  "2496:1664",
  "1664:2496",
  "2912:1344",
  "1344:2912",
  "3200:1440",
  "1440:3200",
  "2912:1456",
  "1456:2912",
  "auto_1k",
  "auto_2k",
] as const;

/** `quality` on gpt_image_2 — the only image arm with the full four-step scale. */
const GPT_IMAGE_2_QUALITIES = ["low", "medium", "high", "auto"] as const;

/** `quality` on grok_imagine_image_2 — the only other arm that declares it. */
const GROK_IMAGINE_IMAGE_2_QUALITIES = ["low", "medium"] as const;

/** `outputFormat` on the two seedream5 arms — the only arms that declare it. */
const IMAGE_OUTPUT_FORMATS = ["png", "jpeg"] as const;

/**
 * `ratio` values across every documented text_to_image model. Each model
 * accepts only its own slice (narrowed at runtime by the `enums` tables
 * below), and the keyword forms are model-specific too: `"auto"` is
 * gpt_image_2 only, `"auto_1k"`/`"auto_2k"` are seedream5_pro and
 * grok_imagine_image_2 only — seedream5_lite has neither. The named arms are
 * autocomplete for the documented space; `${number}:${number}` keeps the
 * pixel-pair form open for models unmodel has no arm for yet, while making
 * non-ratio strings a compile error.
 */
export type RunwayImageRatio =
  | (typeof GEN4_IMAGE_RATIOS)[number]
  | (typeof GEMINI_25_FLASH_RATIOS)[number]
  | (typeof GEMINI_IMAGE3_PRO_RATIOS)[number]
  | (typeof GEMINI_IMAGE31_FLASH_RATIOS)[number]
  | (typeof GPT_IMAGE_2_RATIOS)[number]
  | (typeof SEEDREAM5_PRO_RATIOS)[number]
  | (typeof SEEDREAM5_LITE_RATIOS)[number]
  | (typeof GROK_IMAGINE_IMAGE_2_RATIOS)[number]
  | (`${number}:${number}` & {});

/** `quality` across the two text_to_image arms that declare it. */
export type RunwayImageQuality =
  | (typeof GPT_IMAGE_2_QUALITIES)[number]
  | (typeof GROK_IMAGINE_IMAGE_2_QUALITIES)[number];

/** `outputFormat` on text_to_image (seedream5_pro / seedream5_lite only). */
export type RunwayImageOutputFormat = (typeof IMAGE_OUTPUT_FORMATS)[number];

/**
 * Fields each model's arm marks as required beyond the schema-level
 * `promptText` + `ratio` (all arms require those), enforced by a checker in
 * text-to-image.ts.
 */
export const imageRequired: Readonly<Partial<Record<string, readonly string[]>>> = {
  gen4_image_turbo: ["referenceImages"],
};

/**
 * Prompt caps, `referenceImages` caps, and which sub-fields each model's
 * reference-image item accepts. `tag` rides the gen4 / gpt_image_2 / gemini
 * arms; `subject` exists only on the gemini_image3 family; the seedream and
 * grok arms take bare `{ uri }` objects and reject both.
 */
export const imageShapeRules: Readonly<Partial<Record<string, ModelShapeRules>>> = {
  gen4_image: {
    promptText: PT_1K,
    arrays: { referenceImages: { max: 3 } },
    referenceImageFields: ["tag"],
  },
  gen4_image_turbo: {
    promptText: PT_1K,
    arrays: { referenceImages: { min: 1, max: 3 } },
    referenceImageFields: ["tag"],
  },
  gpt_image_2: {
    promptText: { min: 1, max: 32000 },
    arrays: { referenceImages: { max: 16 } },
    referenceImageFields: ["tag"],
  },
  gemini_image3_pro: {
    promptText: PT_5500,
    arrays: { referenceImages: { max: 14 } },
    referenceImageFields: ["tag", "subject"],
  },
  "gemini_image3.1_flash": {
    promptText: PT_5500,
    arrays: { referenceImages: { max: 14 } },
    referenceImageFields: ["tag", "subject"],
  },
  seedream5_pro: {
    promptText: PT_4K,
    arrays: { referenceImages: { max: 10 } },
    referenceImageFields: [],
  },
  seedream5_lite: {
    promptText: PT_4K,
    arrays: { referenceImages: { max: 14 } },
    referenceImageFields: [],
  },
  grok_imagine_image_2: {
    promptText: PT_2500,
    arrays: { referenceImages: { max: 3 } },
    referenceImageFields: [],
  },
  "gemini_2.5_flash": {
    promptText: PT_5500,
    arrays: { referenceImages: { max: 3 } },
    referenceImageFields: ["tag"],
  },
};

export const imageConstraints: Readonly<Partial<Record<string, EndpointConstraints>>> = {
  gen4_image: {
    deny: notInSchema("text_to_image", TEXT_TO_IMAGE_SOURCE, [
      "background",
      "edit",
      "grounding",
      "outputCount",
      "outputFormat",
      "quality",
    ]),
    enums: { ratio: GEN4_IMAGE_RATIOS },
  },
  gen4_image_turbo: {
    deny: notInSchema("text_to_image", TEXT_TO_IMAGE_SOURCE, [
      "background",
      "edit",
      "grounding",
      "outputCount",
      "outputFormat",
      "quality",
    ]),
    enums: { ratio: GEN4_IMAGE_RATIOS },
  },
  gpt_image_2: {
    deny: notInSchema("text_to_image", TEXT_TO_IMAGE_SOURCE, [
      "contentModeration",
      "edit",
      "grounding",
      "outputFormat",
      "seed",
    ]),
    enums: {
      ratio: GPT_IMAGE_2_RATIOS,
      quality: GPT_IMAGE_2_QUALITIES,
      background: ["opaque", "auto"],
      outputCount: intRange(1, 10),
    },
  },
  gemini_image3_pro: {
    deny: notInSchema("text_to_image", TEXT_TO_IMAGE_SOURCE, [
      "background",
      "contentModeration",
      "edit",
      "grounding",
      "outputFormat",
      "quality",
      "seed",
    ]),
    enums: { ratio: GEMINI_IMAGE3_PRO_RATIOS, outputCount: [1, 4] },
  },
  "gemini_image3.1_flash": {
    deny: notInSchema("text_to_image", TEXT_TO_IMAGE_SOURCE, [
      "background",
      "contentModeration",
      "edit",
      "grounding",
      "outputFormat",
      "quality",
      "seed",
    ]),
    enums: { ratio: GEMINI_IMAGE31_FLASH_RATIOS, outputCount: [1, 4] },
  },
  seedream5_pro: {
    deny: notInSchema("text_to_image", TEXT_TO_IMAGE_SOURCE, [
      "background",
      "contentModeration",
      "edit",
      "quality",
      "seed",
    ]),
    enums: {
      ratio: SEEDREAM5_PRO_RATIOS,
      outputFormat: IMAGE_OUTPUT_FORMATS,
      outputCount: intRange(1, 4),
    },
  },
  seedream5_lite: {
    deny: notInSchema("text_to_image", TEXT_TO_IMAGE_SOURCE, [
      "background",
      "contentModeration",
      "edit",
      "quality",
      "seed",
    ]),
    enums: {
      ratio: SEEDREAM5_LITE_RATIOS,
      outputFormat: IMAGE_OUTPUT_FORMATS,
      outputCount: intRange(1, 4),
    },
  },
  grok_imagine_image_2: {
    deny: notInSchema("text_to_image", TEXT_TO_IMAGE_SOURCE, [
      "background",
      "contentModeration",
      "grounding",
      "outputFormat",
      "seed",
    ]),
    enums: {
      ratio: GROK_IMAGINE_IMAGE_2_RATIOS,
      quality: GROK_IMAGINE_IMAGE_2_QUALITIES,
      outputCount: intRange(1, 4),
    },
  },
  "gemini_2.5_flash": {
    deny: notInSchema("text_to_image", TEXT_TO_IMAGE_SOURCE, [
      "background",
      "contentModeration",
      "edit",
      "grounding",
      "outputCount",
      "outputFormat",
      "quality",
      "seed",
    ]),
    enums: { ratio: GEMINI_25_FLASH_RATIOS },
  },
};
