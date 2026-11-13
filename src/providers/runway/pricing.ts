/**
 * Request-aware credit pricing for the Runway API.
 *
 * Source of truth: https://docs.dev.runwayml.com/guides/pricing.md
 * ("Credit costs are documented only in /guides/pricing.md. Do not infer
 * pricing from anywhere else."), verified 2026-11-12. Credits cost $0.01
 * each, so USD = credits × 0.01.
 *
 * Estimates are worst-case where the request leaves the tier open: when a
 * price-driving field (`resolution`, `ratio`, `quality`) is omitted, its
 * documented default is assumed, and where no default is documented, the
 * most expensive documented tier. Components that depend on the
 * duration of referenced media (seedance2_5 input/reference-video seconds,
 * hailuo3 reference-video seconds) are NOT estimable from the wire params
 * (URLs carry no duration) and are excluded — the real bill can exceed the
 * estimate for those requests. Flat, countable surcharges (per-reference
 * credits, gemini_omni_flash's first-frame credit) are included.
 *
 * Video estimates need `duration`: when it is omitted no estimate is produced
 * rather than assuming seconds (defaults are documented for some arms and not
 * others, and none is assumed for any). `duration: "auto"` is estimated at
 * the documented reservation where there is one (gemini_omni_flash_1.2's 15
 * seconds) and not at all elsewhere.
 *
 * Kling 4.0 / 4.0 Flash bill a request with an input video (a video_to_video
 * source or any `referenceVideos`) at a lower per-second rate, applied to the
 * output duration plus "the greater of total input-video duration and output
 * duration"; the input's length is unknown, so that term is estimated at its
 * floor, the output duration. The Gemini Omni Flash 1.x arms add "1 credit per
 * second of input video", which is excluded like the other media-length
 * components above.
 *
 * On video_to_video that rule bites hardest: `aleph2` and `gemini_omni_flash`
 * have no `duration` param at all (output length follows the input video, and
 * gemini_omni_flash bills per second of *input*), and unmodel cannot read the
 * length of a remote `videoUri`. Those requests therefore get no estimate.
 * The seedance/hailuo arms do take `duration` and estimate normally, minus the
 * input/reference-video seconds they also bill for.
 */

import { CREDIT_USD } from "./models";
import {
  RATIO_TIERS,
  SEEDANCE2_5_1080P_RATIOS,
  SEEDANCE2_5_4K_RATIOS,
  SEEDANCE2_SMALL_RATIOS_BY_TIER,
  type RunwayRatioTier,
} from "./constraints";

/** Splits "W:H" into pixel dimensions; undefined for non-numeric ratios. */
function ratioDims(ratio: string): { w: number; h: number } | undefined {
  const match = /^(\d+):(\d+)$/.exec(ratio);
  if (match === null) return undefined;
  return { w: Number(match[1]), h: Number(match[2]) };
}

/** Largest dimension of a "W:H" ratio; undefined when not parseable. */
function maxDim(ratio: string): number | undefined {
  const dims = ratioDims(ratio);
  return dims === undefined ? undefined : Math.max(dims.w, dims.h);
}

/** The three generation routes that bill per second of video. */
export type VideoRoute = "image_to_video" | "text_to_video" | "video_to_video";

interface VideoPricingFields {
  audio?: boolean;
  resolution?: string;
  ratio?: string;
  route?: VideoRoute;
  /**
   * The request carries an input video — a video_to_video source or any
   * `referenceVideos` — which switches Kling 4.0's per-second rate.
   */
  inputVideo?: boolean;
  /** seedance2_5 `draft: true` — a preview billed at the 480p rate. */
  draft?: boolean;
}

/** This model's documented billing tier for `ratio`, from ./constraints.ts. */
function ratioTier(model: string, ratio: string | undefined): RunwayRatioTier | undefined {
  return ratio === undefined ? undefined : RATIO_TIERS[model]?.[ratio];
}

/**
 * Credits per second of output video for a model + request configuration.
 * Undefined when the model has no published per-second rate.
 */
export function videoCreditsPerSecond(
  model: string,
  fields: VideoPricingFields,
): number | undefined {
  switch (model) {
    case "aleph2":
      // 28 credits/s (56-credit minimum). aleph2 has no `duration` param —
      // the output length follows the input video — so videoCostUSD only
      // produces a number when the caller supplies the duration itself.
      return 28;
    case "gen4.5":
      return 12;
    case "gen4_turbo":
      return 5;
    case "veo3.1":
      // audio defaults to true in the request schema, so omitted = with audio.
      return fields.audio === false ? 20 : 40;
    case "veo3.1_fast":
      return fields.audio === false ? 10 : 15;
    case "hailuo3":
      // 768P / 768p: 10, 2K / 2k: 15 — and 2K is the default ("`resolution`
      // of `768P` or `2K` (default `2K`)" — inputs.md, 2026-11-12).
      return fields.resolution === "768P" || fields.resolution === "768p" ? 10 : 15;
    case "happyhorse_1_0": {
      // 720p: 15, 1080p: 30. image_to_video sizes by `resolution`, "default
      // `720P`" (inputs.md, 2026-11-12); text_to_video by `ratio`, whose
      // first five sizes are the 720p tier (HAPPYHORSE_720P_RATIOS) and which
      // documents no default → worst case 30.
      if (fields.route === "image_to_video") {
        return fields.resolution === "1080P" || fields.resolution === "1080p" ? 30 : 15;
      }
      return fields.ratio !== undefined && HAPPYHORSE_720P_RATIOS.has(fields.ratio) ? 15 : 30;
    }
    case "seedance2": {
      // guides/pricing.md, 2026-11-12: 14 at 480p, 30 at 720p, 40 at 1080p,
      // 150 at 4K (56-credit minimum). The small sizes split six and six
      // into 480p and 720p (SEEDANCE2_SMALL_RATIOS_BY_TIER). The
      // 3840/2880-family is 4K; everything else in the enum is 1080p
      // (1440:1440 included, despite its small max dimension). Omitted/unknown
      // ratio → worst case 150.
      if (fields.ratio === undefined) return 150;
      if ((SEEDANCE2_SMALL_RATIOS_BY_TIER["480p"] as readonly string[]).includes(fields.ratio)) return 14;
      if ((SEEDANCE2_SMALL_RATIOS_BY_TIER["720p"] as readonly string[]).includes(fields.ratio)) return 30;
      const max = maxDim(fields.ratio);
      if (max === undefined) return 150;
      if (max < 2880) return 40;
      return 150;
    }
    case "seedance2_fast":
      // 11 at 480p, 24 at 720p (44-credit minimum), by RATIO_TIERS; no
      // default ratio is documented, so an omitted one bills at 24.
      return ratioTier(model, fields.ratio) === "480p" ? 11 : 24;
    case "seedance2_mini":
      // 7 at 480p, 15 at 720p (28-credit minimum), as above.
      return ratioTier(model, fields.ratio) === "480p" ? 7 : 15;
    case "seedance2_5": {
      // 20 / 30 / 68 credits/s of output at 480p / 720p / 1080p (80-credit
      // minimum). "480p 16:9 / 9:16 use `854:480` / `480:854`" (inputs.md),
      // the other small sizes bill at the 720p worst case, and an omitted
      // ratio is the documented default `1280:720`. No 2.5 4K rate is
      // published, so the 4K sizes get no estimate. Input/reference video
      // seconds also bill (10 / 15 / 34 credits/s) but are not estimable
      // from URLs.
      //
      // A draft preview "is always 480p `.mp4`, and it is billed at the 480p
      // rate" (guides/models.md, 2026-11-12) at any `ratio`: "a 720p, 1080p,
      // or 4K ratio is accepted, and the preview uses the 480p frame for that
      // aspect" (guides/models.md, 2026-11-13). The minimum still applies.
      if (fields.draft === true) return 20;
      if (fields.ratio === "854:480" || fields.ratio === "480:854") return 20;
      if (fields.ratio !== undefined && (SEEDANCE2_5_4K_RATIOS as readonly string[]).includes(fields.ratio)) {
        return undefined;
      }
      if (fields.ratio !== undefined && (SEEDANCE2_5_1080P_RATIOS as readonly string[]).includes(fields.ratio)) {
        return 68;
      }
      return 30;
    }
    case "grok_imagine_1_5": {
      // 480p: 10, 720p: 16, 1080p: 29; "default `480p`" on both routes
      // (inputs.md, 2026-11-12).
      if (fields.resolution === "720p") return 16;
      if (fields.resolution === "1080p") return 29;
      return 10;
    }
    case "gemini_omni_flash":
      // text/image-to-video: 10 credits per second of OUTPUT. video-to-video:
      // 11 credits per second of INPUT video (capped at 10s), "plus 1 credit
      // per reference image" — a different billing basis, and the v2v arm
      // has no `duration` param, so a caller must pass the input length
      // explicitly to get a number out.
      return fields.route === "video_to_video" ? 11 : 10;
    // guides/pricing.md, 2026-11-12, for every case below.
    case "kling2.5_turbo_pro":
      return 12;
    case "kling3.0_standard":
      // "`audio` defaults to `true`. Kling 3.0 Standard and Pro use the
      // no-audio rate when `audio` is `false`."
      return fields.audio === false ? 9 : 13;
    case "kling3.0_pro":
      return fields.audio === false ? 12 : 17;
    case "kling3.0_4k":
      return 43;
    case "klingO3_standard":
    case "klingO3_pro":
    case "klingO3_4k":
      // "Kling O3 video-to-video is billed per second of the input video",
      // whose length a URI does not carry, and the arm has no `duration`.
      if (fields.route === "video_to_video") return undefined;
      return model === "klingO3_standard" ? 13 : model === "klingO3_pro" ? 17 : 43;
    case "kling_4": {
      // List price — "List price: 15.7 and 9.4 credits per second" at 720p,
      // "23.5 and 14.1" at 1080p, without / with an input video. Through
      // 2026-11-30 UTC the charge is 20% lower, so until then this is an
      // upper bound. "The default output is landscape 720p" (inputs.md);
      // a ratio outside the documented tiers → worst case 1080p.
      const tier = fields.ratio === undefined ? "720p" : (ratioTier(model, fields.ratio) ?? "1080p");
      if (tier === "720p") return fields.inputVideo === true ? 9.4 : 15.7;
      return fields.inputVideo === true ? 14.1 : 23.5;
    }
    case "kling_4_flash":
      // 720p only: 9.4 without input video, 6.3 with.
      return fields.inputVideo === true ? 6.3 : 9.4;
    case "wan3":
    case "wan3_prime": {
      // wan3: 5 / 10 / 20 at 480p / 720p / 1080p, default `auto_1080p`
      // (inputs.md). wan3_prime: 6.8 / 14 / 28, no documented default →
      // worst case 1080p; so is a ratio outside the tier table.
      const rates = model === "wan3" ? WAN3_RATES : WAN3_PRIME_RATES;
      const tier = ratioTier(model, fields.ratio) ?? "1080p";
      return rates[tier] ?? rates["1080p"];
    }
    case "h3_max":
      // 480p: 5, 768p: 8; no documented default → worst case 8.
      return fields.resolution === "480p" ? 5 : 8;
    case "grok_imagine_1_5_lite": {
      // 2 / 3 / 14 at 480p / 720p / 1080p. Both routes default to 480p
      // ("default `848:480`" / "default `auto_480p`" — inputs.md); a ratio
      // outside the tier table → worst case 1080p.
      const tier = fields.ratio === undefined ? "480p" : ratioTier(model, fields.ratio);
      return tier === undefined ? 14 : (GROK_IMAGINE_1_5_LITE_RATES[tier] ?? 14);
    }
    case "gemini_omni_flash_1.1": {
      // 3.4 / 10 / 15 / 30 at 360p / 720p / 1080p / 4K; no documented
      // default for 1.1 → worst case 4K.
      const tier = ratioTier(model, fields.ratio);
      return tier === undefined ? 30 : GEMINI_OMNI_FLASH_1_1_RATES[tier];
    }
    case "gemini_omni_flash_1.2": {
      // 2 / 7 / 10 / 21 at 360p / 720p / 1080p / 4K; "defaults to 720p". On
      // video_to_video, extend and edit size the output by `resolution`.
      const tier =
        (fields.resolution as RunwayRatioTier | undefined) ??
        (fields.ratio === undefined ? "720p" : ratioTier(model, fields.ratio));
      return tier === undefined ? 21 : GEMINI_OMNI_FLASH_1_2_RATES[tier];
    }
    default:
      return undefined;
  }
}

// Per-tier credits/second, guides/pricing.md, 2026-11-12.
const WAN3_RATES: Partial<Record<RunwayRatioTier, number>> = { "480p": 5, "720p": 10, "1080p": 20 };
const WAN3_PRIME_RATES: Partial<Record<RunwayRatioTier, number>> = {
  "480p": 6.8,
  "720p": 14,
  "1080p": 28,
};
const GROK_IMAGINE_1_5_LITE_RATES: Partial<Record<RunwayRatioTier, number>> = {
  "480p": 2,
  "720p": 3,
  "1080p": 14,
};
const GEMINI_OMNI_FLASH_1_1_RATES: Partial<Record<RunwayRatioTier, number>> = {
  "360p": 3.4,
  "720p": 10,
  "1080p": 15,
  "4k": 30,
};
const GEMINI_OMNI_FLASH_1_2_RATES: Partial<Record<RunwayRatioTier, number>> = {
  "360p": 2,
  "720p": 7,
  "1080p": 10,
  "4k": 21,
};

/**
 * happyhorse_1_0 text_to_video's 720p sizes — the first five of its ten,
 * whose other five are the same shapes at 1080p (openapi.json; "10
 * `width:height` ratios across 720p and 1080p" — inputs.md, 2026-11-12).
 */
const HAPPYHORSE_720P_RATIOS = new Set<string>(["1280:720", "720:1280", "960:960", "1108:832", "832:1108"]);

/** Documented per-generation credit minimums (guides/pricing.md). */
const VIDEO_MINIMUM_CREDITS: Record<string, number> = {
  aleph2: 56,
  // "(56 credit minimum per generation)" / "(44 …)" / "(28 …)" — 2026-11-12.
  seedance2: 56,
  seedance2_fast: 44,
  seedance2_mini: 28,
  seedance2_5: 80,
  // "Rounded up to the next credit; 29-credit minimum" / "a 6-credit
  // minimum per request" — guides/pricing.md, 2026-11-12.
  kling_4_flash: 29,
  "gemini_omni_flash_1.2": 6,
};

/**
 * Models whose charge is "rounded up to the next credit" (guides/pricing.md,
 * 2026-11-12). Elsewhere the page states no rounding, so fractional rates
 * (6.8, 3.4 credits/s) are estimated unrounded.
 */
const ROUNDED_UP = new Set(["kling_4", "kling_4_flash", "gemini_omni_flash_1.2"]);

/**
 * Flat credits per counted reference (image or audio reference, keyframe or
 * start frame — the endpoint modules count what each model bills), from
 * guides/pricing.md.
 */
const PER_REFERENCE_CREDITS: Record<string, number> = {
  grok_imagine_1_5: 1,
  hailuo3: 2,
  // "plus 1 credit per reference image (including an image-to-video start
  // frame)" / "plus 1 credit per reference image or keyframe" — 2026-11-12.
  "gemini_omni_flash_1.1": 1,
  "gemini_omni_flash_1.2": 1,
};

/**
 * What `duration: "auto"` reserves, where documented: "With `duration:
 * \"auto\"`, generation and extension reserve 15 seconds of output" —
 * gemini_omni_flash_1.2, guides/pricing.md; "`auto` is billed at the variant
 * maximum up front; unused credits are refunded" — the seedance arms,
 * openapi.json (both 2026-11-12). Elsewhere `"auto"` gets no estimate.
 */
const AUTO_DURATION_SECONDS: Record<string, number> = {
  "gemini_omni_flash_1.2": 15,
  seedance2: 15,
  seedance2_fast: 15,
  seedance2_mini: 15,
  seedance2_5: 30,
};

/**
 * Kling 4.0 with an input video bills "N credits per second of output plus N
 * credits per second of the greater of total input-video duration and output
 * duration". The input's length is not in the wire params, so the second
 * term is estimated at the output duration — its floor.
 */
const INPUT_VIDEO_DOUBLES_OUTPUT = new Set(["kling_4", "kling_4_flash"]);

/** Round up to whole credits, ignoring binary floating-point noise (9.4 × 5). */
function ceilCredits(credits: number): number {
  return Math.ceil(Number(credits.toFixed(6)));
}

/**
 * The professional-output surcharges on gen4.5 and aleph2 — guides/pricing.md,
 * 2026-11-12: "| `prores`, `png_sequence` | 5 credits per second |" and "|
 * 10-bit and HDR profiles (`hdr10`, `hlg`, `sdr_rec709_10bit`, … ) | 20 credits
 * per second; 40 credits per second when the output is larger than 4
 * megapixels (roughly 4K) |". seedance2_5's `mov` "is billed at the same rates
 * as the default `mp4`".
 */
export const NON_MP4_SURCHARGE_CREDITS_PER_SECOND = 5;
export const HDR_SURCHARGE_CREDITS_PER_SECOND = 20;
export const HDR_OVER_4MP_SURCHARGE_CREDITS_PER_SECOND = 40;

/**
 * Per-second surcharge for `outputFormat` at `ratio`. An HDR request whose
 * output size is unknown (aleph2 follows its input) is charged the >4MP rate.
 */
function outputFormatSurcharge(format: string | undefined, ratio: string | undefined): number {
  if (format === undefined || format === "mp4" || format === "mov") return 0;
  if (format === "prores" || format === "png_sequence") return NON_MP4_SURCHARGE_CREDITS_PER_SECOND;
  const dims = ratio === undefined ? undefined : ratioDims(ratio);
  return dims !== undefined && dims.w * dims.h <= 4_000_000
    ? HDR_SURCHARGE_CREDITS_PER_SECOND
    : HDR_OVER_4MP_SURCHARGE_CREDITS_PER_SECOND;
}

export interface VideoCostInputs extends VideoPricingFields {
  model: string;
  duration?: number | "auto";
  /** Count of image/audio references that bill flat per-reference credits. */
  flatReferenceCount?: number;
  /** Extra flat credits (e.g. gemini_omni_flash's 1-credit first frame). */
  flatExtraCredits?: number;
  /** `prores` / `png_sequence` add 5 credits per second of output, HDR profiles 20 or 40. */
  outputFormat?: string;
}

/**
 * Worst-case USD for one video generation, or undefined when the rate or
 * the duration is unknown.
 */
export function videoCostUSD(inputs: VideoCostInputs): number | undefined {
  const rate = videoCreditsPerSecond(inputs.model, inputs);
  const seconds =
    inputs.duration === "auto" ? AUTO_DURATION_SECONDS[inputs.model] : inputs.duration;
  if (rate === undefined || seconds === undefined) return undefined;
  const billedSeconds =
    inputs.inputVideo === true && INPUT_VIDEO_DOUBLES_OUTPUT.has(inputs.model)
      ? 2 * seconds
      : seconds;
  let credits = rate * billedSeconds;
  // The documented minimum floors the per-second charge; flat surcharges are
  // additive on top of it.
  const minimum = VIDEO_MINIMUM_CREDITS[inputs.model];
  if (minimum !== undefined && credits < minimum) credits = minimum;
  credits += outputFormatSurcharge(inputs.outputFormat, inputs.ratio) * seconds;
  // Flat per-reference surcharges (PER_REFERENCE_CREDITS): grok_imagine_1_5
  // bills 1 credit per image or audio reference (including an image-to-video
  // start frame); hailuo3 bills 2 credits per reference image; the Gemini
  // Omni Flash 1.x arms 1 per reference image or keyframe.
  if (inputs.flatReferenceCount !== undefined && inputs.flatReferenceCount > 0) {
    credits += inputs.flatReferenceCount * (PER_REFERENCE_CREDITS[inputs.model] ?? 0);
  }
  if (inputs.flatExtraCredits !== undefined) credits += inputs.flatExtraCredits;
  if (ROUNDED_UP.has(inputs.model)) credits = ceilCredits(credits);
  return credits * CREDIT_USD;
}

export interface ImageCostInputs {
  model: string;
  ratio?: string;
  quality?: string;
  outputCount?: number;
  referenceCount?: number;
  /** gpt_image_2_6_*: GIF and SVG are priced on their own tables. */
  outputFormat?: string;
  /** gpt_image_2_6_* GIF: the price steps with the frame count (default 9). */
  frameCount?: number;
  /** ideogram_4_5: `preciseEdit` defaults `quality` to `high`. */
  preciseEdit?: boolean;
  /** seedream5_pro_layers: the resolution tier sets the per-image rate. */
  resolution?: string;
}

/**
 * The GPT Image 2.5 / 2.6 size grid: each `ratio` as its tier and aspect
 * column (1:1, 4:5|5:4, 3:4|4:3, 2:3|3:2, 9:16|16:9, 21:9), transcribed from
 * the size lists above guides/pricing.md's tables, 2026-11-12.
 */
const GPT_IMAGE_SIZE_GRID: Readonly<Record<string, readonly [tier: 0 | 1 | 2, aspect: number]>> = {
  "1920:1920": [0, 0], "1536:1920": [0, 1], "1920:1536": [0, 1], "1440:1920": [0, 2],
  "1920:1440": [0, 2], "1280:1920": [0, 3], "1920:1280": [0, 3], "1088:1920": [0, 4],
  "1920:1088": [0, 4], "2048:880": [0, 5],
  "2560:2560": [1, 0], "2048:2560": [1, 1], "2560:2048": [1, 1], "1920:2560": [1, 2],
  "2560:1920": [1, 2], "1712:2560": [1, 3], "2560:1712": [1, 3], "1440:2560": [1, 4],
  "2560:1440": [1, 4], "2912:1248": [1, 5],
  "2880:2880": [2, 0], "2560:3200": [2, 1], "3200:2560": [2, 1], "2448:3264": [2, 2],
  "3264:2448": [2, 2], "2336:3504": [2, 3], "3504:2336": [2, 3], "2160:3840": [2, 4],
  "3840:2160": [2, 4], "3840:1648": [2, 5],
};

/** Credits per image, by quality → [1K, 2K, 4K] → aspect column. */
type GptImageTable = Readonly<Record<string, readonly [readonly number[], readonly number[], readonly number[]]>>;

/** gpt_image_2_5_flare / _sunburst — guides/pricing.md, 2026-11-12. */
const GPT_IMAGE_2_5_CREDITS: GptImageTable = {
  low: [[2, 1, 1, 1, 1, 1], [2, 2, 2, 1, 1, 1], [3, 2, 2, 2, 2, 1]],
  medium: [[3, 2, 2, 2, 2, 1], [4, 3, 3, 2, 2, 2], [5, 4, 4, 4, 3, 2]],
  high: [[11, 8, 7, 6, 5, 4], [16, 11, 10, 8, 6, 5], [19, 15, 14, 13, 11, 7]],
  xhigh: [[19, 13, 12, 10, 8, 6], [28, 19, 17, 14, 11, 8], [34, 27, 25, 23, 19, 12]],
  max: [[42, 29, 26, 22, 17, 12], [63, 43, 38, 31, 24, 18], [75, 60, 55, 50, 43, 26]],
};

/**
 * gpt_image_2_6_flare / _sunburst, PNG/JPEG/WebP (and the image portion of
 * SVG) — guides/pricing.md, 2026-11-12: "`high` costs the same as on GPT Image
 * 2.5, and `low` and `medium` cost more."
 */
const GPT_IMAGE_2_6_CREDITS: GptImageTable = {
  low: [[5, 4, 4, 3, 2, 2], [8, 5, 5, 4, 3, 3], [9, 8, 7, 6, 5, 4]],
  medium: [[9, 6, 6, 5, 4, 3], [13, 9, 8, 7, 5, 4], [16, 13, 12, 11, 9, 6]],
  high: [[11, 8, 7, 6, 5, 4], [16, 11, 10, 8, 6, 5], [19, 15, 14, 13, 11, 7]],
};

/** gpt_image_2_6_* GIF, per animation by frames 2–8 / 9–12 / 13–16 — guides/pricing.md. */
const GPT_IMAGE_2_6_GIF_CREDITS: Readonly<Record<string, readonly [number, number, number]>> = {
  low: [2, 4, 6],
  medium: [4, 7, 10],
  high: [4, 8, 12],
};

/** "SVG output uses the image prices below plus a 50-credit authoring charge per output." */
const GPT_IMAGE_2_6_SVG_CREDITS = 50;

/**
 * One GPT Image 2.5 / 2.6 image at `ratio`. "With `ratio: \"auto\"`, the
 * request is charged the 4K square price up front", which is also the worst
 * case for a ratio outside the grid.
 */
function gptImageCredits(table: GptImageTable, quality: string, ratio: string | undefined): number {
  const rows = table[quality] ?? table["high"]!;
  const [tier, aspect] =
    (ratio === undefined ? undefined : GPT_IMAGE_SIZE_GRID[ratio]) ?? ([2, 0] as const);
  return rows[tier][aspect] ?? rows[2][0]!;
}

/**
 * A ratio's pixel area, used to separate documented resolution tiers. The
 * enums cluster cleanly: ~1MP (1K), ~4MP (2K), and ~8MP+ (4K for
 * gpt_image_2) / ~16.7MP (4K for gemini_image3_pro).
 */
function ratioPixels(ratio: string): number | undefined {
  const dims = ratioDims(ratio);
  return dims === undefined ? undefined : dims.w * dims.h;
}

/** gpt_image_2 credits/image by quality × tier (guides/pricing.md). */
const GPT_IMAGE_2_CREDITS: Record<string, { small: number; large: number }> = {
  low: { small: 1, large: 2 },
  medium: { small: 5, large: 11 },
  high: { small: 20, large: 41 },
  auto: { small: 20, large: 41 },
};

/**
 * gpt_image_2 ratios billed at the 4K tier — the 3840×2160-class family
 * from the request schema's ratio enum (openapi.json, verified 2026-11-12).
 */
const GPT_IMAGE_2_4K_RATIOS = new Set<string>([
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
]);

/**
 * Worst-case USD for one image generation request (all output images), or
 * undefined when the model has no published rate.
 */
export function imageCostUSD(inputs: ImageCostInputs): number | undefined {
  const count = inputs.outputCount ?? 1;
  const references = inputs.referenceCount ?? 0;
  switch (inputs.model) {
    case "gen4_image": {
      // 5 credits per 720p image, 8 per 1080p; the ratio→tier mapping is
      // undocumented → worst case 8.
      return 8 * CREDIT_USD;
    }
    case "gen4_image_turbo":
      return 2 * CREDIT_USD;
    case "gemini_2.5_flash":
      return 5 * CREDIT_USD;
    case "seedream5_lite":
      return 4 * count * CREDIT_USD;
    case "seedream5_pro": {
      // 5 credits per 1K image, 9 per 2K. auto_1k/auto_2k bill at their
      // tier; the numeric enum splits at ~1MP (1024–1376 family) vs ~4MP
      // (2048+ family). Unrecognized → worst case 9.
      let per = 9;
      if (inputs.ratio === "auto_1k") per = 5;
      else if (inputs.ratio !== undefined && inputs.ratio !== "auto_2k") {
        const pixels = ratioPixels(inputs.ratio);
        // 1K family ≤ ~1.12MP; 2K family ≥ ~3.9MP — 2MP splits cleanly.
        if (pixels !== undefined && pixels < 2_000_000) per = 5;
      }
      return per * count * CREDIT_USD;
    }
    case "gemini_image3_pro": {
      // 20 credits per 1K/2K image, 40 per 4K. The 4K enum family is
      // ~16.7MP; everything at or below ~4.3MP (up to 3168:1344) is 1K/2K.
      let per = 40;
      if (inputs.ratio !== undefined) {
        const pixels = ratioPixels(inputs.ratio);
        if (pixels !== undefined && pixels < 8_000_000) per = 20;
      }
      return per * count * CREDIT_USD;
    }
    case "gpt_image_2": {
      // credits/image × outputCount; default quality is high; `auto` bills
      // at the 4K tier (guides/pricing.md). The 4K tier is the
      // 3840×2160-class family from the request schema's ratio enum
      // (explicit list — pixel area alone does not separate 3840:1648 from
      // 2560:2560). Unrecognized ratios → worst case 4K.
      const tier = GPT_IMAGE_2_CREDITS[inputs.quality ?? "high"] ?? GPT_IMAGE_2_CREDITS["high"]!;
      const small =
        inputs.ratio !== undefined &&
        inputs.ratio !== "auto" &&
        !GPT_IMAGE_2_4K_RATIOS.has(inputs.ratio) &&
        ratioPixels(inputs.ratio) !== undefined;
      return (small ? tier.small : tier.large) * count * CREDIT_USD;
    }
    case "grok_imagine_image_2": {
      // outputCount × perImage + referenceCount × 1. Default quality is
      // medium (anything other than `low` bills as medium). 1K: low 4,
      // medium 6; 2K: low 6, medium 8; auto_1k/auto_2k bill at their tier.
      // The numeric enum splits at ~1MP vs ~4MP.
      const low = inputs.quality === "low";
      let large = true;
      if (inputs.ratio === "auto_1k") large = false;
      else if (inputs.ratio !== undefined && inputs.ratio !== "auto_2k") {
        const pixels = ratioPixels(inputs.ratio);
        if (pixels !== undefined && pixels < 2_000_000) large = false;
      }
      const per = large ? (low ? 6 : 8) : low ? 4 : 6;
      return (per * count + references) * CREDIT_USD;
    }
    case "gemini_image3.1_flash": {
      // "5 credits per 512px image, 7 credits per 1K image, 11 credits per 2K
      // image, 16 credits per 4K image" (guides/pricing.md, 2026-11-12). Its
      // 56 sizes cluster at ~0.26MP, ~1MP, ~4MP and ~16.7MP, so 0.5MP, 2MP and
      // 8MP split the tiers, as for gemini_image3_pro; unrecognized → 16.
      const pixels = inputs.ratio === undefined ? undefined : ratioPixels(inputs.ratio);
      const per =
        pixels === undefined
          ? 16
          : pixels < 500_000
            ? 5
            : pixels < 2_000_000
              ? 7
              : pixels < 8_000_000
                ? 11
                : 16;
      return per * count * CREDIT_USD;
    }
    // guides/pricing.md, 2026-11-12, for every case below.
    case "muse_image":
      // "1 credit per image, any resolution".
      return 1 * count * CREDIT_USD;
    case "gemini_image3.1_flash_lite":
      // "4 credits per 1K image" — its ten sizes are all 1K.
      return 4 * count * CREDIT_USD;
    case "seedream5_flash":
      // "2 credits per image, any resolution".
      return 2 * count * CREDIT_USD;
    case "nano_banana_2.1": {
      // 4 / 6 / 12 credits per 1K / 2K / 4K image. Its enum clusters at
      // ~1MP, ~4.2MP and ~16.7MP, so 2MP and 8MP split the tiers;
      // unrecognized → worst case 4K.
      const pixels = inputs.ratio === undefined ? undefined : ratioPixels(inputs.ratio);
      const per = pixels === undefined ? 12 : pixels < 2_000_000 ? 4 : pixels < 8_000_000 ? 6 : 12;
      return per * count * CREDIT_USD;
    }
    case "gpt_image_2_5_flare":
    case "gpt_image_2_5_sunburst": {
      // "(credits per image + 1 credit per reference image) × `outputCount`
      // … Default quality is `high`."
      const per = gptImageCredits(GPT_IMAGE_2_5_CREDITS, inputs.quality ?? "high", inputs.ratio);
      return (per + references) * count * CREDIT_USD;
    }
    case "gpt_image_2_6_flare":
    case "gpt_image_2_6_sunburst": {
      // `quality` defaults to `high`, `outputFormat` to `png`. GIF is "priced
      // per animation by `quality` and `frameCount` (default 9)"; SVG is the
      // image price "plus a 50-credit authoring charge per output"; GIF and
      // SVG take no reference images, so only PNG/JPEG/WebP add them.
      const quality = inputs.quality ?? "high";
      if (inputs.outputFormat === "gif") {
        const frames = inputs.frameCount ?? 9;
        const steps = GPT_IMAGE_2_6_GIF_CREDITS[quality] ?? GPT_IMAGE_2_6_GIF_CREDITS["high"]!;
        const per = frames <= 8 ? steps[0] : frames <= 12 ? steps[1] : steps[2];
        return per * count * CREDIT_USD;
      }
      const image = gptImageCredits(GPT_IMAGE_2_6_CREDITS, quality, inputs.ratio);
      if (inputs.outputFormat === "svg") {
        return (image + GPT_IMAGE_2_6_SVG_CREDITS) * count * CREDIT_USD;
      }
      return (image + references) * count * CREDIT_USD;
    }
    case "bria_fibo_1_5": {
      // "5 credits per 1MP image, 10 credits per 4MP image"; the enum's
      // 1MP sizes are ≤1.2MP and its 4MP sizes ≥2.3MP. Unrecognized → 10.
      const pixels = inputs.ratio === undefined ? undefined : ratioPixels(inputs.ratio);
      return (pixels !== undefined && pixels < 2_000_000 ? 5 : 10) * CREDIT_USD;
    }
    case "bria_fibo_edit_1_5":
      return 5 * CREDIT_USD;
    case "ideogram_4_0": {
      // low 4, medium 7, high 11 × `outputCount`; "defaults to `medium`".
      const per = IDEOGRAM_4_0_CREDITS[inputs.quality ?? "medium"] ?? 11;
      return per * count * CREDIT_USD;
    }
    case "ideogram_4_5": {
      // very_low 1, low 4, medium 8, high 25 × `outputCount`; "defaults to
      // `medium` when generating from reference images and `high` otherwise,
      // including `preciseEdit`".
      const fallback = inputs.preciseEdit !== true && references > 0 ? "medium" : "high";
      const per = IDEOGRAM_4_5_CREDITS[inputs.quality ?? fallback] ?? 25;
      return per * count * CREDIT_USD;
    }
    case "ideogram_vector": {
      // One SVG: low 14, medium 17 (the default), high 22 — 35 "with
      // reference images".
      const quality = inputs.quality ?? "medium";
      if (quality === "high") return (references > 0 ? 35 : 22) * CREDIT_USD;
      return (quality === "low" ? 14 : 17) * CREDIT_USD;
    }
    case "seedream5_pro_layers":
      // Billed per returned image (base + up to 16 layers) at 3 credits
      // (1K / 1.5K) or 5 (2K / auto, the default); "it reserves 51 credits
      // at 1K or 1.5K and 85 credits at 2K or auto" — the worst case.
      return (inputs.resolution === "1k" || inputs.resolution === "1.5k" ? 51 : 85) * CREDIT_USD;
    default:
      // Unknown models have no published rate.
      return undefined;
  }
}

/** ideogram_4_0 credits per image by quality — guides/pricing.md, 2026-11-12. */
const IDEOGRAM_4_0_CREDITS: Readonly<Record<string, number>> = { low: 4, medium: 7, high: 11 };

/** ideogram_4_5 credits per image by quality — guides/pricing.md, 2026-11-12. */
const IDEOGRAM_4_5_CREDITS: Readonly<Record<string, number>> = {
  very_low: 1,
  low: 4,
  medium: 8,
  high: 25,
};
