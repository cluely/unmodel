/**
 * `unmodel/image-edit` — one `imageEdit()` for every image-to-image provider.
 *
 * ```ts
 * import { createImageEdit } from "unmodel/image-edit";
 * import { openaiImageEdit } from "unmodel/openai";
 *
 * const imageEdit = createImageEdit([openaiImageEdit]);
 *
 * const req = imageEdit({
 *   operation: "edit",
 *   model: "openai/gpt-image-1",
 *   prompt: "make it winter",
 *   image: { url: "https://example.com/street.png" },
 *   strength: 0.6,
 * });
 * ```
 *
 * A separate category from `image` because it is a separate endpoint almost
 * everywhere, with its own model list and its own params — see the note in
 * `core/unified/vocabulary/image-edit.ts`.
 *
 * The result is the provider's own `Validated` (see `unmodel/image` for the
 * full explanation of what that means and why the pack is assembled by hand).
 */
import { createUnified } from "../core/unified/kernel";
import type { AnyUnifiedAdapter, UnifiedValidator } from "../core/unified/types";
import type { ImageEditParams } from "../core/unified/vocabulary/image-edit";

/** An adapter for this category; they live at `src/providers/<p>/unified.ts`. */
export type ImageEditAdapter = AnyUnifiedAdapter<ImageEditParams> & {
  readonly category: "imageEdit";
};

/**
 * Builds an `imageEdit()` from the adapters you pass. The generic is on the
 * array element so each adapter's literal `provider` and `as const` `models`
 * survive inference and drive both autocomplete and the return type.
 */
export function createImageEdit<A extends ImageEditAdapter>(
  adapters: readonly A[],
): UnifiedValidator<ImageEditParams, A> {
  return createUnified<ImageEditParams, A>("imageEdit", adapters);
}

/**
 * The zero-argument `imageEdit()` carrying every adapter unmodel ships lands
 * here once there are adapters to carry — see the layering note in
 * `src/unified/image.ts` for why the convenience pack is deliberately not part
 * of the commit that introduces the kernel.
 */

export type {
  AspectRatio,
  AspectRatioPreset,
  Dimensions,
  ImageEditInput,
  ImageEditParams,
  ImageOutputFormat,
  ProviderOptions,
} from "../core/unified/vocabulary/image-edit";

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
