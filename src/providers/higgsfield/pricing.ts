/**
 * What a Higgsfield request is LISTED at — and the many requests that have no
 * listed price unmodel can name.
 *
 * # Prices are sentences
 *
 * Higgsfield publishes no machine-readable rate. `gen/pricing.gen.ts` carries
 * each route's sentence as a row, hand-transcribed into
 * `data/higgsfield/pricing.json` with its quote, source and date, and guarded
 * at codegen (the quote must still be in the snapshot; every number must be in
 * its own quote). A row is a RATE, not a cost, and {@link higgsfieldCostUSD}
 * answers a number only when the request states everything the rate depends
 * on.
 *
 * # When there is no answer
 *
 * `undefined`, never a guess, when:
 *
 * - the route is `unpriced` — a sample point ("for 6 second clips"), a rate
 *   the vendor calls approximate, token metering, a sentence the route's own
 *   console document contradicts, or no sentence at all;
 * - the rate is keyed by a field the request neither states nor has a
 *   published default for, or by an output resolution the route has no
 *   parameter for (`byUnpublished`);
 * - it bills seconds the body does not state: a delivered clip's length
 *   (`seconds: "output"`), the quote's own formula, or a source clip whose
 *   duration was not declared through `ValidateOptions.media`;
 * - the request is one the quote prices some other way (`undefinedWhen`: an
 *   HDR surcharge, a multi-shot request billed on its shots);
 * - a clip is attached and the quote has no with-video rate for the request;
 * - a field that changes how many images come back is not `1`, and no source
 *   says how it bills (`batch_size: 4` on Soul).
 *
 * # Defaults
 *
 * A request that omits `resolution` is billed at the route's default. A rate
 * row carries the default of each parameter it reads where every Higgsfield
 * source that declares the parameter agrees on it (`defaults`), and only
 * those are assumed. Higgsfield's two publications disagree on several
 * defaults; a parameter with no agreed default has to be stated.
 *
 * # Rounding
 *
 * No rounding rule is published for a total, so none is applied beyond
 * removing float noise. A source clip's billed seconds are rounded as its
 * quote says ("rounded up to a whole second", "rounded to the nearest whole
 * second").
 */

import { HIGGSFIELD_RATES } from "./gen/pricing.gen";
import type { HiggsfieldRate, HiggsfieldRateTable } from "./pricing-types";

/**
 * The sentence to show beside any figure {@link higgsfieldCostUSD} returns.
 *
 * "Use the estimate returned for your authenticated account as the
 * authoritative amount"
 * (https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md).
 */
export const HIGGSFIELD_PRICING_CAVEAT =
  "This is Higgsfield's standard self-serve rate, before any account-specific discount. `POST estimateUrl(endpoint)` " +
  "with the same body answers the amount for your account, which Higgsfield calls authoritative.";

/**
 * The sentence to show beside a figure from a rate marked `contradicted`: the
 * three priced Soul routes and AI Influencer, whose console document prints
 * `HIGGSFIELD_NO_PUBLIC_PRICING` while their model page states a price.
 *
 * A validated request whose estimate came from such a rate carries it as an
 * `unconfirmed_cost` warning. {@link higgsfieldCostUSD} returns a bare number,
 * so a caller of that function reads `HIGGSFIELD_RATES[id].contradicted`.
 */
export const HIGGSFIELD_CONTRADICTED_PRICING_CAVEAT =
  "Higgsfield's model page states this rate, while the same route's console document says \"Public pricing " +
  'information is not available for this model." Treat it as an unconfirmed list price.';

/** Totals are rounded to a millionth of a dollar, which removes float noise and nothing a rate states. */
const USD_PRECISION = 1e6;

/** What the request does not say and the estimate needs. */
export interface HiggsfieldCostContext {
  /**
   * The duration, in seconds, of the clip at the rate's `sourceParam` — for
   * the routes billed on a source clip (Genjutsu, Kling motion control).
   */
  readonly sourceSeconds?: number;
}

/**
 * The listed price of one request in USD, or `undefined` when the request
 * does not state what it is priced by (see the module docstring).
 *
 * `body` is the wire body: the route's parameters, without `endpoint`. Show
 * {@link HIGGSFIELD_PRICING_CAVEAT} with the answer.
 */
export function higgsfieldCostUSD(
  endpoint: string,
  body: Readonly<Record<string, unknown>>,
  context: HiggsfieldCostContext = {},
): number | undefined {
  const rate: HiggsfieldRate | undefined = Object.hasOwn(HIGGSFIELD_RATES, endpoint)
    ? HIGGSFIELD_RATES[endpoint as keyof typeof HIGGSFIELD_RATES]
    : undefined;
  if (rate === undefined || rate.unit === undefined || rate.usd === undefined || rate.byUnpublished !== undefined) return undefined;

  function read(name: string): unknown {
    return body[name] ?? rate?.defaults?.[name];
  }

  for (const arm of rate.undefinedWhen ?? []) {
    const value = read(arm.param);
    if (arm.in !== undefined && arm.in.includes(value as string | boolean)) return undefined;
    if (arm.minItems !== undefined && Array.isArray(value) && value.length >= arm.minItems) return undefined;
  }

  const withVideo = (rate.videoInputs ?? []).some((name) => carriesClip(body[name]));
  const table = withVideo ? rate.usdWithVideoInput : rate.usd;
  const usd = rateAt(table, rate.by === undefined ? undefined : read(rate.by));
  if (usd === undefined) return undefined;

  const units = rate.unit === "per_image" ? imageCount(rate, read) : billedSeconds(rate, read, context);
  if (units === undefined) return undefined;
  return Math.round(usd * units * USD_PRECISION) / USD_PRECISION;
}

function carriesClip(value: unknown): boolean {
  return Array.isArray(value) ? value.length > 0 : typeof value === "string" && value !== "";
}

function rateAt(table: HiggsfieldRateTable | undefined, key: unknown): number | undefined {
  if (table === undefined) return undefined;
  if (typeof table === "number") return table;
  if (typeof key !== "string" && typeof key !== "number") return undefined;
  return Object.hasOwn(table, String(key)) ? table[String(key)] : undefined;
}

function imageCount(rate: HiggsfieldRate, read: (name: string) => unknown): number | undefined {
  // No source says how a batch bills, so only a batch of one has a price.
  if (rate.multipliedBy !== undefined && read(rate.multipliedBy) !== 1) return undefined;
  if (rate.count === undefined) return 1;
  const count = read(rate.count);
  return isQuantity(count) ? count : undefined;
}

function billedSeconds(rate: HiggsfieldRate, read: (name: string) => unknown, context: HiggsfieldCostContext): number | undefined {
  if (rate.seconds === "request") {
    const duration = read("duration");
    return isQuantity(duration) ? duration : undefined;
  }
  if (rate.seconds !== "source" || !isQuantity(context.sourceSeconds)) return undefined;
  const billed = rate.maxSeconds === undefined ? context.sourceSeconds : Math.min(context.sourceSeconds, rate.maxSeconds);
  return rate.rounding === "up" ? Math.ceil(billed) : Math.round(billed);
}

/** A count or a duration a price can multiply: finite and not negative. Anything else has no price. */
function isQuantity(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
