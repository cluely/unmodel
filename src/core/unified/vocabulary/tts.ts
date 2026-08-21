/**
 * `unmodel/tts` — the canonical vocabulary for text-to-speech.
 */
import type { ExactKeys } from "../../request";
import type { ValidateOptions } from "../../options";
import type { ValidateResult } from "../../result";
import type {
  AnyUnifiedAdapter,
  SafeUnknown,
  UnifiedAdapter,
  UnifiedInput,
  UnifiedRef,
  UnifiedResult,
} from "../types";
import type { AudioFormatRequest } from "./audio";
import type { ProviderOptions } from "./common";
import type {
  ModelExtras,
  TtsModelNarrowing,
  TtsModelParamTable,
  WithModelParams,
} from "./model-params";

export type {
  AudioContainer,
  AudioFormat,
  AudioFormatCodec,
  AudioFormatRequest,
} from "./audio";
export type { ProviderOptions } from "./common";

export type {
  AudioFormatOf,
  CodecOf,
  LanguageOf,
  ModelExtras,
  ModelParamsFor,
  TtsModelNarrowing,
  TtsModelParams,
  TtsModelParamTable,
  VoiceOf,
  WithModelParams,
} from "./model-params";

/**
 * Which voice.
 *
 * Three spellings because providers genuinely disagree about what a voice
 * *is*: an opaque id (`"21m00Tcm4TlvDq8ikWAM"`), a human name (`"Kore"`), or
 * either. The bare string is the shorthand for whichever one the provider
 * takes; `{ id }` and `{ name }` exist for the providers that take both and
 * would otherwise have to guess which you meant from the shape of the string.
 *
 * **Wide by default, and narrowed per model only where a list exists.** See
 * `TtsModelParams` in `./model-params.ts` for the argument in full — voice
 * catalogs are per-account (cloning), run to thousands of entries at ElevenLabs
 * and Murf, and turn over between releases, so a *closed* union of them would
 * be stale, would refuse the caller's own cloned voice, and would be the
 * largest completion list in the library.
 *
 * That argument is about the providers whose catalogs are unbounded, and it is
 * not a claim that no provider publishes a list. Several do, and this repo
 * hand-catalogues them at the wire: Deepgram (where the voice *is* the model,
 * so the ref union types it for free), OpenAI's nine and thirteen, and — since
 * the Gemini TTS tightening — Google's thirty, which `unmodel/google` now
 * refuses to compile off-list.
 *
 * Those are surfaced, through the open-tailed `voices` row on
 * {@link TtsModelParams} and {@link VoiceOf}: a model whose provider closes
 * a list completes it, every other model keeps this type verbatim, and no
 * model gates — a cloned voice compiles everywhere, in all three spellings.
 * This alias is what a row *without* a list resolves to, and what an adapter's
 * `compile` is written against.
 */
export type Voice = string | { id: string } | { name: string };

/**
 * Everything that is not narrowed per model.
 *
 * The split exists for one reason, and it is the same reason `VideoParamsBase`
 * exists: the three fields on `TtsParams` below — `outputFormat`,
 * `language` and `voice` — are **replaced** by {@link TtsModelNarrowing} in
 * a validator's constraint rather than intersected with it, and a base that
 * still declared them would put the wide type back into the intersection. See
 * `TtsArms` in `./model-params.ts` for what that costs.
 */
export interface TtsParamsBase {
  /** What to say. */
  text: string;
  /** `"provider/model"`, split on the **first** slash. */
  model: string;
  /**
   * A multiplier: `1.0` is the model's normal rate, `2.0` is twice as fast,
   * `0.5` half.
   *
   * One convention, chosen because it is the only one that is unambiguous
   * without a unit. Providers encode it as a multiplier, as its reciprocal (a
   * *time* scale — Rime's `speedAlpha`), and as a signed percentage delta
   * (Murf's `rate`); `derive.ts` has an exact converter for each, and the two
   * that cannot represent a given value say so instead of rounding quietly.
   */
  speed?: number;
  providerOptions?: ProviderOptions;
}

/**
 * A text-to-speech request.
 *
 * The two per-model fields are declared here at their **widest** — this is the
 * type an adapter's `compile` is written against, and the type a caller with a
 * run-time-built ref gets. A literal ref narrows them to that model's own enums
 * through {@link TtsValidator}.
 */
export interface TtsParams extends TtsParamsBase {
  /** A codec shorthand (`"mp3"`) or a fully-spelled encoding. */
  outputFormat?: AudioFormatRequest;
  /** BCP-47, e.g. `"pt-BR"`. Multilingual models use it to pick pronunciation. */
  language?: string;
  /** Which voice — see {@link Voice}. Narrowed per model where a list exists. */
  voice?: Voice;
}

// ---------------------------------------------------------------------------
// Per-model narrowing
// ---------------------------------------------------------------------------

/**
 * A speech adapter, parameterized by its per-model table.
 *
 * The table is the single source of three things — the caller's `outputFormat`
 * and `language` unions, the extras a model takes, and the run-time roster
 * `applyExtras` refuses an out-of-model extra against — for exactly the reason
 * `stt`'s `audioInputs` is one array: a second declaration is a second
 * thing to keep in step, and this one has to be right in an editor *and* on the
 * wire.
 */
export interface TtsAdapterFor<
  T extends TtsModelParamTable,
  Wire extends object = object,
  Out extends object = object,
> extends UnifiedAdapter<TtsParams, Wire, Out>,
    WithModelParams<T> {
  readonly category: "tts";
}

/**
 * The loosest speech adapter that still pins the vocabulary.
 *
 * `modelParams` is **optional** here and required on {@link TtsAdapterFor},
 * which is the split that matters: every adapter unmodel ships declares one,
 * and a third-party adapter that does not is still a legal argument to
 * `createTts` — its refs simply degrade to the wide vocabulary, which is
 * exactly what an unknown model already does.
 */
export type AnyTtsAdapter = AnyUnifiedAdapter<TtsParams> & {
  readonly category: "tts";
  readonly modelParams?: TtsModelParamTable;
};

/**
 * `tts()` — {@link UnifiedRef}-driven like every category validator, plus the
 * per-**model** narrowing this category needs.
 *
 * Two type parameters, for `VideoValidator`'s reason: inferring `M` from
 * `params.model` first and constraining `T` by it produces one error naming the
 * offending field, where a plain intersection would reduce the whole params
 * type to `never` and report three, the first of them on `model`.
 *
 * ```ts
 * tts({ model: "openai/tts-1",     text, outputFormat: "flac" });   // ok
 * tts({ model: "openai/tts-1",     text, outputFormat: "vorbis" }); // error
 * tts({ model: "cartesia/sonic-3", text, outputFormat: { format: "pcm_f32le", sampleRate: 44100 } }); // ok
 * tts({ model: "openai/gpt-4o-mini-tts", text, instructions: "…" }); // ok
 * tts({ model: "openai/tts-1",           text, instructions: "…" }); // error
 * ```
 */
export interface TtsValidator<A> extends SafeUnknown<UnifiedResult<A, string>> {
  <
    M extends UnifiedRef<A> | (string & {}),
    T extends UnifiedInput<TtsParamsBase, UnifiedRef<A>, A> &
      TtsModelNarrowing<A, M> &
      ModelExtras<A, M>,
  >(
    params: T &
      { model: M } &
      ExactKeys<T, UnifiedInput<TtsParams, UnifiedRef<A>, A> & ModelExtras<A, M>>,
    options?: ValidateOptions,
  ): UnifiedResult<A, M>;
  safe<
    M extends UnifiedRef<A> | (string & {}),
    T extends UnifiedInput<TtsParamsBase, UnifiedRef<A>, A> &
      TtsModelNarrowing<A, M> &
      ModelExtras<A, M>,
  >(
    params: T &
      { model: M } &
      ExactKeys<T, UnifiedInput<TtsParams, UnifiedRef<A>, A> & ModelExtras<A, M>>,
    options?: ValidateOptions,
  ): ValidateResult<UnifiedResult<A, M>>;
  /** Every provider id registered on this validator, sorted. */
  readonly providers: readonly string[];
}
