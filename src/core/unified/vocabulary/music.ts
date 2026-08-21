/**
 * `unmodel/music` — the canonical vocabulary for music generation.
 *
 * Deliberately the smallest of the six. Music APIs disagree about almost
 * everything above the prompt — lyrics, sections, reference tracks, stems,
 * continuation — and none of those disagreements has a canonical spelling yet.
 * Four params that every provider means the same way is a vocabulary; adding a
 * fifth that three providers interpret differently would make the category's
 * warnings meaningless, which is the one thing it cannot afford.
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
  MusicModelNarrowing,
  MusicModelParamTable,
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
  ModelExtras,
  ModelParamsFor,
  MusicModelNarrowing,
  MusicModelParams,
  MusicModelParamTable,
  WithModelParams,
} from "./model-params";

/**
 * Everything that is not narrowed per model — the same split, and the same
 * reason, as `VideoParamsBase`: `outputFormat` is **replaced** by
 * {@link MusicModelNarrowing} rather than intersected with it.
 */
export interface MusicParamsBase {
  /** What to generate — style, mood, instrumentation. */
  prompt: string;
  /** `"provider/model"`, split on the **first** slash. */
  model: string;
  /**
   * Length in seconds. Spelled out rather than `duration` because music APIs
   * take milliseconds about as often as seconds, and a bare `duration` is the
   * kind of field people assume the unit of.
   */
  durationSeconds?: number;
  /** No vocals. Providers with no such switch report it unsupported. */
  instrumental?: boolean;
  seed?: number;
  providerOptions?: ProviderOptions;
}

/** A music-generation request, with `outputFormat` at its widest. */
export interface MusicParams extends MusicParamsBase {
  outputFormat?: AudioFormatRequest;
}

// ---------------------------------------------------------------------------
// Per-model narrowing
// ---------------------------------------------------------------------------

/** A music adapter, parameterized by its per-model table. */
export interface MusicAdapterFor<
  T extends MusicModelParamTable,
  Wire extends object = object,
  Out extends object = object,
> extends UnifiedAdapter<MusicParams, Wire, Out>,
    WithModelParams<T> {
  readonly category: "music";
}

/**
 * The loosest music adapter that still pins the vocabulary. `modelParams` is
 * optional here and required on {@link MusicAdapterFor}, so a third-party
 * adapter without one is still a legal argument to `createMusic` and simply
 * degrades to the wide vocabulary.
 */
export type AnyMusicAdapter = AnyUnifiedAdapter<MusicParams> & {
  readonly category: "music";
  readonly modelParams?: MusicModelParamTable;
};

/**
 * `music()` — {@link UnifiedRef}-driven like every category validator, plus the
 * per-model `outputFormat` narrowing and the per-model extras.
 *
 * ```ts
 * music({ model: "stability/stable-audio-2", prompt, outputFormat: "mp3" });    // ok
 * music({ model: "stability/stable-audio-2", prompt, outputFormat: "opus" });   // error
 * music({ model: "elevenlabs/music_v1",      prompt, outputFormat: "opus" });   // ok
 * music({ model: "stability/stable-audio-2", prompt, steps: 40 });              // ok
 * music({ model: "elevenlabs/music_v1",      prompt, steps: 40 });              // error
 * ```
 */
export interface MusicValidator<A> extends SafeUnknown<UnifiedResult<A, string>> {
  <
    M extends UnifiedRef<A> | (string & {}),
    T extends UnifiedInput<MusicParamsBase, UnifiedRef<A>> &
      MusicModelNarrowing<A, M> &
      ModelExtras<A, M>,
  >(
    params: T &
      { model: M } &
      ExactKeys<T, UnifiedInput<MusicParams, UnifiedRef<A>> & ModelExtras<A, M>>,
    options?: ValidateOptions,
  ): UnifiedResult<A, M>;
  safe<
    M extends UnifiedRef<A> | (string & {}),
    T extends UnifiedInput<MusicParamsBase, UnifiedRef<A>> &
      MusicModelNarrowing<A, M> &
      ModelExtras<A, M>,
  >(
    params: T &
      { model: M } &
      ExactKeys<T, UnifiedInput<MusicParams, UnifiedRef<A>> & ModelExtras<A, M>>,
    options?: ValidateOptions,
  ): ValidateResult<UnifiedResult<A, M>>;
  /** Every provider id registered on this validator, sorted. */
  readonly providers: readonly string[];
}
