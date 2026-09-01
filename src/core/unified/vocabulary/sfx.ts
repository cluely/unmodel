/**
 * `unmodel/sfx` — the canonical vocabulary for asking a model to make a noise.
 *
 * Four words, and it is the smallest category in the library. A sound effect is
 * a description and a length: there is no voice to pick, no key to sing in, no
 * frame to size, and the two things a caller does say — how long, and in what
 * encoding — are the two every one of the five witnesses has a field for.
 *
 * ## Why this is not `music`
 *
 * `elevenlabs.music` and `elevenlabs.sfx` are disjoint wires with disjoint
 * model-id enums, and folding them together would break both. `/v1/music` takes
 * `music_length_ms` — MILLISECONDS, floor 3 000 — plus a `composition_plan`
 * whose shape is model-specific and a `force_instrumental` switch;
 * `/v1/sound-generation` takes `duration_seconds` with a floor of **0.5**, a
 * `loop`, and a `prompt_influence`. Merging them would push the category floor
 * from three seconds to half of one and force `instrumental?: boolean` onto a
 * door creak. Nor is it `tts`: there is no voice and no text to read out.
 *
 * ## The five witnesses, and what survived them
 *
 * ElevenLabs, Sonilo, CassetteAI, Stability and Mirelo — five independent
 * vendors, four of them reachable through fal and one of them natively as well.
 * (ElevenLabs-native and ElevenLabs-on-fal are ONE witness: agreement with
 * yourself is not corroboration, which is the rule `3d` already states about
 * Tripo.)
 *
 * | word | witnesses | verdict |
 * |---|---|---|
 * | `prompt` | 5/5 — `text`, `prompt`, `text_prompt`; one meaning, one value space | canonical |
 * | `outputFormat` | 4/5 — `output_format`, `audio_format`, `upload_audio_format`; {@link AudioFormatRequest} is already a lossless superset of all four | canonical |
 * | `durationSeconds` | 5/5 as a CONCEPT — but see below | canonical, with the semantics stated per model |
 * | `loop` | **1/5** — ElevenLabs alone | `providerOptions.elevenlabs`, and a per-model extra at fal |
 *
 * `loop` is the interesting refusal, because it looks like it has a second
 * witness and does not: Mirelo's `ambience` produces a tileable ambience BED —
 * it changes what is generated, not where it ends — which is the same
 * disqualifier the lipsync `sync_mode` / `loop_mode` table already carries.
 * `prompt_influence`, `seed`, `negative_prompt`, `guidance_scale`,
 * `num_samples` and the rest are one vendor's dial apiece and ride as per-model
 * extras, typed from that route's own wire interface.
 *
 * ## Absence of `durationSeconds` means the PROVIDER's default. Never "auto"
 *
 * This is the one thing this vocabulary insists on, and it is the half of the
 * concept the witnesses do NOT share. Omitting the length means five different
 * things across six routes: both ElevenLabs routes read a length off the
 * prompt, Sonilo silently generates 8 seconds, Mirelo 10, Stable Audio 30, and
 * CassetteAI answers **HTTP 422**, because there the field is required.
 *
 * So `durationSeconds` is compiled from the row rather than from a category
 * rule. A route that documents a default warns `approximated_param` naming the
 * number the provider will pick — a request you can reproduce, rather than one
 * you cannot. A route that requires the field types it as REQUIRED
 * ({@link SfxModelNarrowing}) and refuses at run time naming the route. And a
 * route that genuinely guesses says nothing, because nothing was invented on
 * the caller's behalf. What never happens is a literal `"auto"` on the wire:
 * not one of these six fields has such a value, and writing a string into a
 * numeric field to express "you decide" would be a request none of them
 * accepts.
 *
 * ## What is deliberately absent
 *
 * No `seed` — two of the six publish one and the category has no second
 * independent vendor for it in the sense that matters (Stability and Mirelo do,
 * but the word buys nothing the extras mechanism does not already give it at
 * exactly the same call sites, and a vocabulary word is a promise every future
 * route has to keep). No `n`: `num_samples` exists at exactly one vendor. No
 * `negativePrompt`, no `guidance`: one witness each.
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
  SfxModelNarrowing,
  SfxModelParamTable,
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
  SfxModelNarrowing,
  SfxModelParams,
  SfxModelParamTable,
  WithModelParams,
} from "./model-params";

/**
 * Everything that is not narrowed per model.
 *
 * `outputFormat` and `durationSeconds` are omitted here on purpose — the
 * replacement-arm law (`SizingArms` in `./model-params.ts`):
 * {@link SfxModelNarrowing} REPLACES both rather than intersecting with them. A
 * base that still declared `durationSeconds?: number` would put the optional
 * arm back into the intersection, and CassetteAI's required length would go on
 * compiling when absent — which is the one thing the required arm exists to
 * stop.
 */
export interface SfxParamsBase {
  /**
   * The sound to make — "a heavy oak door creaking open in a stone hall".
   *
   * The same word `image`, `video`, `music` and `3d` already use, and the only
   * one of the four canonical words every witness spells with the same meaning.
   * Three wire spellings behind it (`text`, `prompt`, `text_prompt`) and one
   * value space: a string.
   */
  prompt: string;
  /** `"provider/model"`, split on the **first** slash. */
  model: string;
  providerOptions?: ProviderOptions;
}

/**
 * A sound-effect request, with `durationSeconds` and `outputFormat` at their
 * widest — the type an adapter's `compile` is written against, and the type a
 * caller with a run-time-built ref gets.
 */
export interface SfxParams extends SfxParamsBase {
  /**
   * How long the effect should be, in seconds.
   *
   * Spelled out rather than `duration` for the reason `music` spells it out:
   * these APIs take milliseconds about as often as seconds, and a bare
   * `duration` is the kind of field people assume the unit of.
   *
   * **Absent means the provider's own default**, which is a different number at
   * every vendor and a 422 at one of them. See the module header.
   */
  durationSeconds?: number;
  /** The encoding to ask for. Refused by name where the route has no such field. */
  outputFormat?: AudioFormatRequest;
}

// ---------------------------------------------------------------------------
// Per-model narrowing
// ---------------------------------------------------------------------------

/** A sound-effect adapter, parameterized by its per-model table. */
export interface SfxAdapterFor<
  T extends SfxModelParamTable,
  Wire extends object = object,
  Out extends object = object,
> extends UnifiedAdapter<SfxParams, Wire, Out>,
    WithModelParams<T> {
  readonly category: "sfx";
}

/**
 * The loosest sound-effect adapter that still pins the vocabulary.
 * `modelParams` is optional here and required on {@link SfxAdapterFor}, so a
 * third-party adapter without one is still a legal argument to `createSfx` and
 * simply degrades to the wide vocabulary.
 */
export type AnySfxAdapter = AnyUnifiedAdapter<SfxParams> & {
  readonly category: "sfx";
  readonly modelParams?: SfxModelParamTable;
};

/**
 * `sfx()` — {@link UnifiedRef}-driven like every category validator, plus the
 * per-model `durationSeconds` requiredness this category is built around.
 *
 * Two type parameters for `LipsyncValidator`'s reason: `M` is inferred from
 * `params.model` first and `T` is constrained by it, so a length omitted at a
 * route that requires one produces one error, on `durationSeconds`, rather than
 * an intersection reduced to `never` and three errors, the first of them on
 * `model`.
 *
 * ```ts
 * sfx({ model: "elevenlabs/eleven_text_to_sound_v2", prompt: "a door creak" });
 * sfx({ model: "fal/cassetteai/sound-effects-generator", prompt });          // error: needs durationSeconds
 * sfx({ model: "fal/cassetteai/sound-effects-generator", prompt, durationSeconds: 3 });
 * ```
 */
export interface SfxValidator<A> extends SafeUnknown<UnifiedResult<A, string>> {
  <
    M extends UnifiedRef<A> | (string & {}),
    T extends UnifiedInput<SfxParamsBase, UnifiedRef<A>, A> &
      SfxModelNarrowing<A, M> &
      ModelExtras<A, M>,
  >(
    params: T &
      { model: M } &
      ExactKeys<T, UnifiedInput<SfxParams, UnifiedRef<A>, A> & ModelExtras<A, M>>,
    options?: ValidateOptions,
  ): UnifiedResult<A, M>;
  safe<
    M extends UnifiedRef<A> | (string & {}),
    T extends UnifiedInput<SfxParamsBase, UnifiedRef<A>, A> &
      SfxModelNarrowing<A, M> &
      ModelExtras<A, M>,
  >(
    params: T &
      { model: M } &
      ExactKeys<T, UnifiedInput<SfxParams, UnifiedRef<A>, A> & ModelExtras<A, M>>,
    options?: ValidateOptions,
  ): ValidateResult<UnifiedResult<A, M>>;
  /** Every provider id registered on this validator, sorted. */
  readonly providers: readonly string[];
}
