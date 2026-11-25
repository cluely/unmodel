/**
 * `unmodel/image-edit` — the canonical vocabulary for image-to-image.
 *
 * A separate category from `image` rather than an optional `image` field on
 * `ImageParams`, for the reason the two are separate endpoints almost
 * everywhere: the model lists differ, the wire routes differ, and half the
 * text-to-image params (`n`, `negativePrompt`, delivery) mean something else or
 * nothing at all once there is a source image. Merging them would produce a
 * type where most combinations are invalid, which is the type telling you it
 * is two types.
 *
 * Types only, like every file under `vocabulary/`. This one is longer than four
 * of its five siblings for the same reason `transcribe.ts` is: the compile-time
 * narrowing of `image` — the adapter shape and the validator signature that
 * carry it — lives next to the vocabulary word it is about, rather than in the
 * kernel, which has no business knowing that this category's input field is
 * spelled `image`.
 */
import type { ExactKeys } from "../../request";
import type { ValidateOptions } from "../../options";
import type { ValidateResult } from "../../result";
import type {
  AnyUnifiedAdapter,
  DistributiveOmit,
  InputsFor,
  SafeUnknown,
  UnifiedAdapter,
  UnifiedInput,
  UnifiedRef,
  UnifiedResult,
} from "../types";
import type {
  AspectRatio,
  BlobRef,
  DataRef,
  Dimensions,
  ImageOutputFormat,
  ProviderOptions,
  UrlRef,
} from "./common";
import type { ModelExtras, ModelParams, ModelParamsFor, ModelShape } from "./model-params";

export type {
  AspectRatio,
  AspectRatioPreset,
  Dimensions,
  ImageOutputFormat,
  ProviderOptions,
} from "./common";

export type {
  ModelExtras,
  ModelParams,
  ModelParamTable,
  ModelParamsFor,
  ModelShape,
  WithModelParams,
} from "./model-params";

/**
 * The three ways a source image reaches an editing API, as a tag.
 *
 * Named as a union of string literals rather than left implicit in the shape of
 * {@link ImageEditInput}, because it is the thing adapters need to *talk
 * about*: a route accepts some subset, and {@link ImageEditInputFor} turns that
 * subset into the exact `image` type for that route. Same mechanism as
 * `stt`'s `audioInputs`, and for the same reason — the disagreement is
 * per **route**, not per provider.
 */
export type ImageEditInputKind = "file" | "url" | "data";

/** A `Blob`/`File` posted as multipart. */
export type ImageEditFileInput = BlobRef;
/** A URL the provider fetches. A `data:` URL counts, where the route says so. */
export type ImageEditUrlInput = UrlRef;
/**
 * Bytes inline, as the base64 payload.
 *
 * No `mimeType`: the routes that take inline bytes here take *raw base64* in a
 * field that is documented "base64 or a URL", and a media type has nowhere to
 * go. A provider that needs the type takes a `data:` URL instead, which is a
 * `{ url }` — so the distinction is carried by which shape you pass rather than
 * by an optional field that is meaningful at one provider out of four.
 */
export type ImageEditDataInput = Pick<DataRef, "data">;

/**
 * The source image, in the three forms providers accept.
 *
 * `{ file }` is the multipart endpoints, `{ url }` the ones that fetch for
 * you, `{ data }` inline base64 (or a `data:` URL). An adapter narrows this to
 * whatever its route takes and reports the rest as `unsupported_param` naming
 * the form that route *does* accept — never a silent upload.
 */
export type ImageEditInput = ImageEditFileInput | ImageEditUrlInput | ImageEditDataInput;

/**
 * The `image` type for a route that accepts exactly the kinds in `K`.
 *
 * The compile-time half of the promise the category makes: a multipart-only
 * route declared `ImageEditInputFor<"file">` gives a caller who hands it a URL
 * a type error at the call site, rather than a validated request that 400s on a
 * body the route does not parse.
 *
 * Written with `"file" extends K` rather than `K extends "file"` on purpose:
 * the former asks "is this kind in the set", the latter distributes and answers
 * a different question for a union `K`.
 */
export type ImageEditInputFor<K extends ImageEditInputKind> =
  | ("file" extends K ? ImageEditFileInput : never)
  | ("url" extends K ? ImageEditUrlInput : never)
  | ("data" extends K ? ImageEditDataInput : never);

/**
 * The two things an image-edit route can be asked to do through this
 * vocabulary.
 *
 * `"edit"` changes a picture the way a sentence says; `"removeBackground"` cuts
 * the subject out and takes no sentence at all. Which one a **model** serves is
 * a fact of its `modelParams` row (`operations`, absent = `["edit"]`), not of
 * its provider: Photoroom serves one at `photoroom/edit-with-ai` and the other
 * at `photoroom/remove-background`. See `docs/decisions.md` §10.
 */
export type ImageEditOperation = "edit" | "removeBackground";

/** The words every operation shares. */
export interface ImageEditParamsCommon {
  image: ImageEditInput;
  /** `"provider/model"`, split on the **first** slash. */
  model: string;
  outputFormat?: ImageOutputFormat;
  providerOptions?: ProviderOptions;
}

/**
 * The words of a prompted edit, before the sizing XOR. Exported because the
 * declaration of an adapter whose `compile` takes both operations names it;
 * callers want {@link ImageEditEditParams}.
 */
export interface ImageEditEditBase extends ImageEditParamsCommon {
  /** Discriminant: change the picture the way `prompt` says. */
  operation: "edit";
  /** What to change. */
  prompt: string;
  /** 0 = keep the source, 1 = ignore it. Providers spell this a dozen ways. */
  strength?: number;
  n?: number;
  seed?: number;
}

/**
 * A prompted edit. `size` / `aspectRatio` / `dimensions` are XOR for the same
 * reason as in `ImageParams`; all three are optional here because the common
 * case is "same shape as the input", which is what omitting them means.
 *
 * A union of three complete object types, not `Base & (ArmA | ArmB | ArmC)` —
 * see the note on `ImageParams` for the distributive-`Omit` trap the shorter
 * spelling walks into.
 */
export type ImageEditEditParams =
  | (ImageEditEditBase & {
      /**
       * The provider's own spelling of size — `"1024x1536"`, or the literal a
       * model takes instead (`"auto"`). Narrows to *this model's* presets when
       * the ref is a literal.
       */
      size?: string;
      aspectRatio?: never;
      dimensions?: never;
    })
  | (ImageEditEditBase & { size?: never; aspectRatio?: AspectRatio; dimensions?: never })
  | (ImageEditEditBase & { size?: never; aspectRatio?: never; dimensions?: Dimensions });

/**
 * Cut the subject out. No prompt: the operation is the instruction.
 *
 * The seven `?: never` keys are load-bearing twice over. `ExactKeys` reads
 * `keyof` the vocabulary, and `keyof` a union is only the keys every member
 * declares — so an arm that simply left `prompt` out would stop it being a
 * known key on the edit arm too. And they are what makes `prompt` on a removal
 * a compile error rather than a field that is silently dropped.
 *
 * One arm, not three: a removal has no shape to choose, so it does not cross
 * the sizing XOR.
 */
export interface ImageEditRemoveBackgroundParams extends ImageEditParamsCommon {
  /** Discriminant: return the subject on a transparent background. */
  operation: "removeBackground";
  prompt?: never;
  strength?: never;
  n?: never;
  seed?: never;
  size?: never;
  aspectRatio?: never;
  dimensions?: never;
}

/** An image-edit request: one of the {@link ImageEditOperation}s. */
export type ImageEditParams = ImageEditEditParams | ImageEditRemoveBackgroundParams;

// ---------------------------------------------------------------------------
// The per-model row, and the operation it decides
//
// Declared here and not beside the other categories' rows in
// `./model-params.ts`, which every pack's declaration reaches: that module
// would have to name this one's operation arms, and this whole vocabulary
// would then ride in the declaration graph of `unmodel/tts` and the twelve
// other packs that never edit a picture (13.6 KiB each, measured). This module
// already imports that one, so the row sits on the side of the edge that
// exists.
// ---------------------------------------------------------------------------

/**
 * An image-edit model's row: the image row, plus which operations the model
 * serves.
 */
export interface ImageEditModelParams extends ModelParams {
  /**
   * The operations this model serves, `as const`.
   *
   * **Absent means `["edit"]`**: a prompted edit is what an image-edit model
   * does unless its row says otherwise. A row that lists only
   * `"removeBackground"` types `prompt`, `strength`, `n`, `seed` and the three
   * shape words as `never` at that ref.
   *
   * On the row and not on the adapter, because one provider can serve the two
   * operations at two different models, and an adapter-wide list would let the
   * wrong pairing compile.
   */
  readonly operations?: readonly ImageEditOperation[];
}

/** An image-edit adapter's per-model table, keyed by **bare** model id. */
export type ImageEditModelParamTable = Readonly<Record<string, ImageEditModelParams>>;

/** `operations` → the operation union; absent is `"edit"`. */
export type ImageEditOperationOf<Row> = Row extends {
  readonly operations: readonly (infer O extends ImageEditOperation)[];
}
  ? O
  : "edit";

/**
 * The words each operation owns, read off the arms above so the two cannot
 * drift: everything an arm declares beyond the shared words and the sizing
 * trio, which `ModelShape` supplies per model.
 */
type EditWords = Pick<ImageEditEditParams, "operation" | "prompt" | "strength" | "n" | "seed">;
type RemoveBackgroundWords = Omit<ImageEditRemoveBackgroundParams, keyof ImageEditParamsCommon>;

/**
 * The operation one ref admits, with that operation's words — a complete
 * **replacement** for the arms above, for the reason `SizingArms` in
 * `./model-params.ts` states and one more: an intersection cannot make the
 * required `prompt` of an edit `never` on a removal, so the narrowed words
 * (`operation`, `prompt`, `strength`, `n`, `seed`, the sizing trio) are absent
 * from the base this is intersected with and supplied only here.
 *
 * Degraded — dynamic ref, unknown provider, unknown model — both operations are
 * offered, the edit with the wide sizing arms `ModelShape` restates, and the
 * adapter answers at run time. A UNION of refs degrades the same way: it is
 * offered every operation any of its members serves (a picker typed over a
 * list of models is this case), and the wrong pairing is refused at run time
 * from the same row.
 */
export type ImageEditOperationArms<A, R extends string> = [ModelParamsFor<A, R>] extends [never]
  ? (EditWords & ModelShape<A, R>) | RemoveBackgroundWords
  :
      | ("edit" extends ImageEditOperationOf<ModelParamsFor<A, R>>
          ? EditWords & ModelShape<A, R>
          : never)
      | ("removeBackground" extends ImageEditOperationOf<ModelParamsFor<A, R>>
          ? RemoveBackgroundWords
          : never);

// ---------------------------------------------------------------------------
// The narrowing, in the two places it has to be declared
// ---------------------------------------------------------------------------

/**
 * `ImageEditParams` narrowed to the input kinds one route accepts, and to the
 * operations it serves.
 *
 * `O` defaults to `"edit"`, so an adapter that only edits writes
 * `ImageEditParamsFor<"file">` and reads `input.prompt` as a `string`. An
 * adapter that serves both names `ImageEditOperation` and narrows on
 * `input.operation` itself.
 *
 * `DistributiveOmit` rather than `Omit`, for the reason stated on
 * {@link ImageEditEditParams}: this is a union, and plain `Omit` would collapse
 * its arms into one object with neither `aspectRatio` nor `dimensions`
 * exclusive — quietly deleting the invariant the type exists to state. The
 * intersection then distributes back over the arms, so each keeps its XOR.
 */
export type ImageEditParamsFor<
  K extends ImageEditInputKind,
  O extends ImageEditOperation = "edit",
> = DistributiveOmit<Extract<ImageEditParams, { operation: O }>, "image"> & {
  image: ImageEditInputFor<K>;
};

/**
 * An image-edit adapter, parameterized by the image shapes its route accepts.
 *
 * The `imageInputs` array is the single source of both halves of the promise:
 *
 * - **compile time** — {@link ImageEditValidator} reads it back through
 *   `InputsFor` and types the caller's `image` from it, so a URL handed to a
 *   multipart-only route is an error at the call site;
 * - **run time** — `resolveImageEditInput` in `derive.ts` takes the same array
 *   and reports `unsupported_param` naming the shapes this route does take, for
 *   the JavaScript callers and the runtime-built refs no type can reach.
 *
 * One array, two enforcement points, no way for them to disagree. It is
 * declared `readonly K[]` rather than inferred from the compile signature
 * because a function parameter type is not something a *value* can be read
 * from — and the runtime half needs a value.
 */
export interface ImageEditAdapterFor<
  K extends ImageEditInputKind,
  Wire extends object = object,
  Out extends object = object,
  T extends ImageEditModelParamTable = ImageEditModelParamTable,
  O extends ImageEditOperation = "edit",
> extends UnifiedAdapter<ImageEditParamsFor<K, O>, Wire, Out> {
  readonly category: "imageEdit";
  /** The image shapes this route accepts, `as const`. */
  readonly imageInputs: readonly K[];
  /**
   * The per-**model** surface: this route's `size` presets, the extras each
   * model takes, and the `operations` it serves (absent = `["edit"]`).
   * Optional on the type and present on every shipped adapter — a route with
   * nothing model-dependent to say would leave it off and degrade to the wide
   * vocabulary, which is what an unknown model already does.
   */
  readonly modelParams?: T;
}

/**
 * `imageEdit()` — {@link UnifiedRef}-driven like every category validator, plus
 * the one thing this category shares with `stt`: `image` is typed from
 * the adapter the **ref** selects.
 *
 * `image` is narrowed by an intersection on the parameter, because it is a
 * required *object* field and an intersection reports those well. `size`,
 * `aspectRatio` and the extras are narrowed through `T`'s **constraint**
 * against the separately-inferred `M` instead — see the note on
 * `ImageValidator` in `./image.ts` for why an intersection collapses a unit
 * union to `never` and swallows the message.
 *
 * ```ts
 * imageEdit({ model: "openai/gpt-image-1.5", image: { file } });  // ok
 * imageEdit({ model: "openai/gpt-image-1.5", image: { url } });   // compile error
 * imageEdit({ model: "black-forest-labs/flux-kontext-pro", image: { url } });  // ok
 * imageEdit({ model: "black-forest-labs/flux-kontext-pro", image: { file } }); // compile error
 * ```
 */
export interface ImageEditValidator<A> extends SafeUnknown<UnifiedResult<A, string>> {
  <
    M extends UnifiedRef<A> | (string & {}),
    T extends UnifiedInput<ImageEditParamsCommon, UnifiedRef<A>, A> &
      ImageEditOperationArms<A, M> &
      ModelExtras<A, M>,
  >(
    params: T &
      { model: M } &
      ExactKeys<T, UnifiedInput<ImageEditParams, UnifiedRef<A>, A> & ModelExtras<A, M>> &
      ImageNarrowing<A, M>,
    options?: ValidateOptions,
  ): UnifiedResult<A, M>;
  safe<
    M extends UnifiedRef<A> | (string & {}),
    T extends UnifiedInput<ImageEditParamsCommon, UnifiedRef<A>, A> &
      ImageEditOperationArms<A, M> &
      ModelExtras<A, M>,
  >(
    params: T &
      { model: M } &
      ExactKeys<T, UnifiedInput<ImageEditParams, UnifiedRef<A>, A> & ModelExtras<A, M>> &
      ImageNarrowing<A, M>,
    options?: ValidateOptions,
  ): ValidateResult<UnifiedResult<A, M>>;
  /** Every provider id registered on this validator, sorted. */
  readonly providers: readonly string[];
}

/**
 * The `{ image }` constraint one ref imposes, as a standalone object type so
 * the error message a caller sees names `image` and shows the shape wanted.
 */
export type ImageNarrowing<A, R extends string> = {
  // `Extract` because `InputsFor` is generic in the *field*, so it can only
  // promise `string`; the category is what knows those strings are kinds.
  image: ImageEditInputFor<Extract<InputsFor<A, R, "imageInputs">, ImageEditInputKind>>;
};

/** The loosest image-edit adapter that still pins the vocabulary. */
export type AnyImageEditAdapter = AnyUnifiedAdapter<ImageEditParams> & {
  readonly category: "imageEdit";
  readonly imageInputs: readonly ImageEditInputKind[];
  readonly modelParams?: ImageEditModelParamTable;
};
