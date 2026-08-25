/**
 * `unmodel/lipsync` — one `lipsync()` for redubbing a clip.
 *
 * ```ts
 * import { lipsync } from "unmodel/lipsync";
 *
 * const req = lipsync({
 *   model: "fal/fal-ai/sync-lipsync/v3",
 *   source: { url: "https://example.com/take-3.mp4" },
 *   audio: { url: "https://example.com/vo-french.wav" },
 * });
 * ```
 *
 * Five words: the clip, the track, a seed where the model has one, and the ref
 * that decides which model. There is nothing to say about size, length or
 * shape because the output's geometry IS the input's — which is what separates
 * this from `unmodel/video`, where every one of those is a decision the caller
 * makes.
 *
 * `createLipsync([…])` takes the adapters you name instead of all of them:
 *
 * ```ts
 * import { createLipsync } from "unmodel/lipsync";
 * import { lipsync as fal } from "unmodel/fal/unified";
 *
 * const lipsync = createLipsync([fal]);
 * ```
 *
 * ## `source` narrows to the ref
 *
 * Which shape a route accepts is a per-model fact, and the type says so: a
 * still handed to a clip-only model is a compile error on `source`, naming the
 * shape that model takes, rather than a request that 422s. The mechanism is
 * the `sources` row field and the replacement-arm law in
 * `core/unified/vocabulary/model-params.ts`; the sibling category
 * `unmodel/avatar` uses the same one in the other direction.
 *
 * ```ts
 * lipsync({ model: "fal/fal-ai/sync-lipsync/v3", source: { url }, audio: { url } });   // ok
 * lipsync({                                                                            // compile error
 *   model: "fal/fal-ai/sync-lipsync/v3",
 *   source: { data, mimeType: "image/png" },
 *   audio: { url },
 * });
 * ```
 *
 * ## What is not in the vocabulary
 *
 * "What to do when the audio outlasts the clip" is `sync_mode` with five arms
 * at sync., `loop_mode` with two at LatentSync, and absent at VEED and Kling.
 * One idea, three vocabularies — so it is a per-model extra rather than a
 * canonical word, arrives typed from that endpoint's own wire interface, and
 * gets promoted the day two providers agree on a spelling. Anything else
 * one-off rides in `providerOptions`, where it is still checked by the
 * provider's own validator.
 *
 * Routes that take a script and a voice id instead of an audio track are TTS
 * composed with lipsync; composing them inside one call would hide which half
 * failed, so they are not curated.
 *
 * The result is the provider's own `Validated` (see `unmodel/image` for the
 * full explanation of what that means and why the pack is assembled by hand).
 */
import { createUnified } from "../core/unified/kernel";
import type {
  AnyLipsyncAdapter,
  LipsyncParams,
  LipsyncValidator,
} from "../core/unified/vocabulary/lipsync";
import { lipsync as fal } from "../providers/fal/unified-lipsync";

/** An adapter for this category; they live at `src/providers/<p>/unified.ts`. */
export type LipsyncAdapter = AnyLipsyncAdapter;

/**
 * Builds a `lipsync()` from the adapters you pass. The generic is on the array
 * element so each adapter's literal `provider`, `as const` `models` and
 * `as const` `modelParams` survive inference — driving autocomplete, the return
 * type, and the per-model `source` and extras narrowing alike.
 *
 * The cast is the same one `createUnified` already performs internally: the
 * runtime is category-agnostic, and `LipsyncValidator` differs from
 * `UnifiedValidator` only in the extra per-model constraints it puts on the
 * params.
 */
export function createLipsync<A extends LipsyncAdapter>(
  adapters: readonly A[],
): LipsyncValidator<A> {
  return createUnified<LipsyncParams, A>("lipsync", adapters) as unknown as LipsyncValidator<A>;
}

/**
 * Every lipsync adapter unmodel ships — one provider today, and the pack exists
 * all the same.
 *
 * One provider is not a reason to skip the pack: the pack is what makes
 * `import { lipsync } from "unmodel/lipsync"` work the same way it does for
 * every other category, and adding a second provider is then a one-line change
 * here rather than a new public surface. It is also the smallest pack in the
 * library by some distance — one validator, one union schema, ten generated
 * rows — which is exactly what the category being five words buys.
 *
 * fal serves ten endpoints behind it: sync.'s v2, v2/pro and v3, VEED's two
 * generations, LatentSync, Kling's lipsync route, PixVerse's, and HeyGen v3's
 * precision and speed arms. The cost is pinned in `test/bundle-budget.test.ts`.
 */
export const lipsync = createLipsync([fal]);

export type {
  AnyLipsyncAdapter,
  DataRef,
  LipsyncAdapterFor,
  LipsyncAudio,
  LipsyncImageSource,
  LipsyncModelNarrowing,
  LipsyncModelParams,
  LipsyncModelParamTable,
  LipsyncParams,
  LipsyncParamsBase,
  LipsyncSource,
  LipsyncSourceFor,
  LipsyncSourceKind,
  LipsyncSourceOf,
  LipsyncValidator,
  LipsyncVideoSource,
  ModelExtras,
  ModelParamsFor,
  ProviderOptions,
  UrlRef,
  WithModelParams,
} from "../core/unified/vocabulary/lipsync";

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
