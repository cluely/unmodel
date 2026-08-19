/**
 * `unmodel/transcribe` — the canonical vocabulary for speech-to-text.
 */
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
