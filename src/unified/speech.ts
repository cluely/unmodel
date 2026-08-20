/**
 * `unmodel/speech` — one `speech()` for every text-to-speech provider.
 *
 * ```ts
 * import { speech } from "unmodel/speech";
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
 * That `speech` is the ready-made pack: all fourteen providers, and therefore
 * all fourteen providers' catalogs and validators, in one bundle. To pay for
 * only the ones you call, build your own from the adapter leaves:
 *
 * ```ts
 * import { createSpeech } from "unmodel/speech";
 * import { speech as elevenlabs } from "unmodel/elevenlabs/unified";
 * import { speech as openai } from "unmodel/openai/unified";
 *
 * const speech = createSpeech([elevenlabs, openai]);
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
 * ## `outputFormat` and `language` narrow to the ref
 *
 * The vocabulary is one shape for everyone; what one *model* accepts is not.
 * Each adapter carries a `modelParams` table keyed by bare model id, and the
 * ref selects a row — so the codec list an editor offers is that endpoint's own,
 * in both spellings, and so is the language list:
 *
 * ```ts
 * speech({ model: "openai/tts-1",     text, outputFormat: "flac" });   // ok
 * speech({ model: "hume/octave",      text, outputFormat: "flac" });   // compile error — mp3 / pcm only
 * speech({ model: "cartesia/sonic-3", text, outputFormat: { format: "pcm_f32le", sampleRate: 44100 } });
 * speech({ model: "openai/gpt-4o-mini-tts", text, instructions: "…" }); // ok
 * speech({ model: "openai/tts-1",           text, instructions: "…" }); // compile error
 * ```
 *
 * `voice` deliberately stays wide at every provider — voice catalogs are
 * per-account, thousands of entries long and replaced between releases, so a
 * union of them would be stale and would refuse the caller's own cloned voice.
 * `language` completes without gating, because the canonical field is a BCP-47
 * *tag* and `"pt-BR"` is a working request the adapter sends as `"pt"`.
 * `sampleRate`/`bitrate` stay run time's job: their legal values depend on the
 * codec chosen beside them, and at ElevenLabs the legal pairs are not even the
 * cross product. `core/unified/vocabulary/model-params.ts` argues all three.
 *
 * The result is the provider's own `Validated` (see `unmodel/image` for the
 * full explanation of what that means and why the pack is assembled by hand).
 */
import { createUnified } from "../core/unified/kernel";
import type {
  AnySpeechAdapter,
  SpeechParams,
  SpeechValidator,
} from "../core/unified/vocabulary/speech";
import { speech as cartesia } from "../providers/cartesia/unified-speech";
import { speech as deepgram } from "../providers/deepgram/unified-speech";
import { speech as elevenlabs } from "../providers/elevenlabs/unified-speech";
import { speech as fishAudio } from "../providers/fish-audio/unified";
import { speech as hume } from "../providers/hume/unified";
import { speech as inworld } from "../providers/inworld/unified-speech";
import { speech as lmnt } from "../providers/lmnt/unified";
import { speech as minimax } from "../providers/minimax/unified-speech";
import { speech as murf } from "../providers/murf/unified";
import { speech as openai } from "../providers/openai/unified-speech";
import { speech as resemble } from "../providers/resemble/unified";
import { speech as rime } from "../providers/rime/unified";
import { speech as smallestAi } from "../providers/smallest-ai/unified";
import { speech as speechify } from "../providers/speechify/unified";

/** An adapter for this category; they live at `src/providers/<p>/unified.ts`. */
export type SpeechAdapter = AnySpeechAdapter;

/**
 * Builds a `speech()` from the adapters you pass.
 *
 * The generic is on the *array element*, not on `SpeechAdapter`, so the
 * adapters' literal `provider`, `as const` `models` and `as const`
 * `modelParams` survive inference — which is what makes `model:` autocomplete
 * `"cartesia/sonic-3"` rather than `string`, *and* what makes `outputFormat:`
 * accept that model's own codecs and nothing else.
 *
 * The cast is the same one `createUnified` already performs internally: the
 * runtime is category-agnostic, and `SpeechValidator` differs from
 * `UnifiedValidator` only in the extra per-model constraints it puts on the
 * params.
 */
export function createSpeech<A extends SpeechAdapter>(
  adapters: readonly A[],
): SpeechValidator<A> {
  return createUnified<SpeechParams, A>("speech", adapters) as unknown as SpeechValidator<A>;
}

/**
 * Every speech adapter unmodel ships, assembled by hand.
 *
 * By hand, and in one array, because that array is three things at once: the
 * runtime registry, the `"provider/model"` ref union an editor autocompletes,
 * and the return type of a call (each provider's own `Validated`). A generated
 * or dynamically-loaded registry would keep the first and lose the other two.
 *
 * The cost is honest and measured: importing this pulls in fourteen provider
 * validators, their schemas and their catalogs (~400 KiB, pinned in
 * `test/bundle-budget.test.ts`). `createSpeech([…])` above is the way to pay
 * for two providers instead of fourteen.
 */
export const speech = createSpeech([
  openai,
  elevenlabs,
  cartesia,
  deepgram,
  hume,
  minimax,
  rime,
  lmnt,
  fishAudio,
  murf,
  resemble,
  smallestAi,
  speechify,
  inworld,
]);

export type {
  AnySpeechAdapter,
  AudioContainer,
  AudioFormat,
  AudioFormatCodec,
  AudioFormatOf,
  AudioFormatRequest,
  CodecOf,
  LanguageOf,
  ModelExtras,
  ModelParamsFor,
  ProviderOptions,
  SpeechAdapterFor,
  SpeechModelNarrowing,
  SpeechModelParams,
  SpeechModelParamTable,
  SpeechParams,
  SpeechParamsBase,
  SpeechValidator,
  Voice,
  WithModelParams,
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
