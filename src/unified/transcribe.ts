/**
 * `unmodel/transcribe` — one `transcribe()` for every speech-to-text provider.
 *
 * ```ts
 * import { transcribe } from "unmodel/transcribe";
 *
 * const req = transcribe({
 *   model: "deepgram/nova-3",
 *   audio: { url: "https://example.com/interview.wav" },
 *   diarization: { enabled: true },
 *   timestamps: "word",
 * });
 * ```
 *
 * That `transcribe` is the ready-made pack: all eleven providers, and therefore
 * all eleven providers' catalogs and validators, in one bundle. To pay for only
 * the ones you call, build your own from the adapter leaves:
 *
 * ```ts
 * import { createTranscribe } from "unmodel/transcribe";
 * import { transcribe as deepgram } from "unmodel/deepgram/unified";
 * import { transcribe as openai } from "unmodel/openai/unified";
 *
 * const transcribe = createTranscribe([deepgram, openai]);
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
 * transcribe({ model: "assemblyai/universal-2", audio: { url } });   // ok
 * transcribe({ model: "assemblyai/universal-2", audio: { file } });  // compile error
 * transcribe({ model: "cartesia/ink-whisper",  audio: { file } });   // ok
 * transcribe({ model: "cartesia/ink-whisper",  audio: { url } });    // compile error
 * ```
 *
 * The same array backs it at run time — `resolveAudioInput` reports an
 * `unsupported_param` naming the shapes the route does take — because the type
 * only answers for TypeScript callers with a literal ref, and the promise has
 * to hold for everyone else too.
 *
 * The result is the provider's own `Validated` (see `unmodel/image` for the
 * full explanation of what that means and why the pack is assembled by hand).
 */
import { createUnified } from "../core/unified/kernel";
import type {
  AnyTranscribeAdapter,
  TranscribeParams,
  TranscribeValidator,
} from "../core/unified/vocabulary/transcribe";
import { transcribe as assemblyai } from "../providers/assemblyai/unified";
import { transcribe as cartesia } from "../providers/cartesia/unified-transcribe";
import { transcribe as deepgram } from "../providers/deepgram/unified-transcribe";
import { transcribe as elevenlabs } from "../providers/elevenlabs/unified-transcribe";
import { transcribe as gladia } from "../providers/gladia/unified";
import { transcribe as inworld } from "../providers/inworld/unified-transcribe";
import { transcribe as mistral } from "../providers/mistral/unified";
import { transcribe as openai } from "../providers/openai/unified-transcribe";
import { transcribe as revai } from "../providers/revai/unified";
import { transcribe as soniox } from "../providers/soniox/unified";
import { transcribe as speechmatics } from "../providers/speechmatics/unified";

/** An adapter for this category; they live at `src/providers/<p>/unified.ts`. */
export type TranscribeAdapter = AnyTranscribeAdapter;

/**
 * Builds a `transcribe()` from the adapters you pass. The generic is on the
 * array element so each adapter's literal `provider`, `as const` `models` and
 * `as const` `audioInputs` survive inference — and therefore drive
 * autocomplete, the return type, *and* the per-model `audio` narrowing.
 *
 * The cast is the same one `createUnified` already performs internally: the
 * runtime is category-agnostic, and `TranscribeValidator` differs from
 * `UnifiedValidator` only in the extra constraint it puts on the params.
 */
export function createTranscribe<A extends TranscribeAdapter>(
  adapters: readonly A[],
): TranscribeValidator<A> {
  return createUnified<TranscribeParams, A>(
    "transcribe",
    adapters,
  ) as unknown as TranscribeValidator<A>;
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
 * validators, their schemas and their catalogs (~245 KiB, pinned in
 * `test/bundle-budget.test.ts`). `createTranscribe([…])` above is the way to
 * pay for two providers instead of eleven.
 *
 * `inworld` is in the list and cannot be called: its route takes base64 audio
 * inline, which a synchronous compile step cannot produce from a `Blob`, so its
 * adapter declares `audio` unsupported and its `audioInputs` is empty. It is
 * registered anyway because leaving it out would report "inworld is not a
 * transcribe provider in this build" — a packaging answer to a wire question.
 * `src/providers/inworld/unified-transcribe.ts` argues the case in full.
 */
export const transcribe = createTranscribe([
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
  ProviderOptions,
  TimestampGranularity,
  TranscribeAdapterFor,
  TranscribeParams,
  TranscribeParamsFor,
  TranscribeValidator,
} from "../core/unified/vocabulary/transcribe";

export type {
  CompileContext,
  CompileIssue,
  CompiledCall,
  Derived,
  UnifiedAdapter,
  UnifiedRef,
  UnifiedResult,
  UnifiedValidator,
} from "../core/unified/types";
