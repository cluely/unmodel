/**
 * `unmodel/voice-clone` — the canonical vocabulary for voice cloning: create
 * a voice from reference recordings.
 *
 * A separate category from `voiceDesign` rather than one `voice()` with a
 * mode flag, for the reason `image` and `imageEdit` are separate: the model
 * lists differ (design has real model ids at two providers; cloning has none
 * anywhere), the wire routes differ at every provider that serves both, and
 * the required fields are disjoint — cloning's core input is audio samples
 * plus a name, design's is a text prompt. Sharpest of all, `description`
 * means two different things across the pair: **metadata about** the voice on
 * this side, and **the generative prompt** on the other. One category would
 * force one word to carry both meanings, which is exactly what a canonical
 * vocabulary exists to prevent.
 *
 * `operation: "clone"` is a required literal all the same — the imageEdit
 * precedent: a discriminant that exists from day one costs a caller five
 * characters of autocomplete, and its absence can never be retrofitted
 * without a break once a second arm (a re-train? a cross-provider remix?)
 * exists.
 *
 * Types only, like every file under `vocabulary/`. What makes this one long
 * is the compile-time narrowing of `samples`: the adapter shape and the
 * validator signature that carry it live here, next to the vocabulary word
 * they are about — the `audio`/`audioInputs` machinery of `stt`, applied to a
 * field that is an *array* of recordings rather than one.
 */
import type { ExactKeys } from "../../request";
import type { ValidateOptions } from "../../options";
import type { ValidateResult } from "../../result";
import type {
  AnyUnifiedAdapter,
  InputsFor,
  SafeUnknown,
  UnifiedAdapter,
  UnifiedInput,
  UnifiedRef,
  UnifiedResult,
} from "../types";
import type { BlobRef, DataRef, FileIdRef, ProviderOptions } from "./common";
import type {
  ModelExtras,
  VoiceCloneModelNarrowing,
  VoiceCloneModelParamTable,
  WithModelParams,
} from "./model-params";

export type { ProviderOptions } from "./common";

export type {
  LanguageOf,
  ModelExtras,
  ModelParamsFor,
  VoiceCloneModelNarrowing,
  VoiceCloneModelParams,
  VoiceCloneModelParamTable,
  WithModelParams,
} from "./model-params";

/**
 * The three ways a reference recording reaches a cloning API, as a tag.
 *
 * A strict subset of stt's four — its own union rather than a reuse, because
 * the two categories' input spaces evolve independently: `"url"` is absent
 * here not as an oversight but because no wave-one clone route fetches a URL
 * (Resemble's `dataset_url` would add it, as a new member, when that adapter
 * lands). The three that are here are provider-fixed, not interchangeable:
 * multipart file parts (ElevenLabs, Fish, Cartesia, LMNT), base64 inside the
 * JSON body (Inworld), and a handle from the provider's own upload API
 * (MiniMax).
 */
export type VoiceSampleKind = "file" | "data" | "fileId";

/** A `Blob`/`File` posted as a multipart part. */
export type VoiceSampleFileInput = BlobRef;
/** Base64 bytes in the request body, for routes whose sample field is a string. */
export type VoiceSampleDataInput = DataRef;
/** A handle from the provider's own upload API (MiniMax's `file_id`). */
export type VoiceSampleFileIdInput = FileIdRef;

/** A recording, in whichever of the three forms the caller has. */
export type VoiceSampleInput =
  | VoiceSampleFileInput
  | VoiceSampleDataInput
  | VoiceSampleFileIdInput;

/**
 * The sample-audio type for a route that accepts exactly the kinds in `K`.
 *
 * Written with `"file" extends K` rather than `K extends "file"` on purpose:
 * the former asks "is this kind in the set", the latter distributes and
 * answers a different question for a union `K`. (The same sentence, for the
 * same reason, as stt's `AudioInputFor`.)
 */
export type VoiceSampleInputFor<K extends VoiceSampleKind> =
  | ("file" extends K ? VoiceSampleFileInput : never)
  | ("data" extends K ? VoiceSampleDataInput : never)
  | ("fileId" extends K ? VoiceSampleFileIdInput : never);

/**
 * One reference recording.
 *
 * `transcript` is what is spoken in it — Fish's `texts[]` and Inworld's
 * `transcription`, per sample. Routes with no transcript field refuse it
 * (`resolveVoiceSamples` reports the exact element), because silently
 * dropping words a caller supplied to improve clone quality is a lossier act
 * than any format approximation.
 */
export interface VoiceSample {
  audio: VoiceSampleInput;
  transcript?: string;
}

/** {@link VoiceSample} narrowed to the input kinds one route accepts. */
export type VoiceSampleFor<K extends VoiceSampleKind> = {
  audio: VoiceSampleInputFor<K>;
  transcript?: string;
};

/**
 * How many recordings one route takes — the runtime bound
 * `resolveVoiceSamples` enforces.
 *
 * A bound rather than a type (a per-adapter tuple could spell "exactly one"
 * structurally) for the reason `VideoModelParams` keeps duration numeric: a
 * range is a limit, and this library reports limits at runtime with the
 * numbers in the message, not as a `never` a caller has to reverse-engineer.
 * The split is real and worth naming: Fish takes up to 20 recordings,
 * ElevenLabs an uncapped list, Cartesia/LMNT/MiniMax/Speechify exactly one
 * clip.
 */
export interface VoiceSampleLimits {
  readonly min: number;
  readonly max: number;
}

/**
 * Who can see the created voice.
 *
 * Canonical because it is a privacy fact, not a tuning knob: Fish defaults to
 * **public** ("shown in the discovery page") while Cartesia defaults to
 * private, and a caller who cannot say `visibility: "private"` portably would
 * have to learn that difference from an invoice. `"unlisted"` is the
 * canonical spelling of Fish's `unlist` — anyone with the link.
 */
export type VoiceVisibility = "private" | "unlisted" | "public";

/**
 * Everything that is not narrowed per model.
 *
 * `language` is **replaced** by {@link VoiceCloneModelNarrowing} in the
 * validator's constraint rather than intersected with it — `LanguageOf`
 * carries a `(string & {})` brace an intersection with `language?: string`
 * would discharge (the rule `SttParamsBase` states). `samples` stays here:
 * its narrowing is per **adapter**, applied as the separate
 * {@link SampleNarrowing} intersection, whose type is a plain object union
 * with no brace to lose.
 */
export interface VoiceCloneParamsBase {
  operation: "clone";
  /** `"provider/model"`, split on the **first** slash. */
  model: string;
  /**
   * The created voice's display name. Optional here because MiniMax has no
   * name field at all (its caller-chosen {@link voiceId} is the handle);
   * everywhere else the wire requires it, and the provider validator's own
   * non-empty check answers — remapped onto this field — when it is missing.
   */
  name?: string;
  /** The reference recordings. Shape narrows per adapter; count per adapter at runtime. */
  samples: readonly VoiceSample[];
  /**
   * Metadata describing the voice — NEVER the generative prompt, which is
   * `voiceDesign`'s `prompt` (see the module header for why the two words
   * must not merge).
   */
  description?: string;
  /**
   * Whether the provider should denoise the samples before training
   * (ElevenLabs `remove_background_noise`, Inworld
   * `audioProcessingConfig.removeBackgroundNoise`, MiniMax
   * `need_noise_reduction`). Omit to keep each provider's default; every
   * provider documents that denoising already-clean samples can hurt.
   */
  noiseReduction?: boolean;
  /** See {@link VoiceVisibility}. Providers that cannot express a member refuse it. */
  visibility?: VoiceVisibility;
  /**
   * The caller-chosen handle of the new voice — REQUIRED by MiniMax (the one
   * wire where the caller mints the id) and refused everywhere else, where
   * the provider mints it in the response. Canonical despite the 1-of-6
   * split because it is a required *input* on that wire: an extras bucket is
   * for optional knobs, not for the field a request cannot exist without.
   */
  voiceId?: string;
  providerOptions?: ProviderOptions;
}

/**
 * A voice-cloning request.
 *
 * The per-model field is declared here at its widest — this is the type an
 * adapter's `compile` is written against, and the type a caller with a
 * run-time-built ref gets.
 */
export interface VoiceCloneParams extends VoiceCloneParamsBase {
  /** BCP-47. Required by Cartesia's wire; a hint or absent elsewhere. */
  language?: string;
}

/** {@link VoiceCloneParams} narrowed to the sample kinds one route accepts. */
export type VoiceCloneParamsFor<K extends VoiceSampleKind> = Omit<
  VoiceCloneParams,
  "samples"
> & {
  samples: readonly VoiceSampleFor<K>[];
};

// ---------------------------------------------------------------------------
// The narrowing, in the two places it has to be declared
// ---------------------------------------------------------------------------

/**
 * A voice-clone adapter, parameterized by the sample shapes its route accepts.
 *
 * `sampleInputs` is stt's `audioInputs` contract verbatim — one array, two
 * enforcement points ({@link VoiceCloneValidator} at compile time,
 * `resolveVoiceSamples` at runtime), no way for them to disagree.
 * `sampleLimits` is the count half of the same promise; it has no
 * compile-time twin (see {@link VoiceSampleLimits}) so the runtime half is
 * the whole of it.
 */
export interface VoiceCloneAdapterFor<
  K extends VoiceSampleKind,
  T extends VoiceCloneModelParamTable,
  Wire extends object = object,
  Out extends object = object,
> extends UnifiedAdapter<VoiceCloneParamsFor<K>, Wire, Out>,
    WithModelParams<T> {
  readonly category: "voiceClone";
  /** The sample shapes this route accepts, `as const`. */
  readonly sampleInputs: readonly K[];
  /** How many recordings this route takes. */
  readonly sampleLimits: VoiceSampleLimits;
}

/**
 * `voiceClone()` — {@link UnifiedRef}-driven like every category validator,
 * with `samples` typed from the adapter the **ref** selects (the
 * `SttValidator` mechanism, one field over).
 *
 * ```ts
 * voiceClone({ model: "elevenlabs/ivc", operation: "clone",
 *              name: "Narrator", samples: [{ audio: { file } }] });      // ok
 * voiceClone({ model: "minimax/voice-clone", operation: "clone",
 *              voiceId: "MyVoice01", samples: [{ audio: { file } }] });  // error: that route takes { fileId }
 * ```
 */
export interface VoiceCloneValidator<A> extends SafeUnknown<UnifiedResult<A, string>> {
  <
    M extends UnifiedRef<A> | (string & {}),
    T extends UnifiedInput<VoiceCloneParamsBase, UnifiedRef<A>, A> &
      VoiceCloneModelNarrowing<A, M> &
      ModelExtras<A, M>,
  >(
    params: T &
      { model: M } &
      ExactKeys<T, UnifiedInput<VoiceCloneParams, UnifiedRef<A>, A> & ModelExtras<A, M>> &
      SampleNarrowing<A, M>,
    options?: ValidateOptions,
  ): UnifiedResult<A, M>;
  safe<
    M extends UnifiedRef<A> | (string & {}),
    T extends UnifiedInput<VoiceCloneParamsBase, UnifiedRef<A>, A> &
      VoiceCloneModelNarrowing<A, M> &
      ModelExtras<A, M>,
  >(
    params: T &
      { model: M } &
      ExactKeys<T, UnifiedInput<VoiceCloneParams, UnifiedRef<A>, A> & ModelExtras<A, M>> &
      SampleNarrowing<A, M>,
    options?: ValidateOptions,
  ): ValidateResult<UnifiedResult<A, M>>;
  /** Every provider id registered on this validator, sorted. */
  readonly providers: readonly string[];
}

/**
 * The `{ samples }` constraint one ref imposes, as a standalone object type so
 * the error message a caller sees names `samples` and shows the shape wanted.
 */
export type SampleNarrowing<A, R extends string> = {
  // `Extract` because `InputsFor` is generic in the *field*, so it can only
  // promise `string`; the category is what knows those strings are kinds.
  samples: readonly VoiceSampleFor<
    Extract<InputsFor<A, R, "sampleInputs">, VoiceSampleKind>
  >[];
};

/**
 * The loosest voice-clone adapter that still pins the vocabulary.
 *
 * `sampleInputs` and `sampleLimits` are required — a route that declared no
 * kinds would type `samples` as `never[]` and be uncallable, and a route with
 * no count bound has not said what it takes — while `modelParams` is
 * optional, exactly as on the other narrowing categories.
 */
export type AnyVoiceCloneAdapter = AnyUnifiedAdapter<VoiceCloneParams> & {
  readonly category: "voiceClone";
  readonly sampleInputs: readonly VoiceSampleKind[];
  readonly sampleLimits: VoiceSampleLimits;
  readonly modelParams?: VoiceCloneModelParamTable;
};
