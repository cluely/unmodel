/**
 * `unmodel/sts` — the canonical vocabulary for voice conversion: a recording
 * goes in, the same performance comes out in a different voice.
 *
 * Five words, and the category is defined by which of them are REQUIRED. A
 * text-to-speech request can leave out the voice and get the provider's
 * default; a voice-conversion request cannot, because the target voice is the
 * entire operation. So `model`, `audio` and `voice` are all required, and the
 * only optional words are the encoding and the escape hatch.
 *
 * ## Why the source is a `Blob` and nothing else
 *
 * Both witnesses take the recording as a required `multipart/form-data` file
 * part with no URL, no base64 and no upload-handle alternative:
 * `audio` is `format: binary` and the sole `required` member of ElevenLabs'
 * body schema, and `audio` is `(file, required)` on Hume's. So
 * {@link StsAudioInput} is one shape rather than a union, and — unlike
 * `stt`'s `audioInputs` or `voiceClone`'s `sampleInputs` — there is no
 * per-adapter narrowing mechanism here at all. A one-member union narrowed
 * per adapter is indirection for single-use code; the day a route fetches a
 * URL, this becomes a union and grows the mechanism then, which is exactly
 * what `voiceClone`'s own note about the absent `"url"` member says.
 *
 * A consequence worth stating at the surface: because a `Blob` cannot be
 * written in JSON, every endpoint in this category is library-only and
 * unreachable from the CLI (`MULTIPART_ONLY` in `src/cli-registry.ts`), the
 * same way `elevenlabs.voiceClone` is.
 *
 * ## The two witnesses, and what survived them
 *
 * ElevenLabs (`POST /v1/speech-to-speech/{voice_id}`) and Hume
 * (`POST /v0/tts/voice_conversion/file`). Two, which is the floor
 * `docs/decisions.md` §8 sets, and they agree on every word here:
 *
 * | word | witnesses | verdict |
 * |---|---|---|
 * | `audio` | 2/2 — a required binary form part, both spelled `audio` | canonical |
 * | `voice` | 2/2 — a path param at one, a form part at the other | canonical, and REQUIRED |
 * | `outputFormat` | 2/2 — `output_format` query composite / `format.type` object | canonical |
 * | `model` | 1/2 on the WIRE — see below | canonical, as everywhere |
 *
 * `model` is the ref every category has, and it is worth naming what it means
 * here: ElevenLabs publishes three speech-to-speech model ids, Hume publishes
 * none at all (its route has no model field of any kind), so the Hume row is a
 * synthetic catalog id under the `HAND_CATALOGS.md` rule rather than a wire
 * value. That is the `elevenlabs/ivc` situation, one category over.
 *
 * ## What is deliberately NOT a word
 *
 * Everything each vendor publishes alone, which is all of it:
 * `remove_background_noise`, `seed`, `voice_settings`, `file_format` and
 * `enable_logging` at ElevenLabs; `strip_headers`, `context` and
 * `include_timestamp_types` at Hume. Not one of the eight has a second
 * independent witness, so each rides as a per-model extra typed from its own
 * route's wire interface, and each is promoted the day a second vendor spells
 * it the same way.
 *
 * `seed` is the near-miss and stays out for the sfx reason: one vendor of two
 * is not a vocabulary, and the extras mechanism reaches it at the same call
 * site with the same exact type.
 *
 * Types only, like every file under `vocabulary/`.
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
import type { BlobRef, ProviderOptions } from "./common";
import type {
  ModelExtras,
  StsModelNarrowing,
  StsModelParamTable,
  WithModelParams,
} from "./model-params";
// Type-only, and the same erased-at-emit cycle `./model-params` documents: the
// target of a conversion is the same concept the speech vocabulary already
// names, and declaring a second `Voice` here would be a second thing to keep
// in step for no gain.
import type { Voice } from "./tts";

export type {
  AudioContainer,
  AudioFormat,
  AudioFormatCodec,
  AudioFormatRequest,
} from "./audio";
export type { ProviderOptions } from "./common";
export type { Voice } from "./tts";

export type {
  AudioFormatOf,
  CodecOf,
  ModelExtras,
  ModelParamsFor,
  StsModelNarrowing,
  StsModelParams,
  StsModelParamTable,
  WithModelParams,
} from "./model-params";

/**
 * The recording to convert: a `Blob`/`File` posted as a multipart part.
 *
 * One shape, not a union — see the module header for why, and for the note
 * that this is what makes the whole category CLI-unreachable.
 */
export type StsAudioInput = BlobRef;

/**
 * Everything that is not narrowed per model.
 *
 * `outputFormat` is omitted here on purpose — the replacement-arm law
 * (`SizingArms` in `./model-params.ts`): {@link StsModelNarrowing} REPLACES it
 * rather than intersecting with it, and a base that still declared
 * `outputFormat?: AudioFormatRequest` would put the wide arm back into the
 * intersection and let `{ format: "flac" }` compile at a provider that has
 * never heard of FLAC.
 *
 * `voice` stays here, and stays WIDE: neither witness publishes a closed voice
 * list for this route — ElevenLabs' catalog is per-account and runs to
 * thousands, Hume's Voice Library likewise plus custom voices — so there is no
 * `voices` row to narrow from and nothing for a replacement arm to do.
 */
export interface StsParamsBase {
  /** `"provider/model"`, split on the **first** slash. */
  model: string;
  /**
   * The recording whose content and delivery drive the result. Required
   * everywhere: it is the input the operation exists to transform.
   */
  audio: StsAudioInput;
  /**
   * The TARGET voice — what the recording should come out sounding like.
   *
   * **Required**, which is the one place this category is stricter than its
   * neighbours. `tts` leaves `voice` optional because a text-to-speech route
   * has a documented default speaker; neither of these routes documents a
   * default target, and a conversion with no target is not a conversion.
   * ElevenLabs' wire agrees outright — `voice_id` is a required path segment.
   * Hume's schema marks the field optional and documents no default-voice
   * behaviour for it, so the request stays expressible wire-exactly at
   * `hume.sts`, which is the layer that exists to keep it expressible.
   *
   * The bare string is the id or the name, whichever that provider takes;
   * `{ id }` and `{ name }` exist for Hume, which takes both and would
   * otherwise have to guess from the shape of the string.
   */
  voice: Voice;
  providerOptions?: ProviderOptions;
}

/**
 * A voice-conversion request, with `outputFormat` at its widest — the type an
 * adapter's `compile` is written against, and the type a caller with a
 * run-time-built ref gets.
 */
export interface StsParams extends StsParamsBase {
  /** The encoding to ask for. Refused by name where the route has no such field. */
  outputFormat?: AudioFormatRequest;
}

// ---------------------------------------------------------------------------
// Per-model narrowing
// ---------------------------------------------------------------------------

/** A voice-conversion adapter, parameterized by its per-model table. */
export interface StsAdapterFor<
  T extends StsModelParamTable,
  Wire extends object = object,
  Out extends object = object,
> extends UnifiedAdapter<StsParams, Wire, Out>,
    WithModelParams<T> {
  readonly category: "sts";
}

/**
 * The loosest voice-conversion adapter that still pins the vocabulary.
 * `modelParams` is optional here and required on {@link StsAdapterFor}, so a
 * third-party adapter without one is still a legal argument to `createSts` and
 * simply degrades to the wide vocabulary.
 */
export type AnyStsAdapter = AnyUnifiedAdapter<StsParams> & {
  readonly category: "sts";
  readonly modelParams?: StsModelParamTable;
};

/**
 * `sts()` — {@link UnifiedRef}-driven like every category validator, with
 * `outputFormat` narrowed to the codecs the selected model can actually emit.
 *
 * Two type parameters for `SfxValidator`'s reason: `M` is inferred from
 * `params.model` first and `T` is constrained by it, so an off-list codec is
 * one error on `outputFormat` rather than an intersection reduced to `never`
 * and three errors, the first of them on `model`.
 *
 * ```ts
 * sts({ model: "elevenlabs/eleven_multilingual_sts_v2", audio: { file }, voice: "21m00Tcm4TlvDq8ikWAM" });
 * sts({ model: "hume/voice-conversion", audio: { file }, voice: { name: "Male English Actor" } });
 * sts({ model: "hume/voice-conversion", audio: { file }, voice: "x", outputFormat: "opus" }); // error: mp3 / pcm only
 * ```
 */
export interface StsValidator<A> extends SafeUnknown<UnifiedResult<A, string>> {
  <
    M extends UnifiedRef<A> | (string & {}),
    T extends UnifiedInput<StsParamsBase, UnifiedRef<A>, A> &
      StsModelNarrowing<A, M> &
      ModelExtras<A, M>,
  >(
    params: T &
      { model: M } &
      ExactKeys<T, UnifiedInput<StsParams, UnifiedRef<A>, A> & ModelExtras<A, M>>,
    options?: ValidateOptions,
  ): UnifiedResult<A, M>;
  safe<
    M extends UnifiedRef<A> | (string & {}),
    T extends UnifiedInput<StsParamsBase, UnifiedRef<A>, A> &
      StsModelNarrowing<A, M> &
      ModelExtras<A, M>,
  >(
    params: T &
      { model: M } &
      ExactKeys<T, UnifiedInput<StsParams, UnifiedRef<A>, A> & ModelExtras<A, M>>,
    options?: ValidateOptions,
  ): ValidateResult<UnifiedResult<A, M>>;
  /** Every provider id registered on this validator, sorted. */
  readonly providers: readonly string[];
}
