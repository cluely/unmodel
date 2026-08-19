/**
 * `unmodel/image` — one `image()` for every text-to-image provider.
 *
 * ```ts
 * import { image } from "unmodel/image";
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
 * ## Why you might assemble the pack yourself
 *
 * That `image` is the ready-made pack: all fifteen providers, and therefore all
 * fifteen providers' catalogs and validators, in one bundle. `createImage([…])`
 * takes the adapters you name instead, and the bundle contains those providers
 * and no others — which is the difference between a 40 KiB entry and a 500 KiB
 * one for someone who ships to a browser:
 *
 * ```ts
 * import { createImage } from "unmodel/image";
 * import { image as openai } from "unmodel/openai/unified";
 * import { image as ideogram } from "unmodel/ideogram/unified";
 *
 * const image = createImage([openai, ideogram]);
 * ```
 *
 * The adapters also decide the *types*: the refs that autocomplete are exactly
 * the models the adapters you passed declare, and the return type is that
 * provider's own body.
 */
import { createUnified } from "../core/unified/kernel";
import type { AnyUnifiedAdapter, UnifiedValidator } from "../core/unified/types";
import type { ImageParams } from "../core/unified/vocabulary/image";
import { image as blackForestLabs } from "../providers/black-forest-labs/unified";
import { image as bria } from "../providers/bria/unified";
import { image as bytedance } from "../providers/bytedance/unified";
import { image as google } from "../providers/google/unified";
import { image as ideogram } from "../providers/ideogram/unified";
import { image as kling } from "../providers/kling/unified";
import { image as krea } from "../providers/krea/unified";
import { image as leonardo } from "../providers/leonardo/unified";
import { image as luma } from "../providers/luma/unified";
import { image as openai } from "../providers/openai/unified-image";
import { image as recraft } from "../providers/recraft/unified";
import { image as reve } from "../providers/reve/unified";
import { image as runway } from "../providers/runway/unified";
import { image as stability } from "../providers/stability/unified";
import { image as vidu } from "../providers/vidu/unified";

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
 * Every image adapter unmodel ships, assembled by hand.
 *
 * By hand, and in one array, because that array is three things at once: the
 * runtime registry, the `"provider/model"` ref union an editor autocompletes,
 * and the return type of a call (each provider's own `Validated`). A generated
 * or dynamically-loaded registry would keep the first and lose the other two.
 *
 * One adapter per provider, always — a ref resolves to exactly one, and
 * `createUnified` throws on a second claiming the same id. Five providers here
 * have more than one generation route (black-forest-labs' two FLUX
 * generations, ideogram's 3.0 and 4.0, stability's ultra/core/sd3, bria's full
 * and lite, kling's standard and omni, reve's v1 and v2), and every one of them
 * dispatches inside `compile` on the bare model id and returns *that route's*
 * own validator. Which is the right shape anyway: `flux-2-pro` and
 * `flux-pro-1.1-ultra` are the same kind of thing to someone choosing a model,
 * and the difference between them belongs in the warnings rather than in which
 * import you remembered.
 *
 * The cost is honest and measured: importing this pulls in fifteen provider
 * validators, their schemas and their catalogs, pinned in
 * `test/bundle-budget.test.ts`. `createImage([…])` above is the way to pay for
 * two providers instead of fifteen.
 */
export const image = createImage([
  openai,
  google,
  blackForestLabs,
  ideogram,
  recraft,
  stability,
  luma,
  bytedance,
  runway,
  kling,
  vidu,
  bria,
  leonardo,
  krea,
  reve,
]);

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
