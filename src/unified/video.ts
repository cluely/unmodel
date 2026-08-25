/**
 * `unmodel/video` — one `video()` for every video-generation provider.
 *
 * ```ts
 * import { video } from "unmodel/video";
 *
 * const req = video({
 *   model: "luma/ray-2",
 *   prompt: "a drone shot over a fjord",
 *   duration: 5,
 *   resolution: "1080p",
 *   aspectRatio: "16:9",
 * });
 * ```
 *
 * Change the ref to `"openai/sora-2"` and the same object compiles to
 * `{ seconds: "5", size: "1280x720" }`; to `"kling/kling-v3"` and it compiles
 * to `{ duration: "5", mode: "pro", aspect_ratio: "16:9" }`. Add
 * `image: { url }` and it becomes an image-to-video request at whichever
 * provider the ref names — a different endpoint at five of the thirteen, a
 * different field at the rest, and the same six words either way.
 *
 * `createVideo([…])` takes the adapters you name instead of all thirteen, and the
 * bundle then contains those providers and no others:
 *
 * ```ts
 * import { createVideo } from "unmodel/video";
 * import { video as luma } from "unmodel/luma/unified";
 * import { video as google } from "unmodel/google/unified";
 *
 * const video = createVideo([luma, google]);
 * ```
 *
 * `duration` is a plain number of seconds because that is the only spelling
 * that means the same thing everywhere; providers take `5`, `"5"`, `"5s"` and
 * a closed enum, and the adapters encode whichever one theirs wants. A
 * duration a model does not offer is an `invalid_enum_value` listing the ones
 * it does — never the nearest.
 *
 * ## The three size words narrow to the ref
 *
 * The vocabulary is one shape for everyone; what one *model* accepts is not.
 * `sora-2` renders 720p and `sora-2-pro` adds 1080p; `kling-v2-5-turbo` runs 5
 * or 10 seconds and `kling-v3` runs any integer from 3 to 15. So each adapter
 * carries a `modelParams` table keyed by bare model id, and the ref selects a
 * row:
 *
 * ```ts
 * video({ model: "openai/sora-2",     prompt, duration: 8 });         // ok
 * video({ model: "openai/sora-2",     prompt, duration: 7 });         // compile error
 * video({ model: "openai/sora-2",     prompt, resolution: "1080p" }); // pro only
 * video({ model: "kling/kling-v1-6",  prompt, cfg_scale: 0.5 });      // ok
 * video({ model: "kling/kling-v3",    prompt, cfg_scale: 0.5 });      // compile error
 * ```
 *
 * A model whose lengths are a *range* rather than a list — Seedance takes any
 * integer inside per-model bounds — declares none, and `duration` stays the
 * wide `number` there. The params the vocabulary has no word for arrive with
 * their exact types and go on the wire verbatim, and an unknown or
 * run-time-built ref degrades to the wide vocabulary: the union drives
 * autocomplete, it does not gate the API.
 * `core/unified/vocabulary/model-params.ts` is where the mechanism lives.
 *
 * The result is the provider's own `Validated` (see `unmodel/image` for the
 * full explanation of what that means and why the pack is assembled by hand).
 */
import { createUnified } from "../core/unified/kernel";
import type {
  AnyVideoAdapter,
  VideoParams,
  VideoValidator,
} from "../core/unified/vocabulary/video";
import { video as alibaba } from "../providers/alibaba/unified-video";
import { video as bytedance } from "../providers/bytedance/unified-video";
import { video as fal } from "../providers/fal/unified-video";
import { video as google } from "../providers/google/unified-video";
import { video as kling } from "../providers/kling/unified-video";
import { video as lightricks } from "../providers/lightricks/unified";
import { video as luma } from "../providers/luma/unified-video";
import { video as minimax } from "../providers/minimax/unified-video";
import { video as openai } from "../providers/openai/unified-video";
import { video as pixverse } from "../providers/pixverse/unified";
import { video as runway } from "../providers/runway/unified-video";
import { video as vidu } from "../providers/vidu/unified-video";
import { video as xai } from "../providers/xai/unified-video";

/** An adapter for this category; they live at `src/providers/<p>/unified.ts`. */
export type VideoAdapter = AnyVideoAdapter;

/**
 * Builds a `video()` from the adapters you pass.
 *
 * The generic is on the *array element*, not on `VideoAdapter`, so the
 * adapters' literal `provider`, `as const` `models` and `as const`
 * `modelParams` survive inference — which is what makes `model:` autocomplete
 * `"openai/sora-2"` rather than `string`, *and* what makes `duration:` accept
 * that model's own five lengths and nothing else. An unregistered *model* still
 * compiles and still runs: an unrecognised model id is a `unknown_model`
 * **warning**, because a model released after this snapshot must stay callable.
 * An unregistered *provider* is a different thing — that call can only throw —
 * so its result is {@link UnregisteredUnifiedProvider}, named after the
 * provider segment that is not in this pack.
 *
 * The cast is the same one `createUnified` already performs internally: the
 * runtime is category-agnostic, and `VideoValidator` differs from
 * `UnifiedValidator` only in the extra per-model constraints it puts on the
 * params.
 */
export function createVideo<A extends VideoAdapter>(
  adapters: readonly A[],
): VideoValidator<A> {
  return createUnified<VideoParams, A>("video", adapters) as unknown as VideoValidator<A>;
}

/**
 * Every video adapter unmodel ships, assembled by hand.
 *
 * By hand, and in one array, because that array is three things at once: the
 * runtime registry, the `"provider/model"` ref union an editor autocompletes,
 * and the return type of a call (each provider's own `Validated`). A generated
 * or dynamically-loaded registry would keep the first and lose the other two.
 *
 * One adapter per provider, always — a ref resolves to exactly one, and
 * `createUnified` throws on a second claiming the same id. This is the category
 * where that matters most: six of these thirteen providers have more than one
 * video route, Kling has five across two route families, and fal has thirty
 * behind a single address whose path is a parameter. Every one of them
 * dispatches inside `compile` — on the model id, on the inputs, or on both —
 * and returns *that route's* own validator, which is why a caller writes
 * `image: { url }` instead of remembering which import turns a still into a
 * clip.
 *
 * The cost is honest and measured: importing this pulls in thirteen providers'
 * validators (twenty-two endpoint modules between them), their schemas and
 * their catalogs, pinned in `test/bundle-budget.test.ts`. `createVideo([…])`
 * above is the way to pay for two providers instead of thirteen.
 *
 * fal is the newest and the odd one out: it is one adapter over THIRTY
 * endpoints, because at fal the route is a parameter rather than a fork. Its
 * `compile` therefore branches on the generated per-endpoint row — which image
 * roles that endpoint's schema has a field for — instead of on the model id,
 * which is what lets a roster that grows weekly not grow this file.
 */
export const video = createVideo([
  openai,
  google,
  runway,
  kling,
  luma,
  minimax,
  vidu,
  pixverse,
  bytedance,
  lightricks,
  fal,
  xai,
  alibaba,
]);

export type {
  AnyVideoAdapter,
  AspectRatio,
  AspectRatioPreset,
  ModelExtras,
  ModelParamsFor,
  ProviderOptions,
  VideoAdapterFor,
  VideoDurationOf,
  VideoImageInput,
  VideoImageRole,
  VideoInput,
  VideoModelNarrowing,
  VideoModelParams,
  VideoModelParamTable,
  VideoParams,
  VideoParamsBase,
  VideoRatioOf,
  VideoResolution,
  VideoResolutionOf,
  VideoValidator,
  WithModelParams,
} from "../core/unified/vocabulary/video";

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
