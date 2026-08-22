/**
 * `unmodel/voice-design` — one `voiceDesign()` for every provider that
 * invents a voice from a text description.
 *
 * ```ts
 * import { voiceDesign } from "unmodel/voice-design";
 *
 * const req = voiceDesign({
 *   model: "elevenlabs/eleven_ttv_v3",
 *   operation: "design",
 *   prompt: "An elderly British gentleman with a warm, gravelly storytelling tone",
 *   previewText: "Once upon a time, in a land far away, there lived a clockmaker.",
 * });
 * ```
 *
 * That `voiceDesign` is the ready-made pack: all four providers in one
 * bundle. To pay for only the ones you call, build your own from the adapter
 * leaves:
 *
 * ```ts
 * import { createVoiceDesign } from "unmodel/voice-design";
 * import { voiceDesign as elevenlabs } from "unmodel/elevenlabs/unified";
 * import { voiceDesign as minimax } from "unmodel/minimax/unified";
 *
 * const voiceDesign = createVoiceDesign([elevenlabs, minimax]);
 * ```
 *
 * ## The words, and where they land
 *
 * `prompt` is the generative description — `voice_description` at
 * ElevenLabs, `instruction` at Fish, `designPrompt` at Inworld, `prompt` at
 * MiniMax — and deliberately NOT `description`, which is `voice-clone`'s
 * metadata word (the reason the two categories are separate). `previewText`
 * is what the candidates speak: required by Inworld and MiniMax, compiled to
 * `auto_generate_text: true` when omitted at ElevenLabs (that wire's exact
 * spelling of "none given"), and refused at Fish, whose candidates speak
 * model-chosen content. `n`, `seed` and `guidance` land where a wire field
 * exists and are refused by name where none does.
 *
 * ## What comes back, and the two-phase providers
 *
 * This category validates the GENERATIVE request — phase 1. MiniMax's
 * response voice is immediately usable and Fish's candidates are
 * deliberately ephemeral (inline base64, nothing persisted); ElevenLabs and
 * Inworld return previews whose handles a second, provider-shaped call
 * persists. Those save steps are wire-only by design —
 * `elevenlabs.voiceDesignSave` (POST /v1/text-to-voice) and
 * `inworld.voiceDesignPublish` (POST voices/{voiceId}:publish) on the
 * provider subpaths — because the correlating handle is provider-minted and
 * differently shaped every time, and persisting a created resource is the
 * doorstep of voice management, which is out of scope by charter.
 *
 * Hume is the signposted gap: its voice design IS its TTS wire (a
 * description-only `/v0/tts` call), already fully expressible through
 * `unmodel/hume`'s own `tts` validator — an adapter here would return a TTS
 * `Validated` from a voice-design call and muddle what the result is.
 *
 * The result is the provider's own `Validated` (see `unmodel/image` for the
 * full explanation of what that means and why the pack is assembled by hand).
 */
import { createUnified } from "../core/unified/kernel";
import type {
  AnyVoiceDesignAdapter,
  VoiceDesignParams,
  VoiceDesignValidator,
} from "../core/unified/vocabulary/voice-design";
import { voiceDesign as elevenlabs } from "../providers/elevenlabs/unified-voice-design";
import { voiceDesign as fishAudio } from "../providers/fish-audio/unified-voice-design";
import { voiceDesign as inworld } from "../providers/inworld/unified-voice-design";
import { voiceDesign as minimax } from "../providers/minimax/unified-voice-design";

/** An adapter for this category; they live at `src/providers/<p>/unified-voice-design.ts`. */
export type VoiceDesignAdapter = AnyVoiceDesignAdapter;

/**
 * Builds a `voiceDesign()` from the adapters you pass. The generic is on the
 * array element so each adapter's literal `provider` and `as const` `models`
 * survive inference — and therefore drive autocomplete and the return type.
 *
 * The cast is the same one `createUnified` already performs internally: the
 * runtime is category-agnostic, and `VoiceDesignValidator` differs from
 * `UnifiedValidator` only in the extra constraint it puts on the params.
 */
export function createVoiceDesign<A extends VoiceDesignAdapter>(
  adapters: readonly A[],
): VoiceDesignValidator<A> {
  return createUnified<VoiceDesignParams, A>(
    "voiceDesign",
    adapters,
  ) as unknown as VoiceDesignValidator<A>;
}

/**
 * Every voice-design adapter unmodel ships, assembled by hand — the runtime
 * registry, the ref union and the return type in one array, exactly as on
 * the seven sibling packs. The cost is measured and pinned in
 * `test/bundle-budget.test.ts`; `createVoiceDesign([…])` above is the way to
 * pay for one provider instead of four.
 */
export const voiceDesign = createVoiceDesign([elevenlabs, fishAudio, inworld, minimax]);

export type {
  LanguageOf,
  ModelExtras,
  ModelParamsFor,
  ProviderOptions,
  VoiceDesignAdapterFor,
  VoiceDesignModelNarrowing,
  VoiceDesignModelParams,
  VoiceDesignModelParamTable,
  VoiceDesignParams,
  VoiceDesignParamsBase,
  VoiceDesignValidator,
  WithModelParams,
} from "../core/unified/vocabulary/voice-design";

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
