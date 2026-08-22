// Hand-maintained — Fish Audio is not in models.dev; refresh from
//   https://docs.fish.audio/developer-guide/models-pricing/models-overview          (model ids, capabilities, languages)
//   https://docs.fish.audio/developer-guide/models-pricing/pricing-and-rate-limits  (USD rates per model)
//   https://docs.fish.audio/api-reference/endpoint/openapi-v1/text-to-speech        (the `model` HEADER enum POST /v1/tts accepts)
//   https://docs.fish.audio/developer-guide/models-pricing/deprecations             (retired ids)
// Verified 2026-08-13.
//
// PRICING UNIT — read before trusting `perMillionCharacters`: Fish Audio
// publishes "$15.00 / M UTF-8 bytes", not per character. `ModelCost` has no
// per-byte field, so the rate is stored on `perMillionCharacters` and the
// endpoint feeds it a UTF-8 BYTE count (see `utf8ByteLength` in tts.ts)
// instead of `text.length`. For ASCII the two agree; for CJK/emoji a
// character costs 3–4 bytes, which the docs call out explicitly
// ("1M UTF-8 bytes is approximately 180,000 English words").
//
// COVERAGE: the four TTS ids below are exactly the `model` header enum plus
// the two retired `speech-*` ids, `voice-design-1` is the required `model`
// header of POST /v1/voice-design, and `fast` is a SYNTHETIC id — POST /model
// (voice cloning) has no model field, so the id names its documented
// `train_mode` to give the voice-clone validator a catalog address.
// `s2.1-pro-free` is the free developer tier —
// its published rate really is $0.00 / M UTF-8 bytes, so `cost` is 0 rather
// than omitted. Fish Audio publishes no per-request character cap for
// `text`, so no model carries `limit.characters`.
//
// NOT IN THIS CATALOG: `openaudio-s1` and `openaudio-s1-mini` are the
// open-weights (Hugging Face) releases of the S1 generation. They are not
// values of the documented `model` header, so api.fish.audio cannot be asked
// for them — self-hosted inference is out of scope for a wire validator.

import type { ModelInfo, ProviderInfo } from "../../core/catalog-types";

export const provider = {
  id: "fish-audio",
  name: "Fish Audio",
  env: ["FISH_AUDIO_API_KEY"],
  doc: "https://docs.fish.audio",
} as const satisfies ProviderInfo;

/** "$15.00 / M UTF-8 bytes" — pricing-and-rate-limits. */
const PER_MILLION_UTF8_BYTES = 15;

/** Model ids POST /v1/tts accepts in its `model` header. */
const ttsModels = {
  // "Our recommended production TTS model and an improved version of
  // S2-Pro" — 83 languages, `[bracket]` natural-language control,
  // multi-speaker dialogue. Server-side default when the header is omitted.
  "s2.1-pro": {
    id: "s2.1-pro",
    name: "Fish Audio S2.1-Pro",
    family: "s2",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text"], output: ["audio"] },
    limit: { context: 0 },
    cost: { perMillionCharacters: PER_MILLION_UTF8_BYTES },
  },
  // "Free development variant of s2.1-pro … Identical model quality to paid
  // version"; "Free to use under fair-use limits" with no TTFA/DPA guarantees.
  "s2.1-pro-free": {
    id: "s2.1-pro-free",
    name: "Fish Audio S2.1-Pro Free",
    family: "s2",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text"], output: ["audio"] },
    limit: { context: 0 },
    // "$0.00 / M UTF-8 bytes" — pricing-and-rate-limits.
    cost: { perMillionCharacters: 0 },
  },
  // "Previous-generation S2 model" — 80+ languages, "100ms time-to-first-audio",
  // multi-speaker support.
  "s2-pro": {
    id: "s2-pro",
    name: "Fish Audio S2-Pro",
    family: "s2",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text"], output: ["audio"] },
    limit: { context: 0 },
    cost: { perMillionCharacters: PER_MILLION_UTF8_BYTES },
  },
  // "Legacy model available for existing integrations" — 13 languages,
  // "4 billion parameters", emotional control via `(parenthesis)` syntax.
  // Still an accepted `model` header value, so not marked deprecated.
  s1: {
    id: "s1",
    name: "Fish Audio S1",
    family: "s1",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text"], output: ["audio"] },
    limit: { context: 0 },
    cost: { perMillionCharacters: PER_MILLION_UTF8_BYTES },
  },
} as const satisfies Record<string, ModelInfo>;

/**
 * Retired ids, kept so legacy call sites get a precise error instead of a
 * bare `unknown_model` warning: both were deprecated 2026-02-28
 * (https://docs.fish.audio/developer-guide/models-pricing/deprecations) and
 * are absent from the `model` header enum, so POST /v1/tts no longer serves
 * them. No rate is published for them, so `cost` is omitted.
 */
const retiredModels = {
  "speech-1.6": {
    id: "speech-1.6",
    name: "Fish Speech 1.6",
    family: "speech-1",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    status: "deprecated",
    modalities: { input: ["text"], output: ["audio"] },
    limit: { context: 0 },
  },
  "speech-1.5": {
    id: "speech-1.5",
    name: "Fish Speech 1.5",
    family: "speech-1",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    status: "deprecated",
    modalities: { input: ["text"], output: ["audio"] },
    limit: { context: 0 },
  },
} as const satisfies Record<string, ModelInfo>;

/**
 * Voice design — POST /v1/voice-design, validated by ./voice-design. The
 * required `model` header accepts exactly this id. Billed "$0.01 /
 * successful API request"; `ModelCost` has no per-request unit, so `cost` is
 * omitted and the endpoint estimates the flat rate itself.
 */
const voiceDesignModels = {
  "voice-design-1": {
    id: "voice-design-1",
    name: "Fish Audio Voice Design 1",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text"], output: ["audio"] },
    limit: { context: 0 },
  },
} as const satisfies Record<string, ModelInfo>;

/**
 * Voice cloning — POST /model, validated by ./voice-clone. The wire has no
 * model field: `fast` is a synthetic id naming the documented (and only)
 * `train_mode`, so a future full-training mode is a new id rather than a
 * param. No rate is published for model creation, so `cost` is omitted.
 */
const voiceCloneModels = {
  fast: {
    id: "fast",
    name: "Fish Audio Voice Cloning (fast)",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["audio"], output: ["audio"] },
    limit: { context: 0 },
  },
} as const satisfies Record<string, ModelInfo>;

export const models = {
  ...ttsModels,
  ...retiredModels,
  ...voiceDesignModels,
  ...voiceCloneModels,
} as const satisfies Record<string, ModelInfo>;

/** Values the `model` header of POST /v1/tts accepts. */
export type FishAudioTtsModelId = keyof typeof ttsModels;
/** Values the required `model` header of POST /v1/voice-design accepts. */
export type FishAudioVoiceDesignModelId = keyof typeof voiceDesignModels;
/** The synthetic id addressing POST /model (no model field on the wire). */
export type FishAudioVoiceCloneModelId = keyof typeof voiceCloneModels;
export type FishAudioModelId = keyof typeof models;

/** Runtime allow-list backing the text-to-speech endpoint's model gate. */
export const TTS_MODEL_IDS: readonly string[] = Object.keys(ttsModels);
/** Runtime allow-list backing the voice-design endpoint's model gate. */
export const VOICE_DESIGN_MODEL_IDS: readonly string[] = Object.keys(voiceDesignModels);

/**
 * The S2 generation — the only models that accept multi-speaker
 * `reference_id` arrays and honour `prosody.normalize_loudness`.
 */
export const S2_MODEL_IDS: readonly string[] = Object.keys(ttsModels).filter(
  (id) => (ttsModels as Record<string, ModelInfo>)[id]?.family === "s2",
);
