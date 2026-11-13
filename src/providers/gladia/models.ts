// Hand-maintained — Gladia is not in models.dev; refresh from
//   https://api.gladia.io/openapi.json                         (the `model` enum + every request field)
//   https://docs.gladia.io/api-reference/v2/pre-recorded/init  (model ids + per-model capabilities)
//   https://docs.gladia.io/chapters/introduction/models        (the per-model comparison)
//   https://docs.gladia.io/chapters/language/supported-languages
//   https://www.gladia.io/pricing.md                           (plain-text, dated copy of /pricing)
// (last checked 2026-11-12).
//
// The two ids below are the models the docs describe. solaria-1 also backs
// the LIVE (WebSocket) API, which unmodel does not validate.
//
// PRICING: Gladia prices in EUR only, so `cost` is deliberately omitted and
// cost estimation returns no `costUSD` for Gladia models. www.gladia.io/pricing.md
// ("Last updated: 2026-11-03", fetched 2026-11-12) states "Currency: EUR" and
// quotes per-model rates — "| Async rate | Solaria-1 · 0.27€/hr (0.0045€/min);
// Solaria-3 · 0.16€/hr (0.0027€/min) | Custom |" and "| Real-time rate |
// 0.68€/hr (0.0113€/min) | Custom |" — that drop automatically with monthly
// volume ("Your hourly async rate drops as your monthly volume grows"), on a
// prepaid wallet ("Gladia runs on a prepaid credit wallet."). The live page's
// JSON-LD carries six offers, every one `"priceCurrency": "EUR"`, and no USD
// figure or currency toggle exists anywhere on it. A USD rate would be an
// exchange-rate guess, so none is catalogued. Should a USD rate return, note
// that Gladia bills each distinct channel (OpenAPI `billing_time`: "Billed
// duration in seconds (audio_duration * number_of_distinct_channels)"), so a
// declared duration understates stereo audio whose channels differ.
//
// NOT LISTED (deliberate, checked 2026-11-12): `solaria-fusion`. It is the
// third value of the OpenAPI `TranscriptionSupportedModels` enum
// (["solaria-1","solaria-3","solaria-fusion"]) and of the SDK's generated
// `PreRecordedV2TranscriptionModel` (@gladiaio/sdk 2.2.1), but no prose page,
// price, changelog entry or docs/llms-full.txt line describes it — the Models
// page says only "Set `model` to `"solaria-3"` or `"solaria-1"`". With no
// languages, capabilities or rate to put on a row, it stays uncatalogued: it
// still validates, with an `unknown_model` warning. Revisit when a Gladia page
// documents it. (`solaria-3-fast` in the SDK is a passthrough fixture in
// src/v2/live/client.start-session.test.ts, not a model.)

import type { ModelInfo, ProviderInfo } from "../../core/catalog-types";

export const provider = {
  id: "gladia",
  name: "Gladia",
  env: ["GLADIA_API_KEY"],
  doc: "https://docs.gladia.io",
} as const satisfies ProviderInfo;

/** Shared shape of every Gladia STT catalog entry. */
const STT = {
  attachment: false,
  reasoning: false,
  toolCall: false,
  openWeights: false,
  modalities: { input: ["audio"], output: ["text"] },
  // limit.context 0: STT is not token-windowed; the pipeline skips context
  // checks. The 135-minute per-request audio cap is enforced in
  // ./pre-recorded via MAX_AUDIO_DURATION_SECONDS.
  limit: { context: 0 },
} as const;

export const models = {
  "solaria-3": {
    id: "solaria-3",
    name: "Solaria-3",
    family: "solaria",
    ...STT,
  },
  "solaria-1": {
    id: "solaria-1",
    name: "Solaria-1",
    family: "solaria",
    ...STT,
  },
} as const satisfies Record<string, ModelInfo>;

export type GladiaModelId = keyof typeof models;

/** Runtime allow-list of documented `model` values. */
export const MODEL_IDS: readonly string[] = Object.keys(models);

/** "If omitted, the API uses the default model. (Solaria-1)". */
export const DEFAULT_MODEL = "solaria-1";

/**
 * solaria-3's languages. Every page agrees on the five: the endpoint page
 * ("Languages: English, French, German, Spanish, Italian"), the Models page
 * ("several from EN/FR/DE/ES/IT") and www.gladia.io/solaria-3 ("Optimized for
 * EN, FR, DE, ES, IT"). How many of them one request may name is where the
 * pages disagree — see `checkSolaria3` in ./stt.
 */
export const SOLARIA_3_LANGUAGES = ["en", "fr", "de", "es", "it"] as const satisfies readonly string[];
