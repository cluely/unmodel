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
 * ## `size` and the per-model params narrow to the ref
 *
 * The vocabulary is one shape for everyone; what one *model* accepts is not.
 * `gpt-image-2` takes a free-form `size` up to 3840 px and a `background` of
 * `"opaque" | "auto"`; `gpt-image-1` — same provider, same endpoint — takes a
 * three-value `size` enum and a `background` that also accepts
 * `"transparent"`. So each adapter carries a `modelParams` table keyed by bare
 * model id, and the ref selects a row:
 *
 * ```ts
 * image({ model: "openai/gpt-image-2", prompt, size: "3840x2160" });        // that model's presets
 * image({ model: "openai/gpt-image-1", prompt, background: "transparent" }); // ok
 * image({ model: "openai/gpt-image-2", prompt, background: "transparent" }); // compile error
 * ```
 *
 * `aspectRatio` and `resolution` narrow the same way, the params the
 * vocabulary has no word for arrive with their exact types and go on the wire
 * verbatim, and an unknown or run-time-built ref degrades to the wide
 * vocabulary — the union drives autocomplete, it does not gate the API.
 * `core/unified/vocabulary/model-params.ts` is where the mechanism lives.
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
import type {
  AnyImageAdapter,
  ImageParams,
  ImageValidator,
} from "../core/unified/vocabulary/image";
import { image as blackForestLabs } from "../providers/black-forest-labs/unified-image";
import { image as bria } from "../providers/bria/unified";
import { image as bytedance } from "../providers/bytedance/unified-image";
import { image as google } from "../providers/google/unified-image";
import { image as ideogram } from "../providers/ideogram/unified-image";
import { image as kling } from "../providers/kling/unified-image";
import { image as krea } from "../providers/krea/unified";
import { image as leonardo } from "../providers/leonardo/unified";
import { image as luma } from "../providers/luma/unified-image";
import { image as openai } from "../providers/openai/unified-image";
import { image as recraft } from "../providers/recraft/unified-image";
import { image as reve } from "../providers/reve/unified";
import { image as runway } from "../providers/runway/unified-image";
import { image as stability } from "../providers/stability/unified-image";
import { image as vidu } from "../providers/vidu/unified-image";

/**
 * An adapter for this category. Provider adapters live at
 * `src/providers/<p>/unified.ts` and are exported from that provider's
 * subpath.
 */
export type ImageAdapter = AnyImageAdapter;

/**
 * Builds an `image()` from the adapters you pass.
 *
 * The generic is on the *array element*, not on `ImageAdapter`, so the
 * adapters' literal `provider`, `as const` `models` and `as const`
 * `modelParams` survive inference — which is what makes `model:` autocomplete
 * `"openai/gpt-image-1"` rather than `string`, *and* what makes `size:`
 * autocomplete that model's own presets. An unregistered *model* still compiles
 * and still runs: an unrecognised model id is a `unknown_model` **warning**,
 * because a model released after this snapshot must stay callable. An
 * unregistered *provider* is a different thing — that call can only throw — so
 * its result is {@link UnregisteredUnifiedProvider}, named after the provider
 * segment that is not in this pack.
 *
 * The cast is the same one `createUnified` already performs internally: the
 * runtime is category-agnostic, and `ImageValidator` differs from
 * `UnifiedValidator` only in the extra per-model constraints it puts on the
 * params.
 */
export function createImage<A extends ImageAdapter>(
  adapters: readonly A[],
): ImageValidator<A> {
  return createUnified<ImageParams, A>("image", adapters) as unknown as ImageValidator<A>;
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
  AnyImageAdapter,
  AspectRatio,
  AspectRatioPreset,
  Dimensions,
  ImageAdapterFor,
  ImageOutputFormat,
  ImageParams,
  ImageValidator,
  ModelExtras,
  ModelParams,
  ModelParamTable,
  ModelParamsFor,
  ModelSizing,
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
  UnregisteredUnifiedProvider,
} from "../core/unified/types";
