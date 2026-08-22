/**
 * `unmodel/voice-design` — the canonical vocabulary for voice design: invent
 * a voice from a text description.
 *
 * The other half of the split `voice-clone.ts`'s header argues (disjoint
 * required fields, different model lists, different wire routes, and one word
 * — `description` — that means metadata there and the generative prompt
 * here). This is the simpler half: no media input, so no per-adapter input
 * narrowing at all — the smallest category shape in the library beside
 * `music`.
 *
 * **The unified surface is phase 1 only.** Four of the six providers with a
 * design route make it a two-phase flow — generate preview candidates, then a
 * second call persists one — and the correlating handle is provider-minted
 * and differently shaped every time (`generated_voice_id`, a draft `voiceId`,
 * a `uuid` plus sample index). A canonical "save" would be a vocabulary of
 * one word per provider, and persisting a created resource is the doorstep of
 * voice *management*, which is out of scope by charter. The save steps ship
 * as wire-exact validators (`elevenlabs.voiceDesignSave`,
 * `inworld.voiceDesignPublish`) and the entry's docs point at them. The two
 * single-phase providers need nothing: MiniMax's response voice is
 * immediately usable, and Fish's candidates are deliberately ephemeral.
 *
 * `operation: "design"` is the required literal discriminant, mirroring
 * `"clone"` — ElevenLabs' remix route (prompt + existing voice) is the
 * obvious future arm.
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
import type { ProviderOptions } from "./common";
import type {
  ModelExtras,
  VoiceDesignModelNarrowing,
  VoiceDesignModelParamTable,
  WithModelParams,
} from "./model-params";

export type { ProviderOptions } from "./common";

export type {
  LanguageOf,
  ModelExtras,
  ModelParamsFor,
  VoiceDesignModelNarrowing,
  VoiceDesignModelParams,
  VoiceDesignModelParamTable,
  WithModelParams,
} from "./model-params";

/**
 * Everything that is not narrowed per model.
 *
 * `language` is **replaced** by {@link VoiceDesignModelNarrowing} in the
 * validator's constraint rather than intersected with it — the
 * `(string & {})` brace rule `SttParamsBase` states.
 */
export interface VoiceDesignParamsBase {
  operation: "design";
  /** `"provider/model"`, split on the **first** slash. */
  model: string;
  /**
   * The generative description of the voice to invent — the canonical word is
   * `prompt`, whatever the vendor calls it (`voice_description`,
   * `instruction`, `designPrompt`, `prompt`). Deliberately NOT `description`:
   * that word is voice-clone metadata, and merging the two meanings is the
   * mistake this category split exists to prevent.
   */
  prompt: string;
  /**
   * What the preview candidates speak. Required by Inworld and MiniMax's
   * wires (their validators answer when it is missing); at ElevenLabs,
   * omitting it compiles to `auto_generate_text: true` — that wire's exact
   * spelling of "none given", not an invented default. Fish instead takes an
   * optional `reference_text` (≤150 chars), which stays an extra: it is
   * reference *content*, not the candidates' script.
   */
  previewText?: string;
  /**
   * How many candidate voices to generate — the canonical count word `n`,
   * shared with `image` and `video`. Fish takes 1–4, Inworld 1–3 (their
   * model rows' extras carry nothing; the wire validators enforce the
   * bounds); providers whose count is fixed refuse it.
   */
  n?: number;
  /** Deterministic sampling, where the route takes one (Fish, ElevenLabs). */
  seed?: number;
  /**
   * Prompt-adherence scale — Fish's and ElevenLabs' `guidance_scale`, the
   * same knob with different defaults (2 and 5). No default is invented
   * here; omit to keep each provider's.
   */
  guidance?: number;
  providerOptions?: ProviderOptions;
}

/**
 * A voice-design request.
 *
 * The per-model field is declared here at its widest — this is the type an
 * adapter's `compile` is written against, and the type a caller with a
 * run-time-built ref gets.
 */
export interface VoiceDesignParams extends VoiceDesignParamsBase {
  /** BCP-47 hint for the generated voice's language, where the route takes one. */
  language?: string;
}

// ---------------------------------------------------------------------------
// Adapter and validator
// ---------------------------------------------------------------------------

/** A voice-design adapter. No input kinds — the input is the prompt itself. */
export interface VoiceDesignAdapterFor<
  T extends VoiceDesignModelParamTable,
  Wire extends object = object,
  Out extends object = object,
> extends UnifiedAdapter<VoiceDesignParams, Wire, Out>,
    WithModelParams<T> {
  readonly category: "voiceDesign";
}

/**
 * `voiceDesign()` — {@link UnifiedRef}-driven like every category validator;
 * the intersection-on-the-parameter shape is `SttValidator`'s, minus the
 * input narrowing this category does not have.
 */
export interface VoiceDesignValidator<A> extends SafeUnknown<UnifiedResult<A, string>> {
  <
    M extends UnifiedRef<A> | (string & {}),
    T extends UnifiedInput<VoiceDesignParamsBase, UnifiedRef<A>, A> &
      VoiceDesignModelNarrowing<A, M> &
      ModelExtras<A, M>,
  >(
    params: T &
      { model: M } &
      ExactKeys<T, UnifiedInput<VoiceDesignParams, UnifiedRef<A>, A> & ModelExtras<A, M>>,
    options?: ValidateOptions,
  ): UnifiedResult<A, M>;
  safe<
    M extends UnifiedRef<A> | (string & {}),
    T extends UnifiedInput<VoiceDesignParamsBase, UnifiedRef<A>, A> &
      VoiceDesignModelNarrowing<A, M> &
      ModelExtras<A, M>,
  >(
    params: T &
      { model: M } &
      ExactKeys<T, UnifiedInput<VoiceDesignParams, UnifiedRef<A>, A> & ModelExtras<A, M>>,
    options?: ValidateOptions,
  ): ValidateResult<UnifiedResult<A, M>>;
  /** Every provider id registered on this validator, sorted. */
  readonly providers: readonly string[];
}

/**
 * The loosest voice-design adapter that still pins the vocabulary.
 * `modelParams` is optional, exactly as on the other narrowing categories.
 */
export type AnyVoiceDesignAdapter = AnyUnifiedAdapter<VoiceDesignParams> & {
  readonly category: "voiceDesign";
  readonly modelParams?: VoiceDesignModelParamTable;
};
