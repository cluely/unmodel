/**
 * `unmodel/image-edit` — one `imageEdit()` for every image-to-image provider.
 *
 * ```ts
 * import { imageEdit } from "unmodel/image-edit";
 *
 * const req = imageEdit({
 *   operation: "edit",
 *   model: "openai/gpt-image-1.5",
 *   prompt: "make it winter",
 *   image: { file: png },
 * });
 * ```
 *
 * A separate category from `image` because it is a separate endpoint almost
 * everywhere, with its own model list and its own params — see the note in
 * `core/unified/vocabulary/image-edit.ts`.
 *
 * That `imageEdit` is the ready-made pack: four providers, and therefore four
 * providers' catalogs and validators, in one bundle. To pay for only the ones
 * you call, build your own from the adapter leaves:
 *
 * ```ts
 * import { createImageEdit } from "unmodel/image-edit";
 * import { imageEdit as openai } from "unmodel/openai/unified";
 * import { imageEdit as recraft } from "unmodel/recraft/unified";
 *
 * const imageEdit = createImageEdit([openai, recraft]);
 * ```
 *
 * ## `image` narrows per model, at compile time
 *
 * Editing APIs disagree about how the source picture arrives — a multipart
 * upload, a URL they fetch, base64 inline — and the disagreement is per *route*,
 * not per provider. So each adapter declares its `imageInputs`,
 * `ImageEditInputFor` turns that set into the exact `image` type for the route,
 * and a caller who hands a multipart-only endpoint a URL gets a type error at
 * the call site rather than a validated request that 400s on a body the route
 * does not parse:
 *
 * ```ts
 * imageEdit({ …, model: "openai/gpt-image-1.5",              image: { file } }); // ok
 * imageEdit({ …, model: "openai/gpt-image-1.5",              image: { url } });  // compile error
 * imageEdit({ …, model: "black-forest-labs/flux-kontext-pro", image: { data } }); // ok
 * imageEdit({ …, model: "black-forest-labs/flux-kontext-pro", image: { file } }); // compile error
 * ```
 *
 * The same array backs it at run time — `resolveImageEditInput` reports an
 * `unsupported_param` naming the shapes the route does take — because the type
 * only answers for TypeScript callers with a literal ref, and the promise has to
 * hold for everyone else too.
 *
 * ## `size` and the per-model params narrow the same way
 *
 * Same mechanism as `unmodel/image`, and the same table: each adapter carries a
 * `modelParams` row per model, so `size` autocompletes that model's presets,
 * `aspectRatio` its own ratios, and the edits route's non-canonical params —
 * `background`, `input_fidelity`, Recraft's curated `style` lists — appear with
 * their exact types and go on the wire verbatim.
 *
 * ```ts
 * imageEdit({ …, model: "openai/gpt-image-1",   background: "transparent" }); // ok
 * imageEdit({ …, model: "openai/gpt-image-2",   background: "transparent" }); // compile error
 * imageEdit({ …, model: "openai/gpt-image-1-mini", input_fidelity: "high" }); // compile error
 * ```
 *
 * ## `strength` means one thing, in one direction
 *
 * `0` keeps the source, `1` ignores it — "how much may this change". Providers
 * spell that a dozen ways and at least one of them spells it **backwards**:
 * Ideogram's `image_weight` is how strongly the output should *resemble* the
 * input, so `strength: 0` is `image_weight: 100`. Every adapter declares its
 * scale as the wire values at canonical 0 and 1, so the inversion is one number
 * swapped rather than a minus sign hidden in a branch, and
 * `test/unified/image-edit-capabilities.test.ts` asserts the direction by
 * compiling two requests and checking which way the wire value moves.
 *
 * ## Masked operations are wire-only in v1
 *
 * `operation` is `"edit"` and only `"edit"`. Inpainting, outpainting, erase,
 * background replacement and virtual try-on all need a second image or a set of
 * pixels that this vocabulary has no word for — so they stay reachable by name
 * at `unmodel/<provider>` (`recraft.imageEditInpaint`,
 * `stability.imageEditSearchAndReplace`, `black-forest-labs.imageEditFill`, …).
 * The discriminant exists so they can join later without either widening
 * `ImageEditParams` into a shape where half the fields are conditional, or
 * minting a seventh entry point.
 *
 * The result is the provider's own `Validated` (see `unmodel/image` for the
 * full explanation of what that means and why the pack is assembled by hand).
 */
import { createUnified } from "../core/unified/kernel";
import type {
  AnyImageEditAdapter,
  ImageEditParams,
  ImageEditValidator,
} from "../core/unified/vocabulary/image-edit";
import { imageEdit as blackForestLabs } from "../providers/black-forest-labs/unified-image-edit";
import { imageEdit as ideogram } from "../providers/ideogram/unified-image-edit";
import { imageEdit as openai } from "../providers/openai/unified-image-edit";
import { imageEdit as recraft } from "../providers/recraft/unified-image-edit";

/** An adapter for this category; they live at `src/providers/<p>/unified.ts`. */
export type ImageEditAdapter = AnyImageEditAdapter;

/**
 * Builds an `imageEdit()` from the adapters you pass. The generic is on the
 * array element so each adapter's literal `provider`, `as const` `models` and
 * `as const` `imageInputs` survive inference — and therefore drive
 * autocomplete, the return type, *and* the per-model `image` narrowing.
 *
 * The cast is the same one `createUnified` already performs internally: the
 * runtime is category-agnostic, and `ImageEditValidator` differs from
 * `UnifiedValidator` only in the extra constraint it puts on the params.
 */
export function createImageEdit<A extends ImageEditAdapter>(
  adapters: readonly A[],
): ImageEditValidator<A> {
  return createUnified<ImageEditParams, A>(
    "imageEdit",
    adapters,
  ) as unknown as ImageEditValidator<A>;
}

/**
 * Every image-edit adapter unmodel ships, assembled by hand.
 *
 * By hand, and in one array, because that array is four things at once: the
 * runtime registry, the `"provider/model"` ref union an editor autocompletes,
 * the return type of a call (each provider's own `Validated`) — and, as in
 * `stt`, the per-ref `image` narrowing. A generated or
 * dynamically-loaded registry would keep the first and lose the other three.
 *
 * Four providers rather than the eight that ship an editing route, and the four
 * are exactly the ones with a route this vocabulary can express: image, prompt,
 * no mask. Stability's six routes, Luma's reframe and BFL's FLUX Tools family
 * are all mask- or geometry-driven; Bria's `imageEdit` and Reve's are neither
 * (they are prompt-driven), and they are the obvious next adapters — they are
 * out of this wave rather than out of the category.
 *
 * The cost is honest and measured: importing this pulls in four provider
 * validators, their schemas and their catalogs (~250 KiB, pinned in
 * `test/bundle-budget.test.ts`). `createImageEdit([…])` above is the way to pay
 * for two providers instead of four.
 */
export const imageEdit = createImageEdit([openai, blackForestLabs, ideogram, recraft]);

export type {
  AnyImageEditAdapter,
  AspectRatio,
  AspectRatioPreset,
  Dimensions,
  ImageEditAdapterFor,
  ImageEditDataInput,
  ImageEditFileInput,
  ImageEditInput,
  ImageEditInputFor,
  ImageEditInputKind,
  ImageEditParams,
  ImageEditParamsFor,
  ImageEditUrlInput,
  ImageEditValidator,
  ImageNarrowing,
  ImageOutputFormat,
  ModelExtras,
  ModelParams,
  ModelParamTable,
  ModelParamsFor,
  ModelShape,
  ProviderOptions,
  WithModelParams,
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
  UnregisteredUnifiedProvider,
} from "../core/unified/types";
