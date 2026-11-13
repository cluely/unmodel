// Hand-maintained — Fish Audio is not in models.dev; refresh from
//   https://docs.fish.audio/developer-guide/models-pricing/models-overview          (model ids, capabilities, languages)
//   https://docs.fish.audio/developer-guide/models-pricing/pricing-and-rate-limits  (USD rates per model)
//   https://docs.fish.audio/api-reference/openapi.json                              (the `model` HEADER enum POST /v1/tts accepts)
//   https://docs.fish.audio/developer-guide/getting-started/changelog               (launch dates, new ids)
//   https://docs.fish.audio/developer-guide/models-pricing/deprecations             (retired ids)
// Verified 2026-11-12. The header enum and the pricing page are the authority
// for the id list: models-overview does not list `drama-3` (2026-11-12).
//
// PRICING UNIT — read before trusting `perMillionCharacters`: Fish Audio
// publishes "$15.00 / M UTF-8 bytes", not per character. `ModelCost` has no
// per-byte field, so the rate is stored on `perMillionCharacters` and the
// endpoint feeds it a UTF-8 BYTE count (see `utf8ByteLength` in tts.ts)
// instead of `text.length`. For ASCII the two agree; for CJK/emoji a
// character costs 3–4 bytes, which the docs call out explicitly
// ("1M UTF-8 bytes is approximately 180,000 English words").
//
// COVERAGE: the five TTS ids below are exactly the `model` header enum plus
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
  // "Use **`s2.1-pro-free`** for testing, prototyping, development, and
  // smaller businesses. It is the same model as S2.1-Pro at $0, but it does
  // not guarantee TTFA or DPA" (choosing-a-model, 2026-11-12).
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
    // "| `s2.1-pro-free` | $0.00 / M UTF-8 bytes |" — pricing-and-rate-limits,
    // 2026-11-12. The changelog bounds it: "the same model at no cost through
    // November 30, 2026". No later rate is published; re-verify on 2026-12-01
    // and omit `cost` if the page turns non-zero without a number.
    cost: { perMillionCharacters: 0 },
  },
  // "Previous-generation S2 TTS model" — "Multi-speaker dialogue support",
  // "80+ languages", "100ms time-to-first-audio", "Open-source"
  // (models-overview, 2026-11-12). Open weights: the changelog calls it "fully
  // open-source", and https://huggingface.co/fishaudio/s2-pro publishes the
  // checkpoint under the "Fish Audio Research License".
  "s2-pro": {
    id: "s2-pro",
    name: "Fish Audio S2-Pro",
    family: "s2",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: true,
    modalities: { input: ["text"], output: ["audio"] },
    limit: { context: 0 },
    cost: { perMillionCharacters: PER_MILLION_UTF8_BYTES },
  },
  // Changelog, October 13, 2026: "Text-to-speech model you direct in plain
  // language … Use model ID `drama-3` in the API"; a value of the `model`
  // header enum (openapi.json, 2026-11-12). Multi-speaker: "Multi-speaker
  // dialogue synthesis is available with the S2 family … and `drama-3`, not
  // `s1`" (TTSRequest). Open weights: https://huggingface.co/fishaudio/drama-3
  // publishes the checkpoint under the "Fish Audio Community License".
  "drama-3": {
    id: "drama-3",
    name: "Fish Audio Drama 3",
    family: "drama",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: true,
    releaseDate: "2026-10-13",
    modalities: { input: ["text"], output: ["audio"] },
    limit: { context: 0 },
    // "| `drama-3` | $50.00 / M UTF-8 bytes |" — pricing-and-rate-limits,
    // 2026-11-12. A launch promotion bills "$10.00 / M UTF-8 bytes, 80% off
    // the list price" "Through November 30, 2026 (until December 1, 00:00
    // PT / 08:00 UTC)"; the catalog carries the list price.
    cost: { perMillionCharacters: 50 },
  },
  // 13 languages, "4 billion parameters", emotional control via
  // `(parenthesis)` syntax. "**Fish Audio S1** (deprecated) - High-quality
  // voice generation" (models-overview, 2026-11-12). Deprecations: "S1 is
  // deprecated and will be retired on December 31, 2026. After that date,
  // requests that specify `s1` are served by `s2.1-pro`." Until then it is a
  // value of the `model` header enum and is served as itself, so the row
  // stays, warns as deprecated, and keeps its single-speaker gate.
  s1: {
    id: "s1",
    name: "Fish Audio S1",
    family: "s1",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    status: "deprecated",
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
 * The S2 generation (`family: "s2"`) — the models `prosody.normalize_loudness`
 * is documented for: "Applies to the S2 family (`s2-pro`, `s2.1-pro`,
 * `s2.1-pro-free`)" (ProsodyControl, openapi.json, 2026-11-12).
 */
export const S2_MODEL_IDS: readonly string[] = Object.keys(ttsModels).filter(
  (id) => (ttsModels as Record<string, ModelInfo>)[id]?.family === "s2",
);

/**
 * The models that accept multi-speaker dialogue — a `reference_id` array or a
 * nested `references` array: "Multi-speaker dialogue synthesis is available
 * with the S2 family (`s2-pro`, `s2.1-pro`, `s2.1-pro-free`) and `drama-3`,
 * not `s1`" (TTSRequest, openapi.json, 2026-11-12).
 */
export const MULTI_SPEAKER_MODEL_IDS: readonly string[] = [
  ...S2_MODEL_IDS,
  "drama-3" satisfies FishAudioTtsModelId,
];
