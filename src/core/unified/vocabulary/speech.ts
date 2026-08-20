/**
 * `unmodel/speech` — the canonical vocabulary for text-to-speech.
 */
import type { ExactKeys } from "../../request";
import type { ValidateOptions } from "../../options";
import type { ValidateResult } from "../../result";
import type {
  AnyUnifiedAdapter,
  UnifiedAdapter,
  UnifiedInput,
  UnifiedRef,
  UnifiedResult,
} from "../types";
import type { AudioFormatRequest } from "./audio";
import type { ProviderOptions } from "./common";
import type {
  ModelExtras,
  SpeechModelNarrowing,
  SpeechModelParamTable,
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
  SpeechModelNarrowing,
  SpeechModelParams,
  SpeechModelParamTable,
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
 * **Deliberately not narrowed per model.** Every other closed enum in this
 * category is; `voice` is the one that must not be. See `SpeechModelParams` in
 * `./model-params.ts` for the argument in full — voice catalogs are per-account
 * (cloning), run to thousands of entries, and turn over between releases, so a
 * union of them would be stale, would refuse the caller's own cloned voice, and
 * would be the largest completion list in the library. The single provider
 * where the voice is knowable is Deepgram, where the voice *is* the model — and
 * the ref union already types it there for free.
 */
export type Voice = string | { id: string } | { name: string };

/**
 * Everything that is not narrowed per model.
 *
 * The split exists for one reason, and it is the same reason `VideoParamsBase`
 * exists: the two fields below it — `outputFormat` and `language` — are
 * **replaced** by {@link SpeechModelNarrowing} in a validator's constraint
 * rather than intersected with it, and a base that still declared them would
 * put the wide type back into the intersection. See `SpeechArms` in
 * `./model-params.ts` for what that costs.
 */
export interface SpeechParamsBase {
  /** What to say. */
  text: string;
  /** `"provider/model"`, split on the **first** slash. */
  model: string;
  voice?: Voice;
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
 * through {@link SpeechValidator}.
 */
export interface SpeechParams extends SpeechParamsBase {
  /** A codec shorthand (`"mp3"`) or a fully-spelled encoding. */
  outputFormat?: AudioFormatRequest;
  /** BCP-47, e.g. `"pt-BR"`. Multilingual models use it to pick pronunciation. */
  language?: string;
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
 * `transcribe`'s `audioInputs` is one array: a second declaration is a second
 * thing to keep in step, and this one has to be right in an editor *and* on the
 * wire.
 */
export interface SpeechAdapterFor<
  T extends SpeechModelParamTable,
  Wire extends object = object,
  Out extends object = object,
> extends UnifiedAdapter<SpeechParams, Wire, Out>,
    WithModelParams<T> {
  readonly category: "speech";
}

/**
 * The loosest speech adapter that still pins the vocabulary.
 *
 * `modelParams` is **optional** here and required on {@link SpeechAdapterFor},
 * which is the split that matters: every adapter unmodel ships declares one,
 * and a third-party adapter that does not is still a legal argument to
 * `createSpeech` — its refs simply degrade to the wide vocabulary, which is
 * exactly what an unknown model already does.
 */
export type AnySpeechAdapter = AnyUnifiedAdapter<SpeechParams> & {
  readonly category: "speech";
  readonly modelParams?: SpeechModelParamTable;
};

/**
 * `speech()` — {@link UnifiedRef}-driven like every category validator, plus the
 * per-**model** narrowing this category needs.
 *
 * Two type parameters, for `VideoValidator`'s reason: inferring `M` from
 * `params.model` first and constraining `T` by it produces one error naming the
 * offending field, where a plain intersection would reduce the whole params
 * type to `never` and report three, the first of them on `model`.
 *
 * ```ts
 * speech({ model: "openai/tts-1",     text, outputFormat: "flac" });   // ok
 * speech({ model: "openai/tts-1",     text, outputFormat: "vorbis" }); // error
 * speech({ model: "cartesia/sonic-3", text, outputFormat: { format: "pcm_f32le", sampleRate: 44100 } }); // ok
 * speech({ model: "openai/gpt-4o-mini-tts", text, instructions: "…" }); // ok
 * speech({ model: "openai/tts-1",           text, instructions: "…" }); // error
 * ```
 */
export interface SpeechValidator<A> {
  <
    M extends UnifiedRef<A> | (string & {}),
    T extends UnifiedInput<SpeechParamsBase, UnifiedRef<A>> &
      SpeechModelNarrowing<A, M> &
      ModelExtras<A, M>,
  >(
    params: T &
      { model: M } &
      ExactKeys<T, UnifiedInput<SpeechParams, UnifiedRef<A>> & ModelExtras<A, M>>,
    options?: ValidateOptions,
  ): UnifiedResult<A, M>;
  safe<
    M extends UnifiedRef<A> | (string & {}),
    T extends UnifiedInput<SpeechParamsBase, UnifiedRef<A>> &
      SpeechModelNarrowing<A, M> &
      ModelExtras<A, M>,
  >(
    params: T &
      { model: M } &
      ExactKeys<T, UnifiedInput<SpeechParams, UnifiedRef<A>> & ModelExtras<A, M>>,
    options?: ValidateOptions,
  ): ValidateResult<UnifiedResult<A, M>>;
  /** Every provider id registered on this validator, sorted. */
  readonly providers: readonly string[];
}
