/**
 * Per-**model** typing, for every category that needs it.
 *
 * ## The problem this solves
 *
 * `transcribe` narrows one field per *adapter* (`audioInputs`), and that is
 * enough there because a provider's routes agree about how audio arrives. The
 * image and video categories do not have that luxury: `gpt-image-2` takes a
 * free-form `size` up to 3840 px and a `background` that is `"opaque" | "auto"`,
 * while `gpt-image-1` — same provider, same endpoint — takes a three-value
 * `size` enum and a `background` that also accepts `"transparent"`. One
 * adapter, two different request surfaces, and the difference is the model id.
 * Video is the same story twice over: `sora-2` renders 720p and `sora-2-pro`
 * adds 1080p, `kling-v2-5-turbo` runs 5 or 10 seconds and `kling-v3` runs any
 * integer from 3 to 15.
 *
 * So the unit of declaration here is the **model**, not the adapter: each
 * adapter carries a `modelParams` table keyed by bare model id, and
 * {@link ModelParamsFor} resolves `model: "openai/gpt-image-2"` to that row.
 *
 * ## One mechanism, per-category rows
 *
 * The half that is category-agnostic — a row's {@link EXTRA} witnesses, the
 * ref → row lookup, the extras derivations — is declared once, over
 * {@link ModelParamsBase}. Each category then extends that base with the fields
 * its own vocabulary narrows ({@link ModelParams} for the two image surfaces,
 * {@link VideoModelParams} for video) and gets its own derivations. Adding a
 * seventh category means adding a row interface and its derivations, not a
 * second copy of the lookup.
 *
 * ## One table, three consumers
 *
 * The table is a *value* (`as const`), and everything else is read off it with
 * `typeof`. That is the repo's established pattern for anything that has to be
 * true at both compile time and run time, and here it has three readers:
 *
 * | reader | what it takes |
 * |---|---|
 * | the caller's types | `sizes` → the `size` union, `ratios` → `aspectRatio`, `tiers` → `resolution`, `extras` → the per-model extra params |
 * | the adapter's `compile` | `extras`' **keys**, to identity-copy them onto the wire and to refuse one the model does not take |
 * | the preset sweep | `sizes`, to prove every value an editor suggests is one the provider's own validator accepts |
 *
 * A second declaration could not be kept in step with the first, and the
 * autocomplete promise is only worth anything if the suggestions are provably
 * valid — which is what the third reader checks.
 *
 * ## Why `extras` is an object of type witnesses
 *
 * An extra needs two things: a name at run time, and an exact type at compile
 * time. A `readonly string[]` gives the first and not the second; a `type`
 * alias gives the second and not the first. So `extras` is an object whose
 * **keys** are the wire param names and whose **values** are
 * {@link EXTRA} — a `never` that is `undefined` at run time — cast to the type
 * that param takes:
 *
 * ```ts
 * const GPT_IMAGE_2_EXTRAS = {
 *   background: EXTRA as "opaque" | "auto" | null,
 *   quality: EXTRA as GptImageQuality,
 * } as const;
 * ```
 *
 * `Object.keys` sees two names; `typeof` sees two exact types; and the cast can
 * name a type the provider's own wire module already exports, so the unified
 * surface and the hand-written one cannot disagree about what `quality` is.
 * What it costs at run time is one object literal of `undefined`s per model —
 * which minifies to about as little as a name list would.
 */
import type {
  AdapterFor,
  RefModel,
} from "../types";
import type { AspectRatio, Dimensions, ResolutionTier, VideoResolution } from "./common";

/**
 * What every category's row carries: the params the canonical vocabulary has no
 * word for.
 *
 * The shared half of a row, and the reason the ref → row lookup and the extras
 * derivations below are written once rather than once per category.
 */
export interface ModelParamsBase {
  /**
   * The non-canonical params this model takes, as `{ wireName: EXTRA as T }`.
   * See the module header for why the values are witnesses.
   */
  readonly extras?: Readonly<Record<string, unknown>>;
}

/**
 * The loosest per-model table — the constraint on {@link WithModelParams}, so
 * that one ref → row lookup serves every category.
 *
 * `object` and **not** `ModelParamsBase`, which is the shape it means: a row is
 * a category's own row type, and every one of those is `ModelParamsBase` plus
 * that category's fields. Writing the constraint that way would be exactly
 * wrong, because `ModelParamsBase` is a *weak* type — every property optional —
 * and TypeScript refuses to assign an object with no properties in common to
 * one. A row that declares `{ durations, resolutions, ratios }` and no `extras`
 * is precisely that object, so `WithModelParams<infer T>` would fail to match
 * the adapter, `ModelParamsFor` would answer `never`, and every model would
 * silently degrade to the wide vocabulary with tsc perfectly happy. (Measured;
 * it is the same class of failure as the `& {}` one `SizingArms` documents —
 * green build, dead narrowing.)
 *
 * A category's own table type (`ModelParamTable`, `VideoModelParamTable`) is
 * what an adapter's `satisfies` clause names, and that is where a row is
 * actually checked field by field.
 */
export type AnyModelParamTable = Readonly<Record<string, object>>;

/**
 * One image model's request surface, beyond the canonical vocabulary every
 * model has.
 *
 * Every field is optional, and **absent means different things on purpose**:
 *
 * - no `sizes` → this model has no `size` spelling at all, so the caller's
 *   `size` types as `never` and an editor steers them to `aspectRatio`
 *   instead. (Run time stays permissive: `size` on a ratio-only model is
 *   converted by `pixelsToRatio`, with the warning that conversion always
 *   carries.)
 * - no `ratios` → the model's ratio vocabulary is *derived* rather than
 *   enumerated (OpenAI has no `aspect_ratio` field; the adapter turns a ratio
 *   into a `size`), so `aspectRatio` keeps the wide {@link AspectRatio}.
 * - no `tiers` → likewise for `resolution`.
 *
 * The asymmetry is the honest one: a missing size *list* means the field does
 * not exist, while a missing ratio list means the field is computed.
 */
export interface ModelParams extends ModelParamsBase {
  /**
   * The `WxH` values this model accepts, plus any literal it takes instead
   * (`"auto"`). Curated for the free-form models, exhaustive for the enums —
   * `test/unified/image-presets.test.ts` proves both by compiling every one.
   */
  readonly sizes?: readonly string[];
  /**
   * Whether a `WxH` outside {@link sizes} is legal — S4 free-form and S2
   * pixel-pair models. Adds the `` `${number}x${number}` `` tail to the `size`
   * union; a closed S3 enum deliberately gets no tail, because there the list
   * *is* the limit and a template tail would promise otherwise.
   */
  readonly sizeFreeform?: boolean;
  /** The ratio spellings this model accepts, in canonical `W:H` form. */
  readonly ratios?: readonly string[];
  /**
   * Whether a ratio outside {@link ratios} is legal — the S5 models, whose
   * wire field is any `W:H` inside a numeric range and whose list is a set of
   * presets rather than an enum.
   */
  readonly ratioFreeform?: boolean;
  /** The canonical tiers this model can express. */
  readonly tiers?: readonly ResolutionTier[];
}

/** An image adapter's per-model table, keyed by **bare** model id. */
export type ModelParamTable = Readonly<Record<string, ModelParams>>;

/**
 * One video model's request surface, beyond the canonical vocabulary.
 *
 * Absent means "the canonical field keeps its wide type", uniformly — the
 * asymmetry `ModelParams.sizes` carries has no analogue here, because every
 * field a video row narrows is a field the vocabulary already has. What says
 * "this model has no such field at all" is an **empty** list: `ratios: []`
 * types `aspectRatio` as `never`, which is the compile-time half of the
 * `unsupported_param` a Hailuo model raises for it at run time.
 */
export interface VideoModelParams extends ModelParamsBase {
  /**
   * The clip lengths this model offers, **in seconds**, as a closed enum.
   *
   * Absent means the model's lengths are a *range* rather than a list — every
   * integer from 4 to 30 on Seedance 2.5, 1 to 16 on Vidu q3 — and `duration`
   * then keeps the wide `number`. That is the one place this row is not simply
   * "list or wide vocabulary": a range genuinely cannot be a union, and
   * pretending otherwise would put 27 literals in a completion list to describe
   * a `>=` check.
   *
   * When it is present it is exhaustive, so the union carries **no** template
   * tail: the list *is* the limit, and `duration: 7` on `sora-2` is a compile
   * error naming 4, 8, 12, 16 and 20.
   */
  readonly durations?: readonly number[];
  /**
   * The canonical tiers this model can express — after the adapter's own
   * mapping, so `720p` is here for a model whose wire spells it `"768P"` or
   * `"std"`. Empty means the model has no size field at all.
   */
  readonly resolutions?: readonly VideoResolution[];
  /**
   * The shapes this model accepts, in canonical `W:H` form. Every video wire in
   * this build publishes a closed list (a pixel-pair enum still reduces to a
   * finite set of shapes), so — unlike the image row — there is no `freeform`
   * flag and the union carries no template tail. Empty means the model has no
   * aspect-ratio field.
   */
  readonly ratios?: readonly string[];
}

/** A video adapter's per-model table, keyed by **bare** model id. */
export type VideoModelParamTable = Readonly<Record<string, VideoModelParams>>;

/** An adapter that carries one. Every narrowing category's adapter type extends it. */
export interface WithModelParams<T extends AnyModelParamTable = AnyModelParamTable> {
  readonly modelParams: T;
}

// ---------------------------------------------------------------------------
// Ref → row
// ---------------------------------------------------------------------------

/**
 * The row a bare model id selects on one adapter, or `never`.
 *
 * `A` is naked so this distributes: a ref that is not a literal selects *every*
 * adapter (see `AdapterFor`), and every one of them answers `never` for a model
 * id it does not have — which collapses the whole thing to `never` and is
 * exactly the signal {@link ModelSizing} and {@link ModelExtras} degrade on.
 */
type RowOf<A, M extends string> = A extends WithModelParams<infer T>
  ? M extends keyof T
    ? T[M]
    : never
  : never;

/**
 * The row a `"provider/model"` ref selects — `never` when the ref is dynamic,
 * names a provider with no adapter, or names a model this build does not know.
 *
 * All three degrade to the wide vocabulary, which is the same trade every model
 * list in this library makes: the union drives autocomplete, it does not gate
 * the API, and a model released after this snapshot must stay callable.
 */
export type ModelParamsFor<A, R extends string> = RowOf<AdapterFor<A, R>, RefModel<R>>;

// ---------------------------------------------------------------------------
// Row → extras — the half every category shares
// ---------------------------------------------------------------------------

/** `extras` → the optional per-model params, with their exact types. */
type ExtrasOf<Row> = Row extends { readonly extras: infer X }
  ? { -readonly [K in keyof X]?: X[K] }
  : // `unknown`, not `{}`: this lands in an intersection on both of its call
    // sites, and an intersection with `unknown` is the no-op both want.
    unknown;

/** Every extra name any model on any adapter in this build declares. */
type ExtraKeysOf<Row> = Row extends { readonly extras: infer X } ? Extract<keyof X, string> : never;
type AnyExtraKey<A> = A extends WithModelParams<infer T> ? ExtraKeysOf<T[keyof T]> : never;

/**
 * The extras one ref admits.
 *
 * Degraded — dynamic ref, unknown provider, unknown model — it becomes *every*
 * extra name in the build, typed `unknown`. That is the honest widening: the
 * type cannot say which model this is, so it must not claim `background` is
 * illegal; but it can still say `bakcground` is, which is the half of
 * `ExactKeys` worth keeping.
 */
export type ModelExtras<A, R extends string> = [ModelParamsFor<A, R>] extends [never]
  ? { [K in AnyExtraKey<A>]?: unknown }
  : ExtrasOf<ModelParamsFor<A, R>>;

// ---------------------------------------------------------------------------
// Image / imageEdit: row → the caller's types
// ---------------------------------------------------------------------------

/** `sizes` → the `size` union, with the template tail only where the wire is open. */
export type SizeOf<Row> = Row extends { readonly sizes: readonly (infer S extends string)[] }
  ? Row extends { readonly sizeFreeform: true }
    ? S | (`${number}x${number}` & {})
    : S
  : never;

/** `ratios` → the `aspectRatio` union; absent keeps the wide one. */
export type RatioOf<Row> = Row extends { readonly ratios: readonly (infer R extends string)[] }
  ? Row extends { readonly ratioFreeform: true }
    ? R | (`${number}:${number}` & {})
    : R
  : AspectRatio;

/** `tiers` → the `resolution` union; absent keeps all three. */
export type TierOf<Row> = Row extends {
  readonly tiers: readonly (infer T extends ResolutionTier)[];
}
  ? T
  : ResolutionTier;

/**
 * The size/aspectRatio/dimensions XOR with per-model members. This is a
 * complete **replacement** for the vocabulary's own three arms, not a set of
 * per-field narrowings to intersect with them — and that is the load-bearing
 * decision of this module:
 *
 * `SizeOf` unions carry `` (`${number}x${number}` & {}) `` tails, and the
 * `& {}` is what stops TypeScript's union subtype reduction from absorbing
 * every `"WxH"` preset into the template. Intersecting that union with the
 * wide arm's `size?: string` **discharges the `& {}`** during intersection
 * normalization (`` `T` & {} & string `` reduces to `` `T` ``), a bare
 * template survives in the union, subtype reduction eats every preset, and
 * the editor completes nothing but `"auto"`. Measured with the real language
 * service; pinned by `test/unified/completions.test.ts`. Replacing the arms
 * outright means the narrowed union is the only source of `size`'s contextual
 * type, so the presets survive to the completion list — which is the entire
 * point of carrying them.
 */
type SizingArms<Size, Ratio> =
  | { size?: Size; aspectRatio?: never; dimensions?: never }
  | { size?: never; aspectRatio?: Ratio; dimensions?: never }
  | { size?: never; aspectRatio?: never; dimensions?: Dimensions };

/** The wide arms, restated for the degraded (dynamic/unknown-ref) case. */
type WideSizingArms = SizingArms<string, AspectRatio>;

/**
 * The sizing decision one ref admits, as complete XOR arms (see
 * {@link SizingArms} for why they replace the vocabulary's own arms instead
 * of intersecting them). Degraded — dynamic ref, unknown provider, unknown
 * model — it restates the wide arms, so the XOR invariant holds for every
 * caller and a model released after this snapshot stays callable.
 */
export type ModelSizing<A, R extends string> = [ModelParamsFor<A, R>] extends [never]
  ? WideSizingArms & { resolution?: ResolutionTier }
  : SizingArms<SizeOf<ModelParamsFor<A, R>>, RatioOf<ModelParamsFor<A, R>>> & {
      resolution?: TierOf<ModelParamsFor<A, R>>;
    };

/**
 * {@link ModelSizing} without the tier — for `imageEdit`, whose vocabulary has
 * no `resolution` because the overwhelmingly common answer to "how big" when
 * editing is "the size it already was".
 */
export type ModelShape<A, R extends string> = [ModelParamsFor<A, R>] extends [never]
  ? WideSizingArms
  : SizingArms<SizeOf<ModelParamsFor<A, R>>, RatioOf<ModelParamsFor<A, R>>>;

// ---------------------------------------------------------------------------
// Video: row → the caller's types
// ---------------------------------------------------------------------------

/**
 * `durations` → the `duration` union; absent keeps the wide `number`.
 *
 * **No template tail, ever.** `SizeOf`'s `` (`${number}x${number}` & {}) `` is
 * there because a free-form `size` genuinely accepts values outside its preset
 * list; a duration list is a *closed enum* — five values on Sora, two on Luma —
 * and a model whose lengths are open declares no `durations` at all and gets
 * the wide `number`. So the two cases are "these exactly" and "any number",
 * with nothing in between to spell.
 */
export type VideoDurationOf<Row> = Row extends {
  readonly durations: readonly (infer D extends number)[];
}
  ? D
  : number;

/** `resolutions` → the `resolution` union; absent keeps all five tiers. */
export type VideoResolutionOf<Row> = Row extends {
  readonly resolutions: readonly (infer R extends VideoResolution)[];
}
  ? R
  : VideoResolution;

/**
 * `ratios` → the `aspectRatio` union; absent keeps the wide {@link AspectRatio}.
 *
 * A plain literal union with no `` (`${number}:${number}` & {}) `` tail, which
 * is the difference from {@link RatioOf}: every video wire in this build
 * publishes a closed shape list — even Runway, whose `ratio` members are pixel
 * pairs, reduces to a finite set of shapes — so a tail would promise a
 * freedom none of them has. The *degraded* case keeps `AspectRatio` and
 * therefore keeps its tail, which is why this must never be intersected with
 * the wide vocabulary: see {@link SizingArms} for what that costs.
 */
export type VideoRatioOf<Row> = Row extends {
  readonly ratios: readonly (infer R extends string)[];
}
  ? R
  : AspectRatio;

/**
 * The three fields a video row narrows, as a complete **replacement** for the
 * vocabulary's own.
 *
 * Same rule as {@link SizingArms}, and for the same measured reason: the
 * degraded arm restates `AspectRatio`, whose `` (`${number}:${number}` & {}) ``
 * tail is discharged the moment it is intersected with a narrowed literal
 * union — after which subtype reduction eats every preset and `aspectRatio:`
 * completes nothing. `VideoParamsBase` therefore omits all three fields, so
 * this is the only source of their contextual type.
 */
type VideoArms<Duration, Resolution, Ratio> = {
  duration?: Duration;
  resolution?: Resolution;
  aspectRatio?: Ratio;
};

/**
 * The duration / resolution / shape one ref admits. Degraded — dynamic ref,
 * unknown provider, unknown model — it restates the wide vocabulary, so a model
 * released after this snapshot stays callable.
 */
export type VideoModelNarrowing<A, R extends string> = [ModelParamsFor<A, R>] extends [never]
  ? VideoArms<number, VideoResolution, AspectRatio>
  : VideoArms<
      VideoDurationOf<ModelParamsFor<A, R>>,
      VideoResolutionOf<ModelParamsFor<A, R>>,
      VideoRatioOf<ModelParamsFor<A, R>>
    >;
