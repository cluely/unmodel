/**
 * What a Revana generation is LISTED at — and the two reasons that is not
 * always what it costs.
 *
 * # The listed price is the first route's
 *
 * Revana is a router. Each model is served by one or more routes; a request
 * starts on the cheapest and falls back on failure, and "you are charged only
 * when the generation succeeds, at the price quoted for the route that made
 * it" (https://revana.si/docs). The catalog's `price` is the first route's —
 * the figure a quote answers as `quoted_usd` — and a dearer backup route can
 * charge more, up to the quote's `reserved_usd`.
 *
 * What a backup route adds is the one thing Revana's own pages disagree about:
 * the docs say failed attempts are covered by "what those attempts cost plus
 * 10%, whichever is more", the OpenAPI document says a backup route is "billed
 * at its provider's cost plus one cent" (both read 2026-11-12). So unmodel
 * computes no worst case. {@link revanaCostUSD} answers the LISTED price, a
 * lower bound on the charge, and {@link REVANA_PRICING_CAVEAT} is the sentence
 * to show beside it. The exact figures are one free call away:
 * `POST /v1/generations/quote` with the same body.
 *
 * # It is only computed when the request states what it is priced by
 *
 * Rates are keyed by setting — `"720p"`, `"720p+audio"`, `"1:1-high"` — and
 * Revana publishes no default `resolution`, `duration` or `audio` per model
 * (only `default_quality` and `default_voice`). A request that leaves a
 * price-deciding field out therefore has no listed price unmodel can name, and
 * the answer is `undefined` rather than a guess at the default. Likewise for a
 * request priced by the length of a clip it only links to (`video_url` on the
 * models with a `+video_input` rate, and Nemesis, "billed per second of clip
 * in plus video out").
 *
 * # Rounding
 *
 * "Every price is a whole number of credits, rounded up" and "100 credits =
 * $1" (https://revana.si/pricing), so a total is rounded up to the cent: an
 * eleven-character speech request at $0.12 per 1,000 characters quotes $0.01.
 */

import type { RevanaListedPrice, RevanaModelShape, RevanaRate } from "./shape-types";

/** Where the rates were read. */
export const REVANA_PRICING_SOURCE = "https://api.revana.si/v1/models";

/** The sentence to show beside any figure {@link revanaCostUSD} returns. */
export const REVANA_PRICING_CAVEAT =
  "This is Revana's listed price — the first route's, a quote's `quoted_usd`. Revana charges only " +
  "for the route that succeeds, and a backup route can cost more (up to the quote's " +
  "`reserved_usd`); `POST /v1/generations/quote` with the same body answers both figures for " +
  "free, and `max_cost_usd` on the request is the hard cap.";

const CENTS = 100;
/** Guards the round-up against binary float noise (`0.2 * 4` is `0.8000000000000002`). */
const ROUNDING_EPSILON = 1e-9;

/** "Every price is a whole number of credits, rounded up." */
function roundUpToCent(usd: number): number {
  return Math.ceil(usd * CENTS - ROUNDING_EPSILON) / CENTS;
}

/** The key of `rate` that equals `wanted` ignoring case, as the API matches settings. */
function findKey(rate: Readonly<Record<string, number>>, wanted: string): string | undefined {
  const lower = wanted.toLowerCase();
  return Object.keys(rate).find((key) => key.toLowerCase() === lower);
}

function text(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/**
 * The setting key a request is priced under, or `undefined` when the request
 * does not state enough to pick one.
 */
function settingKey(
  usd: Readonly<Record<string, number>>,
  shape: RevanaModelShape,
  input: Readonly<Record<string, unknown>>,
): string | undefined {
  const keys = Object.keys(usd);
  const quality = text(input["quality"]) ?? shape.defaultQuality;

  // Keyed by quality alone (`balanced`, `quality`, `turbo`).
  const qualities = shape.qualities?.map((q) => q.toLowerCase());
  if (qualities !== undefined && keys.every((key) => qualities.includes(key.toLowerCase()))) {
    return quality === undefined ? undefined : findKey(usd, quality);
  }
  // Keyed by shape and quality (`1:1-high`).
  if (shape.qualities !== undefined) {
    const aspect = text(input["aspect_ratio"]);
    if (aspect === undefined || quality === undefined) return undefined;
    return findKey(usd, `${aspect}-${quality}`);
  }

  // Keyed by resolution, with `+audio` and `+video_input` variants. A model
  // with no resolutions at all has one base key (`standard`).
  let base: string | undefined;
  if (shape.resolutions === undefined) {
    const bare = keys.filter((key) => !key.includes("+"));
    base = bare.length === 1 ? bare[0] : undefined;
  } else {
    const resolution = text(input["resolution"]);
    base = resolution === undefined ? undefined : findKey(usd, resolution);
  }
  if (base === undefined) return undefined;

  const variants = keys.filter((key) => key.startsWith(`${base}+`));
  if (variants.length === 0) return base;
  // The clip's length decides the bill and the request only links to it.
  if (input["video_url"] !== undefined && variants.some((key) => key.includes("video_input"))) {
    return undefined;
  }
  if (!variants.includes(`${base}+audio`)) return base;
  // No published default for `audio`: an unstated toggle is an unpriced one.
  if (input["audio"] === true) return `${base}+audio`;
  if (input["audio"] === false) return base;
  return undefined;
}

function rateAt(rate: RevanaRate | undefined, key: string | undefined): number | undefined {
  if (rate === undefined) return 0;
  if (typeof rate === "number") return rate;
  return key === undefined ? undefined : rate[key];
}

/** How many characters a speech request is billed for. */
function spokenCharacters(input: Readonly<Record<string, unknown>>): number | undefined {
  const dialogue = input["dialogue"];
  if (Array.isArray(dialogue)) {
    let total = 0;
    for (const line of dialogue) {
      const words = text((line as { text?: unknown } | null)?.text);
      if (words === undefined) return undefined;
      total += words.length;
    }
    return total;
  }
  return (text(input["text"]) ?? text(input["prompt"]))?.length;
}

/**
 * The listed price of one generation request in USD, or `undefined` when the
 * request does not state what it is priced by (see the module docstring).
 *
 * A lower bound on the charge, never a worst case — show
 * {@link REVANA_PRICING_CAVEAT} with it.
 */
export function revanaCostUSD(
  price: RevanaListedPrice | undefined,
  shape: RevanaModelShape | undefined,
  input: Readonly<Record<string, unknown>>,
): number | undefined {
  if (price === undefined || shape === undefined || price.billed !== undefined) return undefined;

  const key = typeof price.usd === "number" ? undefined : settingKey(price.usd, shape, input);
  const usd = rateAt(price.usd, key);
  const fee = rateAt(price.feeUsd, key);
  if (usd === undefined || fee === undefined) return undefined;

  let units: number | undefined;
  if (price.unit === "per_image") {
    const count = input["num_images"] ?? input["n"] ?? 1;
    units = typeof count === "number" ? count : undefined;
  } else if (price.unit === "per_second") {
    const duration = input["duration"];
    units = typeof duration === "number" ? duration : undefined;
  } else if (price.unit === "per_1k_chars") {
    const characters = spokenCharacters(input);
    units = characters === undefined ? undefined : characters / 1000;
  } else {
    units = 1;
  }
  if (units === undefined) return undefined;
  return roundUpToCent(usd * units + fee);
}
