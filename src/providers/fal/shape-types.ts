/**
 * The contract `scripts/codegen-fal.ts` targets: a compact description of what
 * ONE fal endpoint accepts, which the ONE hand-written check battery reads at
 * run time to narrow from a category to an endpoint.
 *
 * ## Why an IR exists at all
 *
 * fal serves ~100 curated endpoints across nine verbs, and the obvious layouts
 * both fail:
 *
 * - **One zod schema per endpoint.** zod objects are built eagerly, so
 *   importing `unmodel/fal` would construct a hundred of them to use one.
 * - **One schema per category with every endpoint's bounds folded in.** There
 *   is no such thing: `num_inference_steps` tops out at 50 on `flux/dev` and at
 *   12 on `flux/schnell`, and a schema that accepts the union accepts a request
 *   `flux/schnell` refuses.
 *
 * So the split is: ONE `z.looseObject` per category answers "is this the right
 * shape?", and these rows answer "does this endpoint accept these values?".
 * The rows are plain data — no zod, no closures, no messages — which is what
 * lets a hundred of them cost a few kilobytes and lets every message be
 * composed in one place, citing `FAL_DOC_URLS[id]`.
 *
 * ## Why the keys are the allow-list
 *
 * There is no per-endpoint deny table. `props` names everything an endpoint
 * takes, so everything else is unknown by definition; the alternative is an
 * O(endpoints × parameters) table that says the same thing at hundreds of
 * kilobytes. `checkKnownParams` reads these keys and composes the message.
 *
 * Hand-written, and the generator is checked against it: `<v>-narrow.gen.ts`
 * declares `satisfies Record<string, FalEndpointShape>`, so a field renamed
 * here fails `tsc` in the generated file instead of drifting into two
 * vocabularies.
 */

/** The media kind a string parameter carries, from fal's own `ui.field` hint. */
export type FalMediaKind = "image" | "video" | "audio" | "file" | (string & {});

/**
 * The coarse type tag. `"integer"` is kept distinct from `"number"` because
 * fal genuinely distinguishes them and "must be a whole number" is a message
 * worth being able to write; `"union"` means the parameter accepts more than
 * one shape (fal's `image_size` is the canonical case); `"unknown"` means fal
 * itself declared no type, never that the generator gave up — anything it
 * cannot model is a hard error at codegen time.
 */
export type FalPropType =
  | "string"
  | "number"
  | "integer"
  | "boolean"
  | "array"
  | "object"
  | "union"
  | "unknown";

/** One dimension of an `image_size` object, with the bounds fal publishes. */
export interface FalDimensionSpec {
  min?: number;
  /** `exclusiveMinimum`, as a NUMBER — 2020-12 semantics, which is what fal emits. */
  xmin?: number;
  max?: number;
  default?: number;
}

/**
 * The `image_size` union, flattened for `checkImageSize`.
 *
 * fal spells it `anyOf: [$ref ImageSize, string enum]` — either a named preset
 * (`"landscape_4_3"`) or an explicit `{ width, height }`. Both arms are here so
 * one check can answer both "is that a preset this endpoint knows?" and "is
 * 20000 px inside its ceiling?" without re-reading the schema.
 */
export interface FalSizeSpec {
  presets: readonly string[];
  width: FalDimensionSpec;
  height: FalDimensionSpec;
}

/**
 * One parameter, as one endpoint declares it.
 *
 * Field names are terse (`req`, `nul`, `xmin`) because these rows are the bulk
 * of what `unmodel/fal` ships: at ~100 endpoints × ~10 parameters the
 * difference between `required` and `req` is measured in kilobytes of shipped
 * source. Every one of them is documented here, once.
 */
export interface FalPropSpec {
  /** The parameter's type. */
  t: FalPropType;
  /** In the endpoint's OpenAPI `required` list. */
  req?: true;
  /** `anyOf[T, null]` — an explicit `null` is accepted, and means "unset". */
  nul?: true;
  /** fal supplies a default, so omitting it is always safe. */
  def?: true;
  /** The vocabulary, when the parameter has one (`enum` or `const`). */
  enum?: readonly (string | number)[];
  /**
   * The vocabulary above is a SUGGESTION rather than a closed set.
   *
   * fal writes this as `anyOf: [{ type: "string", enum: [...] }, { type:
   * "string" }]` — "these values, or any other string". `flux-pro/v1.1-ultra`
   * lists nine aspect ratios and still accepts `"1234:567"`.
   *
   * The distinction is the difference between an error and a warning:
   * `checkEnums` refuses an unlisted value on a closed enum and merely reports
   * one here, because refusing it would reject a request fal accepts.
   */
  open?: true;
  /** `minimum` / `maximum` — inclusive. */
  min?: number;
  max?: number;
  /** `exclusiveMinimum` / `exclusiveMaximum`, as NUMBERS (2020-12 semantics). */
  xmin?: number;
  xmax?: number;
  /** `minLength` / `maxLength` on a string. */
  minLen?: number;
  maxLen?: number;
  /** `minItems` / `maxItems` on an array. */
  minItems?: number;
  maxItems?: number;
  /** The element spec, for arrays. */
  items?: FalPropSpec;
  /** fal's own hint that this string carries a media reference. */
  media?: FalMediaKind;
  /** The `image_size` union's presets and dimension bounds. */
  size?: FalSizeSpec;
}

/** One endpoint's whole input surface. */
export interface FalEndpointShape {
  /**
   * fal's own field order (`x-fal-order-properties`), asserted at codegen time
   * to be exactly the property key set. Bodies are emitted in this order so a
   * generated request reads like the endpoint's own documentation.
   */
  order: readonly string[];
  /** Every parameter the endpoint accepts. The keys ARE the allow-list. */
  props: Readonly<Record<string, FalPropSpec>>;
}

/**
 * How an endpoint lets a caller state output geometry and duration.
 *
 * The unified adapters branch on these and NEVER on the endpoint id: one
 * branch per class is a readable adapter that a new endpoint joins for free,
 * while one branch per endpoint is a hundred-arm switch and a declaration file
 * to match. An endpoint whose geometry parameters fit none of these fails
 * codegen rather than falling through to a default.
 */
export type FalShapeClass =
  /** `image_size`: `anyOf[{ width, height }, preset enum]` — flux and friends. */
  | "imageSizeUnion"
  /** `image_size` as a bare preset enum, with no explicit-dimensions arm. */
  | "imageSizePresets"
  /** Separate `width` and `height` numbers. */
  | "dimensionPair"
  /** `aspect_ratio`, usually a closed enum of `"16:9"`-style strings. */
  | "aspectRatioEnum"
  /** `resolution`, a closed enum (`"720p"`, `"1K"`, `"4k"`). */
  | "resolutionEnum"
  /** `upscale_factor` / `scale` — a multiplier rather than a target size. */
  | "scaleFactor"
  /** `duration` as a STRING enum (`"5"` at kling, `"8s"` at veo). */
  | "durationStringEnum"
  /** `duration` as a number. */
  | "durationNumber"
  /** No geometry or duration parameter at all — the endpoint decides. */
  | "fixedGeometry";

/**
 * What one endpoint offers the unified layer.
 *
 * This is both halves of the narrowing: `classes` is what the adapter branches
 * on, and the rest IS the row `modelParams` publishes — the same object, not a
 * copy of it. A row here that disagreed with the table a picker renders would
 * be exactly the drift `unmodel/fal/values` exists to make impossible, so
 * there is only ever one.
 */
export interface FalParamShape {
  /** Every geometry/duration class this endpoint exhibits, sorted. */
  classes: readonly FalShapeClass[];
  /** fal's own parameter list, in fal's own order. */
  keys: readonly string[];
  /**
   * The literal `size` values this endpoint takes — fal's own preset names
   * (`"landscape_4_3"`), which are what the wire accepts rather than a
   * translation of it. No free-form tail: explicit pixels reach the same
   * endpoint through `dimensions`, so for THIS spelling the list is the limit.
   */
  sizes?: readonly string[];
  /** The canonical `W:H` ratios this endpoint's `aspect_ratio` enum lists. */
  ratios?: readonly string[];
  /**
   * The ratio list is a set of presets rather than a limit — fal declared the
   * enum open (`anyOf[{enum}, {string}]`), so any `W:H` is accepted.
   */
  ratioFreeform?: true;
  /** The canonical tiers this endpoint's `resolution` enum can express. */
  tiers?: readonly string[];
  /**
   * Canonical tier → the spelling this endpoint's own `resolution` enum uses.
   *
   * fal writes `"1K"` and the canonical vocabulary writes `"1k"`, so an
   * adapter that has resolved a caller's tier still needs the way back to the
   * wire. Generated rather than lower-cased at run time because the two
   * vocabularies agree by coincidence rather than by rule — `"0.5K"` has no
   * canonical tier at all, and a future endpoint may spell one differently
   * again.
   */
  tierWire?: Readonly<Record<string, string>>;
  /**
   * The per-dimension bounds on an explicit `image_size: { width, height }`,
   * so a ratio can be solved into pixels this endpoint accepts.
   */
  pixels?: { min?: number; max?: number };
  /**
   * Numeric bounds on the CANONICAL params, keyed by wire name.
   *
   * So an adapter can respect a floor rather than send a value the endpoint
   * refuses. `fal-ai/flux/dev/image-to-image` floors `strength` at 0.01 while
   * the canonical scale starts at 0, and canonical 0 — "keep the source" — is
   * the commonest thing anyone asks an image-to-image route for.
   */
  bounds?: Readonly<Record<string, { min?: number; max?: number }>>;
  /**
   * Everything this endpoint takes that the canonical vocabulary has no word
   * for, as `{ wireName: EXTRA as T }` — keys for `applyExtras` to read at run
   * time, types for an editor to offer. See `core/unified/vocabulary/model-params.ts`.
   */
  extras?: Readonly<Record<string, unknown>>;
}
