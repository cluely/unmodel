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
import { lipsync as heygen } from "../providers/heygen/unified-lipsync";
import { lipsync as sync } from "../providers/sync/unified-lipsync";
import { lipsync as veed } from "../providers/veed/unified-lipsync";

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
 * Every lipsync adapter unmodel ships — four providers, and three of them are
 * vendors fal is reselling.
 *
 * fal serves ten endpoints: sync.'s v2, v2/pro and v3, VEED's two generations,
 * LatentSync, Kling's lipsync route, PixVerse's, and HeyGen v3's precision and
 * speed arms. The other three are those same vendors reached at their own APIs
 * — which makes this the sharpest comparison in the library, because several of
 * these paths reach the SAME WEIGHTS and still compile to visibly different
 * bodies:
 *
 * ```ts
 * lipsync({ model: "fal/fal-ai/sync-lipsync/v2", source: { url }, audio: { url } });
 * // → { model: "lipsync-2", video_url: "…", audio_url: "…" }
 *
 * lipsync({ model: "sync/lipsync-2", source: { url }, audio: { url } });
 * // → { model: "lipsync-2", input: [ { type: "video", url: "…" },
 * //                                  { type: "audio", url: "…" } ] }
 *
 * lipsync({ model: "veed/lipsync-2.0", source: { url }, audio: { url } });
 * // → { video_url: "…", audio_url: "…" }
 *
 * lipsync({ model: "heygen/lipsync-speed", source: { url }, audio: { url } });
 * // → { video: { type: "url", url: "…" }, audio: { type: "url", url: "…" }, mode: "speed" }
 * ```
 *
 * Four wire shapes for one request. Two flat URL fields at fal; a tagged ARRAY
 * at sync., which is what carries several voices, `refId`s, `segments` and
 * dubbing; two flat fields and NOTHING ELSE at VEED, whose whole input schema
 * is those two required URLs; and tagged OBJECTS plus a `mode` at HeyGen, where
 * the ref names a price rather than a model. None of them is a superset of
 * another. That comparison is pinned in the golden tree rather than described.
 *
 * The four also settle the category's oldest open question by failing to answer
 * it. `unmodel/lipsync` has never had a canonical word for "what happens when
 * the track outlasts the clip", and the promotion rule asks for two independent
 * vendors spelling one compatibly. What the fourth provider produced was a
 * fourth answer: `sync_mode` (a five-arm enum) at sync., `loop_mode` (two arms)
 * at LatentSync, `enable_dynamic_duration` (a boolean) at HeyGen, and no field
 * at all at VEED. Three shapes and an absence is not a vocabulary; see
 * `core/unified/vocabulary/lipsync.ts`.
 *
 * The cost of all four is pinned in `test/bundle-budget.test.ts`.
 */
export const lipsync = createLipsync([fal, heygen, sync, veed]);

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
