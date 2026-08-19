/**
 * `unmodel/speech` — one `speech()` for every text-to-speech provider.
 *
 * ```ts
 * import { createSpeech } from "unmodel/speech";
 * import { elevenlabsSpeech } from "unmodel/elevenlabs";
 * import { openaiSpeech } from "unmodel/openai";
 *
 * const speech = createSpeech([elevenlabsSpeech, openaiSpeech]);
 *
 * const req = speech({
 *   model: "openai/gpt-4o-mini-tts",
 *   text: "The lighthouse keeper checked the lamp.",
 *   voice: "alloy",
 *   outputFormat: { format: "pcm_s16le", sampleRate: 24000 },
 *   speed: 1.1,
 * });
 * ```
 *
 * ## The two params worth knowing about
 *
 * `speed` is a **multiplier** — `1` normal, `2` twice as fast — because it is
 * the only convention that is unambiguous without a unit. Providers encode it
 * as a multiplier, as its reciprocal (a *time* scale), and as a signed
 * percentage; the reciprocal is exact and silent, and the percentage is
 * integral, so a speed it cannot represent exactly is sent rounded and warned
 * about, naming the speed actually achieved.
 *
 * `outputFormat` takes either a codec shorthand (`"mp3"`) or a fully-spelled
 * encoding. `bitrate` is in **bits per second** throughout, so the one place a
 * kbps conversion happens is a named function whose exactness is asserted.
 *
 * The result is the provider's own `Validated` (see `unmodel/image` for the
 * full explanation of what that means and why the pack is assembled by hand).
 */
import { createUnified } from "../core/unified/kernel";
import type { AnyUnifiedAdapter, UnifiedValidator } from "../core/unified/types";
import type { SpeechParams } from "../core/unified/vocabulary/speech";

/** An adapter for this category; they live at `src/providers/<p>/unified.ts`. */
export type SpeechAdapter = AnyUnifiedAdapter<SpeechParams> & { readonly category: "speech" };

/**
 * Builds a `speech()` from the adapters you pass. The generic is on the array
 * element so each adapter's literal `provider` and `as const` `models` survive
 * inference and drive both autocomplete and the return type.
 */
export function createSpeech<A extends SpeechAdapter>(
  adapters: readonly A[],
): UnifiedValidator<SpeechParams, A> {
  return createUnified<SpeechParams, A>("speech", adapters);
}

/**
 * The zero-argument `speech()` carrying every adapter unmodel ships lands here
 * once there are adapters to carry — see the layering note in
 * `src/unified/image.ts` for why the convenience pack is deliberately not part
 * of the commit that introduces the kernel.
 */

export type {
  AudioContainer,
  AudioFormat,
  AudioFormatCodec,
  AudioFormatRequest,
  ProviderOptions,
  SpeechParams,
  Voice,
} from "../core/unified/vocabulary/speech";

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
