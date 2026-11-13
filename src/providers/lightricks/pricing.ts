/**
 * LTX API pricing — https://docs.ltx.io/pricing.md (verified 2026-11-12).
 *
 * LTX quotes USD directly (there is no credit currency to convert). Every
 * generation endpoint bills per second; what "per second" measures differs by
 * endpoint and is spelled out on the pricing page:
 *
 *   - text-to-video / image-to-video: seconds of OUTPUT video.
 *   - audio-to-video: seconds of INPUT audio.
 *   - retake: seconds of INPUT video; extend: the extended portion plus the
 *     context frames, capped at 505 billed frames (~21s at 24fps).
 *   - video-to-video-hdr / -reframe / video-upscale / video-alpha-gen: seconds
 *     of INPUT video.
 *
 * unmodel can only estimate the endpoints whose billed seconds are in the
 * request: text-to-video and image-to-video (`duration`) and audio-to-video
 * (which has no duration field at all — the audio sets it — so it produces no
 * estimate).
 */

/**
 * Every `resolution` string LTX documents, by tier and shape — the table on
 * https://docs.ltx.io/models/ltx-2-5.md (verified 2026-11-12), whose columns
 * are "16:9 (landscape) | 9:16 (portrait) | 1:1 (square) | 3:2 (landscape) |
 * 2:3 (portrait)" and whose first row is "| 720p | `1280x720` | `720x1280` |
 * `720x720` | `1080x720` | `720x1080` |". A string's tier is its short side.
 *
 * Which shapes a model renders is per model (`RESOLUTION_SHAPES` in
 * ./shared.ts): https://docs.ltx.io/models/ltx-2-3.md publishes only the 16:9
 * and 9:16 columns.
 */
export const LTX_RESOLUTION_GRID = {
  "720p": { "16:9": "1280x720", "9:16": "720x1280", "1:1": "720x720", "3:2": "1080x720", "2:3": "720x1080" },
  "1080p": {
    "16:9": "1920x1080",
    "9:16": "1080x1920",
    "1:1": "1080x1080",
    "3:2": "1620x1080",
    "2:3": "1080x1620",
  },
  "1440p": {
    "16:9": "2560x1440",
    "9:16": "1440x2560",
    "1:1": "1440x1440",
    "3:2": "2160x1440",
    "2:3": "1440x2160",
  },
  "4k": { "16:9": "3840x2160", "9:16": "2160x3840", "1:1": "2160x2160", "3:2": "3240x2160", "2:3": "2160x3240" },
} as const satisfies Record<string, Record<string, string>>;

export type LtxResolutionTier = keyof typeof LTX_RESOLUTION_GRID;
export type LtxResolutionShape = keyof (typeof LTX_RESOLUTION_GRID)[LtxResolutionTier];

/** The resolution strings the API accepts, grouped by tier, in grid column order. */
export const LTX_RESOLUTION_TIERS: {
  readonly [T in LtxResolutionTier]: readonly (typeof LTX_RESOLUTION_GRID)[T][LtxResolutionShape][];
} = {
  "720p": Object.values(LTX_RESOLUTION_GRID["720p"]),
  "1080p": Object.values(LTX_RESOLUTION_GRID["1080p"]),
  "1440p": Object.values(LTX_RESOLUTION_GRID["1440p"]),
  "4k": Object.values(LTX_RESOLUTION_GRID["4k"]),
};

/** Every documented `resolution` value, in tier order. */
export const LTX_RESOLUTIONS = [
  ...LTX_RESOLUTION_TIERS["720p"],
  ...LTX_RESOLUTION_TIERS["1080p"],
  ...LTX_RESOLUTION_TIERS["1440p"],
  ...LTX_RESOLUTION_TIERS["4k"],
] as const;

const TIER_OF: Readonly<Record<string, LtxResolutionTier>> = Object.fromEntries(
  Object.entries(LTX_RESOLUTION_TIERS).flatMap(([tier, list]) =>
    list.map((value) => [value, tier as LtxResolutionTier]),
  ),
);

/** Resolution tier of a `WIDTHxHEIGHT` value, or undefined when undocumented. */
export function resolutionTier(resolution: string): LtxResolutionTier | undefined {
  return TIER_OF[resolution];
}

/**
 * USD per second for text-to-video and image-to-video (identical tables on
 * https://docs.ltx.io/pricing.md), keyed by model then resolution tier. Every
 * shape in a tier bills that tier's rate: "Each is priced the same as the 16:9
 * size with the same short side." (https://docs.ltx.io/api-changelog/2026/10/12.md,
 * 2026-11-12).
 */
export const VIDEO_USD_PER_SECOND: Readonly<
  Record<string, Partial<Record<LtxResolutionTier, number>>>
> = {
  "ltx-2-5-fast": { "720p": 0.09, "1080p": 0.13, "1440p": 0.19, "4k": 0.3 },
  // pricing.md, 2026-11-12: "| **ltx-2-5-pro** | `1280x720` / `720x1280` /
  // `720x720` / `1080x720` / `720x1080` | \$0.12 |", then $0.17 (1080p),
  // $0.25 (1440p) and $0.39 (4K) — "1440p is billed at $0.25 per second and
  // 4K at $0.39 per second." (https://docs.ltx.io/api-changelog/2026/9/2.md).
  "ltx-2-5-pro": { "720p": 0.12, "1080p": 0.17, "1440p": 0.25, "4k": 0.39 },
  "ltx-2-3-fast": { "720p": 0.03, "1080p": 0.06, "1440p": 0.12, "4k": 0.24 },
  "ltx-2-3-pro": { "720p": 0.04, "1080p": 0.08, "1440p": 0.16, "4k": 0.32 },
};

/**
 * USD per second of INPUT audio on audio-to-video, keyed by model then
 * resolution tier — https://docs.ltx.io/pricing.md (2026-11-12): "Pricing is
 * based on the **duration of the input audio** in seconds." The request
 * carries only an audio URI, so these rates produce no estimate.
 */
export const AUDIO_TO_VIDEO_USD_PER_SECOND: Readonly<
  Record<string, Partial<Record<LtxResolutionTier, number>>>
> = {
  // "| **ltx-2-5-fast** | `1280x720` / `720x1280` / `720x720` / `1080x720` /
  // `720x1080` | \$0.09 |", then $0.13 (1080p), $0.19 (1440p), $0.30 (4K).
  "ltx-2-5-fast": { "720p": 0.09, "1080p": 0.13, "1440p": 0.19, "4k": 0.3 },
  // "| **ltx-2-5-pro** | `1280x720` / `720x1280` / `720x720` / `1080x720` /
  // `720x1080` | \$0.12 |", then $0.17 (1080p), $0.25 (1440p), $0.39 (4K).
  "ltx-2-5-pro": { "720p": 0.12, "1080p": 0.17, "1440p": 0.25, "4k": 0.39 },
  // "| **ltx-2-3-pro** | `1280x720` / `720x1280` | \$0.06 |", then $0.10
  // (1080p), $0.18 (1440p), $0.34 (4K) — not its text-to-video rates.
  "ltx-2-3-pro": { "720p": 0.06, "1080p": 0.1, "1440p": 0.18, "4k": 0.34 },
};

/** USD per second of input video on retake and extend (ltx-2-3-pro, 1080p). */
export const EDIT_USD_PER_SECOND = 0.1;

/**
 * USD for one text-to-video / image-to-video generation, or undefined when
 * the model has no published rate, the resolution is not a documented value,
 * or `duration` is absent (LTX-2.5's automatic duration sends `null`, whose
 * final length is unknown until the job finishes).
 */
export function videoCostUSD(inputs: {
  model: string;
  resolution?: string;
  duration?: number | null;
}): number | undefined {
  if (typeof inputs.duration !== "number" || !(inputs.duration > 0)) return undefined;
  if (inputs.resolution === undefined) return undefined;
  const tier = resolutionTier(inputs.resolution);
  if (tier === undefined) return undefined;
  const rate = VIDEO_USD_PER_SECOND[inputs.model]?.[tier];
  return rate === undefined ? undefined : rate * inputs.duration;
}
