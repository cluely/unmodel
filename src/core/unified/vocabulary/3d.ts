/**
 * `unmodel/3d` — the canonical vocabulary for asking for a mesh.
 *
 * Five words, and the first category in the library whose two content words are
 * ALTERNATIVES rather than companions. Every other surface here asks for a
 * thing and then qualifies it; this one asks for a thing in one of two moods —
 * describe it (`prompt`) or show it (`image`) — and which mood a route is in is
 * a fact about the route, not a choice the caller gets to make twice.
 *
 * ## Why it waited for wave three
 *
 * `unmodel/lipsync`, `unmodel/avatar` and `unmodel/upscale` all shipped with
 * one provider behind them, and this one deliberately did not. A vocabulary
 * read off a single vendor is that vendor's request schema with the field names
 * changed, and 3D is the surface where that failure mode is loudest: the same
 * idea has five spellings before you have finished reading two schemas.
 * `texture` is `texture` at Tripo, `textured_mesh` at Hunyuan3D,
 * `enable_texture` at Hi3D, `should_texture` at Meshy and `texture_mode` at
 * Rodin. The output container is `geometry_file_format`, `export_format`,
 * `output_format`, a `quad` boolean that silently forces FBX — and at Tripo's
 * own native API, a second HTTP CALL. None of those is a canonical word; all of
 * them ride as per-model `extras`, typed from the endpoint's own wire
 * interface.
 *
 * What survived two witnesses is what is here: the thing you want, in one of
 * two moods, and a seed.
 *
 * ## `prompt` and `image` narrow together
 *
 * The row's `inputs` list says which moods a route reads, and
 * {@link ThreeDModelNarrowing} turns it into three genuinely different shapes:
 *
 * ```ts
 * threeD({ model: "fal/tripo3d/h3.1/text-to-3d", prompt: "a brass astrolabe" });     // ok
 * threeD({ model: "fal/tripo3d/h3.1/text-to-3d", image: { url } });                  // error: no image
 * threeD({ model: "fal/fal-ai/trellis", image: { url } });                           // ok
 * threeD({ model: "fal/fal-ai/trellis", prompt: "a brass astrolabe" });              // error: no prompt
 * threeD({ model: "fal/fal-ai/hyper3d/rodin/v2.5", prompt: "…", image: { url } });   // ok — both
 * ```
 *
 * The third arm is not hypothetical. `fal-ai/hyper3d/rodin/v2.5` publishes both
 * and requires neither: the prompt STEERS an image-driven generation and stands
 * alone without one, which is a real third answer rather than a hedge, and it
 * is the reason `prompt` is not simply "the text-to-3d arm's required field".
 *
 * ## What is deliberately absent
 *
 * No `size`, no `aspectRatio`, no `resolution`, no `duration`, no `n`. A mesh
 * has no frame: what a 3D route lets you ask for instead is a POLYGON BUDGET,
 * and the two witnesses spell that `face_limit`, `face_count`, `FaceCount`,
 * `target_polycount` and `decimation_target` — same idea, five words, so it
 * waits like the rest of them.
 *
 * No `texture`, `pbr`, `quad` or `format`, for the reason above. Note
 * especially that `texture` looks like it has two witnesses and does not:
 * `tripo3d/*` at fal and the native `tripo3d` provider are ONE vendor reached
 * two ways, and agreement with yourself is not corroboration.
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
  ThreeDModelNarrowing,
  ThreeDModelParamTable,
  WithModelParams,
} from "./model-params";

export type { DataRef, ProviderOptions, UrlRef } from "./common";

export type {
  ModelExtras,
  ModelParamsFor,
  ThreeDImageOf,
  ThreeDModelNarrowing,
  ThreeDModelParams,
  ThreeDModelParamTable,
  WithModelParams,
} from "./model-params";

/**
 * The two moods a 3D request can arrive in, as a tag.
 *
 * A genuine two-member union, and unlike `AvatarSourceKind` both members are
 * populated on the first day: `tripo3d/h3.1/text-to-3d` says `["text"]`,
 * `tripo3d/h3.1/image-to-3d` says `["image"]`, and
 * `fal-ai/hyper3d/rodin/v2.5` says both. Same vendor, same release, in the
 * first two cases — which is what makes the split a fact about routes rather
 * than about vendors.
 */
export type ThreeDInputKind = "text" | "image";

/**
 * The reference image to reconstruct: a URL the provider fetches, or inline
 * bytes with the media type stated.
 *
 * `mimeType` is REQUIRED on the inline arm for `AvatarImageInput`'s reason —
 * `{ data }` is bytes whatever is in them, so the type can only speak where the
 * caller does — and because building a `data:` URI needs it.
 *
 * One image, not a list. Three routes in the first build take several views of
 * the same object, and the canonical word names the FRONT one: the extra
 * angles are per-model extras (`back_image_url`, `left_image_url`, …) because
 * "which side is this" is a question only a multiview route asks, and the two
 * witnesses do not even agree on whether the answer is a keyed field or a
 * positional array. A route that REQUIRES more than one view is curated out
 * rather than half-served — see `data/fal/curation.json` on
 * `tripo3d/h3.1/multiview-to-3d`.
 */
export type ThreeDImageInput = UrlRef | (DataRef & { mimeType: `image/${string}` });

/**
 * Everything that is not narrowed per model.
 *
 * `prompt` and `image` are omitted here on purpose — the replacement-arm law
 * (`SizingArms` in `./model-params.ts`): {@link ThreeDModelNarrowing} REPLACES
 * both rather than intersecting with them. A base that still declared
 * `prompt?: string` would put the optional arm back into the intersection and a
 * prompt handed to a reconstruction-only route would go on compiling; a base
 * that still declared `image?: ThreeDImageInput` would do the same to the
 * required arm, which is the one that makes a text-to-3d call safe.
 */
export interface ThreeDParamsBase {
  /** `"provider/model"`, split on the **first** slash. */
  model: string;
  /**
   * Pins the geometry, where the route offers one.
   *
   * The one number in this vocabulary, and it survived both witnesses under the
   * same name and the same meaning. Note that several routes have MORE than one
   * seed — Tripo publishes `model_seed`, `image_seed` and `texture_seed`, which
   * pin three different stages — and the canonical word maps to the GEOMETRY
   * one, because that is the one that decides whether you got the same object.
   * The others are per-model extras.
   */
  seed?: number;
  providerOptions?: ProviderOptions;
}

/**
 * A 3D request, with `prompt` and `image` at their widest — the type an
 * adapter's `compile` is written against, and the type a caller with a
 * run-time-built ref gets.
 */
export interface ThreeDParams extends ThreeDParamsBase {
  /** What to build, described. */
  prompt?: string;
  /** What to build, shown. */
  image?: ThreeDImageInput;
}

// ---------------------------------------------------------------------------
// Per-model narrowing
// ---------------------------------------------------------------------------

/** A 3D adapter, parameterized by its per-model table. */
export interface ThreeDAdapterFor<
  T extends ThreeDModelParamTable,
  Wire extends object = object,
  Out extends object = object,
> extends UnifiedAdapter<ThreeDParams, Wire, Out>,
    WithModelParams<T> {
  readonly category: "3d";
}

/**
 * The loosest 3D adapter that still pins the vocabulary. `modelParams` is
 * optional here and required on {@link ThreeDAdapterFor}, so a third-party
 * adapter without one is a legal argument to `createThreeD` and simply degrades
 * to the wide vocabulary.
 */
export type AnyThreeDAdapter = AnyUnifiedAdapter<ThreeDParams> & {
  readonly category: "3d";
  readonly modelParams?: ThreeDModelParamTable;
};

/**
 * `threeD()` — {@link UnifiedRef}-driven like every category validator, plus
 * the per-**model** `prompt`/`image` narrowing this category is built around.
 *
 * Two type parameters for `LipsyncValidator`'s reason: `M` is inferred from
 * `params.model` first and `T` is constrained by it, so an image handed to a
 * text-only route produces one error, on `image`, rather than an intersection
 * reduced to `never` and three errors, the first of them on `model`.
 *
 * ```ts
 * threeD({ model: "tripo3d/v3.1-20260211", prompt: "a brass astrolabe" });
 * threeD({ model: "fal/fal-ai/hunyuan3d/v2", image: { url }, seed: 7 });
 * ```
 */
export interface ThreeDValidator<A> extends SafeUnknown<UnifiedResult<A, string>> {
  <
    M extends UnifiedRef<A> | (string & {}),
    T extends UnifiedInput<ThreeDParamsBase, UnifiedRef<A>, A> &
      ThreeDModelNarrowing<A, M> &
      ModelExtras<A, M>,
  >(
    params: T &
      { model: M } &
      ExactKeys<T, UnifiedInput<ThreeDParams, UnifiedRef<A>, A> & ModelExtras<A, M>>,
    options?: ValidateOptions,
  ): UnifiedResult<A, M>;
  safe<
    M extends UnifiedRef<A> | (string & {}),
    T extends UnifiedInput<ThreeDParamsBase, UnifiedRef<A>, A> &
      ThreeDModelNarrowing<A, M> &
      ModelExtras<A, M>,
  >(
    params: T &
      { model: M } &
      ExactKeys<T, UnifiedInput<ThreeDParams, UnifiedRef<A>, A> & ModelExtras<A, M>>,
    options?: ValidateOptions,
  ): ValidateResult<UnifiedResult<A, M>>;
  /** Every provider id registered on this validator, sorted. */
  readonly providers: readonly string[];
}
