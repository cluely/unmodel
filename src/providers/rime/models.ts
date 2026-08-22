// Hand-maintained — Rime is not in models.dev; refresh from
// https://docs.rime.ai/docs/models, https://docs.rime.ai/api-reference/coda/http,
// https://docs.rime.ai/api-reference/mistv3/http,
// https://docs.rime.ai/api-reference/mistv2/http,
// https://docs.rime.ai/docs/arcana-sunset and https://rime.ai/pricing
// (last checked 2026-08-13).
//
// MODEL IDS: `modelId` is a body field on POST /v1/rime-tts. The documented
// values are `coda`, `mistv3`, `mistv2`, `mist`, and the sunsetting Arcana
// trio `arcana` / `arcanav2` / `arcanav3`. "Requests that omit `modelId`, or
// send a value the API does not recognize, are served by Mist v3."
//
// PRICING: rime.ai/pricing publishes two Starter rates — "$0.05 / 1K
// characters" for Coda and "$0.03 / 1K characters" for Mist — i.e. $50/1M and
// $30/1M. Enterprise moves to volume pricing. Arcana has no published rate of
// its own and, after the cloud cutover, is served by Coda, so its `cost` is
// omitted rather than guessed.
//
// LIMITS: "Character limit per request is 1,000 via the API" (every HTTP
// reference page; the cheat sheet adds that HTTP returns 400 "text is too
// long" beyond it), encoded as `limit.characters`. `limit.context: 0`
// disables token-window checks — these are not token models.

import type { ModelInfo, ProviderInfo } from "../../core/catalog-types";

export const provider = {
  id: "rime",
  name: "Rime",
  env: ["RIME_API_KEY"],
  doc: "https://docs.rime.ai",
} as const satisfies ProviderInfo;

export const models = {
  // "Rime's flagship TTS model", released May 2026. 184 voices, eight cloud
  // languages, word-level timestamps.
  coda: {
    id: "coda",
    name: "Coda",
    family: "coda",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    releaseDate: "2026-05",
    modalities: { input: ["text"], output: ["audio"] },
    limit: { context: 0, characters: 1000 },
    cost: { perMillionCharacters: 50 },
  },
  // "The low-latency model in the Mist family", released March 2026. Serves
  // requests that omit `modelId`.
  mistv3: {
    id: "mistv3",
    name: "Mist v3",
    family: "mist",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    releaseDate: "2026-03",
    modalities: { input: ["text"], output: ["audio"] },
    limit: { context: 0, characters: 1000 },
    cost: { perMillionCharacters: 30 },
  },
  // "The Mist model with inline pronunciation control", released Feb 2025.
  mistv2: {
    id: "mistv2",
    name: "Mist v2",
    family: "mist",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    releaseDate: "2025-02",
    modalities: { input: ["text"], output: ["audio"] },
    limit: { context: 0, characters: 1000 },
    cost: { perMillionCharacters: 30 },
  },
  // "Mist, released April 2023, is a legacy model in the Mist family."
  mist: {
    id: "mist",
    name: "Mist (legacy)",
    family: "mist",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    releaseDate: "2023-04",
    status: "deprecated",
    modalities: { input: ["text"], output: ["audio"] },
    limit: { context: 0, characters: 1000 },
    cost: { perMillionCharacters: 30 },
  },
  // Arcana: "Cloud Arcana requests will switch to Coda on August 15, 2026 at
  // 12:00 UTC." The three ids stay accepted — requests naming them "continue
  // to succeed but are served by Coda. You will not receive an error." Only
  // on-prem Arcana images are unaffected.
  arcanav3: {
    id: "arcanav3",
    name: "Arcana v3 (cloud → Coda 2026-08-15)",
    family: "arcana",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    status: "deprecated",
    modalities: { input: ["text"], output: ["audio"] },
    limit: { context: 0, characters: 1000 },
  },
  arcanav2: {
    id: "arcanav2",
    name: "Arcana v2 (cloud → Coda 2026-08-15)",
    family: "arcana",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    status: "deprecated",
    modalities: { input: ["text"], output: ["audio"] },
    limit: { context: 0, characters: 1000 },
  },
  arcana: {
    id: "arcana",
    name: "Arcana (cloud → Coda 2026-08-15)",
    family: "arcana",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    status: "deprecated",
    modalities: { input: ["text"], output: ["audio"] },
    limit: { context: 0, characters: 1000 },
  },
} as const satisfies Record<string, ModelInfo>;

export type RimeModelId = keyof typeof models;
/** Every catalogued Rime model serves POST /v1/rime-tts. */
export type RimeTtsModelId = RimeModelId;

export const RIME_MODEL_IDS = [
  "coda",
  "mistv3",
  "mistv2",
  "mist",
  "arcanav3",
  "arcanav2",
  "arcana",
] as const satisfies readonly RimeModelId[];

/** The Arcana ids the sunset notice names as affected by the cloud cutover. */
export const ARCANA_MODEL_IDS = [
  "arcana",
  "arcanav2",
  "arcanav3",
] as const satisfies readonly RimeModelId[];

/**
 * Both the ISO 639-1 and the ISO 639-2/3 spelling are accepted for each of the
 * eight documented languages.
 */
export const LANGUAGES = [
  "en",
  "eng",
  "es",
  "spa",
  "fr",
  "fra",
  "pt",
  "por",
  "de",
  "ger",
  "ja",
  "jpn",
  "ar",
  "ara",
  "hi",
  "hin",
] as const;

/**
 * "The Mist column reflects Mist v3 and Mist v2, which both serve English,
 * French, German, and Spanish" — Coda serves all eight.
 */
export const MIST_LANGUAGES = [
  "en",
  "eng",
  "es",
  "spa",
  "fr",
  "fra",
  "de",
  "ger",
] as const satisfies readonly RimeLanguage[];

export type RimeLanguage = (typeof LANGUAGES)[number];
