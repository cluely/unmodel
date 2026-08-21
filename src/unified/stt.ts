/**
 * `unmodel/stt` — one `stt()` for every speech-to-text provider.
 *
 * ```ts
 * import { stt } from "unmodel/stt";
 *
 * const req = stt({
 *   model: "deepgram/nova-3",
 *   audio: { url: "https://example.com/interview.wav" },
 *   diarization: { enabled: true },
 *   timestamps: "word",
 * });
 * ```
 *
 * That `stt` is the ready-made pack: all eleven providers, and therefore
 * all eleven providers' catalogs and validators, in one bundle. To pay for only
 * the ones you call, build your own from the adapter leaves:
 *
 * ```ts
 * import { createStt } from "unmodel/stt";
 * import { stt as deepgram } from "unmodel/deepgram/unified";
 * import { stt as openai } from "unmodel/openai/unified";
 *
 * const stt = createStt([deepgram, openai]);
 * ```
 *
 * ## `audio` narrows per model, at compile time
 *
 * Transcription APIs disagree about how audio arrives — multipart upload, a
 * URL the provider fetches, or a handle from its own file API — and the
 * disagreement is per *route*, not per provider. So each adapter declares its
 * `audioInputs`, `AudioInputFor` turns that set into the exact `audio` type for
 * the route, and a caller who hands a batch-only endpoint a `Blob` gets a type
 * error at the call site rather than a validated request that 400s on a body
 * the route does not parse:
 *
 * ```ts
 * stt({ model: "assemblyai/universal-2", audio: { url } });   // ok
 * stt({ model: "assemblyai/universal-2", audio: { file } });  // compile error
 * stt({ model: "cartesia/ink-whisper",  audio: { file } });   // ok
 * stt({ model: "cartesia/ink-whisper",  audio: { url } });    // compile error
 * ```
 *
 * The same array backs it at run time — `resolveAudioInput` reports an
 * `unsupported_param` naming the shapes the route does take — because the type
 * only answers for TypeScript callers with a literal ref, and the promise has
 * to hold for everyone else too.
 *
 * ## `timestamps` narrows per **model**, through a second table
 *
 * Which granularities a route can return is a model fact rather than a route
 * one — `whisper-1` returns word *and* segment timings, `gpt-4o-transcribe`
 * returns neither, `scribe_v1` adds character-level — so each adapter also
 * carries a `modelParams` table, and the ref picks a row from it:
 *
 * ```ts
 * stt({ model: "openai/whisper-1",        audio, timestamps: "segment" });   // ok
 * stt({ model: "openai/gpt-4o-transcribe", audio, timestamps: "segment" });  // compile error
 * stt({ model: "elevenlabs/scribe_v1",    audio, timestamps: "character" }); // ok
 * stt({ model: "deepgram/nova-3",         audio, keyterm: "unmodel" });      // ok
 * stt({ model: "deepgram/nova-2",         audio, keyterm: "unmodel" });      // compile error
 * ```
 *
 * The two narrowings compose rather than compete: `audioInputs` types `audio`
 * from the adapter, `modelParams` types `timestamps`, `language` and the extras
 * from the model, and `SttValidator` intersects both.
 *
 * The result is the provider's own `Validated` (see `unmodel/image` for the
 * full explanation of what that means and why the pack is assembled by hand).
 */
import { createUnified } from "../core/unified/kernel";
import type {
  AnySttAdapter,
  SttParams,
  SttValidator,
} from "../core/unified/vocabulary/stt";
import { stt as assemblyai } from "../providers/assemblyai/unified";
import { stt as cartesia } from "../providers/cartesia/unified-stt";
import { stt as deepgram } from "../providers/deepgram/unified-stt";
import { stt as elevenlabs } from "../providers/elevenlabs/unified-stt";
import { stt as gladia } from "../providers/gladia/unified";
import { stt as inworld } from "../providers/inworld/unified-stt";
import { stt as mistral } from "../providers/mistral/unified";
import { stt as openai } from "../providers/openai/unified-stt";
import { stt as revai } from "../providers/revai/unified";
import { stt as soniox } from "../providers/soniox/unified";
import { stt as speechmatics } from "../providers/speechmatics/unified";

/** An adapter for this category; they live at `src/providers/<p>/unified.ts`. */
export type SttAdapter = AnySttAdapter;

/**
 * Builds a `stt()` from the adapters you pass. The generic is on the
 * array element so each adapter's literal `provider`, `as const` `models` and
 * `as const` `audioInputs` survive inference — and therefore drive
 * autocomplete, the return type, *and* the per-model `audio` narrowing.
 *
 * The cast is the same one `createUnified` already performs internally: the
 * runtime is category-agnostic, and `SttValidator` differs from
 * `UnifiedValidator` only in the extra constraint it puts on the params.
 */
export function createStt<A extends SttAdapter>(
  adapters: readonly A[],
): SttValidator<A> {
  return createUnified<SttParams, A>(
    "stt",
    adapters,
  ) as unknown as SttValidator<A>;
}

/**
 * Every transcribe adapter unmodel ships, assembled by hand.
 *
 * By hand, and in one array, because that array is four things at once: the
 * runtime registry, the `"provider/model"` ref union an editor autocompletes,
 * the return type of a call (each provider's own `Validated`) — and, unique to
 * this category, the per-ref `audio` narrowing. A generated or
 * dynamically-loaded registry would keep the first and lose the other three.
 *
 * The cost is honest and measured: importing this pulls in eleven provider
 * validators, their schemas and their catalogs (~395 KiB, pinned in
 * `test/bundle-budget.test.ts`). `createStt([…])` above is the way to
 * pay for two providers instead of eleven.
 *
 * `inworld` is in the list and cannot be called: its route takes base64 audio
 * inline, which a synchronous compile step cannot produce from a `Blob`, so its
 * adapter declares `audio` unsupported and its `audioInputs` is empty. It is
 * registered anyway because leaving it out would report "inworld is not a
 * transcribe provider in this build" — a packaging answer to a wire question.
 * `src/providers/inworld/unified-stt.ts` argues the case in full.
 */
export const stt = createStt([
  openai,
  deepgram,
  assemblyai,
  elevenlabs,
  gladia,
  speechmatics,
  mistral,
  soniox,
  revai,
  cartesia,
  inworld,
]);

export type {
  AudioFileIdInput,
  AudioFileInput,
  AudioInput,
  AudioInputFor,
  AudioInputKind,
  AudioNarrowing,
  AudioUrlInput,
  Diarization,
  LanguageOf,
  ModelExtras,
  ModelParamsFor,
  ProviderOptions,
  TimestampGranularity,
  TimestampsOf,
  SttAdapterFor,
  SttModelNarrowing,
  SttModelParams,
  SttModelParamTable,
  SttParams,
  SttParamsBase,
  SttParamsFor,
  SttValidator,
  WithModelParams,
} from "../core/unified/vocabulary/stt";

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
