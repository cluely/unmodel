/**
 * Per-**model** typing, for every category that needs it.
 *
 * ## The problem this solves
 *
 * `stt` narrows one field per *adapter* (`audioInputs`), and that is
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
 * {@link VideoModelParams}, {@link TtsModelParams},
 * {@link SttModelParams}, {@link MusicModelParams}) and gets its own
 * derivations. Adding a seventh category means adding a row interface and its
 * derivations, not a second copy of the lookup.
 *
 * ## One table, three consumers
 *
 * The table is a *value* (`as const`), and everything else is read off it with
 * `typeof`. That is the repo's established pattern for anything that has to be
 * true at both compile time and run time, and here it has three readers:
 *
 * | reader | what it takes |
 * |---|---|
 * | the caller's types | `sizes` → the `size` union, `ratios` → `aspectRatio`, `tiers` / `resolutions` → `resolution`, `durations` → `duration`, `codecs` → `outputFormat`, `languages` → `language`, `timestamps` → `timestamps`, `extras` → the per-model extra params |
 * | the adapter's `compile` | `extras`' **keys**, to identity-copy them onto the wire and to refuse one the model does not take |
 * | the preset sweep | every list, to prove each value an editor suggests is one the provider's own validator accepts |
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
import type { AudioFormat, AudioFormatCodec, AudioFormatRequest } from "./audio";
import type { AspectRatio, Dimensions, ResolutionTier, VideoResolution } from "./common";
// Type-only, and therefore fine that `./stt` imports this file back: an
// `import type` is erased before emit, so the cycle exists only in the checker,
// which resolves it. The alternative — moving the granularity union into
// `./common` — would file a transcription word under "shared vocabulary" purely
// to dodge an edge the language handles.
import type { TimestampGranularity } from "./stt";
// Same type-only cycle as `./stt` above, and for the same reason: the
// word belongs to the speech vocabulary, and filing it under "shared" purely to
// dodge an edge the checker handles would misplace it.
import type { Voice } from "./tts";

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

/**
 * One speech model's request surface, beyond the canonical vocabulary.
 *
 * ## What is here, and what deliberately is not
 *
 * Two fields, because two are what a *type* can state honestly about a
 * text-to-speech request:
 *
 * - **`codecs`** is a closed set at every one of the fourteen providers. A
 *   codec the endpoint has no spelling for is an error, never an approximation,
 *   so the list is the limit in both directions and the union carries no tail.
 * - **`languages`** is a closed set on the wire and an *open* one in the
 *   vocabulary — see {@link LanguageOf}.
 *
 * **`sampleRate` and `bitrate` are not here, on purpose.** They are the
 * category's real complexity and the one shape a per-model row cannot carry: at
 * ElevenLabs they are a *composite enum* (`mp3_22050_32` exists, `mp3_22050_128`
 * does not — the legal pairs are not the cross product), at Cartesia and MiniMax
 * they are per-codec lists whose validity depends on the codec chosen in the
 * same object, and at Deepgram opus takes a bitrate anywhere in 4–650 kbps,
 * which is a range. Typing any of that would mean either a matrix type keyed on
 * a sibling property or a union of several hundred members — for a check
 * `AudioFormatSpec` already performs at run time, with a message that names the
 * rates the codec *does* take. So the row narrows the codec, and the sample
 * rate stays run time's job.
 *
 * **`voice` IS here now, and only where the provider publishes a list.** Voice
 * catalogs are the one part of a TTS API that is genuinely dynamic: they are
 * per-account (every provider here supports cloned voices, which no snapshot
 * can enumerate), they run to thousands of entries at ElevenLabs and Murf, and
 * they turn over between releases. That argument is about the providers whose
 * catalogs are unbounded, and it was never a claim that no provider publishes
 * a list — OpenAI publishes nine for `tts-1` and thirteen for
 * `gpt-4o-mini-tts`, hand-catalogued in this repo and already enforced at the
 * wire, where an off-list voice is a `checkVoice` error naming the list.
 *
 * So {@link voices} is the `languages` model applied to `voice`: a row states
 * a list only when the provider closes one, {@link VoiceOf} keeps the
 * `(string & {})` tail plus both object spellings so a cloned voice never
 * stops compiling, and a row that declares nothing keeps the wide `Voice`
 * unchanged. The thirteen adapters that publish no list are bit-for-bit
 * unaffected — and the one that does stops being *looser* at the unified
 * surface than at the wire surface it compiles down to, which is the invariant
 * `test/unified/completions.test.ts` already asserts for `size`.
 */
export interface TtsModelParams extends ModelParamsBase {
  /**
   * The canonical codecs this model can emit — after the adapter's own mapping,
   * so `pcm_s16le` is here for an endpoint whose wire spells it `"linear16"`,
   * `"pcm"` or `"wav"`. Exhaustive, and therefore closed: an off-list codec is
   * a compile error naming the ones that exist.
   */
  readonly codecs?: readonly AudioFormatCodec[];
  /**
   * The languages this model's language field enumerates, as primary subtags.
   * Absent means the model has no closed list to offer — either the field is
   * free-form or the adapter declares it unsupported.
   */
  readonly languages?: readonly string[];
  /**
   * The model's **built-in** voices, and ONLY where the provider publishes a
   * closed, hand-catalogued list of them.
   *
   * Absent is the normal case and means "this provider's voice space is not
   * enumerable" — a per-account catalog, cloned voices, or thousands of ids
   * that turn over between releases. Absent keeps the wide {@link Voice}
   * exactly as it was; there is no default list and no guessing.
   *
   * Present is a completion list, never a gate: {@link VoiceOf} keeps the
   * `(string & {})` tail and both object spellings, so the caller's own cloned
   * voice compiles beside the presets. That is deliberate — the wire-level
   * check is per model too, and a type stricter than the validator would be a
   * false compile error, the worst failure mode this library has.
   */
  readonly voices?: readonly string[];
}

/** A speech adapter's per-model table, keyed by **bare** model id. */
export type TtsModelParamTable = Readonly<Record<string, TtsModelParams>>;

/**
 * One transcription model's request surface, beyond the canonical vocabulary.
 *
 * The category already narrows one field per **adapter** — `audioInputs`, which
 * decides the shape of `audio` — and that stays exactly where it is. It
 * composes with this one rather than competing: the two narrow different keys
 * through different mechanisms (a route's input shapes are an adapter fact, a
 * granularity set is a model fact), and `SttValidator` intersects both.
 */
export interface SttModelParams extends ModelParamsBase {
  /**
   * The timing detail this route can return. Every entry is a granularity the
   * caller can *ask for* and get; `"none"` is on the list exactly when asking
   * for plain text is expressible, which is not everywhere — several routes
   * always return word timings and have no switch to turn them off.
   */
  readonly timestamps?: readonly TimestampGranularity[];
  /** The languages this model's language field enumerates. See {@link LanguageOf}. */
  readonly languages?: readonly string[];
}

/** A transcribe adapter's per-model table, keyed by **bare** model id. */
export type SttModelParamTable = Readonly<Record<string, SttModelParams>>;

/**
 * One music model's request surface, beyond the canonical vocabulary.
 *
 * The smallest row in the file, matching the smallest vocabulary: `prompt`,
 * `durationSeconds`, `instrumental` and `seed` are either free-form or booleans,
 * so `outputFormat` is the only canonical word with a per-model enum behind it.
 */
export interface MusicModelParams extends ModelParamsBase {
  /** The canonical codecs this model can emit — same contract as {@link TtsModelParams.codecs}. */
  readonly codecs?: readonly AudioFormatCodec[];
}

/** A music adapter's per-model table, keyed by **bare** model id. */
export type MusicModelParamTable = Readonly<Record<string, MusicModelParams>>;

/**
 * One voice-cloning route's request surface, beyond the canonical vocabulary.
 *
 * The category narrows two things per **adapter** already — `sampleInputs`
 * (the shape of each recording) and `sampleLimits` (how many) — and those
 * stay there: which transport a route takes is an adapter fact. What is a
 * *model* fact is the language space: Cartesia's clone route requires one of
 * 44 codes, so `languages` completes it, open, through {@link LanguageOf}.
 */
export interface VoiceCloneModelParams extends ModelParamsBase {
  /** The languages this route's language field enumerates. See {@link LanguageOf}. */
  readonly languages?: readonly string[];
}

/** A voice-clone adapter's per-model table, keyed by **bare** model id. */
export type VoiceCloneModelParamTable = Readonly<Record<string, VoiceCloneModelParams>>;

/**
 * One voice-design model's request surface, beyond the canonical vocabulary.
 * The same single-field row as its clone sibling, for the same reason.
 */
export interface VoiceDesignModelParams extends ModelParamsBase {
  /** The languages this route's language field enumerates. See {@link LanguageOf}. */
  readonly languages?: readonly string[];
}

/** A voice-design adapter's per-model table, keyed by **bare** model id. */
export type VoiceDesignModelParamTable = Readonly<Record<string, VoiceDesignModelParams>>;

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

// ---------------------------------------------------------------------------
// The three audio categories: row → the caller's types
// ---------------------------------------------------------------------------

/** `codecs` → the codec union; absent keeps every codec the vocabulary has. */
export type CodecOf<Row> = Row extends {
  readonly codecs: readonly (infer C extends AudioFormatCodec)[];
}
  ? C
  : AudioFormatCodec;

/**
 * `codecs` → the whole `outputFormat` type, with **both** spellings narrowed.
 *
 * `AudioFormatRequest` is `AudioFormatCodec | AudioFormat`, and narrowing only
 * the shorthand would leave `{ format: "vorbis" }` compiling at a provider that
 * has never heard of Vorbis — the object form is the one a caller reaches for
 * precisely when they care about the encoding, so it is the half that must not
 * be left wide.
 *
 * Spelled `Omit<AudioFormat, "format"> & { format: C }` rather than
 * `AudioFormat & { format: C }`: the latter leaves two `format` declarations in
 * the intersection and the property's type becomes `AudioFormatCodec & C`,
 * which is a *deferred* intersection — assignability still works, but the
 * contextual type at a `format:` completion position is no longer a plain
 * literal union and the editor's list goes wide. Replacing the property
 * outright is the same rule {@link SizingArms} states, one level down.
 */
export type AudioFormatOf<Row> =
  | CodecOf<Row>
  | (Omit<AudioFormat, "format"> & { format: CodecOf<Row> });

/**
 * `languages` → the `language` union; absent keeps the wide `string`.
 *
 * **Open, unlike every other list in this file**, and the `(string & {})` tail
 * is the whole argument. The canonical `language` is a BCP-47 *tag*, while the
 * wire fields these lists come from are enums of bare primary subtags — so
 * `language: "pt-BR"` is a legal, working request that `toPrimaryLanguage`
 * sends as `"pt"` with an `approximated_param` naming the subtag it could not
 * express (and `"pt_BR"`, which half the world's locale plumbing emits, is
 * accepted too). A closed union would make both of those compile errors: a
 * false negative on a request the library deliberately supports, which is the
 * one failure mode worse than no narrowing at all. Widening the union to
 * `` `${L}-${string}` `` tails instead would triple its size and still lie
 * about the underscore spelling.
 *
 * So the list **completes** and does not gate — exactly what a model ref does,
 * for exactly the reason `UnifiedInput` gives — and the provider's own enum
 * check is what refuses `"xx"`, naming the languages it has.
 */
export type LanguageOf<Row> = Row extends {
  readonly languages: readonly (infer L extends string)[];
}
  ? L | (string & {})
  : string;

/**
 * `voices` → that model's presets, `| (string & {})`, plus both object
 * spellings. Absent restates the wide {@link Voice}.
 *
 * Open for {@link LanguageOf}'s reason and one of its own: every provider in
 * this category supports cloned voices, and the wire-level check that refuses
 * an off-list *string* is itself per model (`checkVoice` skips a model with no
 * table). A closed union here would refuse a working request — so the list
 * completes and does not gate.
 */
export type VoiceOf<Row> = Row extends { readonly voices: readonly (infer V extends string)[] }
  ? V | (string & {}) | { id: string } | { name: string }
  : Voice;

/** `timestamps` → the `timestamps` union; absent keeps all four granularities. */
export type TimestampsOf<Row> = Row extends {
  readonly timestamps: readonly (infer T extends TimestampGranularity)[];
}
  ? T
  : TimestampGranularity;

/**
 * The three fields a speech row narrows, as a complete **replacement** for the
 * vocabulary's own — {@link SizingArms}'s rule, and this category has its own
 * reason to obey it: {@link LanguageOf} and {@link VoiceOf} both carry a
 * `(string & {})` tail, and an intersection with the base's `language?: string`
 * / `voice?: Voice` would discharge the brace, leave a bare `string` in the
 * union, and let subtype reduction eat every code and every preset while tsc
 * stayed green. `TtsParamsBase` therefore omits all three, so this is the
 * only source of their contextual type.
 */
type TtsArms<Format, Language, VoiceArm> = {
  outputFormat?: Format;
  language?: Language;
  voice?: VoiceArm;
};

/**
 * The `outputFormat` / `language` / `voice` triple one ref admits. Degraded —
 * dynamic ref, unknown provider, unknown model — it restates the wide
 * vocabulary.
 */
export type TtsModelNarrowing<A, R extends string> = [ModelParamsFor<A, R>] extends [never]
  ? TtsArms<AudioFormatRequest, string, Voice>
  : TtsArms<
      AudioFormatOf<ModelParamsFor<A, R>>,
      LanguageOf<ModelParamsFor<A, R>>,
      VoiceOf<ModelParamsFor<A, R>>
    >;

/** {@link TtsArms} for transcription: the granularity set and the languages. */
type SttArms<Stamps, Language> = {
  timestamps?: Stamps;
  language?: Language;
};

/**
 * The `timestamps` / `language` pair one ref admits.
 *
 * Composes with — never replaces — this category's *other* narrowing:
 * `AudioNarrowing` types `audio` from the adapter's `audioInputs`, which is a
 * different key reached through a different mechanism, so the two intersect
 * cleanly in `SttValidator`.
 */
export type SttModelNarrowing<A, R extends string> = [ModelParamsFor<A, R>] extends [never]
  ? SttArms<TimestampGranularity, string>
  : SttArms<TimestampsOf<ModelParamsFor<A, R>>, LanguageOf<ModelParamsFor<A, R>>>;

/** The one field a music row narrows. */
type MusicArms<Format> = { outputFormat?: Format };

/** The `outputFormat` one ref admits, restated wide when the ref is degraded. */
export type MusicModelNarrowing<A, R extends string> = [ModelParamsFor<A, R>] extends [never]
  ? MusicArms<AudioFormatRequest>
  : MusicArms<AudioFormatOf<ModelParamsFor<A, R>>>;

/** The one field either voice-creation row narrows. */
type VoiceArms<Language> = { language?: Language };

/**
 * The `language` one voice-clone ref admits, restated wide when the ref is
 * degraded. Composes with — never replaces — the category's *other*
 * narrowing: `SampleNarrowing` types `samples` from the adapter's
 * `sampleInputs`, a different key reached through a different mechanism
 * (stt's `AudioNarrowing` sentence, one field over).
 */
export type VoiceCloneModelNarrowing<A, R extends string> = [ModelParamsFor<A, R>] extends [
  never,
]
  ? VoiceArms<string>
  : VoiceArms<LanguageOf<ModelParamsFor<A, R>>>;

/** The `language` one voice-design ref admits, restated wide when degraded. */
export type VoiceDesignModelNarrowing<A, R extends string> = [ModelParamsFor<A, R>] extends [
  never,
]
  ? VoiceArms<string>
  : VoiceArms<LanguageOf<ModelParamsFor<A, R>>>;
