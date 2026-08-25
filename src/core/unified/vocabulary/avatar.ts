/**
 * `unmodel/avatar` — the canonical vocabulary for making a still speak.
 *
 * The twin of `unmodel/lipsync`, split from it by what goes in: lipsync is
 * handed a performance and preserves it, avatar is handed a face and invents
 * one. `fal-ai/sync-lipsync/v3` and `fal-ai/sync-lipsync/v3/image-to-video` are
 * the same model behind two routes and they land in different categories here,
 * which is the clearest statement of the rule there is.
 *
 * ## `image` is per-model, and that is not a hedge
 *
 * The obvious vocabulary is `{ model, image, audio }` with `image` required,
 * and it is wrong at two of the eight routes in this build. `veed/avatars` and
 * `argil/avatars` take no still at all: their performer is a catalogued
 * `avatar_id` out of a closed list of trained presenters, and there is nowhere
 * to put a face. Making `image` required would make those routes uncallable
 * through this surface; making it optional for everyone would delete the one
 * check the category exists to make.
 *
 * So `image` is narrowed per model, through the same `sources`-style row field
 * `unmodel/lipsync` uses, and obeys the same replacement-arm law: a row that
 * takes a still types it REQUIRED, a row that takes none types it `never`, and
 * a ref this build cannot read restates the wide optional arm. The preset
 * routes are then reachable by naming their performer through `providerOptions`
 * — a per-model extra with a 28-value enum behind it is exactly what that
 * escape hatch is for, and inventing a canonical `performer` word on two
 * witnesses from one provider would be a vocabulary decision made in a provider
 * directory.
 *
 * ## What is deliberately absent
 *
 * `prompt`. Three of the eight rows have no prompt field, one
 * (`fal-ai/echomimic-v3`) REQUIRES one, and two default theirs to `"."` — which
 * is fal's way of spelling "the wire wants a string and the caller has nothing
 * to say". A canonical word whose meaning ranges from mandatory to meaningless
 * across one provider's own roster is not a canonical word yet; it rides as a
 * per-model extra, typed from each endpoint's own wire interface.
 *
 * Likewise there is no `resolution`, `duration` or `aspectRatio`: the clip's
 * length follows the audio's and its shape follows the still's, so all three
 * are answers rather than questions.
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
  AvatarModelNarrowing,
  AvatarModelParamTable,
  ModelExtras,
  WithModelParams,
} from "./model-params";

export type { DataRef, ProviderOptions, UrlRef } from "./common";

export type {
  AvatarImageOf,
  AvatarModelNarrowing,
  AvatarModelParams,
  AvatarModelParamTable,
  ModelExtras,
  ModelParamsFor,
  WithModelParams,
} from "./model-params";

/**
 * The shapes a performer can arrive in — one, today, and a union all the same.
 *
 * A single-member union rather than a bare `"image"` because the row's job is
 * to say what a route accepts, and the two answers that matter are "a still"
 * and "none of these" (an empty list). A second kind joins the day a route
 * takes a 3D head or a trained identity handle, and nothing above it changes.
 */
export type AvatarSourceKind = "image";

/**
 * The still to animate: a URL the provider fetches, or inline bytes with the
 * media type stated.
 *
 * `mimeType` is required on the inline arm for `LipsyncVideoSource`'s reason —
 * `{ url }` looks the same whatever is behind it, so the type can only check
 * the arm where the caller says what they have — and because building a
 * `data:` URI needs it.
 */
export type AvatarImageInput = UrlRef | (DataRef & { mimeType: `image/${string}` });

/**
 * The voice track to animate to. `mimeType` optional, matching
 * `LipsyncAudio`: nothing needs disambiguating, it is only needed to build a
 * `data:` URI, and `toMediaUri` asks for it by name when it is missing.
 */
export type AvatarAudio = UrlRef | DataRef;

/**
 * Everything that is not narrowed per model.
 *
 * `image` is omitted here on purpose — the replacement-arm law (`SizingArms`
 * in `./model-params.ts`): {@link AvatarModelNarrowing} REPLACES it rather
 * than intersecting with it. A base that still declared `image?: AvatarImageInput`
 * would put the wide optional arm back into the intersection, and a still sent
 * to `veed/avatars` — which has no field for one — would go on compiling.
 */
export interface AvatarParamsBase {
  /** `"provider/model"`, split on the **first** slash. */
  model: string;
  /** The voice track the performer speaks. */
  audio: AvatarAudio;
  seed?: number;
  providerOptions?: ProviderOptions;
}

/**
 * An avatar request, with `image` at its widest — the type an adapter's
 * `compile` is written against, and the type a caller with a run-time-built ref
 * gets.
 */
export interface AvatarParams extends AvatarParamsBase {
  /** The still to animate, where the model takes one. */
  image?: AvatarImageInput;
}

// ---------------------------------------------------------------------------
// Per-model narrowing
// ---------------------------------------------------------------------------

/** An avatar adapter, parameterized by its per-model table. */
export interface AvatarAdapterFor<
  T extends AvatarModelParamTable,
  Wire extends object = object,
  Out extends object = object,
> extends UnifiedAdapter<AvatarParams, Wire, Out>,
    WithModelParams<T> {
  readonly category: "avatar";
}

/**
 * The loosest avatar adapter that still pins the vocabulary. `modelParams` is
 * optional here and required on {@link AvatarAdapterFor}, so a third-party
 * adapter without one is a legal argument to `createAvatar` and simply degrades
 * to the wide vocabulary.
 */
export type AnyAvatarAdapter = AnyUnifiedAdapter<AvatarParams> & {
  readonly category: "avatar";
  readonly modelParams?: AvatarModelParamTable;
};

/**
 * `avatar()` — {@link UnifiedRef}-driven like every category validator, plus
 * the per-**model** `image` narrowing that makes the preset-performer routes
 * expressible.
 *
 * ```ts
 * avatar({ model: "fal/fal-ai/sync-lipsync/v3/image-to-video", image: { url }, audio: { url } }); // ok
 * avatar({ model: "fal/veed/avatars/audio-to-video", audio: { url } });                           // ok
 * avatar({ model: "fal/veed/avatars/audio-to-video", image: { url }, audio: { url } });           // error
 * avatar({ model: "fal/fal-ai/sync-lipsync/v3/image-to-video", audio: { url } });                 // error
 * ```
 */
export interface AvatarValidator<A> extends SafeUnknown<UnifiedResult<A, string>> {
  <
    M extends UnifiedRef<A> | (string & {}),
    T extends UnifiedInput<AvatarParamsBase, UnifiedRef<A>, A> &
      AvatarModelNarrowing<A, M> &
      ModelExtras<A, M>,
  >(
    params: T &
      { model: M } &
      ExactKeys<T, UnifiedInput<AvatarParams, UnifiedRef<A>, A> & ModelExtras<A, M>>,
    options?: ValidateOptions,
  ): UnifiedResult<A, M>;
  safe<
    M extends UnifiedRef<A> | (string & {}),
    T extends UnifiedInput<AvatarParamsBase, UnifiedRef<A>, A> &
      AvatarModelNarrowing<A, M> &
      ModelExtras<A, M>,
  >(
    params: T &
      { model: M } &
      ExactKeys<T, UnifiedInput<AvatarParams, UnifiedRef<A>, A> & ModelExtras<A, M>>,
    options?: ValidateOptions,
  ): ValidateResult<UnifiedResult<A, M>>;
  /** Every provider id registered on this validator, sorted. */
  readonly providers: readonly string[];
}
