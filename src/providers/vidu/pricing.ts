/**
 * Vidu pricing — https://platform.vidu.com/docs/pricing (verified 2026-08-13).
 *
 * Credits cost $0.005 each and the pricing page prints a USD column beside
 * every credit rate, so the tables below are transcriptions, not conversions.
 *
 * What is estimable from a request:
 *   - Q3 models: a flat per-second rate by (route × resolution), with an
 *     explicit off-peak column (roughly half). `viduq3-mix` has no off-peak
 *     rate ("Not Supported").
 *   - viduq1 / viduq1-classic: 80 credits ($0.40) per 5s 1080p generation on
 *     every route, 40 credits ($0.20) off-peak.
 *   - vidu2.0: a flat per-generation price by (route × duration × resolution).
 *
 * What is NOT estimable: the Q2 family. Its prices are quoted as tiered
 * curves — "Starts at 8 credits, 10 credits for 2nd sec, then +10 credits per
 * second" — whose first- and second-second boundaries the page does not
 * define unambiguously, so `videoCostUSD` returns undefined for those models
 * rather than guessing. The page also notes two surcharges unmodel does not
 * model: `is_rec` adds 10 credits, and audio on img2video/reference2video
 * adds 15 credits on the Q2 family.
 */

/** The four generation routes that have their own price tables. */
export type ViduRoute = "text2video" | "img2video" | "start-end2video" | "reference2video";

interface Tiered {
  readonly normal: Partial<Record<string, number>>;
  readonly offPeak?: Partial<Record<string, number>>;
}

/**
 * Q3 USD per second of output, by model → route group → resolution.
 * text2video, img2video and start-end2video share one table; reference2video
 * has its own.
 */
const Q3_GENERATION: Readonly<Record<string, Tiered>> = {
  "viduq3-pro": {
    normal: { "540p": 0.045, "720p": 0.1, "1080p": 0.12 },
    offPeak: { "540p": 0.025, "720p": 0.05, "1080p": 0.06 },
  },
  "viduq3-turbo": {
    normal: { "540p": 0.035, "720p": 0.055, "1080p": 0.065 },
    offPeak: { "540p": 0.02, "720p": 0.03, "1080p": 0.035 },
  },
  "viduq3-pro-fast": {
    normal: { "720p": 0.1, "1080p": 0.125 },
    offPeak: { "720p": 0.05, "1080p": 0.065 },
  },
};

const Q3_REFERENCE: Readonly<Record<string, Tiered>> = {
  "viduq3-mix": {
    // "Not Supported" in the off-peak columns.
    normal: { "720p": 0.12, "1080p": 0.145 },
  },
  "viduq3-turbo": {
    normal: { "540p": 0.02, "720p": 0.05, "1080p": 0.065 },
    offPeak: { "540p": 0.01, "720p": 0.025, "1080p": 0.035 },
  },
  viduq3: {
    normal: { "540p": 0.035, "720p": 0.06, "1080p": 0.075 },
    offPeak: { "540p": 0.02, "720p": 0.03, "1080p": 0.035 },
  },
};

/** Flat per-generation USD for viduq1 / viduq1-classic (5s, 1080p). */
export const Q1_GENERATION_USD = 0.4;
export const Q1_GENERATION_OFF_PEAK_USD = 0.2;

/** vidu2.0 flat per-generation USD, keyed `route:duration:resolution`. */
const VIDU2_GENERATION: Readonly<Record<string, number>> = {
  "img2video:4:360p": 0.1,
  "img2video:4:720p": 0.2,
  "img2video:4:1080p": 0.5,
  "img2video:8:720p": 0.5,
  "start-end2video:4:360p": 0.1,
  "start-end2video:4:720p": 0.2,
  "start-end2video:4:1080p": 0.5,
  "start-end2video:8:720p": 0.5,
  "reference2video:4:360p": 0.4,
  "reference2video:4:720p": 0.4,
};

/** Documented default resolution per model, used when `resolution` is omitted. */
export const DEFAULT_RESOLUTION: Readonly<Record<string, string>> = {
  "viduq3-pro": "720p",
  "viduq3-pro-fast": "720p",
  "viduq3-turbo": "720p",
  viduq3: "720p",
  "viduq3-mix": "720p",
  viduq2: "720p",
  "viduq2-pro": "720p",
  "viduq2-pro-fast": "720p",
  "viduq2-turbo": "720p",
  viduq1: "1080p",
  "viduq1-classic": "1080p",
  // vidu2.0's default depends on duration: 360p at 4s, 720p at 8s.
};

/** Documented default duration per model family (seconds). */
export const DEFAULT_DURATION: Readonly<Record<string, number>> = {
  "viduq3-pro": 5,
  "viduq3-pro-fast": 5,
  "viduq3-turbo": 5,
  viduq3: 5,
  "viduq3-mix": 5,
  viduq2: 5,
  "viduq2-pro": 5,
  "viduq2-pro-fast": 5,
  "viduq2-turbo": 5,
  viduq1: 5,
  "viduq1-classic": 5,
  "vidu2.0": 4,
};

export interface VideoCostInputs {
  model: string;
  route: ViduRoute;
  resolution?: string;
  duration?: number;
  off_peak?: boolean;
}

/**
 * USD for one generation, or undefined when the model's price is not a
 * documented flat number (the whole Q2 family) or the requested tier has no
 * published rate.
 */
export function videoCostUSD(inputs: VideoCostInputs): number | undefined {
  const resolution = inputs.resolution ?? resolveDefaultResolution(inputs);
  if (resolution === undefined) return undefined;
  const duration = inputs.duration ?? DEFAULT_DURATION[inputs.model];
  if (duration === undefined || !(duration > 0)) return undefined;
  const offPeak = inputs.off_peak === true;

  if (inputs.model === "viduq1" || inputs.model === "viduq1-classic") {
    return offPeak ? Q1_GENERATION_OFF_PEAK_USD : Q1_GENERATION_USD;
  }
  if (inputs.model === "vidu2.0") {
    const flat = VIDU2_GENERATION[`${inputs.route}:${duration}:${resolution}`];
    if (flat === undefined) return undefined;
    return offPeak ? flat / 2 : flat;
  }

  const table = inputs.route === "reference2video" ? Q3_REFERENCE : Q3_GENERATION;
  const tiers = table[inputs.model];
  if (tiers === undefined) return undefined;
  const rate = offPeak ? tiers.offPeak?.[resolution] : tiers.normal[resolution];
  return rate === undefined ? undefined : rate * duration;
}

function resolveDefaultResolution(inputs: VideoCostInputs): string | undefined {
  if (inputs.model !== "vidu2.0") return DEFAULT_RESOLUTION[inputs.model];
  const duration = inputs.duration ?? DEFAULT_DURATION["vidu2.0"];
  return duration === 8 ? "720p" : "360p";
}

/**
 * USD per output image on `POST /ent/v2/reference2image`, by model →
 * reference-image count band → resolution.
 */
export function imageCostUSD(inputs: {
  model: string;
  resolution?: string;
  imageCount?: number;
}): number | undefined {
  const resolution = inputs.resolution ?? "1080p";
  const count = inputs.imageCount ?? 0;
  if (inputs.model === "viduq1") {
    // 20 credits ($0.10) for 1–7 references at 1080p; no other tier published.
    return resolution === "1080p" ? 0.1 : undefined;
  }
  if (inputs.model !== "viduq2") return undefined;
  if (count === 0) {
    // Text to image.
    return { "1080p": 0.03, "2K": 0.04, "4K": 0.05 }[resolution];
  }
  if (count <= 3) return { "1080p": 0.04, "2K": 0.06, "4K": 0.1 }[resolution];
  if (count <= 7) return { "1080p": 0.05, "2K": 0.08, "4K": 0.15 }[resolution];
  return undefined;
}
