/**
 * `unmodel/sts` — one `sts()` for asking any provider to say the same thing in
 * a different voice.
 *
 * ```ts
 * import { sts } from "unmodel/sts";
 *
 * const req = sts({
 *   model: "elevenlabs/eleven_multilingual_sts_v2",
 *   audio: { file: recording },
 *   voice: "21m00Tcm4TlvDq8ikWAM",
 *   outputFormat: "mp3",
 * });
 *
 * const viaHume = sts({
 *   model: "hume/voice-conversion",
 *   audio: { file: recording },
 *   voice: { name: "Male English Actor" },
 * });
 * ```
 *
 * Five words, three of them required — the only category where most of the
 * vocabulary has to be present. A recording goes in, a target voice says what
 * it should come out as, and that is the whole request: there is no prompt, no
 * length and no frame, because the answer to all three is "whatever the
 * recording did".
 *
 * `createSts([…])` takes the adapters you name instead of all of them:
 *
 * ```ts
 * import { createSts } from "unmodel/sts";
 * import { sts as elevenlabs } from "unmodel/elevenlabs/unified";
 *
 * const sts = createSts([elevenlabs]);
 * ```
 *
 * ## Why this is not `unmodel/tts`, and not `unmodel/voice-clone`
 *
 * It is not `tts` because there is no text: the words, the timing and the
 * delivery all come from the recording, and the model is not reading anything.
 * At ElevenLabs, the one vendor serving both, the two wires are disjoint and so
 * are their model-id enums — `eleven_multilingual_v2` is refused here by name
 * and `eleven_multilingual_sts_v2` is refused there.
 *
 * It is not `voiceClone` because nothing is created: a clone request builds a
 * new voice out of reference recordings and returns an id, and a conversion
 * request spends an id that already exists. Same provider, same kind of
 * multipart upload, opposite direction.
 *
 * ## The source is a `Blob`, so this category is library-only
 *
 * Both witnesses take the recording as a required multipart file part with no
 * URL, no base64 and no upload-handle alternative. A `Blob` cannot be written
 * in JSON, so `elevenlabs.sts` and `hume.sts` are `MULTIPART_ONLY` and
 * unreachable from the CLI by design — the same fact `elevenlabs.voiceClone`
 * already carries.
 *
 * ## `voice` is required, and that is the category's one sharp edge
 *
 * ElevenLabs' wire agrees outright (`voice_id` is a path segment). Hume's
 * schema marks the field optional and documents no default-voice behaviour, so
 * the request without one stays expressible wire-exactly at `hume.sts` — which
 * is precisely the layer that exists to keep it expressible. At this surface it
 * is required, because a conversion with no target is not a conversion.
 *
 * ## What is not a canonical word
 *
 * Everything each vendor publishes alone, which is all of it:
 * `remove_background_noise`, `seed`, `voice_settings`, `file_format` and
 * `enable_logging` at ElevenLabs; `strip_headers`, `context` and
 * `include_timestamp_types` at Hume. Not one of the eight has a second witness,
 * so each is a per-model extra typed from its own route's wire interface, and
 * each gets promoted the day a second vendor spells it the same way. Anything
 * else one-off goes in `providerOptions`, where it is still checked by the
 * provider's own validator.
 *
 * The result is the provider's own `Validated` (see `unmodel/image` for the
 * full explanation of what that means and why the pack is assembled by hand).
 */
import { createUnified } from "../core/unified/kernel";
import type { AnyStsAdapter, StsParams, StsValidator } from "../core/unified/vocabulary/sts";
import { sts as elevenlabs } from "../providers/elevenlabs/unified-sts";
import { sts as hume } from "../providers/hume/unified-sts";

/** An adapter for this category; they live at `src/providers/<p>/unified.ts`. */
export type StsAdapter = AnyStsAdapter;

/**
 * Builds an `sts()` from the adapters you pass. The generic is on the array
 * element so each adapter's literal `provider`, `as const` `models` and
 * `as const` `modelParams` survive inference — driving autocomplete, the return
 * type, and the per-model `outputFormat` narrowing and extras alike.
 *
 * The cast is the same one `createUnified` already performs internally: the
 * runtime is category-agnostic, and `StsValidator` differs from
 * `UnifiedValidator` only in the extra per-model constraints it puts on the
 * params.
 */
export function createSts<A extends StsAdapter>(adapters: readonly A[]): StsValidator<A> {
  return createUnified<StsParams, A>("sts", adapters) as unknown as StsValidator<A>;
}

/**
 * Every voice-conversion adapter unmodel ships — the category's two witnesses.
 *
 * `elevenlabs` is `POST /v1/speech-to-speech/{voice_id}`, three models, a
 * 27-value `output_format` composite in the query string and five knobs;
 * `hume` is `POST /v0/tts/voice_conversion/file`, no model field at all, a
 * container-name `format` object and three knobs. They are the two vendors that
 * publish this operation as a public REST route with a file input — see
 * `docs/providers.md` for the recorded exclusions (Cartesia's `/voice-changer`
 * is sunset, Resemble's is an SSML mode of a route already addressed as
 * `resemble.tts`).
 *
 * The cost is pinned in `test/bundle-budget.test.ts`.
 */
export const sts = createSts([elevenlabs, hume]);

export type {
  AnyStsAdapter,
  AudioContainer,
  AudioFormat,
  AudioFormatCodec,
  AudioFormatOf,
  AudioFormatRequest,
  CodecOf,
  ModelExtras,
  ModelParamsFor,
  ProviderOptions,
  StsAdapterFor,
  StsAudioInput,
  StsModelNarrowing,
  StsModelParams,
  StsModelParamTable,
  StsParams,
  StsParamsBase,
  StsValidator,
  Voice,
  WithModelParams,
} from "../core/unified/vocabulary/sts";

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

// Declaration-portability carriers. One type-only line; see
// src/core/carriers.ts for why a consumer that emits its own `.d.ts` cannot
// name this entry's inferred result types without it (TS2742 / TS2883).
export type * from "../core/carriers";
