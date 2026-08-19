/**
 * `unmodel/video` — one `video()` for every video-generation provider.
 *
 * ```ts
 * import { createVideo } from "unmodel/video";
 * import { lumaVideo } from "unmodel/luma";
 * import { googleVideo } from "unmodel/google";
 *
 * const video = createVideo([lumaVideo, googleVideo]);
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
 * The zero-argument `video()` carrying every adapter unmodel ships lands here
 * once there are adapters to carry — see the layering note in
 * `src/unified/image.ts` for why the convenience pack is deliberately not part
 * of the commit that introduces the kernel.
 */

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
