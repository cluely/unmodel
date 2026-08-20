/**
 * `unmodel/transcribe` — the canonical vocabulary for speech-to-text.
 *
 * Types only, like every file under `vocabulary/`. What makes this one longer
 * than its five siblings is the compile-time narrowing of `audio`: the adapter
 * shape and the validator signature that carry it live here, next to the
 * vocabulary word they are about, rather than in the kernel — which has no
 * business knowing that this category's input field is spelled `audio`.
 */
import type { ExactKeys } from "../../request";
import type { ValidateOptions } from "../../options";
import type { ValidateResult } from "../../result";
import type {
  AnyUnifiedAdapter,
  InputsFor,
  UnifiedAdapter,
  UnifiedInput,
  UnifiedRef,
  UnifiedResult,
} from "../types";
import type { BlobRef, FileIdRef, ProviderOptions, UrlRef } from "./common";

export type { ProviderOptions } from "./common";

/**
 * The three ways audio reaches a transcription API, as a tag.
 *
 * Named as a union of string literals rather than left implicit in the shape
 * of `AudioInput`, because it is the thing adapters need to *talk about*: a
 * route accepts some subset, and {@link AudioInputFor} turns that subset into
 * the exact `audio` type for that route.
 */
export type AudioInputKind = "file" | "url" | "fileId";

/** A `Blob`/`File` posted as multipart. */
export type AudioFileInput = BlobRef;
/** A URL the provider fetches. Async/batch APIs mostly take only this. */
export type AudioUrlInput = UrlRef;
/** A handle from the provider's own upload API. */
export type AudioFileIdInput = FileIdRef;

/** Audio, in whichever of the three forms the caller has. */
export type AudioInput = AudioFileInput | AudioUrlInput | AudioFileIdInput;

/**
 * The `audio` type for a route that accepts exactly the kinds in `K`.
 *
 * This is the compile-time half of the promise the category makes. A batch API
 * that only fetches URLs is declared `AudioInputFor<"url">`, and a caller who
 * hands it a `Blob` gets a type error at the call site naming the field —
 * rather than a validated request that 400s on a multipart body the route does
 * not parse.
 *
 * Written with `"file" extends K` rather than `K extends "file"` on purpose:
 * the former asks "is this kind in the set", the latter distributes and
 * answers a different question for a union `K`.
 *
 * ```ts
 * type Whisper = AudioInputFor<"file" | "url">;   // { file } | { url }
 * type Deepgram = AudioInputFor<"url">;           // { url }
 * ```
 */
export type AudioInputFor<K extends AudioInputKind> =
  | ("file" extends K ? AudioFileInput : never)
  | ("url" extends K ? AudioUrlInput : never)
  | ("fileId" extends K ? AudioFileIdInput : never);

/**
 * `TranscribeParams` narrowed to the input kinds one route accepts.
 *
 * Adapters declare `compile(input: TranscribeParamsFor<"url">, …)`, and the
 * kernel's ref-driven typing carries the narrowing all the way out to the call
 * site — so which `audio` shapes are legal depends on the model ref, at
 * compile time, with no cast anywhere.
 */
export type TranscribeParamsFor<K extends AudioInputKind> = Omit<TranscribeParams, "audio"> & {
  audio: AudioInputFor<K>;
};

/** How much timing detail to return. `"none"` asks for plain text. */
export type TimestampGranularity = "none" | "word" | "segment" | "character";

/**
 * Who spoke.
 *
 * `enabled` is required rather than inferred from the object's presence,
 * because `{ maxSpeakers: 4 }` alone is ambiguous — it reads as configuration
 * for a feature you may or may not have meant to turn on, and a transcription
 * bill is not the place to find out which.
 */
export interface Diarization {
  enabled: boolean;
  /** Exact count, when known. Mutually exclusive with the min/max pair in practice. */
  speakers?: number;
  minSpeakers?: number;
  maxSpeakers?: number;
}

export interface TranscribeParams {
  audio: AudioInput;
  /** `"provider/model"`, split on the **first** slash. */
  model: string;
  /** BCP-47. Omit to let the model detect. */
  language?: string;
  /**
   * A candidate set for detection, for the providers that accept a shortlist.
   * Distinct from `language`: that one *asserts*, this one *constrains*.
   */
  languages?: readonly string[];
  diarization?: Diarization;
  timestamps?: TimestampGranularity;
  /** Vocabulary hints / a prior transcript, where the model takes one. */
  prompt?: string;
  providerOptions?: ProviderOptions;
}

// ---------------------------------------------------------------------------
// The narrowing, in the two places it has to be declared
// ---------------------------------------------------------------------------

/**
 * A transcribe adapter, parameterized by the audio shapes its route accepts.
 *
 * The `audioInputs` array is the single source of both halves of the promise:
 *
 * - **compile time** — {@link TranscribeValidator} reads it back through
 *   `InputsFor` and types the caller's `audio` from it, so a `Blob` handed to
 *   a URL-only route is an error at the call site;
 * - **run time** — `resolveAudioInput` in `derive.ts` takes the same array and
 *   reports `unsupported_param` naming the kinds this provider does take, for
 *   the JavaScript callers and the runtime-built refs that no type can reach.
 *
 * One array, two enforcement points, no way for them to disagree. It is
 * declared `readonly K[]` rather than inferred from the compile signature
 * because a function parameter type is not something a *value* can be read
 * from — and the runtime half needs a value.
 */
export interface TranscribeAdapterFor<
  K extends AudioInputKind,
  Wire extends object = object,
  Out extends object = object,
> extends UnifiedAdapter<TranscribeParamsFor<K>, Wire, Out> {
  readonly category: "transcribe";
  /** The audio shapes this route accepts, `as const`. */
  readonly audioInputs: readonly K[];
}

/**
 * `transcribe()` — {@link UnifiedRef}-driven like every category validator,
 * plus the one thing that makes this category different: `audio` is typed from
 * the adapter the **ref** selects.
 *
 * Written as an intersection on the parameter (`T & …`) rather than as a
 * constraint on `T`, for the same reason `ExactKeys` is: TypeScript infers `T`
 * from the argument first and *then* checks the argument against the parameter
 * type, so a constraint mentioning `T["model"]` would be circular while an
 * intersection is not. The failure surfaces exactly where it should — on
 * `audio`, naming the shape that route takes.
 *
 * ```ts
 * transcribe({ model: "assemblyai/universal-2", audio: { url } });   // ok
 * transcribe({ model: "assemblyai/universal-2", audio: { file } });  // error
 * transcribe({ model: "cartesia/ink-whisper",  audio: { file } });   // ok
 * transcribe({ model: "cartesia/ink-whisper",  audio: { url } });    // error
 * ```
 */
export interface TranscribeValidator<A> {
  <T extends UnifiedInput<TranscribeParams, UnifiedRef<A>>>(
    params: T &
      ExactKeys<T, UnifiedInput<TranscribeParams, UnifiedRef<A>>> &
      AudioNarrowing<A, T["model"] & string>,
    options?: ValidateOptions,
  ): UnifiedResult<A, T["model"] & string>;
  safe<T extends UnifiedInput<TranscribeParams, UnifiedRef<A>>>(
    params: T &
      ExactKeys<T, UnifiedInput<TranscribeParams, UnifiedRef<A>>> &
      AudioNarrowing<A, T["model"] & string>,
    options?: ValidateOptions,
  ): ValidateResult<UnifiedResult<A, T["model"] & string>>;
  /** Every provider id registered on this validator, sorted. */
  readonly providers: readonly string[];
}

/**
 * The `{ audio }` constraint one ref imposes, as a standalone object type so
 * the error message a caller sees names `audio` and shows the shape wanted.
 */
export type AudioNarrowing<A, R extends string> = {
  // `Extract` because `InputsFor` is generic in the *field*, so it can only
  // promise `string`; the category is what knows those strings are kinds.
  audio: AudioInputFor<Extract<InputsFor<A, R, "audioInputs">, AudioInputKind>>;
};

/** The loosest transcribe adapter that still pins the vocabulary. */
export type AnyTranscribeAdapter = AnyUnifiedAdapter<TranscribeParams> & {
  readonly category: "transcribe";
  readonly audioInputs: readonly AudioInputKind[];
};
