/**
 * Luma Dream Machine pricing.
 *
 * Luma publishes almost nothing in USD for the Dream Machine models:
 * https://lumalabs.ai/api/pricing has moved on to the Luma Agents API models
 * (ray-3.2 / uni-1.1) and lists no rate for ray-2, ray-flash-2, photon-1 or
 * photon-flash-1. The one exception is the Modify Video guide, which prints a
 * per-million-pixel rate for both ray models plus two worked examples:
 * https://docs.lumalabs.ai/docs/modify-video (verified 2026-08-13)
 *
 *   | ray-2       | $0.01582 / million pixels |
 *   | ray-flash-2 | $0.00544 / million pixels |
 *   | ray-2,       720p, 5s, 16:9 | $1.75 |
 *   | ray-flash-2, 720p, 5s, 16:9 | $0.60 |
 *
 * Those examples pin the frame rate the pixel count is computed at. 16:9 at
 * 720p is 1280×720, and 1.75 / 0.01582 = 110.62M pixels, which over 5 seconds
 * is 110.62e6 / (1280×720) / 5 = 24 frames per second. Cross-checking the
 * flash row: 110.592 × 0.00544 = $0.6016 → the printed $0.60. So
 *
 *   USD = width × height × FPS × seconds / 1e6 × rate
 *
 * Because a request only carries a media URL, unmodel cannot read the input
 * video's dimensions or duration off the wire — so the endpoints produce no
 * `costUSD` estimate and this module exports the arithmetic for callers who
 * do know those numbers.
 */

/** USD per million pixels of modified video — docs/modify-video. */
export const MODIFY_VIDEO_USD_PER_MEGAPIXEL: Readonly<Record<string, number>> = {
  "ray-2": 0.01582,
  "ray-flash-2": 0.00544,
};

/**
 * Frame rate implied by the two worked examples on docs/modify-video (see the
 * derivation above). Luma does not state it as a standalone fact, so it is
 * recorded here as what the published prices are consistent with.
 */
export const LUMA_VIDEO_FPS = 24;

/**
 * Pixel dimensions each aspect ratio maps to, from the "Advanced Usage" maps
 * on https://docs.lumalabs.ai/docs/reframe-video-image. The Ray map is the
 * 720p tier; the Photon map is Photon's native output size.
 */
export const LUMA_VIDEO_DIMENSIONS: Readonly<Record<string, readonly [number, number]>> = {
  "1:1": [1024, 1024],
  "4:3": [1152, 864],
  "3:4": [864, 1152],
  "16:9": [1280, 720],
  "9:16": [720, 1280],
  "21:9": [1552, 656],
  "9:21": [656, 1552],
};

export const LUMA_IMAGE_DIMENSIONS: Readonly<Record<string, readonly [number, number]>> = {
  "1:1": [1536, 1536],
  "4:3": [1792, 1344],
  "3:4": [1344, 1792],
  "16:9": [2048, 1152],
  "9:16": [1152, 2048],
  "21:9": [2432, 1024],
  "9:21": [1024, 2432],
};

export interface ModifyVideoCostInputs {
  /** "ray-2" or "ray-flash-2". */
  model: string;
  /** Output width in pixels; supply either this pair or `aspectRatio`. */
  width?: number;
  height?: number;
  /** Resolves to `LUMA_VIDEO_DIMENSIONS` (the 720p tier) when width/height are absent. */
  aspectRatio?: string;
  /** Length of the modified video in seconds. */
  seconds: number;
  /** Defaults to the 24fps the published examples are consistent with. */
  fps?: number;
}

/**
 * USD for one Modify Video generation, or undefined when the model has no
 * published rate or the dimensions cannot be resolved.
 *
 * ```ts
 * // The documented example: ray-2, 720p, 5s, 16:9 → $1.75
 * modifyVideoCostUSD({ model: "ray-2", aspectRatio: "16:9", seconds: 5 });
 * ```
 */
export function modifyVideoCostUSD(inputs: ModifyVideoCostInputs): number | undefined {
  const rate = MODIFY_VIDEO_USD_PER_MEGAPIXEL[inputs.model];
  if (rate === undefined) return undefined;
  let width = inputs.width;
  let height = inputs.height;
  if (width === undefined || height === undefined) {
    const dims =
      inputs.aspectRatio === undefined ? undefined : LUMA_VIDEO_DIMENSIONS[inputs.aspectRatio];
    if (dims === undefined) return undefined;
    [width, height] = dims;
  }
  if (!Number.isFinite(inputs.seconds) || inputs.seconds <= 0) return undefined;
  const fps = inputs.fps ?? LUMA_VIDEO_FPS;
  return (width * height * fps * inputs.seconds * rate) / 1_000_000;
}
