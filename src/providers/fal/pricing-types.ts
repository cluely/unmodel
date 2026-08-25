/**
 * The rate contract `scripts/codegen-fal.ts` targets, and `./pricing.ts`
 * computes from.
 *
 * Its own leaf for the same reason `./shape-types.ts` is: the generated
 * `gen/pricing.gen.ts` declares `satisfies Record<string, FalRate>`, so a field
 * renamed here fails `tsc` in the generated file rather than drifting into two
 * vocabularies. Import-free, so nothing pays for a type.
 *
 * ## Fifteen units, five of which reach the catalog
 *
 * `ModelCost` in `src/core/catalog-types.ts` can express exactly four things
 * exactly — `perImage`, `perVideoSecond`, `perMillionCharacters`,
 * `perAudioMinute` — and fal prices in fifteen. Five units reach those four
 * fields, two of them through an EXACT multiplication (`per_1000_characters`
 * x1000, `per_input_audio_second` x60). The other ten reach a caller through
 * an ESTIMATE rather than through a catalog row, because a per-megapixel rate
 * written into `perImage` would be a number that is right for a 1 MP image and
 * wrong for every other one. `undefined` beats a wrong number; see
 * `data/fal/pricing.json`.
 *
 * The audio units come in pairs on purpose, and which side of the microphone
 * they are on is what decides whether they can reach `perAudioMinute` — whose
 * own definition is "per minute of audio PROCESSED". An stt rate can;
 * a music rate, which meters audio fal *produced*, cannot.
 */

/** How fal meters a request. */
export type FalRateUnit =
  /** A flat rate per generated image. Reaches `ModelCost.perImage`. */
  | "per_image"
  /**
   * A flat rate per request, for output that is not an image — fal's "per
   * audio" and "per generation" wording at the music endpoints. `perImage` is
   * an IMAGE rate and `ModelCost` has no other flat field, so this one reaches
   * a caller as a provenance comment and an estimate rather than as a row.
   */
  | "per_generation"
  /** A rate per megapixel of output, almost always rounded UP. */
  | "per_megapixel"
  /** A rate per second of output. Reaches `ModelCost.perVideoSecond`. */
  | "per_second"
  /** A rate per minute of output video. */
  | "per_video_minute"
  /** A rate per 30-second block. */
  | "per_30_seconds"
  /** A rate per 10-second block — the `per_30_seconds` sibling DiffRhythm needs. */
  | "per_10_seconds"
  /** A rate per 1,000 characters of input. Reaches `perMillionCharacters` (x1000, exact). */
  | "per_1000_characters"
  /** A rate per minute of input audio. Reaches `ModelCost.perAudioMinute`. */
  | "per_audio_minute"
  /** A rate per SECOND of input audio. Reaches `ModelCost.perAudioMinute` (x60, exact). */
  | "per_input_audio_second"
  /** A rate per second of GENERATED audio. `ModelCost` has no field for it. */
  | "per_generated_audio_second"
  /** A rate per minute of GENERATED audio, usually rounded up to the minute. */
  | "per_generated_audio_minute"
  /** A quantity threshold — the first N priced apart from each extra. */
  | "tiered"
  /** A request FIELD selects the rate (a resolution, a quality, a speed). */
  | "conditional"
  /** Billed by how long fal's GPU took, which no request body predicts. */
  | "compute_second";

/** One rate arm of a tiered or conditional price. */
export interface FalTier {
  /** The condition that selects this rate, in the page's own terms. */
  readonly when: string;
  readonly usd: number;
}

/** A published rate, or a stated reason there is none. */
export interface FalRate {
  readonly unit?: FalRateUnit;
  /** The scalar rate in {@link unit}. Absent on `tiered` / `conditional`. */
  readonly usd?: number;
  /** How fal rounds the billed quantity, in the page's own words. */
  readonly rounding?: string;
  /** What selects the tier — a wire field name, or prose when it is not one field. */
  readonly tierKey?: string;
  readonly tiers?: readonly FalTier[];
  /**
   * Why no rate can be stated. Mutually exclusive with {@link unit}.
   *
   * A curated endpoint with neither a rate nor one of these fails codegen:
   * silence about price is the one thing the pricing data may not say.
   */
  readonly unpriced?: string;
  /** The page the rate was read from. */
  readonly source: string;
  /** The date it was read, `YYYY-MM-DD`. */
  readonly verified: string;
}
