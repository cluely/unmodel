// Hand-maintained — SpeechifyAI is not in models.dev; refresh from
// https://docs.speechify.ai/build/guides/concepts/models,
// https://docs.speechify.ai/build/guides/concepts/api-limits,
// https://docs.speechify.ai/openapi/api-reference.json (the live OpenAPI 3.1
// spec behind the API reference) and https://speechify.ai/pricing
// (last checked 2026-08-13).
//
// MODEL IDS: the `model` body param is a closed enum in the OpenAPI spec —
// `simba-english`, `simba-multilingual`, `simba-3.0`, `simba-3.2`. There is
// no separate id for the "Simba 1.0" generation: the two legacy ids above are
// documented as "the legacy Simba 1.6 models". `GET /v1/audio/models` returns
// the same four ids at runtime plus the dialogue-only `simba-dialogue-1.0`,
// which is not accepted on /v1/audio/speech or /v1/audio/stream and is
// therefore absent here.
//
// PRICING: Speechify publishes plan-based, not per-model, character rates —
// $10/1M (Starter), $8/1M (Pro), $6/1M (Scale), volume-discounted on
// Enterprise. Every model bills at the same rate, so `perMillionCharacters`
// carries the Starter (entry paid plan) rate: the highest published rate, i.e.
// the worst case a budget check should assume.
//
// LIMITS: the character cap is per ROUTE, not per model — 2,000 on
// /v1/audio/speech and 20,000 on /v1/audio/stream. `limit.characters` carries
// the larger of the two (the most any route accepts) and each endpoint
// validator additionally enforces its own documented cap.
// `limit.context: 0` disables token-window checks — these are not token models.

import type { ModelInfo, ProviderInfo } from "../../core/catalog-types";

export const provider = {
  id: "speechify",
  name: "SpeechifyAI",
  env: ["SPEECHIFY_API_KEY"],
  doc: "https://docs.speechify.ai",
} as const satisfies ProviderInfo;

const ttsModels = {
  // "Streaming-native model with the lowest time-to-first-byte and richest
  // expressivity, English only today." Recommended for new English work.
  "simba-3.2": {
    id: "simba-3.2",
    name: "Simba 3.2",
    family: "simba-3",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text"], output: ["audio"] },
    limit: { context: 0, characters: 20000 },
    cost: { perMillionCharacters: 10 },
  },
  // "The default when a request omits `model`." Streaming-native, English
  // plus six European languages.
  "simba-3.0": {
    id: "simba-3.0",
    name: "Simba 3.0",
    family: "simba-3",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text"], output: ["audio"] },
    limit: { context: 0, characters: 20000 },
    cost: { perMillionCharacters: 10 },
  },
  // `deprecated: true` in GET /v1/audio/models. Speechify is explicit that
  // the flag is advisory — "a deprecated model stays fully supported and
  // behaves exactly as before, with nothing scheduled for removal".
  "simba-multilingual": {
    id: "simba-multilingual",
    name: "Simba Multilingual",
    family: "simba-1.6",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    status: "deprecated",
    modalities: { input: ["text"], output: ["audio"] },
    limit: { context: 0, characters: 20000 },
    cost: { perMillionCharacters: 10 },
  },
  "simba-english": {
    id: "simba-english",
    name: "Simba English",
    family: "simba-1.6",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    status: "deprecated",
    modalities: { input: ["text"], output: ["audio"] },
    limit: { context: 0, characters: 20000 },
    cost: { perMillionCharacters: 10 },
  },
} as const satisfies Record<string, ModelInfo>;

/**
 * Voice cloning — POST /v1/voices, validated by ./voice-clone. The wire has
 * no model field: `voice-clone` is a SYNTHETIC route-noun id so the validator
 * has a catalog address (the response's `models[]` says which synthesis
 * models serve the new voice). No rate is published for voice creation, so
 * `cost` is omitted.
 */
const voiceCloneModels = {
  "voice-clone": {
    id: "voice-clone",
    name: "Speechify Voice Cloning",
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
  ...voiceCloneModels,
} as const satisfies Record<string, ModelInfo>;

export type SpeechifyModelId = keyof typeof models;
/** Model ids the synthesis routes serve. */
export type SpeechifyTtsModelId = keyof typeof ttsModels;
/** The synthetic id addressing POST /v1/voices (no model field on the wire). */
export type SpeechifyVoiceCloneModelId = keyof typeof voiceCloneModels;

export const SPEECHIFY_MODEL_IDS = [
  "simba-english",
  "simba-multilingual",
  "simba-3.0",
  "simba-3.2",
] as const satisfies readonly SpeechifyTtsModelId[];
