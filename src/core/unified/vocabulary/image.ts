/**
 * `unmodel/image` — the canonical vocabulary for text-to-image.
 *
 * Types only; the compilation lives in each provider's adapter and the shared
 * derivations in `../derive.ts`.
 */
import type { ExactKeys } from "../../request";
import type { ValidateOptions } from "../../options";
import type { ValidateResult } from "../../result";
import type {
  AnyUnifiedAdapter,
  UnifiedAdapter,
  UnifiedInput,
  UnifiedRef,
  UnifiedResult,
} from "../types";
import type {
  AspectRatio,
  Dimensions,
  ImageOutputFormat,
  OutputDelivery,
  ProviderOptions,
  ResolutionTier,
} from "./common";
import type {
  ModelExtras,
  ModelParamTable,
  ModelSizing,
  WithModelParams,
} from "./model-params";

export type {
  AspectRatio,
  AspectRatioPreset,
  Dimensions,
  ImageOutputFormat,
  OutputDelivery,
  ProviderOptions,
  ResolutionTier,
} from "./common";

export type {
  ModelExtras,
  ModelParams,
  ModelParamTable,
  ModelParamsFor,
  ModelSizing,
  RatioOf,
  SizeOf,
  TierOf,
  WithModelParams,
} from "./model-params";

/** Everything that is not part of the size decision. */
interface ImageParamsBase {
  /** What to draw. */
  prompt: string;
  /** `"provider/model"`, split on the **first** slash. */
  model: string;
  /**
   * How big, as a tier. Combined with the shape (`aspectRatio` or
   * `dimensions`) this is enough to produce every provider's spelling of size:
   * an enum, a grid-snapped pixel pair, or a free-form `WxH` string.
   */
  resolution?: ResolutionTier;
  /** How many images. Providers that generate exactly one reject anything else. */
  n?: number;
  seed?: number;
  /** What to avoid. Providers with no negative-prompt field report it unsupported. */
  negativePrompt?: string;
  outputFormat?: ImageOutputFormat;
  /** URL or inline bytes. Most providers offer one and reject the other. */
  outputDelivery?: OutputDelivery;
  providerOptions?: ProviderOptions;
}

/**
 * A text-to-image request.
 *
 * ## Why the shape is a union
 *
 * `size`, `aspectRatio` and `dimensions` are three spellings of one decision,
 * and the XOR is expressed in the type rather than checked at runtime because
 * the runtime check comes too late to help: by then the caller has already
 * written a request that cannot mean anything. `dimensions?: never` on the
 * ratio arm is what makes `{ aspectRatio: "16:9", dimensions: { … } }` a
 * compile error instead of a coin flip about which one the adapter reads.
 *
 * JavaScript callers, and anyone who casts, still get an `invalid_shape` from
 * `resolveSizing` — the type is the first line of defence, not the only one.
 *
 * Written as a union of three **complete** object types rather than the shorter
 * `Base & (ArmA | ArmB | ArmC)`. The two are equivalent to assign to, but only
 * the first is a union at the top level — and a distributive `Omit` (which is
 * what `UnifiedInput` applies to substitute `model` with the ref union)
 * flattens the shorter form back into a single object with every field
 * optional, silently deleting the one invariant this type exists to state.
 *
 * ## Why `size` is a string and not a third object
 *
 * Because it is what the provider docs, the dashboards and the models
 * themselves call it: `"3840x2160"`, one token, autocompletable. `dimensions`
 * remains for the case where the numbers are computed, and the two are the
 * same decision — `resolveSizing` parses a `WxH` `size` into a `Dimensions`
 * and hands adapters the pair they already know how to compile, so a `size`
 * costs nothing per adapter and lands in the same six derivation classes.
 */
export type ImageParams =
  | (ImageParamsBase & {
      /**
       * The provider's own spelling of size — `"1024x1536"`, `"3840x2160"`,
       * or the literal a model takes instead (`"auto"`). Narrows to *this
       * model's* presets when the ref is a literal.
       */
      size?: string;
      aspectRatio?: never;
      dimensions?: never;
    })
  | (ImageParamsBase & { size?: never; aspectRatio?: AspectRatio; dimensions?: never })
  | (ImageParamsBase & { size?: never; aspectRatio?: never; dimensions?: Dimensions });

// ---------------------------------------------------------------------------
// Per-model narrowing
// ---------------------------------------------------------------------------

/**
 * An image adapter, parameterized by its per-model table.
 *
 * The table is the single source of three things — the caller's `size` /
 * `aspectRatio` / `resolution` unions, the extras a model takes, and the
 * run-time roster `applyExtras` refuses an out-of-model extra against — for
 * exactly the reason `transcribe`'s `audioInputs` is one array: a second
 * declaration is a second thing to keep in step, and this one has to be right
 * in an editor *and* on the wire.
 */
export interface ImageAdapterFor<
  T extends ModelParamTable,
  Wire extends object = object,
  Out extends object = object,
> extends UnifiedAdapter<ImageParams, Wire, Out>,
    WithModelParams<T> {
  readonly category: "image";
}

/**
 * The loosest image adapter that still pins the vocabulary.
 *
 * `modelParams` is **optional** here and required on {@link ImageAdapterFor},
 * which is the split that matters: every adapter unmodel ships declares one,
 * and a third-party adapter that does not is still a legal argument to
 * `createImage` — its refs simply degrade to the wide vocabulary, which is
 * exactly what an unknown model already does.
 */
export type AnyImageAdapter = AnyUnifiedAdapter<ImageParams> & {
  readonly category: "image";
  readonly modelParams?: ModelParamTable;
};

/**
 * `image()` — {@link UnifiedRef}-driven like every category validator, plus the
 * per-**model** narrowing this category needs.
 *
 * ## Why there are two type parameters
 *
 * `M` exists so the narrowing can live in `T`'s **constraint** rather than in
 * an intersection on the parameter, and that is a message-quality decision
 * with teeth. `transcribe` narrows one *required object* field, where an
 * intersection reports fine. These narrow *unit unions* — and `T & { aspectRatio?: "16:9" | … }`
 * against a `T` whose `aspectRatio` is `"4:3"` gives an intersection with a
 * discriminant property of type `never`, which TypeScript reduces to `never`
 * **whole**: three errors, the first of them on `model`, none of them naming
 * the ratios the model does take.
 *
 * Inferring `M` from `params.model` first and constraining `T` by it produces
 * the one error a caller wants:
 *
 * ```
 * Type '"4:3"' is not assignable to type '"1:1" | "2:3" | … | "9:21" | undefined'.
 * ```
 *
 * `M` is constrained to `UnifiedRef<A> | (string & {})` rather than to
 * `string`, because the `model` completion list comes from that constraint —
 * the same open union `UnifiedInput` declares, for the same reason.
 *
 * `ModelExtras` appears twice, and both are load-bearing. In `ExactKeys` it
 * *admits* the model's extras as legal keys (without it, `background` reads as
 * a typo); in `T`'s constraint it *types* them (without it, `background` would
 * be `unknown` and `"transparent"` would compile on `gpt-image-2`).
 *
 * ```ts
 * image({ model: "openai/gpt-image-2", prompt, size: "3840x2160" });        // ok
 * image({ model: "openai/gpt-image-1", prompt, background: "transparent" }); // ok
 * image({ model: "openai/gpt-image-2", prompt, background: "transparent" }); // error
 * image({ model: "openai/dall-e-3",    prompt, size: "1920x1080" });         // error
 * ```
 */
export interface ImageValidator<A> {
  <
    M extends UnifiedRef<A> | (string & {}),
    T extends UnifiedInput<ImageParams, UnifiedRef<A>> & ModelSizing<A, M> & ModelExtras<A, M>,
  >(
    params: T &
      { model: M } &
      ExactKeys<T, UnifiedInput<ImageParams, UnifiedRef<A>> & ModelExtras<A, M>>,
    options?: ValidateOptions,
  ): UnifiedResult<A, M>;
  safe<
    M extends UnifiedRef<A> | (string & {}),
    T extends UnifiedInput<ImageParams, UnifiedRef<A>> & ModelSizing<A, M> & ModelExtras<A, M>,
  >(
    params: T &
      { model: M } &
      ExactKeys<T, UnifiedInput<ImageParams, UnifiedRef<A>> & ModelExtras<A, M>>,
    options?: ValidateOptions,
  ): ValidateResult<UnifiedResult<A, M>>;
  /** Every provider id registered on this validator, sorted. */
  readonly providers: readonly string[];
}
