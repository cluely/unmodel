/**
 * PixVerse credit pricing —
 * https://docs.platform.pixverse.ai/pricing-796039m0 (verified 2026-08-13).
 *
 * Credits cost $0.01 each (see ./models.ts for the pack table that pins the
 * rate), so USD = credits × 0.01.
 *
 * Two billing shapes:
 *   - v6 and c1 bill PER SECOND, by quality tier and whether audio is on.
 *   - v5.6, v5.5, v5 and the v4.5/v4/v3.5 family bill PER GENERATION, from a
 *     fixed (quality × duration) table — with an audio column on v5.6/v5.5, a
 *     multi-clip column on v5.5, and a `motion_mode` column on v4.5/v4/v3.5.
 *
 * Surcharges the estimate does NOT include, because they are billed per
 * feature rather than per generation: lip sync (4 credits/s or per 15 UTF-8
 * bytes of TTS), sound effects (2 credits/s), upscale (5 credits/s) and
 * restyle (10 credits/s).
 */

import { CREDIT_USD } from "./models";

export const QUALITIES = ["360p", "540p", "720p", "1080p"] as const;
export type PixverseQuality = (typeof QUALITIES)[number];

/** v6 / c1 credits per second: [silent, with audio] by quality. */
const PER_SECOND: Readonly<Record<string, Partial<Record<string, readonly [number, number]>>>> = {
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

/** v5.6 credits per generation: `quality:duration` → [silent, with audio]. */
const V5_6: Readonly<Record<string, readonly [number, number]>> = {
  "360p:5": [35, 80],
  "360p:8": [70, 115],
  "360p:10": [77, 122],
  "540p:5": [35, 90],
  "540p:8": [70, 115],
  "540p:10": [77, 122],
  "720p:5": [45, 80],
  "720p:8": [90, 135],
  "720p:10": [99, 144],
  "1080p:5": [75, 150],
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

/**
 * v4.5 / v4 / v3.5 credits per generation: `quality:motion_mode:duration`.
 * The published table only prices `fast` at 5s, and 1080p only at 5s/normal.
 */
const LEGACY: Readonly<Record<string, number>> = {
  "360p:normal:5": 45,
  "360p:fast:5": 90,
  "360p:normal:8": 90,
  "540p:normal:5": 45,
  "540p:fast:5": 90,
  "540p:normal:8": 90,
  "720p:normal:5": 60,
  "720p:fast:5": 120,
  "720p:normal:8": 120,
  "1080p:normal:5": 120,
};

export interface VideoCostInputs {
  model: string;
  quality?: string;
  duration?: number;
  /** `generate_audio_switch` (v5.5+) — defaults to false. */
  audio?: boolean;
  /** `generate_multi_clip_switch` (v5.5 / v6) — defaults to false. */
  multiClip?: boolean;
  /** `motion_mode` on the v4.5/v4/v3.5 family — defaults to "normal". */
  motionMode?: string;
}

/**
 * Credits for one generation, or undefined when the requested combination has
 * no published row (e.g. v3.5 at 1080p/8s, which the API rejects anyway).
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
    case "v4.5":
    case "v4":
    case "v3.5":
      return LEGACY[`${quality}:${inputs.motionMode ?? "normal"}:${duration}`];
    default:
      return undefined;
  }
}

/** USD for one generation, or undefined when no row is published. */
export function videoCostUSD(inputs: VideoCostInputs): number | undefined {
  const credits = videoCredits(inputs);
  return credits === undefined ? undefined : credits * CREDIT_USD;
}
