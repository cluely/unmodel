/**
 * Per-model constraint tables for the Runway API's generation routes,
 * transcribed from the official OpenAPI spec (spec version 2024-11-06):
 * https://docs.dev.runwayml.com/openapi.json — every arm verified 2026-11-12
 * (the `bitrate` / `draft` / `draftTaskId` fields of the seedance arms are
 * not yet typed, so they pass as unknown params). Each route's request body
 * is a strict per-model union there, so a param absent from a model's arm is
 * rejected (or ignored) by the API; those are the `deny` rules. `enums` carry
 * each arm's documented ratio/duration/resolution/quality values; integer
 * ranges (e.g. duration 2–10) are expanded to explicit lists.
 */

import type { EndpointConstraints, DenyRule } from "../../core/constraint-types";
import type { ModelShapeRules, PairingRule } from "./shared";
import {
  ALEPH2_TARGET_ASPECT_RATIOS,
  IMAGE_TO_VIDEO_MODELS,
  SEEDANCE2_SMALL_RATIOS,
  TEXT_TO_VIDEO_MODELS,
  VIDEO_TO_VIDEO_MODELS,
} from "./video-lists";

export const IMAGE_TO_VIDEO_SOURCE =
  "https://docs.dev.runwayml.com/api#tag/Start-generating/paths/~1v1~1image_to_video/post";
export const TEXT_TO_VIDEO_SOURCE =
  "https://docs.dev.runwayml.com/api#tag/Start-generating/paths/~1v1~1text_to_video/post";
export const VIDEO_TO_VIDEO_SOURCE =
  "https://docs.dev.runwayml.com/api#tag/Start-generating/paths/~1v1~1video_to_video/post";
export const TEXT_TO_IMAGE_SOURCE =
  "https://docs.dev.runwayml.com/api#tag/Start-generating/paths/~1v1~1text_to_image/post";

export const MODELS_SOURCE = "https://docs.dev.runwayml.com/guides/models.md";

/** Per-model input rules the spec states only in prose. */
export const INPUTS_SOURCE = "https://docs.dev.runwayml.com/assets/inputs.md";

// The lists `unmodel/runway/values` publishes live on an import-free leaf;
// see ./video-lists.ts. Re-exported so the wire modules read one module.
export {
  IMAGE_TO_VIDEO_MODELS,
  TEXT_TO_VIDEO_MODELS,
  VIDEO_TO_VIDEO_MODELS,
  SEEDANCE2_SMALL_RATIOS,
  ALEPH2_TARGET_ASPECT_RATIOS,
};

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

/** The same row under each id of a family whose arms are identical on a route. */
function rowsFor<T>(models: readonly string[], row: T): Record<string, T> {
  return Object.fromEntries(models.map((model) => [model, row]));
}

// Families whose arms differ, if at all, only in their `ratio` enum.
const KLING3_MODELS = ["kling3.0_standard", "kling3.0_pro", "kling3.0_4k"] as const;
const KLING_O3_MODELS = ["klingO3_standard", "klingO3_pro", "klingO3_4k"] as const;
const WAN3_MODELS = ["wan3", "wan3_prime"] as const;
const GEMINI_OMNI_FLASH_1X_MODELS = ["gemini_omni_flash_1.1", "gemini_omni_flash_1.2"] as const;

// ---------------------------------------------------------------------------
// Shared promptText length caps (openapi.json minLength/maxLength per arm).
// Every arm caps prompt length, and the caps differ by an order of magnitude
// across models (1000 for the gen4/veo/aleph family, 15000 for seedance2_5).
// ---------------------------------------------------------------------------

const PT_1K = { min: 1, max: 1000 } as const;
const PT_2500 = { min: 1, max: 2500 } as const;
const PT_4K = { min: 1, max: 4000 } as const;
const PT_6K = { min: 1, max: 6000 } as const;
/** seedance2 / fast / mini: "max length 10000" on every route (openapi.json, 2026-11-12). */
const PT_10K = { min: 1, max: 10000 } as const;
const PT_15K = { min: 1, max: 15000 } as const;
const PT_20K = { min: 1, max: 20000 } as const;
const PT_26K = { min: 1, max: 26000 } as const;
/**
 * The Gemini image arms' `promptText`: "max length 45000" (openapi.json,
 * 2026-11-12). The changelog's prose still says 5,500 characters; the
 * validation schema governs, so a prompt the API accepts is never refused.
 */
const PT_45K = { min: 1, max: 45000 } as const;
/** happyhorse_1_0 and the Kling 2.5 / 3.0 / O3 arms carry minLength 2. */
const PT_2500_MIN2 = { min: 2, max: 2500 } as const;

// ---------------------------------------------------------------------------
// Shared ratio enums (openapi.json, verified 2026-11-12)
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

/**
 * seedance2_5 on every route: seedance2's 24-value ladder with `854:480` /
 * `480:854` in place of `864:496` / `496:864` (openapi.json, 2026-11-12). The
 * 4K sizes are accepted on the wire, though guides/pricing.md publishes no
 * Seedance 2.5 4K rate ("4K stays on Seedance 2.0" — the 2026-08-15
 * changelog), so they get no estimate.
 */
export const SEEDANCE2_5_1080P_RATIOS = [
  "2206:946",
  "1920:1080",
  "1664:1248",
  "1440:1440",
  "1248:1664",
  "1080:1920",
] as const;
export const SEEDANCE2_5_4K_RATIOS = [
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
  ...SEEDANCE2_5_1080P_RATIOS,
  ...SEEDANCE2_5_4K_RATIOS,
] as const;

/** seedance2_5 `outputFormat`: "one of `mp4`, `mov` … Draft mode only supports `mp4`." */
const SEEDANCE2_5_OUTPUT_FORMATS = ["mp4", "mov"] as const;

/**
 * gen4.5 `outputFormat` (image_to_video, text_to_video): "one of `mp4`,
 * `prores`, `png_sequence`, `hdr10`, `hlg`, `sdr_rec709_10bit`,
 * `hdr_pq_12bit_master`, `hdr_prores`, `hdr_png_sequence`, `hdr_exr_sequence`,
 * `hdr_exr_acescg_sequence_1_3`, `hdr_exr_acescg_sequence_2_0`" — api.md,
 * 2026-11-12 ("These formats are being enabled progressively per account").
 */
export const GEN45_OUTPUT_FORMATS = [
  "mp4",
  "prores",
  "png_sequence",
  "hdr10",
  "hlg",
  "sdr_rec709_10bit",
  "hdr_pq_12bit_master",
  "hdr_prores",
  "hdr_png_sequence",
  "hdr_exr_sequence",
  "hdr_exr_acescg_sequence_1_3",
  "hdr_exr_acescg_sequence_2_0",
] as const;

/** aleph2 `outputFormat`: "one of `mp4`, `prores`, `png_sequence`, `sdr_rec709_10bit`". */
export const ALEPH2_OUTPUT_FORMATS = ["mp4", "prores", "png_sequence", "sdr_rec709_10bit"] as const;

/** `outputFormat` across every video arm that declares it — the route schemas' enum. */
export const VIDEO_OUTPUT_FORMATS = [...GEN45_OUTPUT_FORMATS, "mov"] as const;

/** `outputFormat` across every video arm that declares it. */
export type RunwayVideoOutputFormat = (typeof VIDEO_OUTPUT_FORMATS)[number];

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

// Kling 2.5 / 3.0 / O3 (openapi.json, 2026-11-12). The O3 arms share the 3.0
// enums: "Kling O3 Standard, Pro, and 4K use the same durations, ratios, and
// `audio` default as Kling 3.0" (assets/inputs.md, 2026-11-12).

/** kling2.5_turbo_pro on text_to_video (it has no `ratio` on image_to_video). */
const KLING2_5_TURBO_PRO_RATIOS = [
  "1920:1080",
  "1440:1440",
  "1080:1920",
  "1280:720",
  "720:720",
  "720:1280",
] as const;
const KLING3_STANDARD_RATIOS = ["1280:720", "720:1280", "960:960"] as const;
const KLING3_PRO_RATIOS = ["1920:1080", "1080:1920", "1440:1440"] as const;
const KLING3_4K_RATIOS = ["3840:2160", "2160:3840", "2880:2880"] as const;

/** `auto_<tier>`: "model-chosen framing" at one quality tier. */
const AUTO_RATIOS = ["auto_480p", "auto_720p", "auto_1080p"] as const;

/**
 * wan3 / wan3_prime `ratio`, by tier. The spec enum lists the fifteen sizes as
 * three runs of the same five shapes, 480p then 720p then 1080p, followed by
 * one `auto_*` token per tier; "WAN 3.0 supports 480p, 720p, and 1080p
 * (default `auto_1080p`)" (assets/inputs.md, 2026-11-12).
 */
const WAN3_RATIOS_BY_TIER = {
  "480p": ["832:480", "720:544", "624:624", "544:720", "480:832"],
  "720p": ["1280:720", "1104:832", "960:960", "832:1104", "720:1280"],
  "1080p": ["1920:1080", "1648:1248", "1440:1440", "1248:1648", "1080:1920"],
} as const;
const WAN3_RATIOS = [
  ...WAN3_RATIOS_BY_TIER["480p"],
  ...WAN3_RATIOS_BY_TIER["720p"],
  ...WAN3_RATIOS_BY_TIER["1080p"],
  ...AUTO_RATIOS,
] as const;

/**
 * grok_imagine_1_5_lite on text_to_video, by tier: "21 `width:height` ratios
 * across 480p, 720p, and 1080p (default `848:480`), covering 16:9, 9:16, 1:1,
 * 4:3, 3:4, 3:2, and 2:3" (assets/inputs.md, 2026-11-12) — the spec enum is
 * those seven shapes at each tier in turn. On image_to_video the arm takes
 * the three `auto_*` tokens instead.
 */
const GROK_IMAGINE_1_5_LITE_RATIOS_BY_TIER = {
  "480p": ["848:480", "480:848", "480:480", "640:480", "480:640", "720:480", "480:720"],
  "720p": ["1280:720", "720:1280", "720:720", "960:720", "720:960", "1088:720", "720:1088"],
  "1080p": ["1904:1072", "1072:1904", "1424:1424", "1648:1232", "1232:1648", "1744:1152", "1152:1744"],
} as const;
const GROK_IMAGINE_1_5_LITE_RATIOS = [
  ...GROK_IMAGINE_1_5_LITE_RATIOS_BY_TIER["480p"],
  ...GROK_IMAGINE_1_5_LITE_RATIOS_BY_TIER["720p"],
  ...GROK_IMAGINE_1_5_LITE_RATIOS_BY_TIER["1080p"],
] as const;

/**
 * gemini_omni_flash_1.1 / 1.2 `ratio` on every route, by the tiers
 * guides/pricing.md bills them at ("(360p)", "(720p)", "(1080p)", "(4K)",
 * 2026-11-12).
 */
const GEMINI_OMNI_FLASH_1X_RATIOS_BY_TIER = {
  "360p": ["640:360", "360:640"],
  "720p": ["1280:720", "720:1280"],
  "1080p": ["1920:1080", "1080:1920"],
  "4k": ["3840:2160", "2160:3840"],
} as const;
const GEMINI_OMNI_FLASH_1X_RATIOS = [
  ...GEMINI_OMNI_FLASH_1X_RATIOS_BY_TIER["360p"],
  ...GEMINI_OMNI_FLASH_1X_RATIOS_BY_TIER["720p"],
  ...GEMINI_OMNI_FLASH_1X_RATIOS_BY_TIER["1080p"],
  ...GEMINI_OMNI_FLASH_1X_RATIOS_BY_TIER["4k"],
] as const;

/**
 * kling_4 on text_to_video, by tier: "`ratio` selects the output size:
 * `1280:720`, `720:1280`, `940:940`, or `1460:624` at 720p; `1920:1080`,
 * `1080:1920`, `1440:1440`, or `2200:940` at 1080p. Use `auto_720p` or
 * `auto_1080p` for model-chosen framing." (assets/inputs.md, 2026-11-12).
 * image_to_video and video_to_video take the two `auto_*` tokens only.
 */
const KLING4_RATIOS_BY_TIER = {
  "720p": ["1280:720", "720:1280", "940:940", "1460:624"],
  "1080p": ["1920:1080", "1080:1920", "1440:1440", "2200:940"],
} as const;
const KLING4_AUTO_RATIOS = ["auto_720p", "auto_1080p"] as const;
const KLING4_RATIOS = [
  ...KLING4_RATIOS_BY_TIER["720p"],
  ...KLING4_RATIOS_BY_TIER["1080p"],
  ...KLING4_AUTO_RATIOS,
] as const;

/**
 * kling_4_flash on text_to_video and video_to_video — all 720p: "generates
 * 3–20 seconds (default 5) at 720p … Legacy values `940:940` and `1460:624`
 * remain accepted as aliases" (assets/inputs.md, 2026-11-12). Its
 * image_to_video arm takes `auto_720p` alone.
 */
const KLING4_FLASH_RATIOS = [
  "1280:720",
  "720:1280",
  "960:960",
  "1464:628",
  "auto_720p",
  "940:940",
  "1460:624",
] as const;

/**
 * A ratio's billing tier, for the models whose price follows `ratio`. `360p`
 * is Gemini Omni Flash 1.x's lowest tier, which the canonical video
 * vocabulary has no word for.
 */
export type RunwayRatioTier = "360p" | "480p" | "720p" | "1080p" | "4k";

/**
 * One model's ratio → tier lookup: each group's sizes, plus whichever
 * `auto_<tier>` tokens its arms take (each names its own tier).
 */
function byTier(
  groups: Readonly<Partial<Record<RunwayRatioTier, readonly string[]>>>,
  autos: readonly string[] = [],
): Readonly<Record<string, RunwayRatioTier>> {
  const table: Record<string, RunwayRatioTier> = {};
  for (const [tier, ratios] of Object.entries(groups) as Array<[RunwayRatioTier, readonly string[]]>) {
    for (const ratio of ratios) table[ratio] = tier;
  }
  for (const auto of autos) table[auto] = auto.slice("auto_".length) as RunwayRatioTier;
  return table;
}

/**
 * Which tier each `ratio` value bills at, per model — the documented or
 * spec-evident grouping above, shared by ./pricing.ts (the price) and the
 * unified video adapter (which tier a pixel pair answers for).
 */
export const RATIO_TIERS: Readonly<Record<string, Readonly<Record<string, RunwayRatioTier>>>> = {
  wan3: byTier(WAN3_RATIOS_BY_TIER, AUTO_RATIOS),
  wan3_prime: byTier(WAN3_RATIOS_BY_TIER, AUTO_RATIOS),
  grok_imagine_1_5_lite: byTier(GROK_IMAGINE_1_5_LITE_RATIOS_BY_TIER, AUTO_RATIOS),
  "gemini_omni_flash_1.1": byTier(GEMINI_OMNI_FLASH_1X_RATIOS_BY_TIER),
  "gemini_omni_flash_1.2": byTier(GEMINI_OMNI_FLASH_1X_RATIOS_BY_TIER),
  kling_4: byTier(KLING4_RATIOS_BY_TIER, KLING4_AUTO_RATIOS),
  // Every kling_4_flash size, `auto_720p` included, is 720p.
  kling_4_flash: byTier({ "720p": KLING4_FLASH_RATIOS }),
};

// ---------------------------------------------------------------------------
// Shared `resolution` enums. The casing is genuinely per model in the spec —
// hailuo3 uses "2k"/"768p" (and the deprecated "2K"/"768P"), happyhorse_1_0
// "720p"/"1080p" (and "720P"/"1080P"),
// grok_imagine_1_5 lowercase "480p"/"720p"/"1080p", h3_max "480p"/"768p" and
// gemini_omni_flash_1.2 (video_to_video) "360p"…"4k" — so the per-model
// tables below stay separate; only the type-level union is shared.
// ---------------------------------------------------------------------------

/**
 * "one of `768p`, `2k`, `768P`, `2K`" on every route; the upper-case pair is
 * marked deprecated ("Use \"768p\" instead.") — openapi.json, 2026-11-12.
 */
const HAILUO3_RESOLUTIONS = ["768p", "2k", "768P", "2K"] as const;
/** happyhorse_1_0 image_to_video: "one of `720p`, `1080p`, `720P`, `1080P`". */
const HAPPYHORSE_RESOLUTIONS = ["720p", "1080p", "720P", "1080P"] as const;
const GROK_IMAGINE_1_5_RESOLUTIONS = ["480p", "720p", "1080p"] as const;
/** "MiniMax H3 Max supports 480p and 768p." — openapi.json, 2026-11-12. */
const H3_MAX_RESOLUTIONS = ["480p", "768p"] as const;
/**
 * "The output resolution when editing or extending a video. In reference
 * mode, use ratio instead." — openapi.json, 2026-11-12.
 */
const GEMINI_OMNI_FLASH_1_2_RESOLUTIONS = ["360p", "720p", "1080p", "4k"] as const;

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
  | (typeof KLING2_5_TURBO_PRO_RATIOS)[number]
  | (typeof KLING3_STANDARD_RATIOS)[number]
  | (typeof KLING3_PRO_RATIOS)[number]
  | (typeof KLING3_4K_RATIOS)[number]
  | (typeof WAN3_RATIOS)[number]
  | (typeof GROK_IMAGINE_1_5_LITE_RATIOS)[number]
  | (typeof GEMINI_OMNI_FLASH_1X_RATIOS)[number]
  | (typeof KLING4_RATIOS)[number]
  | (typeof KLING4_FLASH_RATIOS)[number]
  | (`${number}:${number}` & {});

/**
 * `resolution` values across every video model that declares the param. Each
 * model accepts only its own casing (see above); the runtime tables reject
 * the others, and every model that has no `resolution` at all denies the
 * param outright.
 */
export type RunwayVideoResolution =
  | (typeof HAILUO3_RESOLUTIONS)[number]
  | (typeof HAPPYHORSE_RESOLUTIONS)[number]
  | (typeof GROK_IMAGINE_1_5_RESOLUTIONS)[number]
  | (typeof H3_MAX_RESOLUTIONS)[number]
  | (typeof GEMINI_OMNI_FLASH_1_2_RESOLUTIONS)[number];

/** `promptExpansionMode` (h3_max): "disabled", "balanced" (the default) or "quality". */
export const H3_MAX_PROMPT_EXPANSION_MODES = ["disabled", "balanced", "quality"] as const;

// ---------------------------------------------------------------------------
// Rules several new arms share across routes
// ---------------------------------------------------------------------------

/**
 * Kling 3.0 / O3 multishot: "Total duration across all segments must be
 * between 3 and 15 seconds. `promptText` is still required when `shotType` is
 * \"intelligence\"." — the `providerSettings.multiPrompt` description,
 * openapi.json, 2026-11-12.
 */
const KLING_MULTISHOT_RULES = {
  multiPromptSeconds: { min: 3, max: 15 },
  pairings: [
    {
      if: { path: ["providerSettings", "shotType"], values: ["intelligence"] },
      then: { path: ["promptText"], present: true },
      message: '`promptText` is required when `providerSettings.shotType` is "intelligence"',
      source: INPUTS_SOURCE,
    },
  ],
} as const satisfies ModelShapeRules;

/**
 * "A last keyframe and `multiPrompt` cannot be combined." — Kling O3,
 * assets/inputs.md, 2026-11-12.
 */
const KLING_O3_LAST_FRAME_RULE: PairingRule = {
  if: { path: ["providerSettings", "multiPrompt"] },
  then: { path: ["promptImage"], withoutPosition: "last" },
  message: "A `last` keyframe and `providerSettings.multiPrompt` cannot be combined",
  source: INPUTS_SOURCE,
};

/**
 * kling_4: "`promptText` is required except when image-to-video uses only
 * frames."; kling_4_flash: "it may be omitted only for image-to-video without
 * references." — assets/inputs.md, 2026-11-12. Required outright on their
 * other routes (the `*Required` tables); on image_to_video, required as soon
 * as a reference rides along.
 */
const KLING4_PROMPT_WITH_REFERENCES: readonly PairingRule[] = [
  {
    if: { path: ["references"] },
    then: { path: ["promptText"], present: true },
    message: "`promptText` is required when `references` are sent",
    source: INPUTS_SOURCE,
  },
  {
    if: { path: ["referenceVideos"] },
    then: { path: ["promptText"], present: true },
    message: "`promptText` is required when `referenceVideos` are sent",
    source: INPUTS_SOURCE,
  },
];

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
  "kling2.5_turbo_pro": ["promptText"],
  wan3: ["promptText"],
  wan3_prime: ["promptText"],
  h3_max: ["promptText"],
  "gemini_omni_flash_1.1": ["promptText"],
  "gemini_omni_flash_1.2": ["promptText"],
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
    promptText: PT_2500_MIN2,
    arrays: { promptImage: { min: 1, max: 1 } },
    promptImagePositions: ["first"],
    promptImagePositionRequired: true,
  },
  seedance2: {
    promptText: PT_10K,
    arrays: { referenceAudio: { max: 3 } },
    promptImagePositions: ["first", "last"],
  },
  seedance2_fast: {
    promptText: PT_10K,
    arrays: { referenceAudio: { max: 3 } },
    promptImagePositions: ["first", "last"],
  },
  seedance2_mini: {
    promptText: PT_10K,
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
  "kling2.5_turbo_pro": {
    promptText: PT_2500_MIN2,
    arrays: { promptImage: { min: 1, max: 2 } },
    promptImagePositionRequired: true,
  },
  ...rowsFor(KLING3_MODELS, {
    promptText: PT_2500_MIN2,
    arrays: { promptImage: { min: 1, max: 2 } },
    promptImagePositionRequired: true,
    ...KLING_MULTISHOT_RULES,
  }),
  ...rowsFor(KLING_O3_MODELS, {
    promptText: PT_2500_MIN2,
    arrays: { promptImage: { min: 1, max: 2 } },
    promptImagePositionRequired: true,
    referencesTakePromptImages: true,
    // "Image-to-video also accepts up to 7 reference images, including
    // keyframes." — assets/inputs.md, 2026-11-12 (the spec's `references`
    // array carries no maxItems).
    imageBudget: { max: 7, params: ["promptImage", "references"], source: INPUTS_SOURCE },
    multiPromptSeconds: KLING_MULTISHOT_RULES.multiPromptSeconds,
    pairings: [...KLING_MULTISHOT_RULES.pairings, KLING_O3_LAST_FRAME_RULE],
  }),
  kling_4: {
    promptText: PT_26K,
    arrays: { promptImage: { min: 1, max: 10 }, references: { max: 10 }, referenceVideos: { max: 5 } },
    // The spec types these items `{}`; the layout is inputs.md's: "an array
    // with exactly one `first` frame, up to 8 `middle` frames in array order,
    // and an optional `last` frame" (2026-11-12).
    promptImagePositions: ["first", "middle", "last"],
    promptImagePositionCounts: {
      counts: { first: { min: 1, max: 1 }, middle: { max: 8 }, last: { max: 1 } },
      source: INPUTS_SOURCE,
    },
    // "frames and references together are at most 10" — assets/inputs.md.
    imageBudget: { max: 10, params: ["promptImage", "references"], source: INPUTS_SOURCE },
    pairings: KLING4_PROMPT_WITH_REFERENCES,
  },
  kling_4_flash: {
    promptText: PT_26K,
    arrays: { promptImage: { min: 1, max: 1 }, references: { max: 10 }, referenceVideos: { max: 5 } },
    promptImagePositions: ["first"],
    promptImagePositionRequired: true,
    referenceVideoTyped: false,
    // "at most 10 images including the first frame" — assets/inputs.md.
    imageBudget: { max: 10, params: ["promptImage", "references"], source: INPUTS_SOURCE },
    pairings: KLING4_PROMPT_WITH_REFERENCES,
  },
  ...rowsFor(WAN3_MODELS, {
    promptText: PT_20K,
    arrays: { promptImage: { min: 1, max: 10 }, referenceVideos: { max: 5 }, referenceAudio: { max: 5 } },
    // "Use position `first`/`last` for keyframe mode, or omit position for
    // reference images. The two modes cannot be mixed." — openapi.json.
    promptImageModesExclusive: true,
    referenceVideoTyped: true,
    pairings: [
      {
        if: { path: ["promptImage"], positioned: true },
        then: { path: ["ratio"], values: AUTO_RATIOS, default: "auto_1080p" },
        message:
          'Keyframe image-to-video requests must use `ratio` "auto_480p", "auto_720p" or "auto_1080p" because their aspect ratio follows the first frame',
        source: IMAGE_TO_VIDEO_SOURCE,
      },
    ],
  }),
  h3_max: {
    promptText: PT_6K,
    arrays: { promptImage: { min: 1, max: 2 } },
    promptImagePositionRequired: true,
    // "A last frame requires a first frame." — openapi.json, 2026-11-12.
    promptImagePositionCounts: { counts: { first: { min: 1 } }, source: IMAGE_TO_VIDEO_SOURCE },
  },
  grok_imagine_1_5_lite: {
    promptText: PT_2500,
    arrays: { promptImage: { min: 1, max: 1 } },
    promptImagePositions: ["first"],
    promptImagePositionRequired: true,
  },
  ...rowsFor(GEMINI_OMNI_FLASH_1X_MODELS, {
    promptText: PT_4K,
    arrays: { promptImage: { min: 1, max: 2 } },
    promptImagePositionRequired: true,
  }),
};

export const videoFromImageConstraints: Readonly<Partial<Record<string, EndpointConstraints>>> = {
  "gen4.5": {
    deny: notInSchema("image_to_video", IMAGE_TO_VIDEO_SOURCE, [
      "audio",
      "cfgScale",
      "negativePrompt",
      "promptExpansionMode",
      "providerSettings",
      "referenceAudio",
      "referenceVideos",
      "references",
      "resolution",
    ]),
    enums: {
      ratio: GEN4_VIDEO_RATIOS,
      duration: intRange(2, 10),
      outputFormat: GEN45_OUTPUT_FORMATS,
      proresProfile: ["422", "4444", "422 Proxy", "422 LT", "422 HQ", "4444 XQ"],
    },
  },
  gen4_turbo: {
    deny: notInSchema("image_to_video", IMAGE_TO_VIDEO_SOURCE, [
      "audio",
      "cfgScale",
      "negativePrompt",
      "outputFormat",
      "promptExpansionMode",
      "proresProfile",
      "providerSettings",
      "referenceAudio",
      "referenceVideos",
      "references",
      "resolution",
    ]),
    enums: { ratio: GEN4_VIDEO_RATIOS, duration: intRange(2, 10) },
  },
  "veo3.1": {
    deny: notInSchema("image_to_video", IMAGE_TO_VIDEO_SOURCE, [
      "cfgScale",
      "contentModeration",
      "outputFormat",
      "promptExpansionMode",
      "proresProfile",
      "providerSettings",
      "referenceAudio",
      "referenceVideos",
      "references",
      "resolution",
    ]),
    enums: { ratio: VEO_RATIOS, duration: [4, 6, 8] },
  },
  "veo3.1_fast": {
    deny: notInSchema("image_to_video", IMAGE_TO_VIDEO_SOURCE, [
      "cfgScale",
      "contentModeration",
      "outputFormat",
      "promptExpansionMode",
      "proresProfile",
      "providerSettings",
      "referenceAudio",
      "referenceVideos",
      "references",
      "resolution",
    ]),
    enums: { ratio: VEO_RATIOS, duration: [4, 6, 8] },
  },
  hailuo3: {
    deny: notInSchema("image_to_video", IMAGE_TO_VIDEO_SOURCE, [
      "audio",
      "cfgScale",
      "contentModeration",
      "negativePrompt",
      "outputFormat",
      "promptExpansionMode",
      "proresProfile",
      "providerSettings",
      "referenceVideos",
      "references",
      "seed",
    ]),
    enums: { resolution: HAILUO3_RESOLUTIONS, duration: intRange(5, 15), ratio: HAILUO3_RATIOS },
  },
  happyhorse_1_0: {
    deny: notInSchema("image_to_video", IMAGE_TO_VIDEO_SOURCE, [
      "audio",
      "cfgScale",
      "contentModeration",
      "negativePrompt",
      "outputFormat",
      "promptExpansionMode",
      "proresProfile",
      "providerSettings",
      "ratio",
      "referenceAudio",
      "referenceVideos",
      "references",
      "seed",
    ]),
    enums: { resolution: HAPPYHORSE_RESOLUTIONS, duration: intRange(3, 15) },
  },
  seedance2: {
    deny: notInSchema("image_to_video", IMAGE_TO_VIDEO_SOURCE, [
      "cfgScale",
      "contentModeration",
      "negativePrompt",
      "outputFormat",
      "promptExpansionMode",
      "proresProfile",
      "providerSettings",
      "referenceVideos",
      "references",
      "resolution",
    ]),
    enums: { duration: [...intRange(4, 15), "auto"], ratio: SEEDANCE2_RATIOS },
  },
  seedance2_fast: {
    deny: notInSchema("image_to_video", IMAGE_TO_VIDEO_SOURCE, [
      "cfgScale",
      "contentModeration",
      "negativePrompt",
      "outputFormat",
      "promptExpansionMode",
      "proresProfile",
      "providerSettings",
      "referenceVideos",
      "references",
      "resolution",
    ]),
    enums: { duration: [...intRange(4, 15), "auto"], ratio: SEEDANCE2_SMALL_RATIOS },
  },
  seedance2_mini: {
    deny: notInSchema("image_to_video", IMAGE_TO_VIDEO_SOURCE, [
      "cfgScale",
      "contentModeration",
      "negativePrompt",
      "outputFormat",
      "promptExpansionMode",
      "proresProfile",
      "providerSettings",
      "referenceVideos",
      "references",
      "resolution",
    ]),
    enums: { duration: [...intRange(4, 15), "auto"], ratio: SEEDANCE2_SMALL_RATIOS },
  },
  seedance2_5: {
    deny: notInSchema("image_to_video", IMAGE_TO_VIDEO_SOURCE, [
      "cfgScale",
      "contentModeration",
      "negativePrompt",
      "promptExpansionMode",
      "proresProfile",
      "providerSettings",
      "referenceVideos",
      "references",
      "resolution",
    ]),
    enums: {
      duration: [...intRange(4, 30), "auto"],
      ratio: SEEDANCE2_5_RATIOS,
      outputFormat: SEEDANCE2_5_OUTPUT_FORMATS,
    },
  },
  grok_imagine_1_5: {
    deny: notInSchema("image_to_video", IMAGE_TO_VIDEO_SOURCE, [
      "audio",
      "cfgScale",
      "contentModeration",
      "negativePrompt",
      "outputFormat",
      "promptExpansionMode",
      "proresProfile",
      "providerSettings",
      "ratio",
      "referenceAudio",
      "referenceVideos",
      "references",
      "seed",
    ]),
    enums: { resolution: GROK_IMAGINE_1_5_RESOLUTIONS, duration: intRange(1, 15) },
  },
  gemini_omni_flash: {
    deny: notInSchema("image_to_video", IMAGE_TO_VIDEO_SOURCE, [
      "audio",
      "cfgScale",
      "contentModeration",
      "negativePrompt",
      "outputFormat",
      "promptExpansionMode",
      "proresProfile",
      "providerSettings",
      "referenceAudio",
      "referenceVideos",
      "references",
      "resolution",
      "seed",
    ]),
    enums: { ratio: GEMINI_OMNI_FLASH_RATIOS, duration: intRange(3, 10) },
  },
  "kling2.5_turbo_pro": {
    deny: notInSchema("image_to_video", IMAGE_TO_VIDEO_SOURCE, [
      "audio",
      "contentModeration",
      "negativePrompt",
      "outputFormat",
      "promptExpansionMode",
      "proresProfile",
      "providerSettings",
      "ratio",
      "referenceAudio",
      "referenceVideos",
      "references",
      "resolution",
      "seed",
    ]),
    enums: { duration: [5, 10] },
  },
  "kling3.0_standard": kling3ImageToVideo(KLING3_STANDARD_RATIOS),
  "kling3.0_pro": kling3ImageToVideo(KLING3_PRO_RATIOS),
  "kling3.0_4k": kling3ImageToVideo(KLING3_4K_RATIOS),
  klingO3_standard: klingO3ImageToVideo(KLING3_STANDARD_RATIOS),
  klingO3_pro: klingO3ImageToVideo(KLING3_PRO_RATIOS),
  klingO3_4k: klingO3ImageToVideo(KLING3_4K_RATIOS),
  kling_4: {
    deny: notInSchema("image_to_video", IMAGE_TO_VIDEO_SOURCE, [
      "audio",
      "cfgScale",
      "contentModeration",
      "negativePrompt",
      "outputFormat",
      "promptExpansionMode",
      "proresProfile",
      "providerSettings",
      "referenceAudio",
      "resolution",
      "seed",
    ]),
    enums: { ratio: KLING4_AUTO_RATIOS, duration: intRange(3, 30) },
  },
  kling_4_flash: {
    deny: notInSchema("image_to_video", IMAGE_TO_VIDEO_SOURCE, [
      "audio",
      "cfgScale",
      "contentModeration",
      "negativePrompt",
      "outputFormat",
      "promptExpansionMode",
      "proresProfile",
      "providerSettings",
      "referenceAudio",
      "resolution",
      "seed",
    ]),
    // `ratio` is `const: "auto_720p"`: "omit `ratio` or use `auto_720p` to
    // follow its framing" (assets/inputs.md, 2026-11-12).
    enums: { ratio: ["auto_720p"], duration: intRange(3, 20) },
  },
  ...rowsFor(WAN3_MODELS, {
    deny: notInSchema("image_to_video", IMAGE_TO_VIDEO_SOURCE, [
      "cfgScale",
      "contentModeration",
      "negativePrompt",
      "outputFormat",
      "promptExpansionMode",
      "proresProfile",
      "providerSettings",
      "references",
      "resolution",
      "seed",
    ]),
    enums: { ratio: WAN3_RATIOS, duration: intRange(2, 30) },
  }),
  h3_max: {
    deny: notInSchema("image_to_video", IMAGE_TO_VIDEO_SOURCE, [
      "audio",
      "cfgScale",
      "contentModeration",
      "negativePrompt",
      "outputFormat",
      "proresProfile",
      "providerSettings",
      "ratio",
      "referenceAudio",
      "referenceVideos",
      "references",
    ]),
    enums: {
      resolution: H3_MAX_RESOLUTIONS,
      duration: intRange(5, 15),
      promptExpansionMode: H3_MAX_PROMPT_EXPANSION_MODES,
    },
  },
  grok_imagine_1_5_lite: {
    deny: notInSchema("image_to_video", IMAGE_TO_VIDEO_SOURCE, [
      "audio",
      "cfgScale",
      "contentModeration",
      "negativePrompt",
      "outputFormat",
      "promptExpansionMode",
      "proresProfile",
      "providerSettings",
      "referenceAudio",
      "referenceVideos",
      "references",
      "resolution",
      "seed",
    ]),
    enums: { ratio: AUTO_RATIOS, duration: intRange(1, 15) },
  },
  "gemini_omni_flash_1.1": geminiOmniFlash1xImageToVideo(intRange(3, 10)),
  "gemini_omni_flash_1.2": geminiOmniFlash1xImageToVideo(intRange(3, 15)),
};

/** The Kling 3.0 image_to_video arm; the three variants differ only in `ratio`. */
function kling3ImageToVideo(ratio: readonly string[]): EndpointConstraints {
  return {
    deny: notInSchema("image_to_video", IMAGE_TO_VIDEO_SOURCE, [
      "contentModeration",
      "negativePrompt",
      "outputFormat",
      "promptExpansionMode",
      "proresProfile",
      "referenceAudio",
      "referenceVideos",
      "references",
      "resolution",
      "seed",
    ]),
    enums: { ratio, duration: intRange(3, 15) },
  };
}

/** Kling O3 on image_to_video: the 3.0 arm without `cfgScale`, with `references`. */
function klingO3ImageToVideo(ratio: readonly string[]): EndpointConstraints {
  return {
    deny: notInSchema("image_to_video", IMAGE_TO_VIDEO_SOURCE, [
      "cfgScale",
      "contentModeration",
      "negativePrompt",
      "outputFormat",
      "promptExpansionMode",
      "proresProfile",
      "referenceAudio",
      "referenceVideos",
      "resolution",
      "seed",
    ]),
    enums: { ratio, duration: intRange(3, 15) },
  };
}

/**
 * gemini_omni_flash_1.1 / 1.2 on image_to_video. `duration` is "auto" or an
 * integer — 3–10 on 1.1, 3–15 on 1.2 ("Numeric durations must be between 3
 * and 10 seconds" / "… 3 and 15 seconds" — openapi.json, 2026-11-12).
 */
function geminiOmniFlash1xImageToVideo(seconds: readonly number[]): EndpointConstraints {
  return {
    deny: notInSchema("image_to_video", IMAGE_TO_VIDEO_SOURCE, [
      "audio",
      "cfgScale",
      "contentModeration",
      "negativePrompt",
      "outputFormat",
      "promptExpansionMode",
      "proresProfile",
      "providerSettings",
      "referenceAudio",
      "referenceVideos",
      "references",
      "resolution",
      "seed",
    ]),
    enums: { ratio: GEMINI_OMNI_FLASH_1X_RATIOS, duration: [...seconds, "auto"] },
  };
}

// ---------------------------------------------------------------------------
// POST /v1/text_to_video
// ---------------------------------------------------------------------------

/**
 * Fields each model's arm marks as required (beyond `model`), enforced by a
 * checker in text-to-video.ts. Every arm requires `promptText` except
 * seedance2_5 (nothing else required) and the Kling 3.0 / O3 arms (which
 * require `ratio` instead).
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
  "kling2.5_turbo_pro": ["promptText"],
  ...rowsFor(KLING3_MODELS, ["ratio"]),
  ...rowsFor(KLING_O3_MODELS, ["ratio"]),
  kling_4: ["promptText"],
  kling_4_flash: ["promptText"],
  ...rowsFor(WAN3_MODELS, ["promptText"]),
  h3_max: ["promptText"],
  grok_imagine_1_5_lite: ["promptText"],
  ...rowsFor(GEMINI_OMNI_FLASH_1X_MODELS, ["promptText"]),
};

/** Prompt-length caps and reference-array caps for text_to_video. */
export const videoShapeRules: Readonly<Partial<Record<string, ModelShapeRules>>> = {
  "gen4.5": { promptText: PT_1K },
  "veo3.1": { promptText: PT_1K },
  "veo3.1_fast": { promptText: PT_1K },
  hailuo3: {
    promptText: PT_6K,
    arrays: { references: { max: 9 }, referenceVideos: { max: 3 }, referenceAudio: { max: 3 } },
    referenceVideoTyped: true,
  },
  happyhorse_1_0: { promptText: PT_2500_MIN2 },
  seedance2: {
    promptText: PT_10K,
    arrays: { references: { max: 9 }, referenceVideos: { max: 3 }, referenceAudio: { max: 3 } },
    referenceVideoTyped: true,
  },
  seedance2_fast: {
    promptText: PT_10K,
    arrays: { references: { max: 9 }, referenceVideos: { max: 3 }, referenceAudio: { max: 3 } },
    referenceVideoTyped: true,
  },
  seedance2_mini: {
    promptText: PT_10K,
    arrays: { references: { max: 9 }, referenceVideos: { max: 3 }, referenceAudio: { max: 3 } },
    referenceVideoTyped: true,
  },
  seedance2_5: {
    promptText: PT_15K,
    arrays: { references: { max: 30 }, referenceVideos: { max: 10 }, referenceAudio: { max: 10 } },
    referenceVideoTyped: true,
  },
  grok_imagine_1_5: {
    promptText: PT_2500,
    arrays: { references: { max: 7 }, referenceAudio: { max: 3 } },
  },
  gemini_omni_flash: { promptText: PT_4K },
  "kling2.5_turbo_pro": { promptText: PT_2500_MIN2 },
  ...rowsFor(KLING3_MODELS, { promptText: PT_2500_MIN2, ...KLING_MULTISHOT_RULES }),
  ...rowsFor(KLING_O3_MODELS, { promptText: PT_2500_MIN2, ...KLING_MULTISHOT_RULES }),
  kling_4: {
    promptText: PT_26K,
    arrays: { references: { max: 10 }, referenceVideos: { max: 5 } },
  },
  kling_4_flash: {
    promptText: PT_26K,
    arrays: { references: { max: 10 }, referenceVideos: { max: 5 } },
    referenceVideoTyped: false,
  },
  ...rowsFor(WAN3_MODELS, {
    promptText: PT_20K,
    arrays: { references: { max: 10 }, referenceVideos: { max: 5 }, referenceAudio: { max: 5 } },
    referenceVideoTyped: true,
  }),
  h3_max: { promptText: PT_6K },
  grok_imagine_1_5_lite: { promptText: PT_2500 },
  ...rowsFor(GEMINI_OMNI_FLASH_1X_MODELS, {
    promptText: PT_4K,
    arrays: { references: { max: 5 }, referenceVideos: { max: 3 } },
    referenceVideoTyped: false,
  }),
};

export const videoConstraints: Readonly<Partial<Record<string, EndpointConstraints>>> = {
  "gen4.5": {
    deny: notInSchema("text_to_video", TEXT_TO_VIDEO_SOURCE, [
      "audio",
      "cfgScale",
      "negativePrompt",
      "promptExpansionMode",
      "providerSettings",
      "referenceAudio",
      "referenceVideos",
      "references",
      "resolution",
    ]),
    enums: {
      ratio: GEN45_TEXT_TO_VIDEO_RATIOS,
      duration: intRange(2, 10),
      outputFormat: GEN45_OUTPUT_FORMATS,
      proresProfile: ["422", "4444", "422 Proxy", "422 LT", "422 HQ", "4444 XQ"],
    },
  },
  "veo3.1": {
    deny: notInSchema("text_to_video", TEXT_TO_VIDEO_SOURCE, [
      "cfgScale",
      "contentModeration",
      "outputFormat",
      "promptExpansionMode",
      "proresProfile",
      "providerSettings",
      "referenceAudio",
      "referenceVideos",
      "references",
      "resolution",
    ]),
    enums: { ratio: VEO_RATIOS, duration: [4, 6, 8] },
  },
  "veo3.1_fast": {
    deny: notInSchema("text_to_video", TEXT_TO_VIDEO_SOURCE, [
      "cfgScale",
      "contentModeration",
      "outputFormat",
      "promptExpansionMode",
      "proresProfile",
      "providerSettings",
      "referenceAudio",
      "referenceVideos",
      "references",
      "resolution",
    ]),
    enums: { ratio: VEO_RATIOS, duration: [4, 6, 8] },
  },
  hailuo3: {
    deny: notInSchema("text_to_video", TEXT_TO_VIDEO_SOURCE, [
      "audio",
      "cfgScale",
      "contentModeration",
      "negativePrompt",
      "outputFormat",
      "promptExpansionMode",
      "proresProfile",
      "providerSettings",
      "seed",
    ]),
    enums: { resolution: HAILUO3_RESOLUTIONS, duration: intRange(5, 15), ratio: HAILUO3_RATIOS },
  },
  happyhorse_1_0: {
    deny: notInSchema("text_to_video", TEXT_TO_VIDEO_SOURCE, [
      "audio",
      "cfgScale",
      "contentModeration",
      "negativePrompt",
      "outputFormat",
      "promptExpansionMode",
      "proresProfile",
      "providerSettings",
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
      "cfgScale",
      "contentModeration",
      "negativePrompt",
      "outputFormat",
      "promptExpansionMode",
      "proresProfile",
      "providerSettings",
      "resolution",
    ]),
    enums: { duration: [...intRange(4, 15), "auto"], ratio: SEEDANCE2_RATIOS },
  },
  seedance2_fast: {
    deny: notInSchema("text_to_video", TEXT_TO_VIDEO_SOURCE, [
      "cfgScale",
      "contentModeration",
      "negativePrompt",
      "outputFormat",
      "promptExpansionMode",
      "proresProfile",
      "providerSettings",
      "resolution",
    ]),
    enums: { duration: [...intRange(4, 15), "auto"], ratio: SEEDANCE2_SMALL_RATIOS },
  },
  seedance2_mini: {
    deny: notInSchema("text_to_video", TEXT_TO_VIDEO_SOURCE, [
      "cfgScale",
      "contentModeration",
      "negativePrompt",
      "outputFormat",
      "promptExpansionMode",
      "proresProfile",
      "providerSettings",
      "resolution",
    ]),
    enums: { duration: [...intRange(4, 15), "auto"], ratio: SEEDANCE2_SMALL_RATIOS },
  },
  seedance2_5: {
    deny: notInSchema("text_to_video", TEXT_TO_VIDEO_SOURCE, [
      "cfgScale",
      "contentModeration",
      "negativePrompt",
      "promptExpansionMode",
      "proresProfile",
      "providerSettings",
      "resolution",
    ]),
    enums: {
      duration: [...intRange(4, 30), "auto"],
      ratio: SEEDANCE2_5_RATIOS,
      outputFormat: SEEDANCE2_5_OUTPUT_FORMATS,
    },
  },
  grok_imagine_1_5: {
    deny: notInSchema("text_to_video", TEXT_TO_VIDEO_SOURCE, [
      "audio",
      "cfgScale",
      "contentModeration",
      "negativePrompt",
      "outputFormat",
      "promptExpansionMode",
      "proresProfile",
      "providerSettings",
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
      "cfgScale",
      "contentModeration",
      "negativePrompt",
      "outputFormat",
      "promptExpansionMode",
      "proresProfile",
      "providerSettings",
      "referenceAudio",
      "referenceVideos",
      "references",
      "resolution",
      "seed",
    ]),
    enums: { ratio: GEMINI_OMNI_FLASH_RATIOS, duration: intRange(3, 10) },
  },
  "kling2.5_turbo_pro": {
    deny: notInSchema("text_to_video", TEXT_TO_VIDEO_SOURCE, [
      "audio",
      "contentModeration",
      "negativePrompt",
      "outputFormat",
      "promptExpansionMode",
      "proresProfile",
      "providerSettings",
      "referenceAudio",
      "referenceVideos",
      "references",
      "resolution",
      "seed",
    ]),
    enums: { ratio: KLING2_5_TURBO_PRO_RATIOS, duration: [5, 10] },
  },
  "kling3.0_standard": klingTextToVideo(KLING3_STANDARD_RATIOS, { cfgScale: true }),
  "kling3.0_pro": klingTextToVideo(KLING3_PRO_RATIOS, { cfgScale: true }),
  "kling3.0_4k": klingTextToVideo(KLING3_4K_RATIOS, { cfgScale: true }),
  klingO3_standard: klingTextToVideo(KLING3_STANDARD_RATIOS, { cfgScale: false }),
  klingO3_pro: klingTextToVideo(KLING3_PRO_RATIOS, { cfgScale: false }),
  klingO3_4k: klingTextToVideo(KLING3_4K_RATIOS, { cfgScale: false }),
  kling_4: {
    deny: notInSchema("text_to_video", TEXT_TO_VIDEO_SOURCE, [
      "audio",
      "cfgScale",
      "contentModeration",
      "negativePrompt",
      "outputFormat",
      "promptExpansionMode",
      "proresProfile",
      "providerSettings",
      "referenceAudio",
      "resolution",
      "seed",
    ]),
    enums: { ratio: KLING4_RATIOS, duration: intRange(3, 30) },
  },
  kling_4_flash: {
    deny: notInSchema("text_to_video", TEXT_TO_VIDEO_SOURCE, [
      "audio",
      "cfgScale",
      "contentModeration",
      "negativePrompt",
      "outputFormat",
      "promptExpansionMode",
      "proresProfile",
      "providerSettings",
      "referenceAudio",
      "resolution",
      "seed",
    ]),
    enums: { ratio: KLING4_FLASH_RATIOS, duration: intRange(3, 20) },
  },
  ...rowsFor(WAN3_MODELS, {
    deny: notInSchema("text_to_video", TEXT_TO_VIDEO_SOURCE, [
      "cfgScale",
      "contentModeration",
      "negativePrompt",
      "outputFormat",
      "promptExpansionMode",
      "proresProfile",
      "providerSettings",
      "resolution",
      "seed",
    ]),
    enums: { ratio: WAN3_RATIOS, duration: intRange(2, 30) },
  }),
  h3_max: {
    deny: notInSchema("text_to_video", TEXT_TO_VIDEO_SOURCE, [
      "audio",
      "cfgScale",
      "contentModeration",
      "negativePrompt",
      "outputFormat",
      "proresProfile",
      "providerSettings",
      "ratio",
      "referenceAudio",
      "referenceVideos",
      "references",
    ]),
    enums: {
      resolution: H3_MAX_RESOLUTIONS,
      duration: intRange(5, 15),
      promptExpansionMode: H3_MAX_PROMPT_EXPANSION_MODES,
    },
  },
  grok_imagine_1_5_lite: {
    deny: notInSchema("text_to_video", TEXT_TO_VIDEO_SOURCE, [
      "audio",
      "cfgScale",
      "contentModeration",
      "negativePrompt",
      "outputFormat",
      "promptExpansionMode",
      "proresProfile",
      "providerSettings",
      "referenceAudio",
      "referenceVideos",
      "references",
      "resolution",
      "seed",
    ]),
    enums: { ratio: GROK_IMAGINE_1_5_LITE_RATIOS, duration: intRange(1, 15) },
  },
  "gemini_omni_flash_1.1": geminiOmniFlash1xTextToVideo(intRange(3, 10)),
  "gemini_omni_flash_1.2": geminiOmniFlash1xTextToVideo(intRange(3, 15)),
};

/**
 * The Kling 3.0 / O3 text_to_video arm. The variants differ in `ratio`, and
 * O3 has no `cfgScale`.
 */
function klingTextToVideo(
  ratio: readonly string[],
  options: { readonly cfgScale: boolean },
): EndpointConstraints {
  return {
    deny: notInSchema("text_to_video", TEXT_TO_VIDEO_SOURCE, [
      ...(options.cfgScale ? [] : ["cfgScale"]),
      "contentModeration",
      "negativePrompt",
      "outputFormat",
      "promptExpansionMode",
      "proresProfile",
      "referenceAudio",
      "referenceVideos",
      "references",
      "resolution",
      "seed",
    ]),
    enums: { ratio, duration: intRange(3, 15) },
  };
}

/** gemini_omni_flash_1.1 / 1.2 on text_to_video (see the image_to_video note). */
function geminiOmniFlash1xTextToVideo(seconds: readonly number[]): EndpointConstraints {
  return {
    deny: notInSchema("text_to_video", TEXT_TO_VIDEO_SOURCE, [
      "audio",
      "cfgScale",
      "contentModeration",
      "negativePrompt",
      "outputFormat",
      "promptExpansionMode",
      "proresProfile",
      "providerSettings",
      "referenceAudio",
      "resolution",
      "seed",
    ]),
    enums: { ratio: GEMINI_OMNI_FLASH_1X_RATIOS, duration: [...seconds, "auto"] },
  };
}

// ---------------------------------------------------------------------------
// POST /v1/video_to_video — the video-editing route.
//
// Two different input fields split the union: `aleph2`, `kling_4`,
// `kling_4_flash` and the gemini_omni_flash arms take `videoUri`; every
// seedance / hailuo / Kling O3 arm takes `promptVideo`. Sending the wrong one
// is a deny, not a rename — unmodel never rewrites wire params.
// ---------------------------------------------------------------------------


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
  ...rowsFor(KLING_O3_MODELS, ["promptText", "promptVideo"]),
  kling_4: ["videoUri", "promptText"],
  kling_4_flash: ["promptText", "videoUri"],
  ...rowsFor(GEMINI_OMNI_FLASH_1X_MODELS, ["videoUri", "promptText"]),
};

/** `mode` on gemini_omni_flash_1.x: "default `reference`" — openapi.json, 2026-11-12. */
const GEMINI_OMNI_FLASH_1X_MODES = ["reference", "extend", "edit"] as const;

/**
 * gemini_omni_flash_1.2's three modes: "`mode: \"extend\"` accepts up to 30
 * seconds of input and no image references; `mode: \"edit\"` … requires
 * `duration: \"auto\"`. In reference mode use `ratio`; in edit or extend mode
 * use `resolution` … and omit `ratio` because orientation follows the input."
 * — assets/inputs.md, 2026-11-12. `duration` defaults to `"auto"` there.
 */
const GEMINI_OMNI_FLASH_1_2_MODE_RULES: readonly PairingRule[] = [
  {
    if: { path: ["mode"], values: ["extend", "edit"] },
    then: { path: ["ratio"], absent: true },
    message: '`ratio` is not accepted in `mode` "extend" or "edit" — the orientation follows the input; use `resolution`',
    source: INPUTS_SOURCE,
  },
  {
    if: { path: ["mode"], values: ["extend"] },
    then: { path: ["references"], absent: true },
    message: '`mode: "extend"` accepts no image `references`',
    source: INPUTS_SOURCE,
  },
  {
    if: { path: ["mode"], values: ["edit"] },
    then: { path: ["duration"], values: ["auto"], default: "auto" },
    message: '`mode: "edit"` requires `duration: "auto"`',
    source: INPUTS_SOURCE,
  },
];

export const videoFromVideoShapeRules: Readonly<Partial<Record<string, ModelShapeRules>>> = {
  aleph2: { promptText: PT_1K, arrays: { keyframes: { min: 1, max: 5 } } },
  hailuo3: {
    promptText: PT_6K,
    arrays: { references: { max: 9 }, referenceVideos: { max: 2 }, referenceAudio: { max: 3 } },
    referenceVideoTyped: true,
  },
  seedance2: {
    promptText: PT_10K,
    arrays: { references: { max: 9 }, referenceVideos: { max: 2 }, referenceAudio: { max: 3 } },
    referenceVideoTyped: true,
  },
  seedance2_fast: {
    promptText: PT_10K,
    arrays: { references: { max: 9 }, referenceVideos: { max: 2 }, referenceAudio: { max: 3 } },
    referenceVideoTyped: true,
  },
  seedance2_mini: {
    promptText: PT_10K,
    arrays: { references: { max: 9 }, referenceVideos: { max: 2 }, referenceAudio: { max: 3 } },
    referenceVideoTyped: true,
  },
  seedance2_5: {
    promptText: PT_15K,
    arrays: { references: { max: 30 }, referenceVideos: { max: 9 }, referenceAudio: { max: 10 } },
    referenceVideoTyped: true,
  },
  gemini_omni_flash: { promptText: PT_4K, arrays: { references: { max: 5 } } },
  ...rowsFor(KLING_O3_MODELS, {
    promptText: PT_2500_MIN2,
    // "Video-to-video edits a clip … with up to 4 reference images." —
    // assets/inputs.md, 2026-11-12 (the spec's array carries no maxItems).
    arrays: { references: { max: 4 } },
    referencesTakePromptImages: true,
    ...KLING_MULTISHOT_RULES,
  }),
  kling_4: { promptText: PT_26K, arrays: { references: { max: 10 } } },
  kling_4_flash: {
    promptText: PT_26K,
    arrays: { references: { max: 10 }, referenceVideos: { max: 5 } },
    referenceVideoTyped: false,
  },
  "gemini_omni_flash_1.1": { promptText: PT_4K, arrays: { references: { max: 5 } } },
  "gemini_omni_flash_1.2": {
    promptText: PT_4K,
    arrays: { references: { max: 5 } },
    pairings: GEMINI_OMNI_FLASH_1_2_MODE_RULES,
  },
};

export const videoFromVideoConstraints: Readonly<Partial<Record<string, EndpointConstraints>>> = {
  aleph2: {
    deny: notInSchema("video_to_video", VIDEO_TO_VIDEO_SOURCE, [
      "audio",
      "duration",
      "mode",
      "promptVideo",
      "providerSettings",
      "referenceAudio",
      "referenceVideos",
      "references",
      "resolution",
    ]),
    enums: {
      targetAspectRatio: ALEPH2_TARGET_ASPECT_RATIOS,
      outputFormat: ALEPH2_OUTPUT_FORMATS,
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
      "providerSettings",
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
      "providerSettings",
      "resolution",
      "targetAspectRatio",
      "videoUri",
    ]),
    enums: { duration: [...intRange(4, 15), "auto"], ratio: SEEDANCE2_RATIOS },
  },
  seedance2_fast: {
    deny: notInSchema("video_to_video", VIDEO_TO_VIDEO_SOURCE, [
      "contentModeration",
      "keyframes",
      "mode",
      "negativePrompt",
      "outputFormat",
      "proresProfile",
      "providerSettings",
      "resolution",
      "targetAspectRatio",
      "videoUri",
    ]),
    enums: { duration: [...intRange(4, 15), "auto"], ratio: SEEDANCE2_SMALL_RATIOS },
  },
  seedance2_mini: {
    deny: notInSchema("video_to_video", VIDEO_TO_VIDEO_SOURCE, [
      "contentModeration",
      "keyframes",
      "mode",
      "negativePrompt",
      "outputFormat",
      "proresProfile",
      "providerSettings",
      "resolution",
      "targetAspectRatio",
      "videoUri",
    ]),
    enums: { duration: [...intRange(4, 15), "auto"], ratio: SEEDANCE2_SMALL_RATIOS },
  },
  seedance2_5: {
    deny: notInSchema("video_to_video", VIDEO_TO_VIDEO_SOURCE, [
      "contentModeration",
      "keyframes",
      "negativePrompt",
      "proresProfile",
      "providerSettings",
      "resolution",
      "targetAspectRatio",
      "videoUri",
    ]),
    // `mode` exists on this arm and the gemini_omni_flash_1.x ones, and only
    // on this route.
    enums: {
      mode: ["reference", "extend", "edit"],
      duration: [...intRange(4, 30), "auto"],
      ratio: SEEDANCE2_5_RATIOS,
      outputFormat: SEEDANCE2_5_OUTPUT_FORMATS,
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
      "providerSettings",
      "ratio",
      "referenceAudio",
      "referenceVideos",
      "resolution",
      "seed",
      "targetAspectRatio",
    ]),
  },
  ...rowsFor(KLING_O3_MODELS, {
    // No `duration`, `ratio` or `audio`: "Kling O3 video-to-video is billed
    // per second of the input video" (guides/pricing.md), whose length and
    // framing the edit keeps.
    deny: notInSchema("video_to_video", VIDEO_TO_VIDEO_SOURCE, [
      "audio",
      "contentModeration",
      "duration",
      "keyframes",
      "mode",
      "outputFormat",
      "proresProfile",
      "ratio",
      "referenceAudio",
      "referenceVideos",
      "resolution",
      "seed",
      "targetAspectRatio",
      "videoUri",
    ]),
  }),
  kling_4: {
    // "Video-to-video edits a source clip and does not take `duration`" —
    // assets/inputs.md, 2026-11-12.
    deny: notInSchema("video_to_video", VIDEO_TO_VIDEO_SOURCE, [
      "audio",
      "contentModeration",
      "duration",
      "keyframes",
      "mode",
      "outputFormat",
      "promptVideo",
      "proresProfile",
      "providerSettings",
      "referenceAudio",
      "referenceVideos",
      "resolution",
      "seed",
      "targetAspectRatio",
    ]),
    enums: { ratio: KLING4_AUTO_RATIOS },
  },
  kling_4_flash: {
    deny: notInSchema("video_to_video", VIDEO_TO_VIDEO_SOURCE, [
      "audio",
      "contentModeration",
      "keyframes",
      "mode",
      "outputFormat",
      "promptVideo",
      "proresProfile",
      "providerSettings",
      "referenceAudio",
      "resolution",
      "seed",
      "targetAspectRatio",
    ]),
    enums: { ratio: KLING4_FLASH_RATIOS, duration: intRange(3, 20) },
  },
  "gemini_omni_flash_1.1": {
    deny: notInSchema("video_to_video", VIDEO_TO_VIDEO_SOURCE, [
      "audio",
      "contentModeration",
      "keyframes",
      "outputFormat",
      "promptVideo",
      "proresProfile",
      "providerSettings",
      "referenceAudio",
      "referenceVideos",
      "resolution",
      "seed",
      "targetAspectRatio",
    ]),
    enums: {
      mode: GEMINI_OMNI_FLASH_1X_MODES,
      ratio: GEMINI_OMNI_FLASH_1X_RATIOS,
      duration: [...intRange(3, 10), "auto"],
    },
  },
  "gemini_omni_flash_1.2": {
    deny: notInSchema("video_to_video", VIDEO_TO_VIDEO_SOURCE, [
      "audio",
      "contentModeration",
      "keyframes",
      "outputFormat",
      "promptVideo",
      "proresProfile",
      "providerSettings",
      "referenceAudio",
      "referenceVideos",
      "seed",
      "targetAspectRatio",
    ]),
    enums: {
      mode: GEMINI_OMNI_FLASH_1X_MODES,
      resolution: GEMINI_OMNI_FLASH_1_2_RESOLUTIONS,
      ratio: GEMINI_OMNI_FLASH_1X_RATIOS,
      duration: [...intRange(3, 15), "auto"],
    },
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

// The arms below were read from openapi.json on 2026-11-12.

const MUSE_IMAGE_RATIOS = [
  "2352:1008",
  "2016:1152",
  "1920:1280",
  "1792:1344",
  "1600:1600",
  "1344:1792",
  "1280:1920",
  "1152:2016",
  "auto",
] as const;

const GEMINI_IMAGE31_FLASH_LITE_RATIOS = [
  "1024:1024",
  "848:1264",
  "1264:848",
  "896:1200",
  "1200:896",
  "928:1152",
  "1152:928",
  "768:1376",
  "1376:768",
  "1584:672",
] as const;

/** nano_banana_2.1 — a different 42-size ladder from gemini_image3.1_flash's. */
const NANO_BANANA_21_RATIOS = [
  ...GEMINI_IMAGE31_FLASH_LITE_RATIOS,
  "512:2064",
  "2064:512",
  "352:2928",
  "2928:352",
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
  "1024:4128",
  "4128:1024",
  "704:5856",
  "5856:704",
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
  "2048:8256",
  "8256:2048",
  "1408:11712",
  "11712:1408",
] as const;

/** bria_fibo_edit_1_5 — the nine 1MP sizes; "auto" is the tenth value. */
const BRIA_FIBO_1MP_RATIOS = [
  "1024:1024",
  "768:1152",
  "1152:768",
  "768:1024",
  "1024:768",
  "768:960",
  "960:768",
  "576:1024",
  "1024:576",
] as const;

/** bria_fibo_1_5: "1MP sizes cost 5 credits per image and 4MP sizes 10." */
const BRIA_FIBO_RATIOS = [
  ...BRIA_FIBO_1MP_RATIOS,
  "2048:2048",
  "1536:2304",
  "2304:1536",
  "1536:2048",
  "2048:1536",
  "1536:1920",
  "1920:1536",
  "1152:2048",
  "2048:1152",
] as const;

const BRIA_FIBO_EDIT_RATIOS = [...BRIA_FIBO_1MP_RATIOS, "auto"] as const;

const IDEOGRAM_4_0_RATIOS = [
  "2048:2048",
  "2560:1440",
  "1440:2560",
  "2304:1728",
  "1728:2304",
  "2496:1664",
  "1664:2496",
  "3072:1280",
  "1280:3072",
] as const;

const IDEOGRAM_4_5_RATIOS = [
  "1024:1024",
  "1280:720",
  "720:1280",
  "1152:864",
  "864:1152",
  "1248:832",
  "832:1248",
  "1120:896",
  "896:1120",
  "1440:720",
  "720:1440",
  "2048:2048",
  "2560:1440",
  "1440:2560",
  "2304:1728",
  "1728:2304",
  "2496:1664",
  "1664:2496",
  "2240:1792",
  "1792:2240",
  "2880:1440",
  "1440:2880",
  "1024:576",
  "576:1024",
  "1408:704",
  "704:1408",
  "auto",
] as const;

const SEEDREAM5_FLASH_RATIOS = [
  "1024:1024",
  "1184:896",
  "896:1184",
  "1376:768",
  "768:1376",
  "1248:832",
  "832:1248",
  "1568:672",
  "2048:2048",
  "2304:1728",
  "1728:2304",
  "2848:1600",
  "1600:2848",
  "2496:1664",
  "1664:2496",
  "3136:1344",
  "auto_1k",
  "auto_2k",
] as const;

/** `quality` on gpt_image_2 — the four-step scale with `auto`. */
const GPT_IMAGE_2_QUALITIES = ["low", "medium", "high", "auto"] as const;

/** `quality` on grok_imagine_image_2. */
const GROK_IMAGINE_IMAGE_2_QUALITIES = ["low", "medium"] as const;

/** `quality` on the gpt_image_2_5 pair: "one of `low`, `medium`, `high`, `xhigh`, `max`". */
const GPT_IMAGE_2_5_QUALITIES = ["low", "medium", "high", "xhigh", "max"] as const;

/** `quality` on the gpt_image_2_6 pair, ideogram_4_0 and ideogram_vector. */
const LOW_MEDIUM_HIGH = ["low", "medium", "high"] as const;

/** `quality` on ideogram_4_5: "`very_low` requires reference images". */
const IDEOGRAM_4_5_QUALITIES = ["very_low", "low", "medium", "high"] as const;

/** `outputFormat` on the seedream5 / FIBO / Pro Layers arms. */
const IMAGE_OUTPUT_FORMATS = ["png", "jpeg"] as const;

/** `outputFormat` on muse_image: "one of `webp`, `png`, `jpeg` … Defaults to png." */
const MUSE_IMAGE_OUTPUT_FORMATS = ["webp", "png", "jpeg"] as const;

/** `outputFormat` on the gpt_image_2_6 pair; GIF is animated, SVG is vector. */
const GPT_IMAGE_2_6_OUTPUT_FORMATS = ["png", "jpeg", "webp", "gif", "svg"] as const;

/** `background` where the arm offers transparency (gpt_image_2_5_sunburst, gpt_image_2_6_*). */
const TRANSPARENT_BACKGROUNDS = ["transparent", "opaque", "auto"] as const;

/** `thinkingLevel` on nano_banana_2.1: "Defaults to medium." */
export const NANO_BANANA_21_THINKING_LEVELS = ["minimal", "medium", "high"] as const;

/** `reasoningEffort` on the gpt_image_2_6 pair: "Defaults to `high`." */
export const GPT_IMAGE_2_6_REASONING_EFFORTS = ["low", "medium", "high"] as const;

/** `resolution` on seedream5_pro_layers: "Defaults to auto, which adapts to the input image." */
export const SEEDREAM5_PRO_LAYERS_RESOLUTIONS = ["auto", "1k", "1.5k", "2k"] as const;

/** `optimizePromptMode` on seedream5_pro_layers: "Defaults to standard." */
export const SEEDREAM5_PRO_LAYERS_PROMPT_MODES = ["standard", "fast"] as const;

/**
 * `ratio` values across every documented text_to_image model. Each model
 * accepts only its own slice (narrowed at runtime by the `enums` tables
 * below), and the keyword forms are model-specific too: `"auto"` is the GPT
 * Image, muse_image, ideogram_4_5, bria_fibo_edit_1_5 and ideogram_vector
 * arms' (the last takes nothing else); `"auto_1k"`/`"auto_2k"` are the
 * seedream5_pro, seedream5_flash and grok_imagine_image_2 arms'. The named
 * arms are autocomplete for the documented space; `${number}:${number}` keeps
 * the pixel-pair form open for models unmodel has no arm for yet, while making
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
  | (typeof MUSE_IMAGE_RATIOS)[number]
  | (typeof NANO_BANANA_21_RATIOS)[number]
  | (typeof BRIA_FIBO_RATIOS)[number]
  | (typeof BRIA_FIBO_EDIT_RATIOS)[number]
  | (typeof IDEOGRAM_4_0_RATIOS)[number]
  | (typeof IDEOGRAM_4_5_RATIOS)[number]
  | (typeof SEEDREAM5_FLASH_RATIOS)[number]
  | (`${number}:${number}` & {});

/** `quality` across the text_to_image arms that declare it. */
export type RunwayImageQuality =
  | (typeof GPT_IMAGE_2_QUALITIES)[number]
  | (typeof GROK_IMAGINE_IMAGE_2_QUALITIES)[number]
  | (typeof GPT_IMAGE_2_5_QUALITIES)[number]
  | (typeof IDEOGRAM_4_5_QUALITIES)[number];

/** `outputFormat` across the text_to_image arms that declare it. */
export type RunwayImageOutputFormat =
  | (typeof IMAGE_OUTPUT_FORMATS)[number]
  | (typeof MUSE_IMAGE_OUTPUT_FORMATS)[number]
  | (typeof GPT_IMAGE_2_6_OUTPUT_FORMATS)[number];

/**
 * Fields each model's arm marks as required, enforced by a checker in
 * image.ts. Most arms require `promptText` + `ratio`; the editing arms
 * (bria_fibo_edit_1_5, the Ideogram arms) make `ratio` optional, and
 * seedream5_pro_layers requires only its source image.
 */
export const imageRequired: Readonly<Partial<Record<string, readonly string[]>>> = {
  gen4_image: ["promptText", "ratio"],
  gen4_image_turbo: ["promptText", "ratio", "referenceImages"],
  gpt_image_2: ["promptText", "ratio"],
  gemini_image3_pro: ["promptText", "ratio"],
  "gemini_image3.1_flash": ["promptText", "ratio"],
  seedream5_pro: ["promptText", "ratio"],
  seedream5_lite: ["promptText", "ratio"],
  grok_imagine_image_2: ["promptText", "ratio"],
  "gemini_2.5_flash": ["promptText", "ratio"],
  muse_image: ["promptText", "ratio"],
  "gemini_image3.1_flash_lite": ["promptText", "ratio"],
  "nano_banana_2.1": ["promptText", "ratio"],
  gpt_image_2_5_flare: ["promptText", "ratio"],
  gpt_image_2_5_sunburst: ["promptText", "ratio"],
  gpt_image_2_6_flare: ["promptText", "ratio"],
  gpt_image_2_6_sunburst: ["promptText", "ratio"],
  bria_fibo_1_5: ["promptText", "ratio"],
  bria_fibo_edit_1_5: ["promptText"],
  ideogram_4_0: ["promptText"],
  ideogram_4_5: ["promptText"],
  ideogram_vector: ["promptText"],
  seedream5_flash: ["promptText", "ratio"],
  seedream5_pro_layers: ["referenceImages"],
};

/** FIBO and ideogram_vector take a 31-bit `seed`: "0-2147483647". */
const SEED_31_BIT = { seed: { min: 0, max: 2147483647 } } as const;

/**
 * gpt_image_2_6_*: "GIF and SVG cannot use reference images; GIF requires
 * ratio auto." / "JPEG cannot have a transparent background." / `frameCount`
 * and `frameDurationMs` — "Only supported for GIF output." (openapi.json,
 * 2026-11-12). `outputFormat` "Defaults to PNG", `background` to `auto`.
 */
const GPT_IMAGE_2_6_FORMAT_RULES: readonly PairingRule[] = [
  {
    if: { path: ["outputFormat"], values: ["gif"] },
    then: { path: ["ratio"], values: ["auto"] },
    message: 'GIF output requires `ratio: "auto"`',
    source: TEXT_TO_IMAGE_SOURCE,
  },
  {
    if: { path: ["outputFormat"], values: ["gif", "svg"] },
    then: { path: ["referenceImages"], absent: true },
    message: "GIF and SVG output cannot use `referenceImages`",
    source: TEXT_TO_IMAGE_SOURCE,
  },
  {
    if: { path: ["outputFormat"], values: ["jpeg"] },
    then: { path: ["background"], values: ["opaque", "auto"], default: "auto" },
    message: 'JPEG output cannot have `background: "transparent"`',
    source: TEXT_TO_IMAGE_SOURCE,
  },
  {
    if: { path: ["frameCount"] },
    then: { path: ["outputFormat"], values: ["gif"], default: "png" },
    message: '`frameCount` is only supported with `outputFormat: "gif"`',
    source: TEXT_TO_IMAGE_SOURCE,
  },
  {
    if: { path: ["frameDurationMs"] },
    then: { path: ["outputFormat"], values: ["gif"], default: "png" },
    message: '`frameDurationMs` is only supported with `outputFormat: "gif"`',
    source: TEXT_TO_IMAGE_SOURCE,
  },
];

/**
 * ideogram_4_5's editing rules: "`very_low` requires reference images and is
 * not available with `preciseEdit`" (guides/pricing.md); `preciseEdit` —
 * "Requires at least one reference image."; `contextWindow` — "auto (requires
 * maskUri)"; `maskUri` — "Supports up to 3 additional reference images"
 * beside the one it masks (openapi.json, 2026-11-12). With `preciseEdit` the
 * default quality is `high`.
 */
const IDEOGRAM_4_5_EDIT_RULES: readonly PairingRule[] = [
  {
    if: { path: ["quality"], values: ["very_low"] },
    then: { path: ["referenceImages"], minItems: 1 },
    message: '`quality: "very_low"` requires `referenceImages`',
    source: "https://docs.dev.runwayml.com/guides/pricing.md",
  },
  {
    if: { path: ["preciseEdit"], values: [true] },
    then: { path: ["quality"], values: ["low", "medium", "high"], default: "high" },
    message: '`quality: "very_low"` is not available with `preciseEdit`',
    source: "https://docs.dev.runwayml.com/guides/pricing.md",
  },
  {
    if: { path: ["preciseEdit"], values: [true] },
    then: { path: ["referenceImages"], minItems: 1 },
    message: "`preciseEdit` requires at least one reference image",
    source: TEXT_TO_IMAGE_SOURCE,
  },
  {
    if: { path: ["contextWindow"], values: ["auto"] },
    then: { path: ["maskUri"], present: true },
    message: '`contextWindow: "auto"` requires `maskUri`',
    source: TEXT_TO_IMAGE_SOURCE,
  },
  {
    if: { path: ["maskUri"] },
    then: { path: ["referenceImages"], maxItems: 4 },
    message: "With `maskUri`, `referenceImages` takes the edited image plus up to 3 more",
    source: TEXT_TO_IMAGE_SOURCE,
  },
];

/**
 * Prompt caps, `referenceImages` caps, and which sub-fields each model's
 * reference-image item accepts. `tag` rides the gen4 / GPT Image / gemini /
 * nano_banana_2.1 arms; `subject` exists only on the gemini_image3 family
 * (gemini_image3_pro, gemini_image3.1_flash, gemini_image3.1_flash_lite); the
 * seedream, grok, muse, FIBO and Ideogram arms take bare `{ uri }` objects
 * and reject both.
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
    promptText: { min: 3, max: 45000 },
    arrays: { referenceImages: { max: 14 } },
    referenceImageFields: ["tag", "subject"],
  },
  "gemini_image3.1_flash": {
    promptText: PT_45K,
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
    // `ratio` is "anyOf" the 16-size enum and "string maxLength 32", which
    // the description narrows: "Also accepts freeform sizes whose
    // width*height is between 3686400 and 16777216 pixels." (openapi.json,
    // 2026-11-12).
    freeformRatio: {
      presets: SEEDREAM5_LITE_RATIOS,
      maxLength: 32,
      minPixels: 3_686_400,
      maxPixels: 16_777_216,
    },
  },
  grok_imagine_image_2: {
    promptText: PT_2500,
    arrays: { referenceImages: { max: 3 } },
    referenceImageFields: [],
  },
  "gemini_2.5_flash": {
    promptText: PT_45K,
    arrays: { referenceImages: { max: 3 } },
    referenceImageFields: ["tag"],
  },
  muse_image: {
    promptText: PT_4K,
    arrays: { referenceImages: { max: 10 } },
    referenceImageFields: [],
  },
  "gemini_image3.1_flash_lite": {
    promptText: { min: 1, max: 45000 },
    arrays: { referenceImages: { max: 14 } },
    referenceImageFields: ["tag", "subject"],
  },
  "nano_banana_2.1": {
    promptText: { min: 1, max: 45000 },
    arrays: { referenceImages: { max: 14 } },
    referenceImageFields: ["tag"],
  },
  ...rowsFor(["gpt_image_2_5_flare", "gpt_image_2_5_sunburst"], {
    promptText: { min: 1, max: 32000 },
    arrays: { referenceImages: { max: 16 } },
    referenceImageFields: ["tag"],
  }),
  ...rowsFor(["gpt_image_2_6_flare", "gpt_image_2_6_sunburst"], {
    promptText: { min: 1, max: 32000 },
    arrays: { referenceImages: { max: 16 } },
    referenceImageFields: ["tag"],
    pairings: GPT_IMAGE_2_6_FORMAT_RULES,
  }),
  bria_fibo_1_5: {
    promptText: { min: 1, max: 10000 },
    arrays: { referenceImages: { max: 1 } },
    referenceImageFields: [],
    numberRanges: SEED_31_BIT,
  },
  bria_fibo_edit_1_5: {
    promptText: { min: 1, max: 10000 },
    arrays: { referenceImages: { max: 4 } },
    referenceImageFields: [],
    numberRanges: SEED_31_BIT,
    pairings: [
      {
        if: { path: ["ratio"], values: BRIA_FIBO_1MP_RATIOS },
        then: { path: ["referenceImages"], minItems: 2 },
        message:
          "Choosing a `ratio` size requires at least 2 `referenceImages` — a single image always keeps its own framing (omit `ratio` or send \"auto\")",
        source: TEXT_TO_IMAGE_SOURCE,
      },
    ],
  },
  ideogram_4_0: {
    promptText: PT_4K,
    arrays: { referenceImages: { max: 1 } },
    referenceImageFields: [],
  },
  ideogram_4_5: {
    promptText: { min: 1, max: 10000 },
    arrays: { referenceImages: { max: 5 } },
    referenceImageFields: [],
    pairings: IDEOGRAM_4_5_EDIT_RULES,
  },
  ideogram_vector: {
    // `promptText` is required with no minLength on this arm.
    promptText: { min: 0, max: 9500 },
    arrays: { referenceImages: { max: 5 } },
    referenceImageFields: [],
    numberRanges: SEED_31_BIT,
  },
  seedream5_flash: {
    promptText: PT_4K,
    arrays: { referenceImages: { max: 10 } },
    referenceImageFields: [],
  },
  seedream5_pro_layers: {
    promptText: PT_4K,
    arrays: { referenceImages: { min: 1, max: 1 } },
    referenceImageFields: [],
  },
};

export const imageConstraints: Readonly<Partial<Record<string, EndpointConstraints>>> = {
  gen4_image: {
    deny: notInSchema("text_to_image", TEXT_TO_IMAGE_SOURCE, [
      "background",
      "contextWindow",
      "edit",
      "frameCount",
      "frameDurationMs",
      "grounding",
      "maskUri",
      "optimizePromptMode",
      "outputCount",
      "outputFormat",
      "preciseEdit",
      "quality",
      "reasoningEffort",
      "resolution",
      "thinkingLevel",
    ]),
    enums: { ratio: GEN4_IMAGE_RATIOS },
  },
  gen4_image_turbo: {
    deny: notInSchema("text_to_image", TEXT_TO_IMAGE_SOURCE, [
      "background",
      "contextWindow",
      "edit",
      "frameCount",
      "frameDurationMs",
      "grounding",
      "maskUri",
      "optimizePromptMode",
      "outputCount",
      "outputFormat",
      "preciseEdit",
      "quality",
      "reasoningEffort",
      "resolution",
      "thinkingLevel",
    ]),
    enums: { ratio: GEN4_IMAGE_RATIOS },
  },
  gpt_image_2: {
    deny: notInSchema("text_to_image", TEXT_TO_IMAGE_SOURCE, [
      "contentModeration",
      "contextWindow",
      "edit",
      "frameCount",
      "frameDurationMs",
      "grounding",
      "maskUri",
      "optimizePromptMode",
      "outputFormat",
      "preciseEdit",
      "reasoningEffort",
      "resolution",
      "seed",
      "thinkingLevel",
    ]),
    enums: {
      ratio: GPT_IMAGE_2_RATIOS,
      quality: GPT_IMAGE_2_QUALITIES,
      background: TRANSPARENT_BACKGROUNDS,
      outputCount: intRange(1, 10),
    },
  },
  gemini_image3_pro: {
    deny: notInSchema("text_to_image", TEXT_TO_IMAGE_SOURCE, [
      "background",
      "contentModeration",
      "contextWindow",
      "edit",
      "frameCount",
      "frameDurationMs",
      "grounding",
      "maskUri",
      "optimizePromptMode",
      "outputFormat",
      "preciseEdit",
      "quality",
      "reasoningEffort",
      "resolution",
      "seed",
      "thinkingLevel",
    ]),
    enums: { ratio: GEMINI_IMAGE3_PRO_RATIOS, outputCount: [1, 4] },
  },
  "gemini_image3.1_flash": {
    deny: notInSchema("text_to_image", TEXT_TO_IMAGE_SOURCE, [
      "background",
      "contentModeration",
      "contextWindow",
      "edit",
      "frameCount",
      "frameDurationMs",
      "grounding",
      "maskUri",
      "optimizePromptMode",
      "outputFormat",
      "preciseEdit",
      "quality",
      "reasoningEffort",
      "resolution",
      "seed",
      "thinkingLevel",
    ]),
    enums: { ratio: GEMINI_IMAGE31_FLASH_RATIOS, outputCount: [1, 4] },
  },
  seedream5_pro: {
    deny: notInSchema("text_to_image", TEXT_TO_IMAGE_SOURCE, [
      "background",
      "contentModeration",
      "contextWindow",
      "edit",
      "frameCount",
      "frameDurationMs",
      "maskUri",
      "optimizePromptMode",
      "preciseEdit",
      "quality",
      "reasoningEffort",
      "resolution",
      "seed",
      "thinkingLevel",
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
      "contextWindow",
      "edit",
      "frameCount",
      "frameDurationMs",
      "maskUri",
      "optimizePromptMode",
      "preciseEdit",
      "quality",
      "reasoningEffort",
      "resolution",
      "seed",
      "thinkingLevel",
    ]),
    // `ratio` is checked by `freeformRatio` in `imageShapeRules`: the enum or
    // a freeform size.
    enums: {
      outputFormat: IMAGE_OUTPUT_FORMATS,
      outputCount: intRange(1, 4),
    },
  },
  grok_imagine_image_2: {
    deny: notInSchema("text_to_image", TEXT_TO_IMAGE_SOURCE, [
      "background",
      "contentModeration",
      "contextWindow",
      "frameCount",
      "frameDurationMs",
      "grounding",
      "maskUri",
      "optimizePromptMode",
      "outputFormat",
      "preciseEdit",
      "reasoningEffort",
      "resolution",
      "seed",
      "thinkingLevel",
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
      "contextWindow",
      "edit",
      "frameCount",
      "frameDurationMs",
      "grounding",
      "maskUri",
      "optimizePromptMode",
      "outputCount",
      "outputFormat",
      "preciseEdit",
      "quality",
      "reasoningEffort",
      "resolution",
      "seed",
      "thinkingLevel",
    ]),
    enums: { ratio: GEMINI_25_FLASH_RATIOS },
  },
  muse_image: {
    deny: notInSchema("text_to_image", TEXT_TO_IMAGE_SOURCE, [
      "background",
      "contentModeration",
      "contextWindow",
      "edit",
      "frameCount",
      "frameDurationMs",
      "grounding",
      "maskUri",
      "optimizePromptMode",
      "preciseEdit",
      "quality",
      "reasoningEffort",
      "resolution",
      "seed",
      "thinkingLevel",
    ]),
    enums: {
      ratio: MUSE_IMAGE_RATIOS,
      outputFormat: MUSE_IMAGE_OUTPUT_FORMATS,
      outputCount: intRange(1, 10),
    },
  },
  "gemini_image3.1_flash_lite": {
    deny: notInSchema("text_to_image", TEXT_TO_IMAGE_SOURCE, [
      "background",
      "contentModeration",
      "contextWindow",
      "edit",
      "frameCount",
      "frameDurationMs",
      "grounding",
      "maskUri",
      "optimizePromptMode",
      "outputFormat",
      "preciseEdit",
      "quality",
      "reasoningEffort",
      "resolution",
      "seed",
      "thinkingLevel",
    ]),
    enums: { ratio: GEMINI_IMAGE31_FLASH_LITE_RATIOS, outputCount: [1, 4] },
  },
  "nano_banana_2.1": {
    deny: notInSchema("text_to_image", TEXT_TO_IMAGE_SOURCE, [
      "background",
      "contentModeration",
      "contextWindow",
      "edit",
      "frameCount",
      "frameDurationMs",
      "grounding",
      "maskUri",
      "optimizePromptMode",
      "outputFormat",
      "preciseEdit",
      "quality",
      "reasoningEffort",
      "resolution",
      "seed",
    ]),
    enums: {
      ratio: NANO_BANANA_21_RATIOS,
      thinkingLevel: NANO_BANANA_21_THINKING_LEVELS,
      outputCount: intRange(1, 4),
    },
  },
  gpt_image_2_5_flare: gptImage25Constraints(["opaque", "auto"]),
  gpt_image_2_5_sunburst: gptImage25Constraints(TRANSPARENT_BACKGROUNDS),
  ...rowsFor(["gpt_image_2_6_flare", "gpt_image_2_6_sunburst"], {
    deny: notInSchema("text_to_image", TEXT_TO_IMAGE_SOURCE, [
      "contentModeration",
      "contextWindow",
      "edit",
      "grounding",
      "maskUri",
      "optimizePromptMode",
      "preciseEdit",
      "resolution",
      "seed",
      "thinkingLevel",
    ]),
    enums: {
      ratio: GPT_IMAGE_2_RATIOS,
      quality: LOW_MEDIUM_HIGH,
      background: TRANSPARENT_BACKGROUNDS,
      outputFormat: GPT_IMAGE_2_6_OUTPUT_FORMATS,
      reasoningEffort: GPT_IMAGE_2_6_REASONING_EFFORTS,
      outputCount: intRange(1, 10),
    },
  }),
  bria_fibo_1_5: {
    deny: notInSchema("text_to_image", TEXT_TO_IMAGE_SOURCE, [
      "background",
      "contentModeration",
      "contextWindow",
      "edit",
      "frameCount",
      "frameDurationMs",
      "grounding",
      "maskUri",
      "optimizePromptMode",
      "outputCount",
      "preciseEdit",
      "quality",
      "reasoningEffort",
      "resolution",
      "thinkingLevel",
    ]),
    enums: { ratio: BRIA_FIBO_RATIOS, outputFormat: IMAGE_OUTPUT_FORMATS },
  },
  bria_fibo_edit_1_5: {
    deny: notInSchema("text_to_image", TEXT_TO_IMAGE_SOURCE, [
      "background",
      "contentModeration",
      "contextWindow",
      "edit",
      "frameCount",
      "frameDurationMs",
      "grounding",
      "maskUri",
      "optimizePromptMode",
      "outputCount",
      "preciseEdit",
      "quality",
      "reasoningEffort",
      "resolution",
      "thinkingLevel",
    ]),
    enums: { ratio: BRIA_FIBO_EDIT_RATIOS, outputFormat: IMAGE_OUTPUT_FORMATS },
  },
  ideogram_4_0: {
    deny: notInSchema("text_to_image", TEXT_TO_IMAGE_SOURCE, [
      "background",
      "contentModeration",
      "contextWindow",
      "edit",
      "frameCount",
      "frameDurationMs",
      "grounding",
      "maskUri",
      "optimizePromptMode",
      "outputFormat",
      "preciseEdit",
      "reasoningEffort",
      "resolution",
      "seed",
      "thinkingLevel",
    ]),
    enums: { ratio: IDEOGRAM_4_0_RATIOS, quality: LOW_MEDIUM_HIGH, outputCount: intRange(1, 4) },
  },
  ideogram_4_5: {
    deny: notInSchema("text_to_image", TEXT_TO_IMAGE_SOURCE, [
      "background",
      "contentModeration",
      "edit",
      "frameCount",
      "frameDurationMs",
      "grounding",
      "optimizePromptMode",
      "outputFormat",
      "reasoningEffort",
      "resolution",
      "seed",
      "thinkingLevel",
    ]),
    enums: {
      ratio: IDEOGRAM_4_5_RATIOS,
      quality: IDEOGRAM_4_5_QUALITIES,
      outputCount: intRange(1, 8),
    },
  },
  ideogram_vector: {
    // "`ideogram_vector` returns one SVG per request" — guides/pricing.md.
    deny: notInSchema("text_to_image", TEXT_TO_IMAGE_SOURCE, [
      "background",
      "contentModeration",
      "contextWindow",
      "edit",
      "frameCount",
      "frameDurationMs",
      "grounding",
      "maskUri",
      "optimizePromptMode",
      "outputCount",
      "outputFormat",
      "preciseEdit",
      "reasoningEffort",
      "resolution",
      "thinkingLevel",
    ]),
    enums: { ratio: ["auto"], quality: LOW_MEDIUM_HIGH },
  },
  seedream5_flash: {
    deny: notInSchema("text_to_image", TEXT_TO_IMAGE_SOURCE, [
      "background",
      "contentModeration",
      "contextWindow",
      "edit",
      "frameCount",
      "frameDurationMs",
      "grounding",
      "maskUri",
      "optimizePromptMode",
      "preciseEdit",
      "quality",
      "reasoningEffort",
      "resolution",
      "seed",
      "thinkingLevel",
    ]),
    enums: {
      ratio: SEEDREAM5_FLASH_RATIOS,
      outputFormat: IMAGE_OUTPUT_FORMATS,
      outputCount: intRange(1, 4),
    },
  },
  seedream5_pro_layers: {
    // A decomposition: one source image in, a base image plus up to 16
    // layers out — no `ratio`, no `outputCount`.
    deny: notInSchema("text_to_image", TEXT_TO_IMAGE_SOURCE, [
      "background",
      "contentModeration",
      "contextWindow",
      "edit",
      "frameCount",
      "frameDurationMs",
      "grounding",
      "maskUri",
      "outputCount",
      "preciseEdit",
      "quality",
      "ratio",
      "reasoningEffort",
      "seed",
      "thinkingLevel",
    ]),
    enums: {
      resolution: SEEDREAM5_PRO_LAYERS_RESOLUTIONS,
      optimizePromptMode: SEEDREAM5_PRO_LAYERS_PROMPT_MODES,
      outputFormat: IMAGE_OUTPUT_FORMATS,
    },
  },
};

/** The gpt_image_2_5 pair; Flare has no `"transparent"` background, Sunburst does. */
function gptImage25Constraints(background: readonly string[]): EndpointConstraints {
  return {
    deny: notInSchema("text_to_image", TEXT_TO_IMAGE_SOURCE, [
      "contentModeration",
      "contextWindow",
      "edit",
      "frameCount",
      "frameDurationMs",
      "grounding",
      "maskUri",
      "optimizePromptMode",
      "outputFormat",
      "preciseEdit",
      "reasoningEffort",
      "resolution",
      "seed",
      "thinkingLevel",
    ]),
    enums: {
      ratio: GPT_IMAGE_2_RATIOS,
      quality: GPT_IMAGE_2_5_QUALITIES,
      background,
      outputCount: intRange(1, 10),
    },
  };
}
