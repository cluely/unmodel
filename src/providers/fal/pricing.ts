/**
 * What a fal request costs — the arithmetic, and the refusals.
 *
 * The rates themselves are DATA (`gen/pricing.gen.ts`, transcribed from each
 * endpoint's public model page into `data/fal/pricing.json` with a quote and a
 * date). This file is the behaviour: turning a rate plus a request body into a
 * number, and — more often than not — declining to.
 *
 * ## Declining is the main job
 *
 * fal prices in ten units and only four of them are a number the catalog can
 * carry. Of the rest:
 *
 * - **`per_megapixel`** needs the output's dimensions, which a request states
 *   only sometimes. `image_size: "landscape_4_3"` names a preset whose pixel
 *   count fal does not publish per endpoint; `image_size: { width, height }`
 *   states it exactly. So the first is `undefined` and the second is a number.
 * - **`tiered`** needs a quantity — megapixels, seconds — and prices the first
 *   one differently from the rest.
 * - **`conditional`** needs whichever field selects the tier. When the request
 *   leaves it unset, fal's own default decides, and this file does not guess
 *   at a default that is not written down.
 * - **`compute_second`** cannot be predicted from a request body at all.
 *
 * The alternative to `undefined` is a plausible number that is wrong, which is
 * worse than no number: a caller who sees `costUSD` treats it as a budget.
 * This is the kling `pricing.ts` precedent, applied to a provider where the
 * open cases are the majority rather than the exception.
 *
 * ## The megapixel ceiling
 *
 * Where fal states one, the rule is "billed by rounding up to the nearest
 * megapixel" — so a 512x512 image (0.25 MP) bills as one megapixel, and a
 * 1920x1080 (2.07 MP) bills as three. {@link falMegapixels} is that ceiling,
 * and it is applied whether or not a given page repeats the sentence: the two
 * per-megapixel pages that omit it (`fal-ai/z-image/turbo`,
 * `fal-ai/qwen-image-edit-2511`) do not state a DIFFERENT rule, they state
 * none, and every fal page that does state one states this one.
 */

import { FAL_RATES } from "./gen/pricing.gen";
import type { FalRate } from "./pricing-types";

export type { FalRate, FalRateUnit, FalTier } from "./pricing-types";

/** Every curated endpoint's published rate. Re-exported for callers who want the table. */
export { FAL_RATES } from "./gen/pricing.gen";

/** One megapixel, in pixels. */
const MEGAPIXEL = 1_000_000;

/**
 * Megapixels billed for a `width x height` output — the ceiling rule.
 *
 * `Math.ceil` and not `Math.round`: fal's own wording is "rounding UP to the
 * nearest megapixel", and its own example is a 512x512 output billed at one
 * megapixel rather than at zero.
 */
export function falMegapixels(width: number, height: number): number {
  return Math.max(1, Math.ceil((width * height) / MEGAPIXEL));
}

/**
 * The output dimensions a request states, when it states them.
 *
 * `undefined` is the common answer and the important one. An `image_size`
 * preset (`"landscape_4_3"`) is a name, not a pixel count — fal publishes no
 * per-endpoint table mapping the presets to dimensions, and inventing one
 * would put a fabricated megapixel count into a cost estimate. Only an
 * explicit `{ width, height }`, or an explicit `width` / `height` pair,
 * settles the question.
 */
export function falOutputPixels(body: Readonly<Record<string, unknown>>):
  | { width: number; height: number }
  | undefined {
  const size = body["image_size"];
  if (typeof size === "object" && size !== null && !Array.isArray(size)) {
    const { width, height } = size as { width?: unknown; height?: unknown };
    if (typeof width === "number" && typeof height === "number") return { width, height };
  }
  const width = body["width"];
  const height = body["height"];
  if (typeof width === "number" && typeof height === "number") return { width, height };
  return undefined;
}

/** How many images the request asks for. Absent means fal's default of one. */
function imageCount(body: Readonly<Record<string, unknown>>): number {
  const n = body["num_images"];
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.floor(n) : 1;
}

/**
 * What one request to one endpoint costs, or `undefined` where the request
 * leaves the price open.
 *
 * Only the two units a text-to-image or image-edit request can actually settle
 * are computed — a flat per-image rate, and a per-megapixel rate against
 * dimensions the caller wrote out. Everything else returns `undefined` WITH a
 * reason available through {@link falPriceNote}, so a caller who wants to know
 * why can ask rather than guess.
 */
export function falCostUSD(
  endpointId: string,
  body: Readonly<Record<string, unknown>>,
): number | undefined {
  const rate: FalRate | undefined = (FAL_RATES as Readonly<Record<string, FalRate>>)[endpointId];
  if (rate === undefined || rate.unpriced !== undefined) return undefined;
  switch (rate.unit) {
    case "per_image":
      return rate.usd === undefined ? undefined : rate.usd * imageCount(body);
    case "per_megapixel": {
      if (rate.usd === undefined) return undefined;
      const pixels = falOutputPixels(body);
      if (pixels === undefined) return undefined;
      return rate.usd * falMegapixels(pixels.width, pixels.height) * imageCount(body);
    }
    // Everything below needs a fact the request body does not carry, or does
    // not carry reliably. See the module header for why a guess is worse than
    // nothing here.
    default:
      return undefined;
  }
}

/**
 * Why an estimate came back `undefined`, in a sentence a caller can act on.
 *
 * Reachable from a validator's JSDoc and from the estimate itself, so "no
 * cost" is never mute. A tiered rate says what the tiers are; a conditional
 * one names the field that would settle it; `compute_second` says the number
 * does not exist in advance.
 */
export function falPriceNote(endpointId: string): string | undefined {
  const rate: FalRate | undefined = (FAL_RATES as Readonly<Record<string, FalRate>>)[endpointId];
  if (rate === undefined) return undefined;
  if (rate.unpriced !== undefined) return rate.unpriced;
  const tiers = rate.tiers?.map((tier) => `$${tier.usd} ${tier.when}`).join("; ");
  switch (rate.unit) {
    case "per_image":
      return undefined;
    case "per_megapixel":
      return (
        `${endpointId} bills $${rate.usd} per megapixel of output, rounded up to the nearest megapixel. ` +
        "An estimate needs the pixel count, so it is available when the request states an explicit " +
        "`image_size: { width, height }` and not when it names a preset — fal publishes no per-endpoint " +
        "table of what its presets measure."
      );
    case "tiered":
      return (
        `${endpointId} is priced in tiers (${tiers ?? "see the model page"}), selected by ` +
        `${rate.tierKey ?? "the billed quantity"}. unmodel does not estimate it: the tier boundary is a ` +
        "quantity the request does not state."
      );
    case "conditional":
      return (
        `${endpointId}'s rate depends on ${rate.tierKey ?? "the request"} (${tiers ?? "see the model page"}). ` +
        "unmodel returns no estimate rather than assume a tier the request left open."
      );
    case "compute_second":
      return `${endpointId} is billed per COMPUTE second — how long fal's GPU took, which no request body predicts.`;
    default:
      return (
        `${endpointId} bills in ${rate.unit ?? "an unstated unit"}, which a request body does not settle. ` +
        `See ${rate.source}.`
      );
  }
}
