/**
 * `unmodel/transcribe` — one `transcribe()` for every speech-to-text provider.
 *
 * ```ts
 * import { createTranscribe } from "unmodel/transcribe";
 * import { deepgramTranscribe } from "unmodel/deepgram";
 * import { openaiTranscribe } from "unmodel/openai";
 *
 * const transcribe = createTranscribe([deepgramTranscribe, openaiTranscribe]);
 *
 * const req = transcribe({
 *   model: "deepgram/nova-3",
 *   audio: { url: "https://example.com/interview.wav" },
 *   diarization: { enabled: true, maxSpeakers: 3 },
 *   timestamps: "word",
 * });
 * ```
 *
 * ## `audio` narrows per model, at compile time
 *
 * Transcription APIs disagree about how audio arrives — multipart upload, a
 * URL the provider fetches, or a handle from its own file API — and the
 * disagreement is per *route*, not per provider. So `AudioInputFor` turns a
 * route's accepted set into the exact `audio` type for it, and a caller who
 * hands a batch-only endpoint a `Blob` gets a type error at the call site
 * rather than a validated request that 400s on a body the route does not
 * parse.
 *
 * The result is the provider's own `Validated` (see `unmodel/image` for the
 * full explanation of what that means and why the pack is assembled by hand).
 */
import { createUnified } from "../core/unified/kernel";
import type { AnyUnifiedAdapter, UnifiedValidator } from "../core/unified/types";
import type { TranscribeParams } from "../core/unified/vocabulary/transcribe";

/** An adapter for this category; they live at `src/providers/<p>/unified.ts`. */
export type TranscribeAdapter = AnyUnifiedAdapter<TranscribeParams> & {
  readonly category: "transcribe";
};

/**
 * Builds a `transcribe()` from the adapters you pass. The generic is on the
 * array element so each adapter's literal `provider` and `as const` `models`
 * survive inference and drive both autocomplete and the return type.
 */
export function createTranscribe<A extends TranscribeAdapter>(
  adapters: readonly A[],
): UnifiedValidator<TranscribeParams, A> {
  return createUnified<TranscribeParams, A>("transcribe", adapters);
}

/**
 * The zero-argument `transcribe()` carrying every adapter unmodel ships lands
 * here once there are adapters to carry — see the layering note in
 * `src/unified/image.ts` for why the convenience pack is deliberately not part
 * of the commit that introduces the kernel.
 */

export type {
  AudioFileIdInput,
  AudioFileInput,
  AudioInput,
  AudioInputFor,
  AudioInputKind,
  AudioUrlInput,
  Diarization,
  ProviderOptions,
  TimestampGranularity,
  TranscribeParams,
  TranscribeParamsFor,
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
