/**
 * `unmodel/tts` — one `tts()` for every text-to-speech provider.
 *
 * ```ts
 * import { tts } from "unmodel/tts";
 *
 * const req = tts({
 *   model: "openai/gpt-4o-mini-tts",
 *   text: "The lighthouse keeper checked the lamp.",
 *   voice: "alloy",
 *   outputFormat: { format: "pcm_s16le", sampleRate: 24000 },
 *   speed: 1.1,
 * });
 * ```
 *
 * That `tts` is the ready-made pack: all fifteen providers, and therefore
 * all fifteen providers' catalogs and validators, in one bundle. To pay for
 * only the ones you call, build your own from the adapter leaves:
 *
 * ```ts
 * import { createTts } from "unmodel/tts";
 * import { tts as elevenlabs } from "unmodel/elevenlabs/unified";
 * import { tts as openai } from "unmodel/openai/unified";
 *
 * const tts = createTts([elevenlabs, openai]);
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
 * tts({ model: "openai/tts-1",     text, outputFormat: "flac" });   // ok
 * tts({ model: "hume/octave",      text, outputFormat: "flac" });   // compile error — mp3 / pcm only
 * tts({ model: "cartesia/sonic-3", text, outputFormat: { format: "pcm_f32le", sampleRate: 44100 } });
 * tts({ model: "openai/gpt-4o-mini-tts", text, instructions: "…" }); // ok
 * tts({ model: "openai/tts-1",           text, instructions: "…" }); // compile error
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
  AnyTtsAdapter,
  TtsParams,
  TtsValidator,
} from "../core/unified/vocabulary/tts";
import { tts as cartesia } from "../providers/cartesia/unified-tts";
import { tts as deepgram } from "../providers/deepgram/unified-tts";
import { tts as elevenlabs } from "../providers/elevenlabs/unified-tts";
import { tts as fishAudio } from "../providers/fish-audio/unified-tts";
import { tts as google } from "../providers/google/unified-tts";
import { tts as hume } from "../providers/hume/unified";
import { tts as inworld } from "../providers/inworld/unified-tts";
import { tts as lmnt } from "../providers/lmnt/unified-tts";
import { tts as minimax } from "../providers/minimax/unified-tts";
import { tts as murf } from "../providers/murf/unified";
import { tts as openai } from "../providers/openai/unified-tts";
import { tts as resemble } from "../providers/resemble/unified";
import { tts as rime } from "../providers/rime/unified";
import { tts as smallestAi } from "../providers/smallest-ai/unified";
import { tts as speechify } from "../providers/speechify/unified";

/** An adapter for this category; they live at `src/providers/<p>/unified.ts`. */
export type TtsAdapter = AnyTtsAdapter;

/**
 * Builds a `tts()` from the adapters you pass.
 *
 * The generic is on the *array element*, not on `TtsAdapter`, so the
 * adapters' literal `provider`, `as const` `models` and `as const`
 * `modelParams` survive inference — which is what makes `model:` autocomplete
 * `"cartesia/sonic-3"` rather than `string`, *and* what makes `outputFormat:`
 * accept that model's own codecs and nothing else.
 *
 * The cast is the same one `createUnified` already performs internally: the
 * runtime is category-agnostic, and `TtsValidator` differs from
 * `UnifiedValidator` only in the extra per-model constraints it puts on the
 * params.
 */
export function createTts<A extends TtsAdapter>(
  adapters: readonly A[],
): TtsValidator<A> {
  return createUnified<TtsParams, A>("tts", adapters) as unknown as TtsValidator<A>;
}

/**
 * Every speech adapter unmodel ships, assembled by hand.
 *
 * By hand, and in one array, because that array is three things at once: the
 * runtime registry, the `"provider/model"` ref union an editor autocompletes,
 * and the return type of a call (each provider's own `Validated`). A generated
 * or dynamically-loaded registry would keep the first and lose the other two.
 *
 * The cost is honest and measured: importing this pulls in fifteen provider
 * validators, their schemas and their catalogs (~430 KiB, pinned in
 * `test/bundle-budget.test.ts`). `createTts([…])` above is the way to pay
 * for two providers instead of fifteen.
 */
export const tts = createTts([
  openai,
  elevenlabs,
  cartesia,
  deepgram,
  google,
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
  AnyTtsAdapter,
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
  TtsAdapterFor,
  TtsModelNarrowing,
  TtsModelParams,
  TtsModelParamTable,
  TtsParams,
  TtsParamsBase,
  TtsValidator,
  Voice,
  WithModelParams,
} from "../core/unified/vocabulary/tts";

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
