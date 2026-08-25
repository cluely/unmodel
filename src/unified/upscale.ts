/**
 * `unmodel/upscale` — one `upscale()` for making a frame bigger.
 *
 * ```ts
 * import { upscale } from "unmodel/upscale";
 *
 * const req = upscale({
 *   model: "fal/fal-ai/clarity-upscaler",
 *   source: { url: "https://example.com/still.png" },
 *   factor: 2,
 * });
 * ```
 *
 * Five words: the thing to enlarge, how much bigger, an optional prompt where
 * the model steers on one, and the ref that decides which model. There is no
 * `aspectRatio` because the shape is the input's, no `resolution` because the
 * answer is a MULTIPLE rather than a tier, and no `n` because a
 * super-resolution route returns one output for one input.
 *
 * `createUpscale([…])` takes the adapters you name instead of all of them:
 *
 * ```ts
 * import { createUpscale } from "unmodel/upscale";
 * import { upscale as fal } from "unmodel/fal/unified";
 *
 * const upscale = createUpscale([fal]);
 * ```
 *
 * ## Why this is not an arm of `unmodel/image-edit`
 *
 * Half of these routes take a CLIP, which `imageEdit` has no word for and
 * should not grow one — an "edit" that returns three hundred frames is a
 * different operation with different economics. And `factor` has no meaning in
 * a vocabulary whose size words are absolute: editing is described by what the
 * result should look like, upscaling by how much bigger it should be. Folding
 * them together would give a params type where `factor` is dead for seventeen
 * models and `size` is dead for ten.
 *
 * ## `source` and `factor` narrow to the ref
 *
 * Both are per-model facts and the type says so:
 *
 * ```ts
 * upscale({ model: "fal/fal-ai/seedvr/upscale/video", source: { url }, factor: 2 });    // ok
 * upscale({ model: "fal/fal-ai/aura-sr", source: { url }, factor: 2 });                 // error: 4 only
 * upscale({ model: "fal/fal-ai/recraft/upscale/crisp", source: { url }, factor: 2 });   // error: no factor
 * ```
 *
 * The mechanism is the `sources` / `factors` row fields and the
 * replacement-arm law in `core/unified/vocabulary/model-params.ts` — the same
 * one `unmodel/lipsync` and `unmodel/avatar` use, pointed at a category where
 * the two shapes genuinely coexist rather than separating two categories.
 *
 * ## What is not in the vocabulary
 *
 * `creativity`, `resemblance`, `denoise`, `sharpen`, `texture`, `detail`,
 * `face_enhancement` — every one of them a single vendor's word for a single
 * vendor's dial, with no second witness anywhere. They ride as per-model
 * `extras`, arrive typed from that endpoint's own wire interface, and get
 * promoted the day two providers agree on a spelling. Anything else one-off
 * goes in `providerOptions`, where it is still checked by the provider's own
 * validator.
 *
 * The result is the provider's own `Validated` (see `unmodel/image` for the
 * full explanation of what that means and why the pack is assembled by hand).
 */
import { createUnified } from "../core/unified/kernel";
import type {
  AnyUpscaleAdapter,
  UpscaleParams,
  UpscaleValidator,
} from "../core/unified/vocabulary/upscale";
import { upscale as fal } from "../providers/fal/unified-upscale";

/** An adapter for this category; they live at `src/providers/<p>/unified.ts`. */
export type UpscaleAdapter = AnyUpscaleAdapter;

/**
 * Builds an `upscale()` from the adapters you pass. The generic is on the array
 * element so each adapter's literal `provider`, `as const` `models` and
 * `as const` `modelParams` survive inference — driving autocomplete, the return
 * type, and the per-model `source`, `factor` and extras narrowing alike.
 *
 * The cast is the same one `createUnified` already performs internally: the
 * runtime is category-agnostic, and `UpscaleValidator` differs from
 * `UnifiedValidator` only in the extra per-model constraints it puts on the
 * params.
 */
export function createUpscale<A extends UpscaleAdapter>(
  adapters: readonly A[],
): UpscaleValidator<A> {
  return createUnified<UpscaleParams, A>("upscale", adapters) as unknown as UpscaleValidator<A>;
}

/**
 * Every upscale adapter unmodel ships — one provider today, and the pack exists
 * all the same.
 *
 * One provider is not a reason to skip the pack: the pack is what makes
 * `import { upscale } from "unmodel/upscale"` work the same way it does for
 * every other category, and adding a second provider is then a one-line change
 * here rather than a new public surface.
 *
 * fal serves ten endpoints behind it, across two media: Clarity, AuraSR,
 * Real-ESRGAN, Recraft and SeedVR for stills; Topaz, SeedVR and FLUX for clips;
 * and Topaz's generative arm for either. The cost is pinned in
 * `test/bundle-budget.test.ts`.
 */
export const upscale = createUpscale([fal]);

export type {
  AnyUpscaleAdapter,
  DataRef,
  ModelExtras,
  ModelParamsFor,
  ProviderOptions,
  UpscaleAdapterFor,
  UpscaleFactorOf,
  UpscaleImageSource,
  UpscaleModelNarrowing,
  UpscaleModelParams,
  UpscaleModelParamTable,
  UpscaleParams,
  UpscaleParamsBase,
  UpscaleSource,
  UpscaleSourceFor,
  UpscaleSourceKind,
  UpscaleSourceOf,
  UpscaleValidator,
  UpscaleVideoSource,
  UrlRef,
  WithModelParams,
} from "../core/unified/vocabulary/upscale";

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
