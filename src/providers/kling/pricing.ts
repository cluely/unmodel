/**
 * Kling pricing — https://kling.ai/document-api/pricing/base/video and
 * /pricing/base/image (verified 2026-08-13).
 *
 * Kling bills prepaid "Units" and prints the USD equivalent beside every rate,
 * so the tables below are transcriptions rather than conversions. The Unit
 * price is NOT one number across the product: video Units are $0.14
 * (0.8 Units = $0.112 /s) and image Units are $0.0035 (8 Units = $0.028
 * /image), which is why nothing here multiplies Units.
 *
 * Video is billed per second of output, by resolution and by two switches:
 *   - native audio on/off (and, on Kling 2.6, whether voice control is used);
 *   - whether the request carries a VIDEO input (the Omni and O1 routes).
 * `videoCostUSD` takes both and falls back to the most expensive documented
 * tier only where the request leaves the tier open, which it flags by
 * returning undefined instead of guessing.
 *
 * Not modelled: the Motion Control rows (a separate route), Avatar, Lip Sync,
 * audio generation, effects and the e-commerce solutions.
 */

/** USD per second, silent, by resolution — the "No Native Audio" rows. */
type Tier = Partial<Record<string, number>>;

interface VideoRates {
  /** Silent output. */
  readonly silent: Tier;
  /** Native audio on, no voice control. */
  readonly audio?: Tier;
  /** Native audio on with voice control (Kling 2.6 only). */
  readonly audioVoice?: Tier;
  /** With a video input (the Omni / O1 routes). */
  readonly videoInput?: Tier;
}

/**
 * Rates keyed by the `model_name`/capability-map id space; `pricingKey` maps the
 * current routes' path segments onto it.
 */
const VIDEO_RATES: Readonly<Record<string, VideoRates>> = {
  "kling-v3": {
    silent: { "720p": 0.084, "1080p": 0.112, "4k": 0.42 },
    audio: { "720p": 0.126, "1080p": 0.168, "4k": 0.42 },
  },
  "kling-3.0-turbo": {
    // The published table has a single "With Native Audio" row for 3.0 Turbo,
    // and its route exposes no audio switch, so one tier covers it.
    silent: { "720p": 0.112, "1080p": 0.14 },
    audio: { "720p": 0.112, "1080p": 0.14 },
  },
  "kling-v3-omni": {
    silent: { "720p": 0.084, "1080p": 0.112, "4k": 0.42 },
    audio: { "720p": 0.112, "1080p": 0.14, "4k": 0.42 },
    videoInput: { "720p": 0.126, "1080p": 0.168, "4k": 0.42 },
  },
  "kling-video-o1": {
    silent: { "720p": 0.084, "1080p": 0.112 },
    audio: { "720p": 0.084, "1080p": 0.112 },
    videoInput: { "720p": 0.126, "1080p": 0.168 },
  },
  "kling-v2-6": {
    silent: { "720p": 0.042, "1080p": 0.07 },
    // "With Native Audio × No Voice Control" is 1080P-only ("-" at 720P).
    audio: { "1080p": 0.14 },
    audioVoice: { "1080p": 0.168 },
  },
  "kling-v2-5-turbo": { silent: { "720p": 0.042, "1080p": 0.07 } },
  "kling-v2-1": { silent: { "720p": 0.056, "1080p": 0.098 } },
  "kling-v2-1-master": { silent: { "1080p": 0.28 } },
  "kling-v2-master": { silent: { "1080p": 0.28 } },
  "kling-v1-6": { silent: { "720p": 0.056, "1080p": 0.098 } },
  "kling-v1-5": { silent: { "720p": 0.056, "1080p": 0.098 } },
  "kling-v1": { silent: { "720p": 0.028, "1080p": 0.098 } },
};

/** The path-addressed routes key models by path segment; pricing is keyed `model_name`-side. */
const PATH_TO_PRICING_KEY: Readonly<Record<string, string>> = {
  "kling-3.0": "kling-v3",
  "kling-3.0-turbo": "kling-3.0-turbo",
  "kling-3.0-omni": "kling-v3-omni",
  "kling-o1": "kling-video-o1",
  "kling-2.6": "kling-v2-6",
  "kling-2.5-turbo": "kling-v2-5-turbo",
};

/** Normalizes either id spelling onto the pricing table's key space. */
export function pricingKey(model: string): string {
  return PATH_TO_PRICING_KEY[model] ?? model;
}

/**
 * `mode` → resolution. "`std`: … output video resolution is 720P.
 * `pro`: … 1080P. `4k`: … 4K." — the `/v1/videos/*` route's own description.
 */
export const MODE_RESOLUTION: Readonly<Record<string, string>> = {
  std: "720p",
  pro: "1080p",
  "4k": "4k",
};

/** Server-side defaults on both route families. */
export const DEFAULT_RESOLUTION = "720p";
export const DEFAULT_MODE = "std";
export const DEFAULT_DURATION = 5;

export interface VideoCostInputs {
  /** Either id spelling — path segment or `model_name`. */
  model: string;
  /** "720p" | "1080p" | "4k". Defaults to 720p, the documented default. */
  resolution?: string;
  /** Seconds of output. Defaults to 5, the documented default. */
  duration?: number;
  /** Native audio on (`settings.audio` ≠ "off", or `sound: "on"` on /v1). */
  audio?: boolean;
  /** Voice control in use — Kling 2.6's dearest tier. */
  voiceControl?: boolean;
  /** The request carries a video input (Omni / O1 routes). */
  videoInput?: boolean;
}

/**
 * USD for one generation, or undefined when the model or the requested
 * resolution has no published rate (e.g. 4K on a model that tops out at
 * 1080P, or 720P with native audio on Kling 2.6, which the table prints as
 * "-").
 */
export function videoCostUSD(inputs: VideoCostInputs): number | undefined {
  const rates = VIDEO_RATES[pricingKey(inputs.model)];
  if (rates === undefined) return undefined;
  const resolution = inputs.resolution ?? DEFAULT_RESOLUTION;
  const duration = inputs.duration ?? DEFAULT_DURATION;
  if (!(duration > 0)) return undefined;

  let tier: Tier | undefined;
  if (inputs.videoInput === true) tier = rates.videoInput ?? rates.audio ?? rates.silent;
  else if (inputs.audio === true) {
    tier = inputs.voiceControl === true ? (rates.audioVoice ?? rates.audio) : rates.audio;
  } else tier = rates.silent;

  const rate = tier?.[resolution];
  return rate === undefined ? undefined : rate * duration;
}

// ---------------------------------------------------------------------------
// Images — https://kling.ai/document-api/pricing/base/image
// ---------------------------------------------------------------------------

/** How an image request is being used, which is what the price table keys on. */
export type ImageMode = "text-to-image" | "image-to-image" | "multi-image-to-image";

interface ImageRates {
  readonly "text-to-image"?: Tier;
  readonly "image-to-image"?: Tier;
  readonly "multi-image-to-image"?: Tier;
}

const IMAGE_RATES: Readonly<Record<string, ImageRates>> = {
  "kling-v3": {
    "text-to-image": { "1k": 0.028, "2k": 0.028 },
    "image-to-image": { "1k": 0.028, "2k": 0.028 },
  },
  "kling-v3-omni": {
    "text-to-image": { "1k": 0.028, "2k": 0.028, "4k": 0.056 },
    "image-to-image": { "1k": 0.028, "2k": 0.028, "4k": 0.056 },
  },
  "kling-image-o1": {
    "text-to-image": { "1k": 0.028, "2k": 0.028 },
    "image-to-image": { "1k": 0.028, "2k": 0.028 },
  },
  "kling-v2-1": {
    "text-to-image": { "1k": 0.014, "2k": 0.014 },
    "image-to-image": { "1k": 0.028, "2k": 0.028 },
    "multi-image-to-image": { "1k": 0.056, "2k": 0.056 },
  },
  "kling-v2": {
    "text-to-image": { "1k": 0.014, "2k": 0.014 },
    "image-to-image": { "1k": 0.028 },
    "multi-image-to-image": { "1k": 0.056 },
  },
  "kling-v1-5": {
    "text-to-image": { "1k": 0.014 },
    "image-to-image": { "1k": 0.028 },
  },
  "kling-v1": {
    "text-to-image": { "1k": 0.0035 },
    "image-to-image": { "1k": 0.0035 },
  },
  // kling-v2-new: the pricing page's "Kling Image 2.1 New" row cannot be tied
  // to this id from the docs alone (see ./models.ts), so it has no rate.
};

export interface ImageCostInputs {
  model: string;
  /** "1k" | "2k" | "4k". Defaults to "1k", the documented default. */
  resolution?: string;
  /** Number of output images (`n`). Defaults to 1. */
  n?: number;
  mode?: ImageMode;
}

/** USD for one image request (all `n` outputs), or undefined when unpublished. */
export function imageCostUSD(inputs: ImageCostInputs): number | undefined {
  const rates = IMAGE_RATES[inputs.model];
  if (rates === undefined) return undefined;
  const perImage = rates[inputs.mode ?? "text-to-image"]?.[(inputs.resolution ?? "1k").toLowerCase()];
  if (perImage === undefined) return undefined;
  const n = inputs.n ?? 1;
  return n > 0 ? perImage * n : undefined;
}
