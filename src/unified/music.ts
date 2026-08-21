/**
 * `unmodel/music` — one `music()` for every music-generation provider.
 *
 * ```ts
 * import { music } from "unmodel/music";
 *
 * const req = music({
 *   model: "elevenlabs/music_v1",
 *   prompt: "slow post-rock build, no vocals",
 *   durationSeconds: 45,
 *   instrumental: true,
 * });
 * ```
 *
 * That `music` is the ready-made pack. To pay for one provider instead of two,
 * build your own from the adapter leaves:
 *
 * ```ts
 * import { createMusic } from "unmodel/music";
 * import { music as elevenlabs } from "unmodel/elevenlabs/unified";
 *
 * const music = createMusic([elevenlabs]);
 * ```
 *
 * **The unit is in the name.** `durationSeconds: 45` is `music_length_ms:
 * 45000` at ElevenLabs and `duration: 45` at Stability; the conversion is exact
 * and therefore silent, and a length that lands between two milliseconds is an
 * error rather than a rounded value nobody asked for.
 *
 * **`outputFormat` narrows to the ref.** ElevenLabs publishes a composite enum
 * covering mp3, Opus, PCM, μ-law and A-law; Stability's `output_format` is
 * `"mp3" | "wav"`. Each adapter's `modelParams` table says which, so
 * `outputFormat: "opus"` is a compile error on `stability/stable-audio-2` and
 * fine on `elevenlabs/music_v1` — and each model's non-canonical knobs
 * (`steps`, `cfg_scale`, `finetune_id`) arrive typed and go on the wire
 * verbatim.
 *
 * The smallest of the six vocabularies, deliberately: music APIs disagree
 * about everything above the prompt, and a canonical word for something three
 * providers interpret differently would make this category's warnings
 * meaningless — which is the one thing a translation layer cannot afford.
 * Anything one-off rides in `providerOptions`, where it is still checked by
 * the provider's own validator.
 *
 * The result is the provider's own `Validated` (see `unmodel/image` for the
 * full explanation of what that means and why the pack is assembled by hand).
 */
import { createUnified } from "../core/unified/kernel";
import type {
  AnyMusicAdapter,
  MusicParams,
  MusicValidator,
} from "../core/unified/vocabulary/music";
import { music as elevenlabs } from "../providers/elevenlabs/unified-music";
import { music as stability } from "../providers/stability/unified-music";

/** An adapter for this category; they live at `src/providers/<p>/unified.ts`. */
export type MusicAdapter = AnyMusicAdapter;

/**
 * Builds a `music()` from the adapters you pass. The generic is on the array
 * element so each adapter's literal `provider`, `as const` `models` and
 * `as const` `modelParams` survive inference — driving autocomplete, the return
 * type, and the per-model `outputFormat` and extras narrowing alike.
 *
 * The cast is the same one `createUnified` already performs internally: the
 * runtime is category-agnostic, and `MusicValidator` differs from
 * `UnifiedValidator` only in the extra per-model constraints it puts on the
 * params.
 */
export function createMusic<A extends MusicAdapter>(
  adapters: readonly A[],
): MusicValidator<A> {
  return createUnified<MusicParams, A>("music", adapters) as unknown as MusicValidator<A>;
}

/**
 * Every music adapter unmodel ships, assembled by hand — the smallest pack in
 * the library, and the one whose *omissions* are the interesting part.
 *
 * **Two providers, one route each.** Stability's `musicFromAudio` (audio-to-
 * audio) and `musicInpaint` are deliberately not unified in v1: both take an
 * `audio` Blob plus controls no other provider has (`strength`,
 * `mask_start`/`mask_end`), so a canonical vocabulary for them would be a
 * vocabulary of one — which is a rename with extra steps, not a translation.
 * They stay wire-only on `unmodel/stability`.
 *
 * **The one conversion.** ElevenLabs counts milliseconds and Stability counts
 * seconds, which is exactly why the canonical word is `durationSeconds`;
 * ×1000 is exact and therefore silent, and a length that lands between two
 * milliseconds is refused rather than rounded.
 *
 * The cost is honest and measured: importing this pulls in both providers'
 * validators, schemas and catalogs (~145 KiB, pinned in
 * `test/bundle-budget.test.ts`). `createMusic([…])` above is the way to pay
 * for one provider instead of two.
 */
export const music = createMusic([elevenlabs, stability]);

export type {
  AnyMusicAdapter,
  AudioContainer,
  AudioFormat,
  AudioFormatCodec,
  AudioFormatOf,
  AudioFormatRequest,
  CodecOf,
  ModelExtras,
  ModelParamsFor,
  MusicAdapterFor,
  MusicModelNarrowing,
  MusicModelParams,
  MusicModelParamTable,
  MusicParams,
  MusicParamsBase,
  MusicValidator,
  ProviderOptions,
  WithModelParams,
} from "../core/unified/vocabulary/music";

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
