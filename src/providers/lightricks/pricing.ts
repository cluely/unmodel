/**
 * LTX API pricing — https://docs.ltx.io/pricing.md (verified 2026-08-13).
 *
 * LTX quotes USD directly (there is no credit currency to convert). Every
 * generation endpoint bills per second; what "per second" measures differs by
 * endpoint and is spelled out on the pricing page:
 *
 *   - text-to-video / image-to-video: seconds of OUTPUT video.
 *   - audio-to-video: seconds of INPUT audio.
 *   - retake: seconds of INPUT video; extend: the extended portion plus the
 *     context frames, capped at 505 billed frames (~21s at 24fps).
 *   - video-to-video-hdr / -reframe: seconds of INPUT video.
 *
 * unmodel can only estimate the endpoints whose billed seconds are in the
 * request: text-to-video and image-to-video (`duration`) and audio-to-video
 * (which has no duration field at all — the audio sets it — so it produces no
 * estimate). The deprecated LTX-2 models "stay billed at [their] original
 * LTX-2 rates" but those rates are no longer published, so they have no entry
 * and produce no estimate.
 */

/** The resolution strings the API accepts, grouped by tier. */
export const LTX_RESOLUTION_TIERS = {
  "720p": ["1280x720", "720x1280"],
  "1080p": ["1920x1080", "1080x1920"],
  "1440p": ["2560x1440", "1440x2560"],
  "4k": ["3840x2160", "2160x3840"],
} as const satisfies Record<string, readonly string[]>;

export type LtxResolutionTier = keyof typeof LTX_RESOLUTION_TIERS;

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
 * https://docs.ltx.io/pricing.md), keyed by model then resolution tier.
 */
export const VIDEO_USD_PER_SECOND: Readonly<
  Record<string, Partial<Record<LtxResolutionTier, number>>>
> = {
  "ltx-2-5-fast": { "720p": 0.09, "1080p": 0.13, "1440p": 0.19, "4k": 0.3 },
  "ltx-2-5-pro": { "720p": 0.12, "1080p": 0.17 },
  "ltx-2-3-fast": { "720p": 0.03, "1080p": 0.06, "1440p": 0.12, "4k": 0.24 },
  "ltx-2-3-pro": { "720p": 0.04, "1080p": 0.08, "1440p": 0.16, "4k": 0.32 },
};

/** USD per second of INPUT audio on audio-to-video (1080p only). */
export const AUDIO_TO_VIDEO_USD_PER_SECOND: Readonly<Record<string, number>> = {
  "ltx-2-5-fast": 0.13,
  "ltx-2-5-pro": 0.17,
  "ltx-2-3-pro": 0.1,
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
