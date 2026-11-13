/**
 * Kling pricing — https://kling.ai/document-api/pricing/base/video and
 * /pricing/base/image (verified 2026-08-13; the Kling 4.0 / 4.0 Flash rows
 * 2026-11-12).
 *
 * Kling bills prepaid "Units" and prints the USD equivalent beside every rate,
 * so the tables below are transcriptions rather than conversions. The Unit
 * price is NOT one number across the product: video Units are $0.14
 * (0.8 Units = $0.112 /s), the Kling 4.0 rows' Flagship-pack Units $0.157
 * ("1.0 Unit ($0.157) /s") and image Units $0.0035 (8 Units = $0.028
 * /image), which is why nothing here multiplies Units.
 *
 * Video is billed per second of output, by resolution and by two switches:
 *   - native audio on/off (and, on Kling 2.6, whether voice control is used);
 *   - whether the request carries a VIDEO input (the Omni and O1 routes).
 * `videoCostUSD` takes both and falls back to the most expensive documented
 * tier only where the request leaves the tier open, which it flags by
 * returning undefined instead of guessing.
 *
 * Kling 4.0 / 4.0 Flash differ in two ways the request cannot fully state:
 *   - "With Input Video" bills a TOTAL duration — "When input video duration
 *     > output video duration: Unit price × (Input video duration + Output
 *     video duration)", otherwise "Unit price × Output video duration × 2" —
 *     and "Input video duration includes reference video duration and video
 *     character elements duration". A URL does not reveal the input's length
 *     and an `element_id` does not reveal its kind, so a 4.0 estimate with a
 *     video input is `output × 2 × rate` and one with Elements prices them as
 *     no video input: both a FLOOR, not a quote.
 *   - An omitted `settings.duration` is read off the prompt (else `base_video`,
 *     else 10s) and billed as the task's `usage.output_duration`, so the
 *     estimate is undefined rather than an assumed 10 seconds.
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
  /** `settings.resolution`'s server default, where it is not {@link DEFAULT_RESOLUTION}. */
  readonly defaultResolution?: string;
  /**
   * An omitted duration is the one the prompt states, so no estimate exists
   * before the task runs (Kling 4.0 / 4.0 Flash).
   */
  readonly durationFromPrompt?: boolean;
  /**
   * The `videoInput` tier bills output × 2 seconds at the least (input +
   * output when the input is longer) — Kling 4.0 / 4.0 Flash.
   */
  readonly videoInputBillsTotal?: boolean;
}

/**
 * Rates keyed by the `model_name`/capability-map id space; `pricingKey` maps the
 * current routes' path segments onto it.
 */
const VIDEO_RATES: Readonly<Record<string, VideoRates>> = {
  // https://kling.ai/document-api/pricing/base/video —
  // `{model:{en:"Kling 4.0"},billingType:{en:"Per second"},feature:{en:"No
  // Input Video"},price720:{en:"1.0 Unit ($0.157) /s"},price1080:{en:"1.5 Units
  // ($0.235) /s"},price4k:{en:"-"}` and `feature:{en:"With Input Video"},
  // price720:{en:"0.6 Units ($0.094) /s"},price1080:{en:"0.9 Units ($0.141)
  // /s"}` (2026-11-12). There is no audio split — the routes always generate
  // audio — so one row covers both switches. Resolution defaults to 1080p:
  // `defaultResolution:"1080p"` (/api/video/4-0/text-to-video).
  "kling-4.0": {
    silent: { "720p": 0.157, "1080p": 0.235 },
    audio: { "720p": 0.157, "1080p": 0.235 },
    videoInput: { "720p": 0.094, "1080p": 0.141 },
    defaultResolution: "1080p",
    durationFromPrompt: true,
    videoInputBillsTotal: true,
  },
  // https://kling.ai/document-api/pricing/base/video —
  // `{model:{en:"Kling 4.0 Flash"},billingType:{en:"Per second"},feature:{en:
  // "No Input Video"},price720:{en:"0.6 Units ($0.094) /s"},price1080:{en:"-"}`
  // and `feature:{en:"With Input Video"},price720:{en:"0.4 Units ($0.063) /s"},
  // price1080:{en:"-"}` (2026-11-12). 720p only.
  "kling-4.0-flash": {
    silent: { "720p": 0.094 },
    audio: { "720p": 0.094 },
    videoInput: { "720p": 0.063 },
    durationFromPrompt: true,
    videoInputBillsTotal: true,
  },
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

/**
 * Server-side defaults on both route families — except Kling 4.0 / 4.0 Flash,
 * whose rate rows carry their own (`defaultResolution`, `durationFromPrompt`).
 */
export const DEFAULT_RESOLUTION = "720p";
export const DEFAULT_MODE = "std";
export const DEFAULT_DURATION = 5;

export interface VideoCostInputs {
  /** Either id spelling — path segment or `model_name`. */
  model: string;
  /** "720p" | "1080p" | "4k". Defaults to the model's documented default (720p; Kling 4.0 1080p). */
  resolution?: string;
  /**
   * Seconds of output. Defaults to 5, the documented default — on Kling 4.0 /
   * 4.0 Flash an omitted duration has no estimate (the prompt sets it).
   */
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
  const resolution = inputs.resolution ?? rates.defaultResolution ?? DEFAULT_RESOLUTION;
  if (inputs.duration === undefined && rates.durationFromPrompt === true) return undefined;
  const duration = inputs.duration ?? DEFAULT_DURATION;
  if (!(duration > 0)) return undefined;

  let tier: Tier | undefined;
  if (inputs.videoInput === true) tier = rates.videoInput ?? rates.audio ?? rates.silent;
  else if (inputs.audio === true) {
    tier = inputs.voiceControl === true ? (rates.audioVoice ?? rates.audio) : rates.audio;
  } else tier = rates.silent;

  const rate = tier?.[resolution];
  if (rate === undefined) return undefined;
  const billed = inputs.videoInput === true && rates.videoInputBillsTotal === true ? duration * 2 : duration;
  return rate * billed;
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
