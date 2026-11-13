/**
 * Black Forest Labs per-megapixel rates for the FLUX tools routes — the
 * prices one `cost.perImage` cannot carry.
 *
 * Transcribed from https://bfl.ai/pricing (verified 2026-11-12); the docs
 * pricing page (https://docs.bfl.ml/quick_start/pricing) has no row for these
 * routes. The billing rules, quoted from that page's Image Tools FAQ:
 *
 * - "One megapixel equals 1024 × 1024 pixels (1,048,576 pixels)."
 * - "Resolution is rounded up to the next MP, separately for each reference
 *   image and the generated output."
 * - "Pricing is per megapixel (MP) of image processed: input pricing per MP
 *   for each reference image provided for image editing operations, plus
 *   output pricing per MP of output resolution."
 *
 * So a request costs `firstMp + (outputMp − 1) × additionalMp`, plus
 * `referenceMp` per megapixel of each reference image.
 *
 * ## Where the arithmetic is exact, and where it stops
 *
 * Outpainting's output is the `width × height` canvas the request names, and
 * its reference image is free ("Ref img Free"), so {@link outpaintingCostUSD}
 * is exact and `imageEditOutpainting` estimates with it.
 *
 * Erase and deblur return an image the size of their input, which a URL or a
 * base64 string does not reveal. The page also does not say whether that one
 * input is billed as a reference ("Ref img $0.004 /MP"), so a 1 MP request
 * costs $0.03 or $0.034. Their rates are published here and their endpoints
 * estimate nothing.
 *
 * VTO has one "FLUX VTO" row for two routes (vto-v1, vto-v2), and no page
 * says both bill at it, so it is not transcribed.
 */

import type { FluxOutpaintingMode } from "./image-edit-tools";

/** One billed megapixel: "One megapixel equals 1024 × 1024 pixels (1,048,576 pixels)." */
export const BFL_MEGAPIXEL = 1_048_576;

/** One bfl.ai/pricing row, in USD. */
export interface BflMegapixelRate {
  /** The first output megapixel. */
  readonly firstMp: number;
  /** Each further output megapixel. */
  readonly additionalMp: number;
  /** Each megapixel of each reference image; 0 where the row says "Free". */
  readonly referenceMp: number;
}

/** `flux-tools/outpainting-v1`, by `mode` (default `"high"`). */
export const FLUX_OUTPAINTING_RATES: Readonly<Record<FluxOutpaintingMode, BflMegapixelRate>> = {
  // "FLUX Outpainting [high] 1st MP $0.10 Add'l MP $0.10 Ref img Free"
  high: { firstMp: 0.1, additionalMp: 0.1, referenceMp: 0 },
  // "FLUX Outpainting [fast] 1st MP $0.045 Add'l MP $0.006 Ref img Free"
  fast: { firstMp: 0.045, additionalMp: 0.006, referenceMp: 0 },
};

/** `flux-tools/erase-v1` — "FLUX Erase 1st MP $0.03 Add'l MP $0.004 Ref img $0.004 /MP". */
export const FLUX_ERASE_RATE: BflMegapixelRate = {
  firstMp: 0.03,
  additionalMp: 0.004,
  referenceMp: 0.004,
};

/** `flux-tools/deblur-v1` — "FLUX Deblur 1st MP $0.03 Add'l MP $0.004 Ref img $0.004 /MP". */
export const FLUX_DEBLUR_RATE: BflMegapixelRate = {
  firstMp: 0.03,
  additionalMp: 0.004,
  referenceMp: 0.004,
};

/**
 * USD for one `flux-tools/outpainting-v1` request — exact, because the
 * canvas is the output and the reference image is free.
 *
 * ```ts
 * outpaintingCostUSD({ width: 2048, height: 2048 }); // 4 MP at [high] → $0.40
 * ```
 */
export function outpaintingCostUSD(inputs: {
  width: number;
  height: number;
  mode?: FluxOutpaintingMode;
}): number {
  const rate = FLUX_OUTPAINTING_RATES[inputs.mode ?? "high"];
  const megapixels = billedMegapixels(inputs.width, inputs.height);
  return rate.firstMp + (megapixels - 1) * rate.additionalMp;
}

/** "Resolution is rounded up to the next MP." */
function billedMegapixels(width: number, height: number): number {
  return Math.ceil((width * height) / BFL_MEGAPIXEL);
}
