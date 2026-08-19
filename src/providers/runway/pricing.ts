/**
 * Request-aware credit pricing for the Runway API.
 *
 * Source of truth: https://docs.dev.runwayml.com/guides/pricing.md
 * ("Credit costs are documented only in /guides/pricing.md. Do not infer
 * pricing from anywhere else."), verified 2026-08-13. Credits cost $0.01
 * each, so USD = credits × 0.01.
 *
 * Estimates are worst-case where the request leaves the tier open: when a
 * price-driving field (`resolution`, `ratio`, `quality`) is omitted, the
 * most expensive documented tier is assumed. Components that depend on the
 * duration of referenced media (seedance2_5 input/reference-video seconds,
 * hailuo3 reference-video seconds) are NOT estimable from the wire params
 * (URLs carry no duration) and are excluded — the real bill can exceed the
 * estimate for those requests. Flat, countable surcharges (per-reference
 * credits, gemini_omni_flash's first-frame credit) are included.
 *
 * Video estimates need `duration`: the API reference documents no default
 * duration, so when `duration` is omitted no estimate is produced rather
 * than guessing seconds.
 *
 * On video_to_video that rule bites hardest: `aleph2` and `gemini_omni_flash`
 * have no `duration` param at all (output length follows the input video, and
 * gemini_omni_flash bills per second of *input*), and unmodel cannot read the
 * length of a remote `videoUri`. Those requests therefore get no estimate.
 * The seedance/hailuo arms do take `duration` and estimate normally, minus the
 * input/reference-video seconds they also bill for.
 */

import { CREDIT_USD } from "./models";
import { SEEDANCE2_SMALL_RATIOS } from "./constraints";

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
      // 768P: 10, 2K: 15; no documented default resolution → worst case 15.
      return fields.resolution === "768P" ? 10 : 15;
    case "happyhorse_1_0":
      // 720P: 15, 1080P: 30; no documented default → worst case 30.
      return fields.resolution === "720P" ? 15 : 30;
    case "seedance2": {
      // 480p/720p ratios: 36; 1080p ratios: 40; 4K (3840-family) ratios: 150.
      // The 480p/720p tier is exactly the SEEDANCE2_SMALL_RATIOS enum
      // (membership, not a max-dimension heuristic — 1440:1440 is in the
      // spec's 1080p group despite its small max dimension). The
      // 3840/2880-family is 4K; everything else in the enum is 1080p.
      // Omitted/unknown ratio → worst case 150.
      if (fields.ratio === undefined) return 150;
      if ((SEEDANCE2_SMALL_RATIOS as readonly string[]).includes(fields.ratio)) return 36;
      const max = maxDim(fields.ratio);
      if (max === undefined) return 150;
      if (max < 2880) return 40;
      return 150;
    }
    case "seedance2_fast":
      return 29;
    case "seedance2_mini":
      return 16;
    case "seedance2_5": {
      // 720p ratios: 30 credits/s of output; 480p ratios (854/480-family):
      // 20. Omitted or unrecognized ratio → worst case 30. Input/reference
      // video seconds also bill (15/10 credits/s) but are not estimable
      // from URLs.
      if (fields.ratio === "854:480" || fields.ratio === "480:854") return 20;
      return 30;
    }
    case "grok_imagine_1_5": {
      // 480p: 10, 720p: 16, 1080p: 29; no documented default → worst case 29.
      if (fields.resolution === "480p") return 10;
      if (fields.resolution === "720p") return 16;
      return 29;
    }
    case "gemini_omni_flash":
      // text/image-to-video: 10 credits per second of OUTPUT. video-to-video:
      // 11 credits per second of INPUT video (capped at 10s) — a different
      // billing basis, and the v2v arm has no `duration` param, so a caller
      // must pass the input length explicitly to get a number out.
      return fields.route === "video_to_video" ? 11 : 10;
    default:
      return undefined;
  }
}

/** Documented per-generation credit minimums (guides/pricing.md). */
const VIDEO_MINIMUM_CREDITS: Record<string, number> = {
  aleph2: 56,
  seedance2_mini: 64,
  seedance2_5: 80,
};

/**
 * Non-mp4 output "incur[s] an additional surcharge of 5 credits per second of
 * output" (the `outputFormat` field description in openapi.json, verified
 * 2026-08-13). guides/pricing.md does not carry this row, so the spec is the
 * only source for it. Applies to the two arms that expose `outputFormat`:
 * gen4.5 (image_to_video / text_to_video) and aleph2 (video_to_video).
 */
export const NON_MP4_SURCHARGE_CREDITS_PER_SECOND = 5;

export interface VideoCostInputs extends VideoPricingFields {
  model: string;
  duration?: number;
  /** Count of image/audio references that bill flat per-reference credits. */
  flatReferenceCount?: number;
  /** Extra flat credits (e.g. gemini_omni_flash's 1-credit first frame). */
  flatExtraCredits?: number;
  /** `prores` / `png_sequence` add 5 credits per second of output. */
  outputFormat?: string;
}

/**
 * Worst-case USD for one video generation, or undefined when the rate or
 * the duration is unknown.
 */
export function videoCostUSD(inputs: VideoCostInputs): number | undefined {
  const rate = videoCreditsPerSecond(inputs.model, inputs);
  if (rate === undefined || inputs.duration === undefined) return undefined;
  let credits = rate * inputs.duration;
  // The documented minimum floors the per-second charge; flat surcharges are
  // additive on top of it.
  const minimum = VIDEO_MINIMUM_CREDITS[inputs.model];
  if (minimum !== undefined && credits < minimum) credits = minimum;
  if (inputs.outputFormat !== undefined && inputs.outputFormat !== "mp4") {
    credits += NON_MP4_SURCHARGE_CREDITS_PER_SECOND * inputs.duration;
  }
  // Flat per-reference surcharges: grok_imagine_1_5 bills 1 credit per image
  // or audio reference (including an image-to-video start frame); hailuo3
  // bills 2 credits per reference image.
  if (inputs.flatReferenceCount !== undefined && inputs.flatReferenceCount > 0) {
    const perReference =
      inputs.model === "grok_imagine_1_5" ? 1 : inputs.model === "hailuo3" ? 2 : 0;
    credits += inputs.flatReferenceCount * perReference;
  }
  if (inputs.flatExtraCredits !== undefined) credits += inputs.flatExtraCredits;
  return credits * CREDIT_USD;
}

export interface ImageCostInputs {
  model: string;
  ratio?: string;
  quality?: string;
  outputCount?: number;
  referenceCount?: number;
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
 * from the request schema's ratio enum (openapi.json, verified 2026-08-13).
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
    default:
      // gemini_image3.1_flash has no pricing row yet; unknown models have
      // no published rate.
      return undefined;
  }
}
