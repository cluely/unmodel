/**
 * `unmodel/3d` — one `threeD()` for asking any provider for a mesh.
 *
 * ```ts
 * import { threeD } from "unmodel/3d";
 *
 * const req = threeD({
 *   model: "tripo3d/v3.1-20260211",
 *   prompt: "a brass astrolabe on a walnut stand",
 * });
 *
 * const fromPhoto = threeD({
 *   model: "fal/fal-ai/hunyuan3d/v2",
 *   image: { url: "https://example.com/chair.png" },
 * });
 * ```
 *
 * Five words: the thing you want — described or shown — a seed, and the ref
 * that decides which model. There is no `size`, no `aspectRatio` and no
 * `resolution`, because a mesh has no frame; there is no `n`, because these
 * routes return one object per request.
 *
 * `createThreeD([…])` takes the adapters you name instead of all of them:
 *
 * ```ts
 * import { createThreeD } from "unmodel/3d";
 * import { threeD as tripo3d } from "unmodel/tripo3d/unified";
 *
 * const threeD = createThreeD([tripo3d]);
 * ```
 *
 * ## Why this category waited
 *
 * The other three surfaces added in 2026 shipped on one provider each. This one
 * did not, and the difference is the point: 3D is where a single-witness
 * vocabulary would have been most obviously a transcription. Two schemas in,
 * `texture` already had five spellings (`texture`, `textured_mesh`,
 * `enable_texture`, `should_texture`, `texture_mode`) and the output container
 * had four plus a boolean that changes it as a side effect. So the category
 * waited for a second, independent witness — Tripo's own v3 API next to fal's
 * nineteen curated endpoints — and kept only the words that survived both.
 *
 * ## `prompt` and `image` are alternatives, and the type knows which
 *
 * ```ts
 * threeD({ model: "fal/tripo3d/h3.1/text-to-3d", prompt: "a chair" });  // ok
 * threeD({ model: "fal/tripo3d/h3.1/text-to-3d", image: { url } });     // error: text-driven
 * threeD({ model: "fal/fal-ai/trellis", prompt: "a chair" });           // error: image-driven
 * threeD({ model: "fal/fal-ai/hyper3d/rodin/v2.5", prompt, image });    // ok — reads both
 * ```
 *
 * The mechanism is the `inputs` row field and the replacement-arm law in
 * `core/unified/vocabulary/model-params.ts` — the same one `unmodel/lipsync`,
 * `unmodel/avatar` and `unmodel/upscale` use, pointed for the first time at a
 * pair of fields that move in opposite directions.
 *
 * ## What is not in the vocabulary
 *
 * The polygon budget (`face_limit` / `face_count` / `target_polycount` /
 * `decimation_target`), the texture switches, the PBR switch, the quad-mesh
 * switch, the output container and every sampler dial. Each is a per-model
 * `extra`, typed from that endpoint's own wire interface, and each gets
 * promoted the day two independent vendors spell it the same way. Anything
 * else one-off goes in `providerOptions`, where it is still checked by the
 * provider's own validator.
 *
 * The result is the provider's own `Validated` (see `unmodel/image` for the
 * full explanation of what that means and why the pack is assembled by hand).
 */
import { createUnified } from "../core/unified/kernel";
import type {
  AnyThreeDAdapter,
  ThreeDParams,
  ThreeDValidator,
} from "../core/unified/vocabulary/3d";
import { threeD as fal } from "../providers/fal/unified-3d";
import { threeD as tripo3d } from "../providers/tripo3d/unified";

/** An adapter for this category; they live at `src/providers/<p>/unified.ts`. */
export type ThreeDAdapter = AnyThreeDAdapter;

/**
 * Builds a `threeD()` from the adapters you pass. The generic is on the array
 * element so each adapter's literal `provider`, `as const` `models` and
 * `as const` `modelParams` survive inference — driving autocomplete, the return
 * type, and the per-model `prompt`, `image` and extras narrowing alike.
 *
 * The cast is the same one `createUnified` already performs internally: the
 * runtime is category-agnostic, and `ThreeDValidator` differs from
 * `UnifiedValidator` only in the extra per-model constraints it puts on the
 * params.
 */
export function createThreeD<A extends ThreeDAdapter>(adapters: readonly A[]): ThreeDValidator<A> {
  return createUnified<ThreeDParams, A>("3d", adapters) as unknown as ThreeDValidator<A>;
}

/**
 * Every 3D adapter unmodel ships — the aggregator and the specialist.
 *
 * fal serves nineteen curated endpoints from seven vendors behind it; `tripo3d`
 * is Tripo's own v3 API, four models across two routes. They overlap on purpose:
 * `tripo3d/h3.1/image-to-3d` at fal and `tripo3d/v3.1-20260211` here are the
 * same model reached two ways, which is exactly the comparison
 * `unmodel/3d` exists to make cheap. Where they disagree on a word — and they
 * do, since fal renames Tripo's `input` to `image_url` and drops its
 * `smart_low_poly` — the disagreement lands in each row's `extras` rather than
 * in the vocabulary.
 *
 * The cost is pinned in `test/bundle-budget.test.ts`.
 */
export const threeD = createThreeD([fal, tripo3d]);

export type {
  AnyThreeDAdapter,
  DataRef,
  ModelExtras,
  ModelParamsFor,
  ProviderOptions,
  ThreeDAdapterFor,
  ThreeDImageInput,
  ThreeDImageOf,
  ThreeDInputKind,
  ThreeDModelNarrowing,
  ThreeDModelParams,
  ThreeDModelParamTable,
  ThreeDParams,
  ThreeDParamsBase,
  ThreeDValidator,
  UrlRef,
  WithModelParams,
} from "../core/unified/vocabulary/3d";

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

// Declaration-portability carriers. One type-only line; see
// src/core/carriers.ts for why a consumer that emits its own `.d.ts` cannot
// name this entry's inferred result types without it (TS2742 / TS2883).
export type * from "../core/carriers";
