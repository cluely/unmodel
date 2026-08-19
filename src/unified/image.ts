/**
 * `unmodel/image` — one `image()` for every text-to-image provider.
 *
 * ```ts
 * import { createImage } from "unmodel/image";
 * import { openaiImage } from "unmodel/openai";
 * import { googleImage } from "unmodel/google";
 *
 * const image = createImage([openaiImage, googleImage]);
 *
 * const req = image({
 *   model: "openai/gpt-image-1",
 *   prompt: "a lighthouse in fog",
 *   aspectRatio: "16:9",
 *   resolution: "1k",
 * });
 *
 * await fetch(req.request.url, {
 *   method: req.request.method,
 *   headers: { ...req.request.headers, authorization: `Bearer ${key}` },
 *   body: JSON.stringify(req),          // enumerable props ARE the wire body
 * });
 * ```
 *
 * Change the ref to `"google/imagen-4.0-generate-001"` and the same object
 * compiles to an Imagen `:predict` body. That is the entire proposition.
 *
 * ## What you get back is a provider result
 *
 * `image()` does not validate the request itself. It compiles the canonical
 * params to the provider's wire params and then runs **the provider's own
 * validator** — the same `generateImages()` you would have called by hand,
 * with its catalog, its constraint tables, its media checks and its cost
 * estimate. The return value is that validator's `Validated`: wire body
 * enumerable, `.request` and `.toSdk` not, plus `warnings` describing what
 * compiling cost. Zero warnings means the request mapped exactly.
 *
 * ## Why you assemble the pack yourself
 *
 * `createImage([...])` takes the adapters you name, and the bundle contains
 * those providers and no others — which is the difference between a 40 KiB
 * entry and a 900 KiB one for someone who ships to a browser. The adapters
 * also decide the *types*: the refs that autocomplete are exactly the models
 * the adapters you passed declare, and the return type is that provider's own
 * body.
 */
import { createUnified } from "../core/unified/kernel";
import type { AnyUnifiedAdapter, UnifiedValidator } from "../core/unified/types";
import type { ImageParams } from "../core/unified/vocabulary/image";

/**
 * An adapter for this category. Provider adapters live at
 * `src/providers/<p>/unified.ts` and are exported from that provider's
 * subpath.
 */
export type ImageAdapter = AnyUnifiedAdapter<ImageParams> & { readonly category: "image" };

/**
 * Builds an `image()` from the adapters you pass.
 *
 * The generic is on the *array element*, not on `ImageAdapter`, so the
 * adapters' literal `provider` and `as const` `models` survive inference —
 * which is what makes `model:` autocomplete `"openai/gpt-image-1"` rather than
 * `string`. Unregistered refs still compile and still run: an unrecognised
 * model is a `unknown_model` **warning**, because a model released after this
 * snapshot must stay callable.
 */
export function createImage<A extends ImageAdapter>(
  adapters: readonly A[],
): UnifiedValidator<ImageParams, A> {
  return createUnified<ImageParams, A>("image", adapters);
}

/**
 * ## The ready-made pack
 *
 * A zero-argument `image()` carrying every image adapter unmodel ships lands
 * here once there are adapters to carry — it is deliberately **not** part of
 * this commit, because a convenience export that imports forty provider
 * modules is the one thing that would undo the layering above.
 *
 * The layering, so the placeholder is not mysterious:
 *
 * - `src/core/unified/**` is the kernel. It imports nothing from
 *   `src/providers/**`, ever, and the import-graph suite enforces it.
 * - `src/providers/<p>/unified.ts` is one provider's adapter. It may see its
 *   own directory, the kernel, and the translation warning types.
 * - **this file** is the category entry. Today it exports only the factory, so
 *   its bundle is the kernel and nothing else — which is what the 15 KiB
 *   budget in `test/bundle-budget.test.ts` pins. When the pack arrives, that
 *   budget stays and the pack ships as a separate named export whose weight is
 *   the caller's explicit choice.
 */

export type {
  AspectRatio,
  AspectRatioPreset,
  Dimensions,
  ImageOutputFormat,
  ImageParams,
  OutputDelivery,
  ProviderOptions,
  ResolutionTier,
} from "../core/unified/vocabulary/image";

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
