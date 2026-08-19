/**
 * `unmodel/music` — one `music()` for every music-generation provider.
 *
 * ```ts
 * import { createMusic } from "unmodel/music";
 * import { elevenlabsMusic } from "unmodel/elevenlabs";
 *
 * const music = createMusic([elevenlabsMusic]);
 *
 * const req = music({
 *   model: "elevenlabs/music-v1",
 *   prompt: "slow post-rock build, no vocals",
 *   durationSeconds: 45,
 *   instrumental: true,
 * });
 * ```
 *
 * The smallest of the six vocabularies, deliberately: music APIs disagree
 * about everything above the prompt, and a canonical word for something three
 * providers interpret differently would make this category's warnings
 * meaningless — which is the one thing a translation layer cannot afford.
 * Anything one-off rides in `providerOptions`, where it is still checked by
 * the provider's own validator.
 *
 * The result is the provider's own `Validated` (see `unmodel/image` for the
 * full explanation of what that means and why the pack is assembled by hand).
 */
import { createUnified } from "../core/unified/kernel";
import type { AnyUnifiedAdapter, UnifiedValidator } from "../core/unified/types";
import type { MusicParams } from "../core/unified/vocabulary/music";

/** An adapter for this category; they live at `src/providers/<p>/unified.ts`. */
export type MusicAdapter = AnyUnifiedAdapter<MusicParams> & { readonly category: "music" };

/**
 * Builds a `music()` from the adapters you pass. The generic is on the array
 * element so each adapter's literal `provider` and `as const` `models` survive
 * inference and drive both autocomplete and the return type.
 */
export function createMusic<A extends MusicAdapter>(
  adapters: readonly A[],
): UnifiedValidator<MusicParams, A> {
  return createUnified<MusicParams, A>("music", adapters);
}

/**
 * The zero-argument `music()` carrying every adapter unmodel ships lands here
 * once there are adapters to carry — see the layering note in
 * `src/unified/image.ts` for why the convenience pack is deliberately not part
 * of the commit that introduces the kernel.
 */

export type {
  AudioContainer,
  AudioFormat,
  AudioFormatCodec,
  AudioFormatRequest,
  MusicParams,
  ProviderOptions,
} from "../core/unified/vocabulary/music";

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
