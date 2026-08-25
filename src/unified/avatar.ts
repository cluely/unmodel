/**
 * `unmodel/avatar` — one `avatar()` for making a still speak.
 *
 * ```ts
 * import { avatar } from "unmodel/avatar";
 *
 * const req = avatar({
 *   model: "fal/fal-ai/sync-lipsync/v3/image-to-video",
 *   image: { url: "https://example.com/headshot.png" },
 *   audio: { url: "https://example.com/vo.wav" },
 * });
 * ```
 *
 * The twin of `unmodel/lipsync`, split from it by what goes in: lipsync is
 * handed a performance and preserves it, avatar is handed a face and invents
 * one. `fal-ai/sync-lipsync/v3` and `fal-ai/sync-lipsync/v3/image-to-video` are
 * the same vendor's same model behind two routes and they land at two different
 * entry points here — which is the sharpest statement of the rule the category
 * list follows.
 *
 * `createAvatar([…])` takes the adapters you name instead of all of them:
 *
 * ```ts
 * import { createAvatar } from "unmodel/avatar";
 * import { avatar as fal } from "unmodel/fal/unified";
 *
 * const avatar = createAvatar([fal]);
 * ```
 *
 * ## `image` narrows to the ref — required, forbidden, or wide
 *
 * Most routes animate a picture you supply, and there `image` is REQUIRED. Two
 * of the eight fal endpoints animate a **catalogued performer** instead —
 * `veed/avatars/audio-to-video` and `argil/avatars/audio-to-video` pick from a
 * closed enum of trained presenters and have no image field at all — and there
 * `image` types as `never`:
 *
 * ```ts
 * avatar({ model: "fal/fal-ai/sync-lipsync/v3/image-to-video", image: { url }, audio: { url } }); // ok
 * avatar({ model: "fal/veed/avatars/audio-to-video", audio: { url } });                           // ok
 * avatar({ model: "fal/veed/avatars/audio-to-video", image: { url }, audio: { url } });           // compile error
 * ```
 *
 * The presenters themselves are reached through `providerOptions` — a 28-value
 * enum spelled `avatar_id` at one vendor and `avatar` at another is a
 * coincidence with a shape rather than a vocabulary, and inventing a canonical
 * `performer` word on two witnesses from one provider would be a vocabulary
 * decision made in a provider directory.
 *
 * ## Neither is `prompt`
 *
 * Three of the eight rows have no prompt field, one requires one, and two
 * default theirs to `"."`. A word whose meaning ranges from mandatory to
 * meaningless across a single provider's own roster is not canonical yet, so it
 * arrives as a per-model extra typed from that endpoint's own wire interface.
 *
 * There is no `duration`, `resolution` or `aspectRatio` either: the clip's
 * length follows the audio's and its shape follows the still's, so all three
 * are answers rather than questions.
 *
 * The result is the provider's own `Validated` (see `unmodel/image` for the
 * full explanation of what that means and why the pack is assembled by hand).
 */
import { createUnified } from "../core/unified/kernel";
import type {
  AnyAvatarAdapter,
  AvatarParams,
  AvatarValidator,
} from "../core/unified/vocabulary/avatar";
import { avatar as fal } from "../providers/fal/unified-avatar";
import { avatar as heygen } from "../providers/heygen/unified-avatar";
import { avatar as sync } from "../providers/sync/unified-avatar";
import { avatar as veed } from "../providers/veed/unified-avatar";

/** An adapter for this category; they live at `src/providers/<p>/unified.ts`. */
export type AvatarAdapter = AnyAvatarAdapter;

/**
 * Builds an `avatar()` from the adapters you pass. The generic is on the array
 * element so each adapter's literal `provider`, `as const` `models` and
 * `as const` `modelParams` survive inference — driving autocomplete, the return
 * type, and the per-model `image` and extras narrowing alike.
 *
 * The cast is the same one `createUnified` already performs internally: the
 * runtime is category-agnostic, and `AvatarValidator` differs from
 * `UnifiedValidator` only in the extra per-model constraints it puts on the
 * params.
 */
export function createAvatar<A extends AvatarAdapter>(
  adapters: readonly A[],
): AvatarValidator<A> {
  return createUnified<AvatarParams, A>("avatar", adapters) as unknown as AvatarValidator<A>;
}

/**
 * Every avatar adapter unmodel ships — four providers, and between them three
 * different answers to what `{ data, mimeType }` means.
 *
 * fal serves eight endpoints: sync.'s image arm, ByteDance OmniHuman 1.5,
 * Kling's AI Avatar v2 in both grades, LongCat, EchoMimic v3, and the two
 * catalogued-performer routes from VEED and Argil that make `image` a per-model
 * decision rather than a required field. sync. serves exactly one — `sync-3`,
 * the only model at that vendor which reads a still — and it is the same id its
 * lipsync adapter serves:
 *
 * ```ts
 * lipsync({ model: "sync/sync-3", source: { url: clip },  audio: { url } });
 * avatar({  model: "sync/sync-3", image:  { url: still }, audio: { url } });
 * ```
 *
 * One URL, one model id, two categories, and nothing telling them apart but the
 * tag on the input item — which is the clearest possible statement of why the
 * clip/still split has to be a CATEGORY rather than an optional field. At fal
 * the same product needs two endpoint ids to say it.
 *
 * VEED and HeyGen are the two native halves added next, and they land on the
 * two ends of this category's `image` mechanism. VEED's `fabric-1.0` is
 * `sources: ["image"]` with a REQUIRED `resolution` extra the vocabulary has no
 * word for — the one route here that insists on being told an output size. And
 * VEED is simultaneously a `sources: []` row through fal, because
 * `veed/avatars/audio-to-video` is a presenter library with no native endpoint
 * at all (`POST /v1/avatars` is a 404). Same vendor, opposite rows, two
 * products.
 *
 * HeyGen brings the third answer to inline bytes. fal compiles `{ data,
 * mimeType }` into a `data:` URI in a field that fetches URLs; sync. and VEED
 * refuse it, because their fields only fetch; HeyGen has a real third arm on
 * its own `oneOf` — `{ type: "base64", media_type, data }` — so the bytes go
 * there structurally. Its `audio_url` does NOT have that arm, so one request
 * accepts bytes for the still and refuses them for the track.
 *
 * The cost of all four is pinned in `test/bundle-budget.test.ts`.
 */
export const avatar = createAvatar([fal, heygen, sync, veed]);

export type {
  AnyAvatarAdapter,
  AvatarAdapterFor,
  AvatarAudio,
  AvatarImageInput,
  AvatarImageOf,
  AvatarModelNarrowing,
  AvatarModelParams,
  AvatarModelParamTable,
  AvatarParams,
  AvatarParamsBase,
  AvatarSourceKind,
  AvatarValidator,
  DataRef,
  ModelExtras,
  ModelParamsFor,
  ProviderOptions,
  UrlRef,
  WithModelParams,
} from "../core/unified/vocabulary/avatar";

export type {
  CompileContext,
  CompileIssue,
  CompiledCall,
  Derived,
  UnifiedAdapter,
  UnifiedRef,
  UnifiedResult,
  UnifiedValidator,
  UnregisteredUnifiedProvider,
} from "../core/unified/types";
