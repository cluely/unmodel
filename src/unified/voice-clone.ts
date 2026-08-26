/**
 * `unmodel/voice-clone` — one `voiceClone()` for every provider that creates
 * a voice from reference recordings.
 *
 * ```ts
 * import { voiceClone } from "unmodel/voice-clone";
 *
 * const req = voiceClone({
 *   model: "elevenlabs/ivc",
 *   operation: "clone",
 *   name: "Narrator",
 *   samples: [{ audio: { file: recording } }],
 * });
 * ```
 *
 * That `voiceClone` is the ready-made pack: all six providers, and therefore
 * all six providers' validators, in one bundle. To pay for only the ones you
 * call, build your own from the adapter leaves:
 *
 * ```ts
 * import { createVoiceClone } from "unmodel/voice-clone";
 * import { voiceClone as elevenlabs } from "unmodel/elevenlabs/unified";
 * import { voiceClone as cartesia } from "unmodel/cartesia/unified";
 *
 * const voiceClone = createVoiceClone([elevenlabs, cartesia]);
 * ```
 *
 * ## `samples` narrows per model, at compile time
 *
 * Cloning APIs disagree about how the recordings arrive — multipart file
 * parts, base64 inside the JSON body, or a handle from the provider's own
 * upload API — and about how many (Fish takes up to twenty, Cartesia exactly
 * one clip). Each adapter declares its `sampleInputs` and `sampleLimits`; the
 * first narrows every sample's `audio` at the call site, the second is
 * enforced at run time by `resolveVoiceSamples` with the bounds in the
 * message:
 *
 * ```ts
 * voiceClone({ model: "elevenlabs/ivc", …,          samples: [{ audio: { file } }] });   // ok
 * voiceClone({ model: "inworld/voice-clone", …,     samples: [{ audio: { data } }] });   // ok
 * voiceClone({ model: "inworld/voice-clone", …,     samples: [{ audio: { file } }] });   // compile error
 * voiceClone({ model: "minimax/voice-clone", …,     samples: [{ audio: { fileId } }] }); // ok
 * ```
 *
 * ## The words that refuse rather than approximate
 *
 * The vocabulary carries the facts a caller cannot afford to learn from an
 * invoice: `visibility` (Fish defaults new voices to PUBLIC; say
 * `"private"`), `voiceId` (required by MiniMax — the one wire where the
 * caller mints the handle — refused everywhere else), per-sample `transcript`
 * (a field at Fish/Inworld/MiniMax, refused where no wire field exists), and
 * `name` (refused only at MiniMax, whose `voiceId` is the handle). A member a
 * provider cannot express is an error naming what that route does take —
 * never a silent drop.
 *
 * ## Phase 1 only, by charter
 *
 * This category validates the CREATION request. What comes back — a
 * provider-minted voice id (or, at MiniMax, the id you chose) — is yours to
 * use on `unmodel/tts` as `voice`; managing stored voices is out of scope.
 * Speechify's clone route exists but is wire-only (`unmodel/speechify`):
 * its consent challenge/response ceremony is a one-provider, multi-request
 * flow the canonical vocabulary deliberately does not carry.
 *
 * The result is the provider's own `Validated` (see `unmodel/image` for the
 * full explanation of what that means and why the pack is assembled by hand).
 * The multipart providers' results are posted with their own
 * `voiceCloneToFormData` helpers — see each wire module.
 */
import { createUnified } from "../core/unified/kernel";
import type {
  AnyVoiceCloneAdapter,
  VoiceCloneParams,
  VoiceCloneValidator,
} from "../core/unified/vocabulary/voice-clone";
import { voiceClone as cartesia } from "../providers/cartesia/unified-voice-clone";
import { voiceClone as elevenlabs } from "../providers/elevenlabs/unified-voice-clone";
import { voiceClone as fishAudio } from "../providers/fish-audio/unified-voice-clone";
import { voiceClone as inworld } from "../providers/inworld/unified-voice-clone";
import { voiceClone as lmnt } from "../providers/lmnt/unified-voice-clone";
import { voiceClone as minimax } from "../providers/minimax/unified-voice-clone";

/** An adapter for this category; they live at `src/providers/<p>/unified-voice-clone.ts`. */
export type VoiceCloneAdapter = AnyVoiceCloneAdapter;

/**
 * Builds a `voiceClone()` from the adapters you pass. The generic is on the
 * array element so each adapter's literal `provider`, `as const` `models` and
 * `as const` `sampleInputs` survive inference — and therefore drive
 * autocomplete, the return type, *and* the per-model `samples` narrowing.
 *
 * The cast is the same one `createUnified` already performs internally: the
 * runtime is category-agnostic, and `VoiceCloneValidator` differs from
 * `UnifiedValidator` only in the extra constraint it puts on the params.
 */
export function createVoiceClone<A extends VoiceCloneAdapter>(
  adapters: readonly A[],
): VoiceCloneValidator<A> {
  return createUnified<VoiceCloneParams, A>(
    "voiceClone",
    adapters,
  ) as unknown as VoiceCloneValidator<A>;
}

/**
 * Every voice-clone adapter unmodel ships, assembled by hand.
 *
 * By hand, and in one array, because that array is four things at once: the
 * runtime registry, the `"provider/model"` ref union an editor autocompletes,
 * the return type of a call (each provider's own `Validated`) — and the
 * per-ref `samples` narrowing. A generated or dynamically-loaded registry
 * would keep the first and lose the other three.
 *
 * The cost is honest and measured: importing this pulls in six provider
 * validators and their schemas (pinned in `test/bundle-budget.test.ts`).
 * `createVoiceClone([…])` above is the way to pay for two providers instead
 * of six.
 */
export const voiceClone = createVoiceClone([
  elevenlabs,
  fishAudio,
  inworld,
  minimax,
  cartesia,
  lmnt,
]);

export type {
  LanguageOf,
  ModelExtras,
  ModelParamsFor,
  ProviderOptions,
  SampleNarrowing,
  VoiceCloneAdapterFor,
  VoiceCloneModelNarrowing,
  VoiceCloneModelParams,
  VoiceCloneModelParamTable,
  VoiceCloneParams,
  VoiceCloneParamsBase,
  VoiceCloneParamsFor,
  VoiceCloneValidator,
  VoiceSample,
  VoiceSampleDataInput,
  VoiceSampleFileIdInput,
  VoiceSampleFileInput,
  VoiceSampleFor,
  VoiceSampleInput,
  VoiceSampleInputFor,
  VoiceSampleKind,
  VoiceSampleLimits,
  VoiceVisibility,
  WithModelParams,
} from "../core/unified/vocabulary/voice-clone";

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
