// Hand-maintained — Rime is not in models.dev; refresh from
// https://docs.rime.ai/docs/models, https://docs.rime.ai/api-reference/coda/http,
// https://docs.rime.ai/api-reference/mistv3/http,
// https://docs.rime.ai/docs/migrate-legacy-mist and https://www.rime.ai/pricing
// (last checked 2026-08-13; languages and statuses 2026-11-12; pricing
// 2026-11-13).
//
// MODEL IDS: `modelId` is a body field on POST /v1/rime-tts. The documented
// values are `coda`, `mistv3`, `mistv2` and `mist`. "Requests that omit
// `modelId`, or send a value the API does not recognize, are served by Mist
// v3."
//
// PRICING (https://www.rime.ai/pricing, 2026-11-13): per minute, not per
// character. "Mist v3 Text to speech, lowest latency. About 1K characters per
// minute." at "$0.030 / min" (Flex) and "$0.024 / min" (Scale); "Coda v2 Text
// to speech, most natural. About 1K characters per minute." at "$0.050 / min"
// and "$0.040 / min". "Text to speech is metered by characters generated,
// about 1,000 characters per minute." The `coda` and `mistv3` rows read the
// Flex rate through Rime's own conversion — $50/1M and $30/1M characters — and
// that conversion is approximate ("about"): Rime publishes no exact
// per-character rate. The page lists no Mist v2 or Mist v1 rate, so those rows
// carry no `cost`. Enterprise moves to volume pricing.
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
  // "Rime's flagship TTS model", released May 2026, with word-level
  // timestamps. "Through the cloud API, Coda serves 10 languages across 313
  // voices, but 185 of those voices are English and only 1 is Dutch."
  // (https://docs.rime.ai/docs/models, 2026-11-12)
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
  // Deprecated: "Mist v1 (`mist`) and Mist v2 (`mistv2`) are legacy models.
  // Both retire on December 3, 2026." (https://docs.rime.ai/docs/models,
  // 2026-11-12)
  mistv2: {
    id: "mistv2",
    name: "Mist v2",
    family: "mist",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    releaseDate: "2025-02",
    status: "deprecated",
    modalities: { input: ["text"], output: ["audio"] },
    limit: { context: 0, characters: 1000 },
    // No `cost`: rime.ai/pricing (checked 2026-11-13) lists only Mist v3 and
    // Coda v2 for TTS and publishes no Mist v2 rate, so the estimate is
    // undefined. After 2026-12-03, "Mist v3 serves HTTP requests that name
    // either model" (https://docs.rime.ai/docs/migrate-legacy-mist).
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
    // No `cost`: rime.ai/pricing (checked 2026-11-13) publishes no Mist v1
    // rate; see the `mistv2` row.
  },
} as const satisfies Record<string, ModelInfo>;

export type RimeModelId = keyof typeof models;
/** Every catalogued Rime model serves POST /v1/rime-tts. */
export type RimeTtsModelId = RimeModelId;

export const RIME_MODEL_IDS = ["coda", "mistv3", "mistv2", "mist"] as const satisfies readonly RimeModelId[];

/**
 * Both the ISO 639-1 and the ISO 639-2/3 spelling are accepted for each of the
 * ten documented languages. The Coda reference
 * (https://docs.rime.ai/api-reference/coda/http, 2026-11-12) lists the tags
 * `en`, `es`, `fr`, `pt`, `de`, `ja`, `ar`, `hi`, `it` ("| `it` | Italian |")
 * and `nl` ("| `nl` | Dutch |"), and: "The 3-letter ISO 639-2 codes that older
 * integrations send (`eng`, `spa`, `fra`, `por`, `ger`, `jpn`, `ara`, `hin`,
 * `ita`, `nld`) remain accepted, and will stay accepted."
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
  "it",
  "ita",
  "nl",
  "nld",
] as const;

/**
 * "The Mist column reflects Mist v3 and Mist v2, which both serve English,
 * French, German, and Spanish" — Coda serves all ten.
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
