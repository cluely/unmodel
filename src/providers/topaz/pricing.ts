/**
 * Topaz bills in CREDITS, per output megapixel, and the arithmetic is exact.
 *
 * Transcribed from
 * https://developer.topazlabs.com/getting-started/model-pricing/image-models
 * (the formula), the "Model Pricing" section of each model's own page under
 * https://developer.topazlabs.com/image-models/upscaling-and-enhancement/ (the
 * rate and its credit table) — verified 2026-11-12 — and
 * https://www.topazlabs.com/api (the USD price of a credit, per plan) —
 * verified 2026-11-13.
 *
 * ## One formula reproduces every published table
 *
 * The image pricing page states the rule in one line — "`credits = ceil(output
 * megapixels ÷ MP per credit)`" — and each model page states its own rate in
 * one sentence: "**Wonder 4** costs 1 credit per every 8 MP of generated
 * output." So:
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
 * 32, 50 — its table. `Wonder 4` at 8 gives 1, 1, 1, 2, 3, 4, 5 for 1, 4, 8, 16,
 * 24, 32, 40 MP — its table.
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

import type { TopazModelId } from "./shared";

/**
 * USD per credit at the highest published plan rate, Developer's.
 *
 * Source: https://www.topazlabs.com/api — verified 2026-11-13.
 * Quotes: “Developer … $50/mo … 500 credits/mo … $0.10 / credit” and “Scale …
 * $240/mo … 3000 credits/mo … $0.08 / credit”. A plan that runs out is
 * reloaded “at the current per-credit price” (the page's own worked example,
 * “750 credits and charged $49.75”, comes out lower still), so $0.10 is the
 * most a published plan charges, which is the right direction for an
 * estimate. It is not a ceiling for every account:
 * https://developer.topazlabs.com/getting-started/faqs.md (verified
 * 2026-11-13) mentions “a small one-time pack” of credits whose price is not
 * published.
 */
export const CREDIT_USD = 0.1;

/**
 * Megapixels of OUTPUT per credit, per model — the rate each model's own page
 * states.
 *
 * Per model because the rate does not follow the route or the family: `Detail`
 * rides `/enhance-gen/async` at the classic route's 24, and `Wonder 3`, `3.5`
 * and `4` bill at 8 beside `Wonder` and `Wonder 2`'s 4. Every page states its
 * rate in one sentence, and each row quotes it.
 *
 * Higher is cheaper: a model at 24 fits 24 megapixels into one credit where a
 * Bloom model fits two, which is a twelve-fold difference in price for the same
 * picture and the single most consequential number on this page.
 */
export const MP_PER_CREDIT = {
  // --- POST /image/v1/enhance/async ----------------------------------------
  // https://developer.topazlabs.com/image-models/upscaling-and-enhancement/precision/standard-2.md — verified 2026-11-12.
  // “**Standard 2** costs 1 credit per every 24 MP of generated output.”
  "Standard V2": 24,
  // https://developer.topazlabs.com/image-models/upscaling-and-enhancement/precision/high-fidelity-2.md — verified 2026-11-12.
  // “**High Fidelity 2** costs 1 credit per every 24 MP of generated output.”
  "High Fidelity V2": 24,
  // https://developer.topazlabs.com/image-models/upscaling-and-enhancement/precision/high-fidelity-3.md — verified 2026-11-12.
  // “**High Fidelity 3** costs 1 credit per every 24 MP of generated output.”
  "Upscale High Fidelity V3": 24,
  // https://developer.topazlabs.com/image-models/upscaling-and-enhancement/precision/low-resolution-2.md — verified 2026-11-12.
  // “**Low Resolution 2** costs 1 credit per every 24 MP of generated output.”
  "Low Resolution V2": 24,
  // https://developer.topazlabs.com/image-models/upscaling-and-enhancement/precision/art-and-cgi.md — verified 2026-11-12.
  // “**Art & CGI** costs 1 credit per every 24 MP of generated output.”
  CGI: 24,
  // https://developer.topazlabs.com/image-models/upscaling-and-enhancement/precision/text-and-shapes.md — verified 2026-11-12.
  // “**Text & Shapes** costs 1 credit per every 24 MP of generated output.”
  "Text Refine": 24,
  // --- POST /image/v1/enhance-gen/async ------------------------------------
  // https://developer.topazlabs.com/image-models/upscaling-and-enhancement/generative/redefine.md — verified 2026-11-12.
  // “**Redefine** costs 1 credit per every 4 MP of generated output.”
  Redefine: 4,
  // https://developer.topazlabs.com/image-models/upscaling-and-enhancement/generative/wonder-1.md — verified 2026-11-12.
  // “**Wonder 1** costs 1 credit per every 4 MP of generated output.”
  Wonder: 4,
  // https://developer.topazlabs.com/image-models/upscaling-and-enhancement/generative/wonder-2.md — verified 2026-11-12.
  // “**Wonder 2** costs 1 credit per every 4 MP of generated output.”
  "Wonder 2": 4,
  // https://developer.topazlabs.com/image-models/upscaling-and-enhancement/generative/wonder-3.md — verified 2026-11-12.
  // “**Wonder 3** costs 1 credit per every 8 MP of generated output.”
  "Wonder 3": 8,
  // https://developer.topazlabs.com/image-models/upscaling-and-enhancement/generative/wonder-3.5.md — verified 2026-11-12.
  // “**Wonder 3.5** costs 1 credit per every 8 MP of generated output.”
  "Wonder 3.5": 8,
  // https://developer.topazlabs.com/image-models/upscaling-and-enhancement/generative/wonder-4.md — verified 2026-11-12.
  // “**Wonder 4** costs 1 credit per every 8 MP of generated output.”
  "Wonder 4": 8,
  // https://developer.topazlabs.com/image-models/upscaling-and-enhancement/generative/standard-max.md — verified 2026-11-12.
  // “**Standard Max** costs 1 credit per every 4 MP of generated output.”
  "Standard MAX": 4,
  // https://developer.topazlabs.com/image-models/upscaling-and-enhancement/generative/recover-3.md — verified 2026-11-12.
  // “**Recover 3** costs 1 credit per every 4 MP of generated output.”
  "Recover 3": 4,
  // https://developer.topazlabs.com/image-models/upscaling-and-enhancement/precision/detail-faces.md — verified 2026-11-12.
  // “**Detail Faces** costs 1 credit per every 24 MP of generated output.”
  Detail: 24,
  // https://developer.topazlabs.com/image-models/upscaling-and-enhancement/creative/bloom-2.md — verified 2026-11-12.
  // “**Bloom 2** costs 1 credit per every 2 MP of generated output.”
  "Bloom 2": 2,
  // https://developer.topazlabs.com/image-models/upscaling-and-enhancement/creative/bloom-1-realism.md — verified 2026-11-12.
  // “**Bloom 1 Realism** costs 1 credit per every 2 MP of generated output.”
  "Bloom Realism": 2,
  // https://developer.topazlabs.com/image-models/upscaling-and-enhancement/creative/bloom-1-creative.md — verified 2026-11-12.
  // “**Bloom 1 Creative** costs 1 credit per every 2 MP of generated output.”
  Bloom: 2,
} as const satisfies Record<TopazModelId, number>;

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
  const rates: Readonly<Record<string, number>> = MP_PER_CREDIT;
  const rate = Object.hasOwn(rates, inputs.model) ? rates[inputs.model] : undefined;
  if (rate === undefined) return undefined;
  const { outputWidth: width, outputHeight: height } = inputs;
  if (width === undefined || height === undefined) return undefined;
  const megapixels = (width * height) / 1_000_000;
  if (!(megapixels > 0)) return undefined;
  return Math.ceil(megapixels / rate);
}

/** The same figure in USD, at the Developer plan's {@link CREDIT_USD} rate. */
export function topazCostUSD(inputs: TopazCostInputs): number | undefined {
  const credits = topazCredits(inputs);
  return credits === undefined ? undefined : credits * CREDIT_USD;
}
