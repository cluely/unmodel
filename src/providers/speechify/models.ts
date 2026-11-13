// Hand-maintained — SpeechifyAI is not in models.dev; refresh from
// https://docs.speechify.ai/build/guides/concepts/models,
// https://docs.speechify.ai/build/guides/concepts/api-limits,
// https://docs.speechify.ai/openapi/api-reference.json (the live OpenAPI 3.1
// spec behind the API reference), https://docs.speechify.ai/build/changelog
// and https://speechify.ai/pricing (last checked 2026-11-12).
//
// MODEL IDS: the `model` body param is a closed enum in the OpenAPI spec —
// GetSpeechRequestModel and GetStreamRequestModel are both
// "enum":["simba-3.0","simba-3.2","simba-3.5"] (2026-11-12). The legacy
// Simba 1.6 ids `simba-english` and `simba-multilingual` left that enum at API
// version 2026-09-21 and keep their rows for the reason stated on them.
// `GET /v1/audio/models` also lists `simba-dialogue-1.0`, in a separate
// `dialogue_models` array: "Multi-speaker models arrive in a separate
// `dialogue_models` array because they are valid only on POST
// /v1/audio/dialogue." That route is absent from the OpenAPI `paths` and its
// reference page reads "This page does not exist." (2026-11-12), so there is
// no request schema to validate it against and the id is not catalogued.
//
// PRICING: per model and per plan. "Simba 3.5 lists at $15/$12/$10 per 1M
// characters on Starter/Pro/Scale , billed at $10/$8/$6 until 21 Nov 2026 .
// Simba 3.0 and 3.2 bill $10/$8/$6 per 1M characters." (speechify.ai/pricing,
// 2026-11-12), volume-discounted on Enterprise. `perMillionCharacters` carries
// the Starter (entry paid plan) LIST rate: the highest published rate, i.e.
// the worst case a budget check should assume — a launch price that ends on a
// published date does not lower it.
//
// LIMITS: the character cap is per ROUTE, not per model — "2,000 spoken
// characters" on /v1/audio/speech and "20,000 spoken characters" on
// /v1/audio/stream, where "SSML tags do not count", plus a ceiling on "The
// input as sent, markup included" of 20,000 and 32,000 (API Limits,
// 2026-11-12). `limit.characters` carries the larger spoken cap (the most any
// route speaks) and each endpoint validator additionally enforces its own two
// documented caps.
// `limit.context: 0` disables token-window checks — these are not token models.

import type { ModelInfo, ProviderInfo } from "../../core/catalog-types";

export const provider = {
  id: "speechify",
  name: "SpeechifyAI",
  env: ["SPEECHIFY_API_KEY"],
  doc: "https://docs.speechify.ai",
} as const satisfies ProviderInfo;

const ttsModels = {
  // The recommended model: "Streaming-native model covering 48 languages under
  // one model id, on every plan. The recommended model since 18 October 2026."
  // (docs.speechify.ai/build/guides/concepts/models, 2026-11-12). Launched with
  // its price on 2026-10-21: "`simba-3.5`, the recommended model since the
  // 2026-10-18 entry, launches today." (docs.speechify.ai/build/changelog/2026/10/21).
  // Rate: "Simba 3.5 List price $15 launch price $10 per 1M characters · Launch
  // price until 21 Nov" (speechify.ai/pricing, Starter, 2026-11-12); "From 22
  // November it bills at the new list price" (changelog 2026/11/9).
  "simba-3.5": {
    id: "simba-3.5",
    name: "Simba 3.5",
    family: "simba-3",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    releaseDate: "2026-10-21",
    modalities: { input: ["text"], output: ["audio"] },
    limit: { context: 0, characters: 20000 },
    cost: { perMillionCharacters: 15 },
  },
  // "Streaming-native English model. Serves every English voice in the
  // catalog, your workspace's own cloned voices included. Use `simba-3.5` for
  // any other language." (the GET /v1/audio/models response on
  // docs.speechify.ai/build/guides/concepts/models, 2026-11-12). Not
  // deprecated — "both stay available and are not deprecated" — and for
  // English-only text it "keeps today's price" (changelog 2026/11/10).
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
  // The legacy Simba 1.6 pair: "No longer selectable. Naming either returns
  // `400` `model_retired`, and neither appears in `GET /v1/audio/models`." on
  // API version 2026-09-21 and later; a workspace pinned below it keeps the
  // Simba 1.6 training until 2026-11-21, and from then "Both ids are served by
  // Simba 3.5, in every language, and billed as `simba-3.5`. Nothing breaks;
  // the audio changes." (docs.speechify.ai/build/guides/concepts/models,
  // 2026-11-12). Still served, so still catalogued — deprecated.
  // Rate: "A request naming either id is billed at the `simba-3.5` rate on
  // your plan" (changelog 2026/11/10) — simba-3.5's $15 Starter list rate,
  // which it bills "From 22 November" (changelog 2026/11/9; the $10 launch
  // rate runs "Until 21 November 2026"). The list rate is the worst case, per
  // the PRICING note.
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
    cost: { perMillionCharacters: 15 },
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
    cost: { perMillionCharacters: 15 },
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
  "simba-3.5",
] as const satisfies readonly SpeechifyTtsModelId[];
