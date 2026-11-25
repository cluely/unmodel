/**
 * The rate contract `scripts/codegen-higgsfield.ts` targets, and
 * `./pricing.ts` computes from.
 *
 * Its own leaf, type only and import-free, for the reason `./shape-types.ts`
 * is: `gen/pricing.gen.ts` declares `satisfies Record<string, HiggsfieldRate>`.
 *
 * Higgsfield publishes prices as sentences, and only two units appear in
 * them: a rate per image and a rate per second of video. What varies is what
 * selects the rate and which seconds it multiplies, and several sentences
 * price some requests in ways no row can state. Every field below exists so
 * that `higgsfieldCostUSD` can tell a request it can price from one it cannot,
 * and answer `undefined` for the second.
 */

/** One rate, or one per value of the selecting field. Keys are that field's WIRE values, verbatim. */
export type HiggsfieldRateTable = number | Readonly<Record<string, number>>;

/** A request the quote prices in a way the row cannot express. */
export interface HiggsfieldUnpricedArm {
  readonly param: string;
  /** The values that select the arm… */
  readonly in?: readonly (string | boolean)[];
  /** …or the array length from which it applies. Exactly one of the two. */
  readonly minItems?: number;
  readonly reason: string;
}

/** A published rate, or the stated reason there is none. */
export interface HiggsfieldRate {
  readonly unit?: "per_image" | "per_second";
  readonly usd?: HiggsfieldRateTable;
  /** The wire field that selects the rate. */
  readonly by?: string;
  /**
   * Why no wire field selects it: the quote prices output resolutions the
   * route has no parameter for. `usd` is then keyed by the quote's own labels
   * and no request can be priced.
   */
  readonly byUnpublished?: string;
  /** The table that applies when any of `videoInputs` carries a clip. */
  readonly usdWithVideoInput?: HiggsfieldRateTable;
  readonly videoInputs?: readonly string[];
  /**
   * What a per-second rate multiplies.
   *
   * - `request` — the body's `duration`.
   * - `source` — the clip at `sourceParam`, rounded as `rounding` says and
   *   capped at `maxSeconds`. Its length is not in the body; declare it with
   *   `ValidateOptions.media`.
   * - `output` — the delivered clip, whose length the request does not state.
   * - `formula` — the quote's own arithmetic over durations the request does
   *   not state.
   */
  readonly seconds?: "request" | "source" | "output" | "formula";
  readonly sourceParam?: string;
  /** How the quote rounds the billed source duration to a whole second. */
  readonly rounding?: "up" | "nearest";
  /** The longest source clip billed: the route trims a longer one. */
  readonly maxSeconds?: number;
  /** A wire field the vendor says multiplies a per-image rate. */
  readonly count?: string;
  /** A field that changes how many images come back, where NO source says how it bills. */
  readonly multipliedBy?: string;
  readonly undefinedWhen?: readonly HiggsfieldUnpricedArm[];
  /**
   * The published default of each parameter this rate reads, where every
   * source that declares the parameter agrees on it. A request that omits one
   * is priced at its default; a parameter with no entry here must be stated.
   */
  readonly defaults?: Readonly<Record<string, string | number | boolean>>;
  /**
   * The same route's console document says no price is public
   * (`HIGGSFIELD_NO_PUBLIC_PRICING`) while another surface states this one,
   * and the rate is catalogued by an owner ruling for this route. Every other
   * route with that evidence is `unpriced`. An estimate computed from this
   * rate comes with an `unconfirmed_cost` warning.
   */
  readonly contradicted?: true;
  /** Why no rate can be stated. Mutually exclusive with `unit`. */
  readonly unpriced?: string;
  /** The page the rate, or the lack of one, was read from. */
  readonly source: string;
  /** The date it was read. */
  readonly verified: string;
}
