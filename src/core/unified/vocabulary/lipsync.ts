/**
 * `unmodel/lipsync` — the canonical vocabulary for redubbing a video clip.
 *
 * Five words, and the smallest vocabulary in the library after music: a clip
 * goes in, an audio track goes in, and a clip whose mouth matches the audio
 * comes out. There is nothing to say about size, length or shape, because the
 * output's geometry IS the input's — that is what makes it lipsync rather than
 * generation, and it is why this category has no `resolution`, no `duration`
 * and no `aspectRatio`.
 *
 * ## Why it is not an arm of `video`
 *
 * `unmodel/video` takes a prompt and invents frames. A lipsync route invents
 * nothing: it edits mouths in frames it was handed. Folding the two together
 * would mean a `VideoParams` where `prompt` is meaningless for some models and
 * required for others, `duration` is decided by the audio rather than the
 * caller, and every video warning would have to be read twice — once for "the
 * model cannot express this" and once for "this category has no such idea".
 * Separate categories mean each one's warnings mean one thing.
 *
 * ## Why it is not an arm of `avatar` either
 *
 * The two are the same product on many vendors (`fal-ai/sync-lipsync/v3` and
 * `fal-ai/sync-lipsync/v3/image-to-video` are one model on two routes) and
 * still they split, because the INPUT differs and the input is the whole
 * request: a clip already contains the performance and the model preserves it,
 * while a still contains none and the model invents it. A single `source` that
 * meant either would make `sources: ["video", "image"]` the common declaration
 * and the narrowing meaningless.
 *
 * ## What is deliberately absent
 *
 * `sync_mode` (sync.'s five-arm enum for what to do when the audio outlasts the
 * clip) and `loop_mode` (LatentSync's two-arm one for the same idea) are NOT
 * canonical. They are one idea two vendors spell differently, and a canonical
 * word for it would have to pick a spelling and then answer for it at every
 * other provider. They ride as per-model `extras`, typed from the endpoint's
 * own wire interface, and get promoted the day a third provider agrees on a
 * name.
 *
 * Text-driven arms are absent for a different reason: a route that takes a
 * script and a voice id instead of an audio track is TTS composed with
 * lipsync, and composing it inside one call would hide which half failed.
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
  LipsyncModelNarrowing,
  LipsyncModelParamTable,
  ModelExtras,
  WithModelParams,
} from "./model-params";

export type { DataRef, ProviderOptions, UrlRef } from "./common";

export type {
  LipsyncModelNarrowing,
  LipsyncModelParams,
  LipsyncModelParamTable,
  LipsyncSourceOf,
  ModelExtras,
  ModelParamsFor,
  WithModelParams,
} from "./model-params";

/**
 * The two shapes a performance can arrive in, as a tag.
 *
 * Named rather than left implicit for `stt`'s reason, one category over: a
 * route accepts one of them, and {@link LipsyncSourceFor} turns that choice
 * into the exact `source` type for that route. Every lipsync route in this
 * build declares `["video"]`; the kind exists as a union because the row is
 * what the *type* reads, and a row that could only ever say one thing would be
 * a constant pretending to be data.
 */
export type LipsyncSourceKind = "video" | "image";

/**
 * A source clip: a URL the provider fetches, or inline bytes with the media
 * type stated.
 *
 * `mimeType` is REQUIRED on the inline arm, and it is the only compile-time
 * thing separating a clip from a still — `{ url }` is `{ url }` whichever
 * medium is behind it, so the type can only speak where the caller does. A
 * `data:` URI passed as `data` is taken verbatim (the media type is already in
 * the envelope); anything else needs the type in order to build one.
 */
export type LipsyncVideoSource = UrlRef | (DataRef & { mimeType: `video/${string}` });

/** A still, for the routes whose source is an image rather than a clip. */
export type LipsyncImageSource = UrlRef | (DataRef & { mimeType: `image/${string}` });

/** A performance source, in whichever shape the caller has. */
export type LipsyncSource = LipsyncVideoSource | LipsyncImageSource;

/**
 * The `source` type for a route that accepts exactly the kinds in `K`.
 *
 * Written `"video" extends K` rather than `K extends "video"` for
 * `AudioInputFor`'s reason: the former asks "is this kind in the set", the
 * latter distributes and answers a different question for a union `K`.
 */
export type LipsyncSourceFor<K extends LipsyncSourceKind> =
  | ("video" extends K ? LipsyncVideoSource : never)
  | ("image" extends K ? LipsyncImageSource : never);

/**
 * The audio to lip-sync to.
 *
 * `mimeType` is optional here where it is required on the source: every
 * provider in this category takes audio in a field whose name says `audio`, so
 * there is nothing for the media type to disambiguate — it is only needed to
 * build a `data:` URI, and `toMediaUri` asks for it by name when it is missing.
 */
export type LipsyncAudio = UrlRef | DataRef;

/**
 * Everything that is not narrowed per model.
 *
 * `source` is omitted here on purpose — the replacement-arm law
 * (`SizingArms` in `./model-params.ts`): {@link LipsyncModelNarrowing}
 * REPLACES it rather than intersecting with it, and a base that still declared
 * `source: LipsyncSource` would put the wide union back into the intersection,
 * so a still handed to a clip-only model would still compile.
 */
export interface LipsyncParamsBase {
  /** `"provider/model"`, split on the **first** slash. */
  model: string;
  /** The voice track to sync to. */
  audio: LipsyncAudio;
  seed?: number;
  providerOptions?: ProviderOptions;
}

/**
 * A lipsync request, with `source` at its widest — the type an adapter's
 * `compile` is written against, and the type a caller with a run-time-built ref
 * gets.
 */
export interface LipsyncParams extends LipsyncParamsBase {
  /** The clip to redub. */
  source: LipsyncSource;
}

// ---------------------------------------------------------------------------
// Per-model narrowing
// ---------------------------------------------------------------------------

/** A lipsync adapter, parameterized by its per-model table. */
export interface LipsyncAdapterFor<
  T extends LipsyncModelParamTable,
  Wire extends object = object,
  Out extends object = object,
> extends UnifiedAdapter<LipsyncParams, Wire, Out>,
    WithModelParams<T> {
  readonly category: "lipsync";
}

/**
 * The loosest lipsync adapter that still pins the vocabulary. `modelParams` is
 * optional here and required on {@link LipsyncAdapterFor}, so a third-party
 * adapter without one is a legal argument to `createLipsync` and simply
 * degrades to the wide vocabulary.
 */
export type AnyLipsyncAdapter = AnyUnifiedAdapter<LipsyncParams> & {
  readonly category: "lipsync";
  readonly modelParams?: LipsyncModelParamTable;
};

/**
 * `lipsync()` — {@link UnifiedRef}-driven like every category validator, plus
 * the per-**model** `source` narrowing this category is built around.
 *
 * Two type parameters for `VideoValidator`'s reason: `M` is inferred from
 * `params.model` first and `T` is constrained by it, so a still handed to a
 * clip-only model produces one error, on `source`, naming the shape that model
 * takes — rather than an intersection reduced to `never` and three errors, the
 * first of them on `model`.
 *
 * ```ts
 * lipsync({ model: "fal/fal-ai/sync-lipsync/v3", source: { url }, audio: { url } });   // ok
 * lipsync({                                                                            // error on `source`
 *   model: "fal/fal-ai/sync-lipsync/v3",
 *   source: { data, mimeType: "image/png" },
 *   audio: { url },
 * });
 * ```
 */
export interface LipsyncValidator<A> extends SafeUnknown<UnifiedResult<A, string>> {
  <
    M extends UnifiedRef<A> | (string & {}),
    T extends UnifiedInput<LipsyncParamsBase, UnifiedRef<A>, A> &
      LipsyncModelNarrowing<A, M> &
      ModelExtras<A, M>,
  >(
    params: T &
      { model: M } &
      ExactKeys<T, UnifiedInput<LipsyncParams, UnifiedRef<A>, A> & ModelExtras<A, M>>,
    options?: ValidateOptions,
  ): UnifiedResult<A, M>;
  safe<
    M extends UnifiedRef<A> | (string & {}),
    T extends UnifiedInput<LipsyncParamsBase, UnifiedRef<A>, A> &
      LipsyncModelNarrowing<A, M> &
      ModelExtras<A, M>,
  >(
    params: T &
      { model: M } &
      ExactKeys<T, UnifiedInput<LipsyncParams, UnifiedRef<A>, A> & ModelExtras<A, M>>,
    options?: ValidateOptions,
  ): ValidateResult<UnifiedResult<A, M>>;
  /** Every provider id registered on this validator, sorted. */
  readonly providers: readonly string[];
}
