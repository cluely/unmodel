/**
 * Topaz bills in CREDITS, per output megapixel, and the arithmetic is exact.
 *
 * Transcribed from https://developer.topazlabs.com/getting-started/model-pricing
 * (the per-family MP-per-credit rates), the per-model credit tables on each
 * model's page under https://developer.topazlabs.com/image-models/, and
 * https://www.topazlabs.com/enhance-api (the USD price of a credit) — verified
 * 2026-08-25.
 *
 * ## One formula reproduces every published table
 *
 * The pricing page states the rule in one sentence: "Image models are priced
 * linearly based on MP output (e.g. 1 credit = 24 MP of output)", and gives the
 * rate per family. Rounding is up, per whole credit, which is what the "Up to
 * 24 MP output: 1 credit" phrasing on the public FAQ means. So:
 *
 * ```text
 * credits = ceil(outputMegapixels / mpPerCredit)
 * ```
 *
 * That was checked against every per-model table published: `Standard 2` at 24
 * MP/credit gives 1, 1, 1, 1, 1, 2, 2, 3, 3, 5 credits for 1, 4, 8, 16, 24, 32,
 * 40, 50, 64, 100 MP — which is the table on its page, entry for entry.
 * `Redefine` and `Recover 3` at 4 MP/credit give 1, 1, 2, 4, 6, 8, 10, 13, 16,
 * 25 — their table. `Bloom 2` at 2 MP/credit gives 1, 2, 4, 8, 12, 16, 20, 25,
 * 32, 50 — its table. Three families, thirty numbers, no exceptions.
 *
 * ## Why the estimate is EXACT here, and why it is often absent
 *
 * Topaz bills on the OUTPUT's pixel count, and the request states it:
 * `output_width × output_height` is right there in the body. That makes this
 * one of the few media providers whose price is a pure function of the request
 * — no duration to guess, no input dimensions to discover behind a URL.
 *
 * The other half of the same fact is that both fields are OPTIONAL. A request
 * that names neither lets Topaz choose the output size from the input's, which
 * a URL does not reveal — so {@link topazCredits} returns `undefined` rather
 * than a number, and Topaz's own `POST /image/v1/estimate` (or `/estimate-gen`)
 * is the answer for those. Naming only one dimension scales the other
 * proportionally, which is a ratio the request also does not carry.
 *
 * ## Why no row carries a `cost`
 *
 * `ModelCost` has four media fields — `perImage`, `perVideoSecond`,
 * `perMillionCharacters`, `perAudioMinute` — and "per output megapixel, rounded
 * up to a whole credit" is none of them. `perImage` would be a lie by a factor
 * of five across the sizes one model serves. So the tables live here and each
 * endpoint estimates per request, exactly, whenever the request said enough.
 */

/**
 * USD per credit at the pay-as-you-go rate.
 *
 * Source: https://www.topazlabs.com/enhance-api — verified 2026-08-25.
 * Quote: “Starter … $0.12 / credit”. The subscription tiers are cheaper —
 * Developer at $50/mo for 500 credits is $0.10, Scale at $240/mo for 3,000 is
 * $0.08 — so this is the undiscounted ceiling, which is the right direction for
 * an estimate. Unused credits roll over up to 5× the monthly volume.
 */
export const CREDIT_USD = 0.12;

/**
 * Megapixels of OUTPUT per credit, per model family.
 *
 * Source: https://developer.topazlabs.com/getting-started/model-pricing —
 * verified 2026-08-25. Quote: “| Precision Upscale | `Gigapixel` | 24 |
 * Generative Upscale | `Wonder` | 4 | Creative Upscale | `Bloom` | 2 |”.
 *
 * Higher is cheaper: a Gigapixel model fits 24 megapixels into one credit where
 * a Bloom model fits two, which is a twelve-fold difference in price for the
 * same picture and the single most consequential number on this page.
 */
export const MP_PER_CREDIT = {
  /** The classic GAN upscalers on `/enhance/async`. */
  gigapixel: 24,
  /** The generative upscalers on `/enhance-gen/async`. */
  wonder: 4,
  /** The creative upscalers on `/enhance-gen/async`. */
  bloom: 2,
} as const;

export type TopazPricingFamily = keyof typeof MP_PER_CREDIT;

/** Which family each rostered model bills as. */
export const TOPAZ_PRICING_FAMILY: Readonly<Record<string, TopazPricingFamily>> = {
  "Standard V2": "gigapixel",
  "High Fidelity V2": "gigapixel",
  "Upscale High Fidelity V3": "gigapixel",
  "Low Resolution V2": "gigapixel",
  CGI: "gigapixel",
  "Text Refine": "gigapixel",
  Redefine: "wonder",
  Wonder: "wonder",
  "Wonder 2": "wonder",
  "Wonder 3": "wonder",
  "Wonder 3.5": "wonder",
  "Standard MAX": "wonder",
  "Recover 3": "wonder",
  "Bloom 2": "bloom",
  "Bloom Realism": "bloom",
};

export interface TopazCostInputs {
  model: string;
  /** `output_width` on the wire. */
  outputWidth?: number;
  /** `output_height` on the wire. */
  outputHeight?: number;
}

/**
 * The credits a request will be billed, or `undefined` when it did not say.
 *
 * `undefined` for three reasons, and each is a real request: an unrostered
 * model (a new one Topaz shipped since this file was written), a request that
 * names neither output dimension (Topaz picks the size), and a request that
 * names only one (the other scales from the input's ratio, which the body does
 * not carry).
 */
export function topazCredits(inputs: TopazCostInputs): number | undefined {
  const family = TOPAZ_PRICING_FAMILY[inputs.model];
  if (family === undefined) return undefined;
  const { outputWidth: width, outputHeight: height } = inputs;
  if (width === undefined || height === undefined) return undefined;
  const megapixels = (width * height) / 1_000_000;
  if (!(megapixels > 0)) return undefined;
  return Math.ceil(megapixels / MP_PER_CREDIT[family]);
}

/** The same figure in USD, at the pay-as-you-go {@link CREDIT_USD} rate. */
export function topazCostUSD(inputs: TopazCostInputs): number | undefined {
  const credits = topazCredits(inputs);
  return credits === undefined ? undefined : credits * CREDIT_USD;
}
