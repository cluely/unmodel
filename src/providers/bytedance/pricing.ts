/**
 * Request-aware pricing for the BytePlus ModelArk generation routes.
 *
 * Source of truth: https://docs.byteplus.com/en/docs/ModelArk/1544106
 * ("Pricing"), verified 2026-08-13. Both routes bill only for successfully
 * generated output.
 *
 * IMAGES bill per generated image, so the estimate is
 * `rate × number of images`, worst-cased where the request leaves the count
 * open: `sequential_image_generation: "auto"` bills for every image the model
 * decides to return, up to `max_images` (default 15); Seedream 5.0 pro /
 * flash layer decomposition returns one base image plus up to 16 layers, and
 * Seedream 5.5's returns up to `layer_decomposition_options.max_images`
 * images (default 30) counting the base image.
 *
 * VIDEOS bill by token — `price = token unit price × tokens` with
 * `tokens = (input video duration + output video duration) × width × height ×
 * fps / 1024` — which makes the effective rate a function of resolution. The
 * tables below carry the documented USD-per-second figures from the "Price
 * examples" section (16:9 output, no input video). Two things the
 * estimate therefore does NOT include, both documented here so the number is
 * never mistaken for a quote:
 * - Reference VIDEO input is billed as extra seconds; unmodel cannot read the
 *   duration of a remote URL, so estimates for omni-reference requests are a
 *   FLOOR. The 2.x models also apply a minimum token consumption in that case.
 * - Non-16:9 ratios shift the pixel count a little in either direction.
 *
 * The limited-time discounts on Seedance 2.0 fast/mini (to 2026-09-07) are
 * deliberately not modeled: the estimate is the list price.
 */

import { VIDEO_FPS } from "./constraints";
import { parsePixelSize } from "./shared";

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

/**
 * Seedream 5.0 pro's tier boundary: "≤ 2.61 million pixels (1.5K or lower)"
 * bills 0.045/image, above it 0.09/image.
 *
 * UNVERIFIED — do not change this number without a first-party source.
 * The quoted wording above is what was transcribed from the Pricing page
 * (https://docs.byteplus.com/en/docs/ModelArk/1544106) when this table was
 * written, but that page is a JS-rendered SPA: curl and WebFetch both retrieve
 * only the navigation shell, so the figure cannot be re-verified without a
 * browser. A reachable third-party summary contradicts it, putting the
 * boundary at 2,359,296 pixels — which is exactly 1536x1536, i.e. the `1.5K`
 * keyword itself, making it a plausible reading of the same "1.5K or lower"
 * parenthetical.
 *
 * Blast radius if 2,359,296 is the true boundary: only explicit `WxH` sizes
 * landing in the 2.36M–2.61M band are affected — they would estimate $0.045
 * where the real bill is $0.09 (and $0.0225 vs $0.045 per decomposed layer).
 * The `size`-keyword path is identical under both boundaries: 1.5K
 * (1536x1536 = 2,359,296) falls in the low tier either way, and 2K
 * (2048x2048 = 4,194,304) falls in the high tier either way.
 */
export const SEEDREAM_5_PRO_TIER_PIXELS = 2_610_000;

/** Seedream 5.0 pro output-image rates (USD per generated image). */
export const SEEDREAM_5_PRO_RATES = {
  standardLow: 0.045,
  standardHigh: 0.09,
  layerLow: 0.0225,
  layerHigh: 0.045,
} as const;

/** "From the 2nd image: 0.003" — Seedream 5.0 pro input images. */
export const SEEDREAM_5_PRO_INPUT_IMAGE_USD = 0.003;

/**
 * "one base image and up to 16 independently editable layers" — Seedream 5.0
 * pro, and "Seedream 5.0 flash: Up to one base image and 16 layers." —
 * https://docs.byteplus.com/docs/en/modelark/image-generation-api.md, 2026-11-12.
 */
export const MAX_DECOMPOSED_LAYERS = 16;

/**
 * Seedream 5.5's tier boundary, stated exactly: "921,600 ≤ P ≤ 1536² × 1.05²
 * (2,601,123.84): $0.020 · 1536² × 1.05² (2,601,123.84) < P ≤ 2048² × 1.05²
 * (4,624,220.16): $0.035" —
 * https://docs.byteplus.com/docs/en/modelark/model-pricing.md, 2026-11-12.
 */
export const SEEDREAM_5_5_TIER_PIXELS = 1536 * 1536 * 1.05 * 1.05;

/** Seedream 5.5 output-image rates (USD per generated image or layer). */
export const SEEDREAM_5_5_RATES = { low: 0.02, high: 0.035 } as const;

/**
 * "|`dola-seedream-5-5-261028` |$0.008 |…" — every input image bills, no free
 * first image: "Cost per request = Σ (each input image × input image unit
 * price) + Σ (each output image × output image unit price at the applicable
 * tier)" — https://docs.byteplus.com/docs/en/modelark/model-pricing.md, 2026-11-12.
 */
export const SEEDREAM_5_5_INPUT_IMAGE_USD = 0.008;

/**
 * `layer_decomposition_options.max_images` default: "Default: 30, which
 * returns at most one base image and 29 layers." —
 * https://docs.byteplus.com/docs/en/modelark/seedream-5-5.md, 2026-11-12.
 */
export const SEEDREAM_5_5_DEFAULT_LAYER_IMAGES = 30;

/** Documented `size` default per image model (image generation scenario). */
const DEFAULT_IMAGE_SIZE: Readonly<Record<string, string>> = {
  "dola-seedream-5-5-261028": "2K",
  "dola-seedream-5-0-pro-260628": "2K",
  "dola-seedream-5-0-flash-260915": "2K",
  "seedream-5-0-260128": "2048x2048",
  "seedream-5-0-lite-260128": "2048x2048",
  "seedream-4-5-251128": "2048x2048",
  "seedream-4-0-250828": "2048x2048",
};

/** Pixel count of the documented 1:1 mapping for each `size` keyword. */
const SIZE_KEYWORD_PIXELS: Readonly<Record<string, number>> = {
  "1K": 1024 * 1024,
  "1.5K": 1536 * 1536,
  "2K": 2048 * 2048,
  "3K": 3072 * 3072,
  "4K": 4096 * 4096,
};

/** Output pixels implied by a `size` value; undefined when it cannot be read. */
export function outputPixels(model: string, size: string | undefined): number | undefined {
  const value = size ?? DEFAULT_IMAGE_SIZE[model];
  if (value === undefined) return undefined;
  const pixels = parsePixelSize(value);
  if (pixels !== undefined) return pixels.width * pixels.height;
  return SIZE_KEYWORD_PIXELS[value];
}

export interface ImagePricingFields {
  size?: string | undefined;
  layerDecomposition?: boolean | undefined;
  sequential?: string | undefined;
  maxImages?: number | undefined;
  /** `layer_decomposition_options.max_images` (Seedream 5.5). */
  layerMaxImages?: number | undefined;
  /** Number of reference images supplied in `image`. */
  inputImages?: number;
  /** `cost.perImage` from the catalog — the fallback for flat-rate models. */
  perImage?: number | undefined;
}

/**
 * Worst-case USD for one image generation request. Returns undefined when no
 * rate is known for the model.
 */
export function imageCostUSD(model: string, fields: ImagePricingFields): number | undefined {
  if (model === "dola-seedream-5-5-261028") {
    const pixels = outputPixels(model, fields.size);
    // `size: "auto"` (layer decomposition) reads as no pixel count: worst case.
    const high = pixels === undefined ? true : pixels > SEEDREAM_5_5_TIER_PIXELS;
    const rate = high ? SEEDREAM_5_5_RATES.high : SEEDREAM_5_5_RATES.low;
    const inputCost = (fields.inputImages ?? 0) * SEEDREAM_5_5_INPUT_IMAGE_USD;
    // "In Seedream 5.5 and Seedream 5.0 pro layer decomposition, each layer in
    // a single request may fall into a different resolution tier and is
    // billed based on the actual generated output." — every image at the
    // request's tier, up to `max_images`, is the worst case.
    const outputs =
      fields.layerDecomposition === true
        ? (fields.layerMaxImages ?? SEEDREAM_5_5_DEFAULT_LAYER_IMAGES)
        : 1;
    return rate * outputs + inputCost;
  }
  if (model === "dola-seedream-5-0-pro-260628") {
    const pixels = outputPixels(model, fields.size);
    const high = pixels === undefined ? true : pixels > SEEDREAM_5_PRO_TIER_PIXELS;
    const inputImages = fields.inputImages ?? 0;
    // "First image: Free · From the 2nd image: 0.003"
    const inputCost = Math.max(0, inputImages - 1) * SEEDREAM_5_PRO_INPUT_IMAGE_USD;
    if (fields.layerDecomposition === true) {
      const rate = high ? SEEDREAM_5_PRO_RATES.layerHigh : SEEDREAM_5_PRO_RATES.layerLow;
      // Worst case: the base image plus the documented maximum of 16 layers.
      return rate * (1 + MAX_DECOMPOSED_LAYERS) + inputCost;
    }
    const rate = high ? SEEDREAM_5_PRO_RATES.standardHigh : SEEDREAM_5_PRO_RATES.standardLow;
    return rate + inputCost;
  }

  const perImage = fields.perImage;
  if (perImage === undefined) return undefined;
  return perImage * generatedImageCount(fields);
}

/**
 * Worst-case number of billed output images on a flat-rate model: the base
 * image plus {@link MAX_DECOMPOSED_LAYERS} layers in layer decomposition
 * (Seedream 5.0 flash), otherwise 1 unless sequential generation is on, in
 * which case the model may return up to `max_images` (default 15), capped by
 * "input reference images + generated images ≤ 15".
 */
export function generatedImageCount(fields: ImagePricingFields): number {
  if (fields.layerDecomposition === true) return 1 + MAX_DECOMPOSED_LAYERS;
  if (fields.sequential !== "auto") return 1;
  const requested = fields.maxImages ?? 15;
  const room = 15 - (fields.inputImages ?? 0);
  return Math.max(1, Math.min(requested, room));
}

// ---------------------------------------------------------------------------
// Videos
// ---------------------------------------------------------------------------

/**
 * Documented USD per second of OUTPUT video, by model and resolution, for
 * 16:9 output with no reference video ("Price examples", 1544106). The 5s
 * example prices divide exactly by 5.
 */
const VIDEO_USD_PER_SECOND: Readonly<Record<string, Readonly<Record<string, number>>>> = {
  // 0.514 / 1.156 USD per 5s video.
  "dreamina-seedance-2-5-260628": { "480p": 0.103, "720p": 0.231 },
  "dreamina-seedance-2-0-260128": { "480p": 0.07, "720p": 0.15, "1080p": 0.37, "4k": 0.78 },
  "dreamina-seedance-2-0-fast-260128": { "480p": 0.06, "720p": 0.12 },
  "dreamina-seedance-2-0-mini-260615": { "480p": 0.04, "720p": 0.08 },
  "seedance-1-0-pro-250528": { "480p": 0.024, "720p": 0.052, "1080p": 0.122 },
  "seedance-1-0-pro-fast-251015": { "480p": 0.01, "720p": 0.02, "1080p": 0.048 },
};

/** Documented `resolution` default per model. */
const DEFAULT_RESOLUTION: Readonly<Record<string, string>> = {
  "dreamina-seedance-2-5-260628": "720p",
  "dreamina-seedance-2-0-260128": "720p",
  "dreamina-seedance-2-0-fast-260128": "720p",
  "dreamina-seedance-2-0-mini-260615": "720p",
  "seedance-1-0-pro-250528": "1080p",
  "seedance-1-0-pro-fast-251015": "1080p",
};

/** Documented `duration` default per model; 2.5 defaults to -1 (model picks). */
const DEFAULT_DURATION: Readonly<Record<string, number>> = {
  "dreamina-seedance-2-0-260128": 5,
  "dreamina-seedance-2-0-fast-260128": 5,
  "dreamina-seedance-2-0-mini-260615": 5,
  "seedance-1-0-pro-250528": 5,
  "seedance-1-0-pro-fast-251015": 5,
};

export interface VideoPricingFields {
  resolution?: string | undefined;
  duration?: number | undefined;
  frames?: number | undefined;
}

/** USD per second of output video for a model + request configuration. */
export function videoUsdPerSecond(model: string, fields: VideoPricingFields): number | undefined {
  const table = VIDEO_USD_PER_SECOND[model];
  if (table === undefined) return undefined;
  const resolution = fields.resolution ?? DEFAULT_RESOLUTION[model];
  if (resolution === undefined) return undefined;
  return table[resolution];
}

/**
 * Output seconds a request will be billed for. `frames` wins over `duration`
 * (documented); `duration: -1` means the model picks the length, which cannot
 * be estimated.
 */
export function billedSeconds(model: string, fields: VideoPricingFields): number | undefined {
  if (fields.frames !== undefined) return fields.frames / VIDEO_FPS;
  const duration = fields.duration ?? DEFAULT_DURATION[model];
  if (duration === undefined || duration <= 0) return undefined;
  return duration;
}

/**
 * Estimated USD for one video generation task — a FLOOR when the request
 * carries reference video (see the module docstring). Undefined when the
 * output length or the rate is unknown.
 */
export function videoCostUSD(model: string, fields: VideoPricingFields): number | undefined {
  const perSecond = videoUsdPerSecond(model, fields);
  const seconds = billedSeconds(model, fields);
  if (perSecond === undefined || seconds === undefined) return undefined;
  return perSecond * seconds;
}
