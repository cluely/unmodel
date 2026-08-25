/**
 * `unmodel/upscale` — the canonical vocabulary for making a frame bigger.
 *
 * Five words, and the shortest argument for its own existence in the library:
 * an upscaler does not invent a picture, it re-renders one you already have at
 * a size you name. There is no `aspectRatio` here because the shape is the
 * input's, no `resolution` because the answer is a MULTIPLE rather than a tier,
 * and no `n` because a super-resolution route returns one output for one input.
 *
 * ## Why it is not an arm of `imageEdit`
 *
 * Two reasons, and the second is the one that settles it.
 *
 * The first is that half of these routes take a VIDEO. `fal-ai/seedvr/upscale/
 * image` and `fal-ai/seedvr/upscale/video` are one vendor's one product behind
 * two paths, and `unmodel/image-edit` has no word for a clip and should not
 * grow one — an "edit" that returns 300 frames is a different operation with
 * different economics, and the category's `image` would have to mean either.
 *
 * The second is `factor`. Editing is described by what you want the result to
 * LOOK like; upscaling is described by how much bigger it should BE, and the
 * two are not the same question. A `factor: 4` request has no meaning in
 * `imageEdit` (there is no size to multiply — the vocabulary says `size` and
 * `aspectRatio`, both absolute), and an `imageEdit` request has no meaning here
 * (there is nothing to change but the pixel count). Folding them together would
 * produce a params type where `factor` is dead for seventeen models and `size`
 * is dead for ten, which is exactly the "valid combinations you have to
 * memorize" the category list exists to avoid.
 *
 * ## `source` is per model, and `factor` is too
 *
 * Which SHAPE a route takes is the same `sources` mechanism `unmodel/lipsync`
 * and `unmodel/avatar` use, pointed at a different question: there it separates
 * a clip from a still across two CATEGORIES, here it separates them inside one.
 * A still handed to a video upscaler is a compile error naming the shape that
 * route takes.
 *
 * `factor` narrows the same way and has three answers, all of them real in this
 * build: a RANGE at most routes (`factor` keeps the wide `number` and the
 * provider's own bounds check catches 12), a closed SET at `fal-ai/aura-sr`
 * (whose `upscale_factor` is a `const 4` — it upscales by four or not at all),
 * and NOTHING at `fal-ai/recraft/upscale/crisp`, which types `factor` as
 * `never` rather than letting a caller ask for a multiplier the route has
 * nowhere to put.
 *
 * ## What is deliberately absent
 *
 * `creativity`, `resemblance`, `denoise`, `sharpen`, `texture`, `detail`,
 * `face_enhancement` — the dials that make one upscaler's output look different
 * from another's. Every one of them is a single vendor's word for a single
 * vendor's knob, and none has a second witness. They ride as per-model
 * `extras`, typed from the endpoint's own wire interface, and get promoted the
 * day two providers spell the same idea the same way.
 *
 * `prompt` is here rather than there for the opposite reason: three of the ten
 * routes in this build steer on one, it means the same thing at all three (what
 * the added detail should be OF), and it is the same word `unmodel/image` and
 * `unmodel/video` already use. It is optional, and a route without one refuses
 * it by name.
 */
import type { ExactKeys } from "../../request";
import type { ValidateOptions } from "../../options";
import type { ValidateResult } from "../../result";
import type {
  AnyUnifiedAdapter,
  SafeUnknown,
  UnifiedAdapter,
  UnifiedInput,
  UnifiedRef,
  UnifiedResult,
} from "../types";
import type { DataRef, ProviderOptions, UrlRef } from "./common";
import type {
  ModelExtras,
  UpscaleModelNarrowing,
  UpscaleModelParamTable,
  WithModelParams,
} from "./model-params";

export type { DataRef, ProviderOptions, UrlRef } from "./common";

export type {
  ModelExtras,
  ModelParamsFor,
  UpscaleFactorOf,
  UpscaleModelNarrowing,
  UpscaleModelParams,
  UpscaleModelParamTable,
  UpscaleSourceOf,
  WithModelParams,
} from "./model-params";

/**
 * The two shapes an upscale source can arrive in, as a tag.
 *
 * A genuine two-member union, unlike its lipsync and avatar cousins where one
 * member is hypothetical: `fal-ai/seedvr/upscale/image` says `["image"]` and
 * `fal-ai/seedvr/upscale/video` says `["video"]`, same vendor, same product,
 * same release. This category is where the mechanism earns its keep.
 */
export type UpscaleSourceKind = "image" | "video";

/**
 * A still to upscale: a URL the provider fetches, or inline bytes with the
 * media type stated.
 *
 * `mimeType` is REQUIRED on the inline arm for `LipsyncVideoSource`'s reason —
 * `{ url }` is `{ url }` whichever medium is behind it, so the type can only
 * speak where the caller does — and because building a `data:` URI needs it.
 */
export type UpscaleImageSource = UrlRef | (DataRef & { mimeType: `image/${string}` });

/** A clip to upscale, for the routes whose source is video rather than a still. */
export type UpscaleVideoSource = UrlRef | (DataRef & { mimeType: `video/${string}` });

/** Something to upscale, in whichever shape the caller has. */
export type UpscaleSource = UpscaleImageSource | UpscaleVideoSource;

/**
 * The `source` type for a route that accepts exactly the kinds in `K`.
 *
 * Written `"image" extends K` rather than `K extends "image"` for
 * `LipsyncSourceFor`'s reason: the former asks "is this kind in the set", the
 * latter distributes and answers a different question for a union `K`.
 */
export type UpscaleSourceFor<K extends UpscaleSourceKind> =
  | ("image" extends K ? UpscaleImageSource : never)
  | ("video" extends K ? UpscaleVideoSource : never);

/**
 * Everything that is not narrowed per model.
 *
 * `source` and `factor` are omitted here on purpose — the replacement-arm law
 * (`SizingArms` in `./model-params.ts`): {@link UpscaleModelNarrowing}
 * REPLACES both rather than intersecting with them. A base that still declared
 * `source: UpscaleSource` would put the wide union back into the intersection
 * and a still sent to a video route would go on compiling; a base that still
 * declared `factor?: number` would do the same to the `never` arm.
 */
export interface UpscaleParamsBase {
  /** `"provider/model"`, split on the **first** slash. */
  model: string;
  /**
   * What the added detail should be of, where the route steers on one.
   *
   * Optional and per-route: three of the ten endpoints in this build take a
   * prompt and seven do not, so a route without one refuses it by name rather
   * than dropping it.
   */
  prompt?: string;
  providerOptions?: ProviderOptions;
}

/**
 * An upscale request, with `source` and `factor` at their widest — the type an
 * adapter's `compile` is written against, and the type a caller with a
 * run-time-built ref gets.
 */
export interface UpscaleParams extends UpscaleParamsBase {
  /** The image or clip to enlarge. */
  source: UpscaleSource;
  /**
   * How many times bigger, as a multiplier: `2` doubles each dimension.
   *
   * A multiplier and not a target size, because that is what every upscaler in
   * this build actually takes and because a target is not expressible without
   * knowing the input's dimensions — which a request never carries, since the
   * input arrives as a URL. A route with a target-resolution mode reaches it
   * through `providerOptions`.
   */
  factor?: number;
}

// ---------------------------------------------------------------------------
// Per-model narrowing
// ---------------------------------------------------------------------------

/** An upscale adapter, parameterized by its per-model table. */
export interface UpscaleAdapterFor<
  T extends UpscaleModelParamTable,
  Wire extends object = object,
  Out extends object = object,
> extends UnifiedAdapter<UpscaleParams, Wire, Out>,
    WithModelParams<T> {
  readonly category: "upscale";
}

/**
 * The loosest upscale adapter that still pins the vocabulary. `modelParams` is
 * optional here and required on {@link UpscaleAdapterFor}, so a third-party
 * adapter without one is a legal argument to `createUpscale` and simply
 * degrades to the wide vocabulary.
 */
export type AnyUpscaleAdapter = AnyUnifiedAdapter<UpscaleParams> & {
  readonly category: "upscale";
  readonly modelParams?: UpscaleModelParamTable;
};

/**
 * `upscale()` — {@link UnifiedRef}-driven like every category validator, plus
 * the per-**model** `source` and `factor` narrowing this category is built
 * around.
 *
 * Two type parameters for `LipsyncValidator`'s reason: `M` is inferred from
 * `params.model` first and `T` is constrained by it, so a clip handed to an
 * image-only route produces one error, on `source`, naming the shape that route
 * takes — rather than an intersection reduced to `never` and three errors, the
 * first of them on `model`.
 *
 * ```ts
 * upscale({ model: "fal/fal-ai/clarity-upscaler", source: { url }, factor: 2 });        // ok
 * upscale({ model: "fal/fal-ai/seedvr/upscale/video", source: { url }, factor: 2 });    // ok
 * upscale({ model: "fal/fal-ai/aura-sr", source: { url }, factor: 2 });                 // error: 4 only
 * upscale({ model: "fal/fal-ai/recraft/upscale/crisp", source: { url }, factor: 2 });   // error: no factor
 * ```
 */
export interface UpscaleValidator<A> extends SafeUnknown<UnifiedResult<A, string>> {
  <
    M extends UnifiedRef<A> | (string & {}),
    T extends UnifiedInput<UpscaleParamsBase, UnifiedRef<A>, A> &
      UpscaleModelNarrowing<A, M> &
      ModelExtras<A, M>,
  >(
    params: T &
      { model: M } &
      ExactKeys<T, UnifiedInput<UpscaleParams, UnifiedRef<A>, A> & ModelExtras<A, M>>,
    options?: ValidateOptions,
  ): UnifiedResult<A, M>;
  safe<
    M extends UnifiedRef<A> | (string & {}),
    T extends UnifiedInput<UpscaleParamsBase, UnifiedRef<A>, A> &
      UpscaleModelNarrowing<A, M> &
      ModelExtras<A, M>,
  >(
    params: T &
      { model: M } &
      ExactKeys<T, UnifiedInput<UpscaleParams, UnifiedRef<A>, A> & ModelExtras<A, M>>,
    options?: ValidateOptions,
  ): ValidateResult<UnifiedResult<A, M>>;
  /** Every provider id registered on this validator, sorted. */
  readonly providers: readonly string[];
}
