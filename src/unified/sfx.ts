/**
 * `unmodel/sfx` — one `sfx()` for asking any provider to make a noise.
 *
 * ```ts
 * import { sfx } from "unmodel/sfx";
 *
 * const req = sfx({
 *   model: "elevenlabs/eleven_text_to_sound_v2",
 *   prompt: "a heavy oak door creaking open in a stone hall",
 *   durationSeconds: 4,
 * });
 *
 * const viaFal = sfx({
 *   model: "fal/fal-ai/stable-audio-3/small/sfx/text-to-audio",
 *   prompt: "footsteps on wet gravel",
 *   outputFormat: "flac",
 * });
 * ```
 *
 * Four words: what to make, how long, in what encoding, and the ref that
 * decides which model. There is no voice, no key, no `instrumental` and no
 * frame — a sound effect is a description and a length.
 *
 * `createSfx([…])` takes the adapters you name instead of all of them:
 *
 * ```ts
 * import { createSfx } from "unmodel/sfx";
 * import { sfx as elevenlabs } from "unmodel/elevenlabs/unified";
 *
 * const sfx = createSfx([elevenlabs]);
 * ```
 *
 * ## Why this is not `unmodel/music`
 *
 * The one vendor that serves both serves them as disjoint wires with disjoint
 * model-id enums: `/v1/music` counts MILLISECONDS with a floor of 3 000 and
 * takes a `composition_plan` and a `force_instrumental`;
 * `/v1/sound-generation` counts seconds with a floor of **0.5** and takes a
 * `loop` and a `prompt_influence`. Folding them together would push the
 * category floor from three seconds to half of one and put
 * `instrumental?: boolean` on a door creak.
 *
 * ## Omitting `durationSeconds` is a real decision, and the type says so
 *
 * This is the category's one sharp edge, and it is sharp because the five
 * vendors genuinely disagree about it:
 *
 * ```ts
 * sfx({ model: "elevenlabs/eleven_text_to_sound_v2", prompt });               // ok, no warning
 * sfx({ model: "fal/sonilo/v1.1/text-to-sound-effects", prompt });            // ok + approximated_param: 8s
 * sfx({ model: "fal/cassetteai/sound-effects-generator", prompt });           // compile error
 * sfx({ model: "fal/cassetteai/sound-effects-generator", prompt, durationSeconds: 3 });
 * ```
 *
 * Both ElevenLabs routes read a length off the prompt, so nothing is invented
 * and nothing warns. Sonilo, Mirelo and Stable Audio silently substitute 8, 10
 * and 30 seconds, so the compile warns naming the number — a request you can
 * reproduce rather than one you cannot. CassetteAI requires the field, so it is
 * REQUIRED at the keystroke. What never happens is a literal `"auto"` on the
 * wire: not one of these six fields has such a value.
 *
 * ## What is not in the vocabulary
 *
 * `loop` (one witness — ElevenLabs; Mirelo's `ambience` changes what is
 * generated, not where it ends), `prompt_influence`, `seed`, `negative_prompt`,
 * `guidance_scale`, `num_samples`, `enable_prompt_expansion`. Each is a
 * per-model `extra`, typed from that endpoint's own wire interface, and each
 * gets promoted the day two independent vendors spell it the same way. Anything
 * else one-off goes in `providerOptions`, where it is still checked by the
 * provider's own validator.
 *
 * The result is the provider's own `Validated` (see `unmodel/image` for the
 * full explanation of what that means and why the pack is assembled by hand).
 */
import { createUnified } from "../core/unified/kernel";
import type { AnySfxAdapter, SfxParams, SfxValidator } from "../core/unified/vocabulary/sfx";
import { sfx as elevenlabs } from "../providers/elevenlabs/unified-sfx";
import { sfx as fal } from "../providers/fal/unified-sfx";

/** An adapter for this category; they live at `src/providers/<p>/unified.ts`. */
export type SfxAdapter = AnySfxAdapter;

/**
 * Builds an `sfx()` from the adapters you pass. The generic is on the array
 * element so each adapter's literal `provider`, `as const` `models` and
 * `as const` `modelParams` survive inference — driving autocomplete, the return
 * type, and the per-model `durationSeconds` requiredness, `outputFormat`
 * narrowing and extras alike.
 *
 * The cast is the same one `createUnified` already performs internally: the
 * runtime is category-agnostic, and `SfxValidator` differs from
 * `UnifiedValidator` only in the extra per-model constraints it puts on the
 * params.
 */
export function createSfx<A extends SfxAdapter>(adapters: readonly A[]): SfxValidator<A> {
  return createUnified<SfxParams, A>("sfx", adapters) as unknown as SfxValidator<A>;
}

/**
 * Every sound-effect adapter unmodel ships — the specialist and the aggregator.
 *
 * `elevenlabs` is ElevenLabs' own `/v1/sound-generation`, one model; `fal`
 * serves six curated endpoints from five vendors behind it, ElevenLabs among
 * them. They overlap on purpose, and the overlap is NARROWED rather than
 * mirrored: fal's resale of the same model caps the length at 22 seconds
 * instead of 30, moves `output_format` from the query string into the body,
 * caps the prompt at 450 characters and has no model field at all. That
 * comparison is exactly what `unmodel/sfx` exists to make cheap, and it is
 * pinned in the golden tree rather than described.
 *
 * The cost is pinned in `test/bundle-budget.test.ts`.
 */
export const sfx = createSfx([elevenlabs, fal]);

export type {
  AnySfxAdapter,
  AudioContainer,
  AudioFormat,
  AudioFormatCodec,
  AudioFormatOf,
  AudioFormatRequest,
  CodecOf,
  ModelExtras,
  ModelParamsFor,
  ProviderOptions,
  SfxAdapterFor,
  SfxModelNarrowing,
  SfxModelParams,
  SfxModelParamTable,
  SfxParams,
  SfxParamsBase,
  SfxValidator,
  WithModelParams,
} from "../core/unified/vocabulary/sfx";

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
