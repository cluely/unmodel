/**
 * What Atlas Cloud publishes about price, and why none of it reaches
 * `ModelInfo.cost`.
 *
 * # The contradiction, in Atlas's own words
 *
 * Every model page is a React application, and its bundle carries **three**
 * mutually exclusive price sentences from three templates (read at
 * https://www.atlascloud.ai/models/bytedance/seedance-2.5/reference-to-video on
 * 2026-08-26, verbatim from the shipped source):
 *
 * > `Your request will cost ${price} per run. For $10 you can run this model
 * > approximately {times} times.`
 *
 * > `For every second of 720p video you generated, you will be charged
 * > ${rate}/second. Your request will cost ${tokenRate} per 1000 tokens. The
 * > number of tokens is given by (height of output video × width of output
 * > video × (input duration + output duration) × 24) / 1024. If video inputs
 * > are provided the rate drops to ${tokenRateWithVideo} per 1000 tokens. With
 * > video inputs and 720p resolution the price is ${rateWithVideo} per second.`
 *
 * …and the same page's own meta description says *"Starting from $0.134/1M
 * tokens"* for the model whose card in the related-models strip reads
 * *"From $0.134 /SEC"*. One number, `0.134`, presented as a per-run price, a
 * per-second rate and a per-million-token rate on one page.
 *
 * # And the catalog cannot settle it
 *
 * `GET https://api.atlascloud.ai/api/v1/models` returns a `price` object per
 * row, but only **2 of 337** media rows carry `price.actual.unit` (both
 * `"generation"`); the other 335 are a bare `base_price` string with no unit at
 * all. Worse, **152 of 473** rows carry a promotional `discount` between 40 and
 * 90, so `price.actual` is not the list price either — it is today's offer.
 *
 * # So: no `cost`, and the caveat instead
 *
 * Under the same rule that governs fal (`data/fal/pricing.json`: a rate needs a
 * source, a date and the quote it was read from, or the row ships no rate),
 * every Atlas row ships **no `cost`** and this module carries what Atlas
 * actually published. {@link ATLASCLOUD_PRICING_CAVEAT} is the sentence to
 * show a caller who asks why an estimate is missing.
 *
 * There is deliberately **no `videoCostUSD`**. A function that always returns
 * `undefined` is a promise that a number is coming; a missing function is the
 * truth. `atlascloud.video` therefore declares no `estimate` at all, and a
 * `Validated` from it carries no `costUSD` — which is what makes
 * `options.maxCostUSD` a no-op here rather than a false pass.
 *
 * What would change this: Atlas documenting a unit (a `price.actual.unit` on
 * every media row would do it), or a model page settling on one of its three
 * sentences. Either one is a small diff — {@link LISTED_BASE_PRICE_USD} is
 * already the transcription — and until then the number stays out of the
 * catalog.
 *
 * @see https://www.atlascloud.ai/models — the model pages
 * @see https://api.atlascloud.ai/api/v1/models — the keyless catalog
 */

/** The sentence to show a caller who asks why an Atlas request has no estimate. */
export const ATLASCLOUD_PRICING_CAVEAT =
  "Atlas Cloud publishes no unit for its video rates: 335 of its 337 media catalog rows carry a " +
  "bare `base_price` with no `unit`, 152 of 473 rows carry a 40–90% promotional discount so the " +
  "listed figure is not the list price, and the model page renders the same number as a per-run " +
  "price, a per-second rate and a per-1000-token rate from three templates in one bundle. " +
  "unmodel therefore ships no `cost` for any atlascloud model rather than a guess. The listed " +
  "figures are in ATLASCLOUD_LISTED_BASE_PRICE_USD, and they are unit-less on purpose.";

/** Where the caveat was read, and when. */
export const ATLASCLOUD_PRICING_SOURCE = "https://api.atlascloud.ai/api/v1/models";
export const ATLASCLOUD_PRICING_VERIFIED = "2026-08-26";

/**
 * The token formula Atlas's model page states, transcribed verbatim so the one
 * quantitative thing it does say is not lost:
 *
 * > "(height of output video × width of output video × (input duration +
 * > output duration) × 24) / 1024"
 *
 * It is the same shape ByteDance documents for ModelArk
 * (`src/providers/bytedance/pricing.ts`), 24 fps and all — which is evidence
 * that the "/1000 tokens" template is the honest one for the Seedance rows and
 * exactly zero evidence about what unit the *catalog's* `base_price` is in.
 * That is why it is documentation here and not arithmetic.
 */
export const ATLASCLOUD_VIDEO_TOKEN_FORMULA =
  "(height of output video × width of output video × (input duration + output duration) × 24) / 1024";

/** One row's price, exactly as `GET /api/v1/models` returns it. */
export interface AtlascloudListedPrice {
  /** `price.actual.base_price`, parsed. **The unit is unknown** — see the caveat. */
  readonly actual: number;
  /** `price.origin.base_price` — the pre-discount figure, same unknown unit. */
  readonly origin: number;
  /**
   * `price.discount`, as Atlas returns it: a number between 40 and 100 where
   * **100 means no discount** (`actual === origin`) and 70 means the row is
   * currently discounted. It is a percentage OF the list price, not off it.
   */
  readonly discount: number;
}

/**
 * The figures Atlas listed for the 23 curated ids on 2026-08-26.
 *
 * Transcribed rather than derived, and carried as data rather than as `cost`,
 * for the reason in this module's docstring: these are numbers without units.
 * `scripts/atlascloud-audit.ts` reports when a live figure stops matching one
 * of these, which is the only thing that can be checked about them.
 */
export const ATLASCLOUD_LISTED_BASE_PRICE_USD: Readonly<
  Record<string, AtlascloudListedPrice>
> = {
  "alibaba/wan-3.0-prime/text-to-video": { actual: 0.061, origin: 0.068, discount: 90 },
  "alibaba/wan-3.0-prime/image-to-video": { actual: 0.061, origin: 0.068, discount: 90 },
  "alibaba/wan-3.0/text-to-video": { actual: 0.04, origin: 0.05, discount: 80 },
  "alibaba/wan-3.0/image-to-video": { actual: 0.04, origin: 0.05, discount: 80 },
  "bytedance/seedance-2.5/text-to-video": { actual: 0.134, origin: 0.134, discount: 100 },
  "bytedance/seedance-2.5/image-to-video": { actual: 0.134, origin: 0.134, discount: 100 },
  "bytedance/seedance-2.5/reference-to-video": { actual: 0.134, origin: 0.134, discount: 100 },
  "bytedance/seedance-2.0/text-to-video": { actual: 0.112, origin: 0.112, discount: 100 },
  "bytedance/seedance-2.0/image-to-video": { actual: 0.112, origin: 0.112, discount: 100 },
  "bytedance/seedance-2.0/reference-to-video": { actual: 0.112, origin: 0.112, discount: 100 },
  "bytedance/seedance-2.0-mini/text-to-video": { actual: 0.039, origin: 0.056, discount: 70 },
  "bytedance/seedance-2.0-mini/image-to-video": { actual: 0.039, origin: 0.056, discount: 70 },
  "bytedance/seedance-2.0-mini/reference-to-video": { actual: 0.039, origin: 0.056, discount: 70 },
  "bytedance/seedance-2.0-fast/text-to-video": { actual: 0.072, origin: 0.09, discount: 80 },
  "bytedance/seedance-2.0-fast/image-to-video": { actual: 0.072, origin: 0.09, discount: 80 },
  "bytedance/seedance-2.0-fast/reference-to-video": { actual: 0.072, origin: 0.09, discount: 80 },
  "bytedance/seedance-v1.5-pro/text-to-video": { actual: 0.047, origin: 0.052, discount: 90 },
  "bytedance/seedance-v1.5-pro/image-to-video": { actual: 0.047, origin: 0.052, discount: 90 },
  "bytedance/seedance-v1.5-pro/text-to-video-fast": { actual: 0.018, origin: 0.02, discount: 90 },
  "bytedance/seedance-v1.5-pro/image-to-video-fast": { actual: 0.018, origin: 0.02, discount: 90 },
  "google/veo3.1/text-to-video": { actual: 0.2, origin: 0.2, discount: 100 },
  "google/veo3.1/image-to-video": { actual: 0.2, origin: 0.2, discount: 100 },
  "google/veo3.1/reference-to-video": { actual: 0.2, origin: 0.2, discount: 100 },
};

/**
 * The listed figure for a model, or `undefined`.
 *
 * Read the return type: it is `AtlascloudListedPrice`, **not** a USD amount,
 * because a number whose unit is unknown is not a price. Anything that wants
 * to display it has to acknowledge the caveat to get at the field.
 */
export function listedPrice(model: string): AtlascloudListedPrice | undefined {
  return ATLASCLOUD_LISTED_BASE_PRICE_USD[model];
}
