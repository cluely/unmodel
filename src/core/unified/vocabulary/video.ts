/**
 * `unmodel/video` — the canonical vocabulary for video generation.
 *
 * Text-to-video, image-to-video, and video-to-video are one category rather
 * than three, because they are one *route* at every provider that offers more
 * than one of them: adding a `keyframes` block is how you turn a Luma text
 * request into an image request, not a different endpoint. What varies is
 * which inputs a given model accepts, and that is a per-model fact an adapter
 * reports — not a shape the caller should have to pick up front.
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
import type { AspectRatio, DataRef, ProviderOptions, UrlRef, VideoResolution } from "./common";
import type {
  ModelExtras,
  VideoModelNarrowing,
  VideoModelParamTable,
  WithModelParams,
} from "./model-params";

export type {
  AspectRatio,
  AspectRatioPreset,
  ProviderOptions,
  VideoResolution,
} from "./common";

export type {
  ModelExtras,
  ModelParamsFor,
  VideoDurationOf,
  VideoModelNarrowing,
  VideoModelParams,
  VideoModelParamTable,
  VideoRatioOf,
  VideoResolutionOf,
  WithModelParams,
} from "./model-params";

/**
 * What an input image is *for*.
 *
 * The same `{ url }` means three different things depending on this field —
 * the opening frame, the closing frame, or a style/subject reference — and
 * every provider that supports more than one puts them in different wire
 * slots. Omitted means `"first"`, which is what an unlabelled image means
 * everywhere.
 */
export type VideoImageRole = "first" | "last" | "reference";

/** One image input, tagged with the job it does. */
export type VideoImageInput = (UrlRef | (DataRef & { mimeType: string })) & {
  role?: VideoImageRole;
};

/** A source clip, for extend / restyle / reframe routes. */
export type VideoInput = UrlRef | Pick<DataRef, "data">;

/**
 * Everything that is not narrowed per model.
 *
 * The split exists for one reason, and it is the same reason `ImageParamsBase`
 * exists: the three fields below it — `duration`, `resolution`, `aspectRatio` —
 * are **replaced** by {@link VideoModelNarrowing} in a validator's constraint
 * rather than intersected with it, and a base that still declared them would
 * put the wide type back into the intersection. See `VideoArms` in
 * `./model-params.ts` for what that costs (an `AspectRatio` intersected with a
 * narrowed union loses its `& {}` brace, subtype reduction eats the presets,
 * and `aspectRatio:` completes nothing while tsc stays green).
 */
export interface VideoParamsBase {
  /**
   * Optional: an image-to-video request with a first frame and no prompt is a
   * legitimate request at several providers, and requiring an empty string
   * would be a lie about what was sent.
   */
  prompt?: string;
  /** `"provider/model"`, split on the **first** slash. */
  model: string;
  /**
   * One image, or several with distinct roles. The array form is what
   * first-and-last-frame interpolation needs; a bare object is the common
   * image-to-video case.
   */
  image?: VideoImageInput | readonly VideoImageInput[];
  video?: VideoInput;
  negativePrompt?: string;
  seed?: number;
  n?: number;
  providerOptions?: ProviderOptions;
}

/**
 * A video-generation request.
 *
 * The three per-model fields are declared here at their **widest** — this is
 * the type an adapter's `compile` is written against, and the type a caller
 * with a run-time-built ref gets. A literal ref narrows them to that model's
 * own enums through {@link VideoValidator}.
 */
export interface VideoParams extends VideoParamsBase {
  /**
   * Seconds. A plain number, because that is the only spelling that means the
   * same thing everywhere — providers variously take `5`, `"5"`, `"5s"` and a
   * closed enum, and `derive.ts` has one encoder per spelling.
   */
  duration?: number;
  resolution?: VideoResolution;
  aspectRatio?: AspectRatio;
}

// ---------------------------------------------------------------------------
// Per-model narrowing
// ---------------------------------------------------------------------------

/**
 * A video adapter, parameterized by its per-model table.
 *
 * The table is the single source of three things — the caller's `duration` /
 * `resolution` / `aspectRatio` unions, the extras a model takes, and the
 * run-time roster `applyExtras` refuses an out-of-model extra against — for
 * exactly the reason `transcribe`'s `audioInputs` is one array: a second
 * declaration is a second thing to keep in step, and this one has to be right
 * in an editor *and* on the wire.
 */
export interface VideoAdapterFor<
  T extends VideoModelParamTable,
  Wire extends object = object,
  Out extends object = object,
> extends UnifiedAdapter<VideoParams, Wire, Out>,
    WithModelParams<T> {
  readonly category: "video";
}

/**
 * The loosest video adapter that still pins the vocabulary.
 *
 * `modelParams` is **optional** here and required on {@link VideoAdapterFor},
 * which is the split that matters: every adapter unmodel ships declares one,
 * and a third-party adapter that does not is still a legal argument to
 * `createVideo` — its refs simply degrade to the wide vocabulary, which is
 * exactly what an unknown model already does.
 */
export type AnyVideoAdapter = AnyUnifiedAdapter<VideoParams> & {
  readonly category: "video";
  readonly modelParams?: VideoModelParamTable;
};

/**
 * `video()` — {@link UnifiedRef}-driven like every category validator, plus the
 * per-**model** narrowing this category needs.
 *
 * ## Why there are two type parameters
 *
 * The same argument as `ImageValidator`'s, and it bites harder here because
 * `duration` is a *number* union: `T & { duration?: 4 | 8 | 12 | 16 | 20 }`
 * against a `T` whose `duration` is `7` gives an intersection with a property
 * of type `never`, which TypeScript reduces to `never` **whole** — three
 * errors, the first of them on `model`, none of them naming the lengths the
 * model does offer. Inferring `M` from `params.model` first and constraining
 * `T` by it produces the one error a caller wants:
 *
 * ```
 * Type '7' is not assignable to type '4 | 8 | 12 | 16 | 20 | undefined'.
 * ```
 *
 * `M` is constrained to `UnifiedRef<A> | (string & {})` rather than to
 * `string`, because the `model` completion list comes from that constraint —
 * the same open union `UnifiedInput` declares, for the same reason.
 *
 * `ModelExtras` appears twice, and both are load-bearing. In `ExactKeys` it
 * *admits* the model's extras as legal keys (without it, `cfg_scale` reads as
 * a typo); in `T`'s constraint it *types* them (without it, `cfg_scale` would
 * be `unknown` and a string would compile).
 *
 * ```ts
 * video({ model: "openai/sora-2",  prompt, duration: 8 });          // ok
 * video({ model: "openai/sora-2",  prompt, duration: 7 });          // error
 * video({ model: "openai/sora-2",  prompt, resolution: "1080p" });  // error — pro only
 * video({ model: "kling/kling-v1-6", prompt, cfg_scale: 0.5 });     // ok
 * video({ model: "kling/kling-v3",   prompt, cfg_scale: 0.5 });     // error
 * ```
 */
export interface VideoValidator<A> extends SafeUnknown<UnifiedResult<A, string>> {
  <
    M extends UnifiedRef<A> | (string & {}),
    T extends UnifiedInput<VideoParamsBase, UnifiedRef<A>> &
      VideoModelNarrowing<A, M> &
      ModelExtras<A, M>,
  >(
    params: T &
      { model: M } &
      ExactKeys<T, UnifiedInput<VideoParams, UnifiedRef<A>> & ModelExtras<A, M>>,
    options?: ValidateOptions,
  ): UnifiedResult<A, M>;
  safe<
    M extends UnifiedRef<A> | (string & {}),
    T extends UnifiedInput<VideoParamsBase, UnifiedRef<A>> &
      VideoModelNarrowing<A, M> &
      ModelExtras<A, M>,
  >(
    params: T &
      { model: M } &
      ExactKeys<T, UnifiedInput<VideoParams, UnifiedRef<A>> & ModelExtras<A, M>>,
    options?: ValidateOptions,
  ): ValidateResult<UnifiedResult<A, M>>;
  /** Every provider id registered on this validator, sorted. */
  readonly providers: readonly string[];
}
