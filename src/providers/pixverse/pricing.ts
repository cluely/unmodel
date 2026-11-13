/**
 * PixVerse credit pricing —
 * https://docs.platform.pixverse.ai/pixverse-api-pricing-2394995m0 (verified
 * 2026-11-12).
 *
 * USD = credits ÷ 225, the page's own reference rate (`CREDIT_USD` in
 * ./models.ts carries the quote).
 *
 * Two billing shapes:
 *   - v6-max, v6 and c1 bill PER SECOND, by quality tier and whether audio is
 *     on.
 *   - v5.6, v5.5 and v5 bill PER GENERATION, from a fixed (quality × duration)
 *     table — with an audio column on v5.6/v5.5 and a multi-clip column on
 *     v5.5.
 *
 * v4.5, v4 and v3.5 have no published rate, so they estimate nothing.
 *
 * Surcharges the estimate does NOT include, because they are billed per
 * feature rather than per generation: lip sync (4 credits/s or per 15 UTF-8
 * bytes of TTS), sound effects (2 credits/s), upscale (5 credits/s) and
 * restyle (10 credits/s).
 */

import { CREDIT_USD } from "./models";

export const QUALITIES = ["360p", "540p", "720p", "1080p"] as const;
export type PixverseQuality = (typeof QUALITIES)[number];

/** v6-max / v6 / c1 credits per second: [silent, with audio] by quality. */
const PER_SECOND: Readonly<Record<string, Partial<Record<string, readonly [number, number]>>>> = {
  // https://docs.platform.pixverse.ai/pixverse-api-pricing-2394995m0 (2026-11-12):
  // "V6 Max | Off | **6 Credits/s** … | **9 Credits/s** … | **11 Credits/s** … |
  // **22 Credits/s**" and "| V6 Max | On | **9 Credits/s** … | **11 Credits/s** … |
  // **15 Credits/s** … | **28 Credits/s**" (360p / 540p / 720p / 1080p).
  "v6-max": {
    "360p": [6, 9],
    "540p": [9, 11],
    "720p": [11, 15],
    "1080p": [22, 28],
  },
  v6: {
    "360p": [5, 7],
    "540p": [7, 9],
    "720p": [9, 12],
    "1080p": [18, 23],
  },
  c1: {
    "360p": [6, 8],
    "540p": [8, 10],
    "720p": [10, 13],
    "1080p": [19, 24],
  },
};

/**
 * v5.6 credits per generation: `quality:duration` → [silent, with audio]. The
 * 5-second row (2026-11-12): "| 5 seconds | Off | **35 Credits** … | **35
 * Credits** … | **45 Credits** … | **75 Credits**" and "| 5 seconds | On |
 * **80 Credits** … | **80 Credits** … | **90 Credits** … | **120 Credits**"
 * (360p / 540p / 720p / 1080p).
 */
const V5_6: Readonly<Record<string, readonly [number, number]>> = {
  "360p:5": [35, 80],
  "360p:8": [70, 115],
  "360p:10": [77, 122],
  "540p:5": [35, 80],
  "540p:8": [70, 115],
  "540p:10": [77, 122],
  "720p:5": [45, 90],
  "720p:8": [90, 135],
  "720p:10": [99, 144],
  "1080p:5": [75, 120],
  "1080p:8": [150, 195],
};

/**
 * v5.5 credits per generation: `quality:duration` →
 * [single silent, single audio, multi silent, multi audio].
 */
const V5_5: Readonly<Record<string, readonly [number, number, number, number]>> = {
  "360p:5": [45, 55, 75, 85],
  "360p:8": [90, 100, 120, 130],
  "360p:10": [99, 109, 129, 139],
  "540p:5": [45, 55, 75, 85],
  "540p:8": [90, 100, 120, 130],
  "540p:10": [99, 109, 129, 139],
  "720p:5": [60, 70, 90, 100],
  "720p:8": [120, 130, 150, 160],
  "720p:10": [132, 142, 162, 172],
  "1080p:5": [120, 130, 150, 160],
  "1080p:8": [240, 250, 270, 280],
};

/** v5 credits per generation: `quality:duration`. */
const V5: Readonly<Record<string, number>> = {
  "360p:5": 45,
  "360p:8": 90,
  "540p:5": 45,
  "540p:8": 90,
  "720p:5": 60,
  "720p:8": 120,
  "1080p:5": 120,
  "1080p:8": 240,
};

export interface VideoCostInputs {
  model: string;
  quality?: string;
  duration?: number;
  /** `generate_audio_switch` (v5.5+) — defaults to false. */
  audio?: boolean;
  /** `generate_multi_clip_switch` (v5.5 / v6) — defaults to false. */
  multiClip?: boolean;
}

/**
 * Credits for one generation, or undefined when the requested combination has
 * no published row (e.g. v5.6 at 1080p/10s, which the page marks "Not
 * supported", or any v4.5 / v4 / v3.5 request).
 */
export function videoCredits(inputs: VideoCostInputs): number | undefined {
  const { quality, duration } = inputs;
  if (quality === undefined) return undefined;
  const audio = inputs.audio === true;

  const perSecond = PER_SECOND[inputs.model]?.[quality];
  if (perSecond !== undefined) {
    if (duration === undefined || !(duration > 0)) return undefined;
    return perSecond[audio ? 1 : 0] * duration;
  }

  if (duration === undefined) return undefined;
  const key = `${quality}:${duration}`;
  switch (inputs.model) {
    case "v5.6":
      return V5_6[key]?.[audio ? 1 : 0];
    case "v5.5": {
      const row = V5_5[key];
      if (row === undefined) return undefined;
      const index = (inputs.multiClip === true ? 2 : 0) + (audio ? 1 : 0);
      return row[index];
    }
    case "v5":
      return V5[key];
    default:
      return undefined;
  }
}

/** USD for one generation, or undefined when no row is published. */
export function videoCostUSD(inputs: VideoCostInputs): number | undefined {
  const credits = videoCredits(inputs);
  return credits === undefined ? undefined : credits * CREDIT_USD;
}
