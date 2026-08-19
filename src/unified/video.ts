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
 * provider the ref names — a different endpoint at four of the ten, a
 * different field at the rest, and the same six words either way.
 *
 * `createVideo([…])` takes the adapters you name instead of all ten, and the
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
 * The result is the provider's own `Validated` (see `unmodel/image` for the
 * full explanation of what that means and why the pack is assembled by hand).
 */
import { createUnified } from "../core/unified/kernel";
import type { AnyUnifiedAdapter, UnifiedValidator } from "../core/unified/types";
import type { VideoParams } from "../core/unified/vocabulary/video";
import { video as bytedance } from "../providers/bytedance/unified-video";
import { video as google } from "../providers/google/unified-video";
import { video as kling } from "../providers/kling/unified-video";
import { video as lightricks } from "../providers/lightricks/unified";
import { video as luma } from "../providers/luma/unified-video";
import { video as minimax } from "../providers/minimax/unified-video";
import { video as openai } from "../providers/openai/unified-video";
import { video as pixverse } from "../providers/pixverse/unified";
import { video as runway } from "../providers/runway/unified-video";
import { video as vidu } from "../providers/vidu/unified-video";

/** An adapter for this category; they live at `src/providers/<p>/unified.ts`. */
export type VideoAdapter = AnyUnifiedAdapter<VideoParams> & { readonly category: "video" };

/**
 * Builds a `video()` from the adapters you pass. The generic is on the array
 * element so each adapter's literal `provider` and `as const` `models` survive
 * inference and drive both autocomplete and the return type.
 */
export function createVideo<A extends VideoAdapter>(
  adapters: readonly A[],
): UnifiedValidator<VideoParams, A> {
  return createUnified<VideoParams, A>("video", adapters);
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
 * where that matters most: six of these ten providers have more than one video
 * route, and Kling has five across two route families. Every one of them
 * dispatches inside `compile` — on the model id, on the inputs, or on both —
 * and returns *that route's* own validator, which is why a caller writes
 * `image: { url }` instead of remembering which import turns a still into a
 * clip.
 *
 * The cost is honest and measured: importing this pulls in ten providers'
 * validators (twenty-one endpoint modules between them), their schemas and
 * their catalogs, pinned in `test/bundle-budget.test.ts`. `createVideo([…])`
 * above is the way to pay for two providers instead of ten.
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
]);

export type {
  AspectRatio,
  AspectRatioPreset,
  ProviderOptions,
  VideoImageInput,
  VideoImageRole,
  VideoInput,
  VideoParams,
  VideoResolution,
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
} from "../core/unified/types";
