// Hand-maintained — Gladia is not in models.dev; refresh from
//   https://docs.gladia.io/api-reference/v2/pre-recorded/init  (model ids + per-model capabilities)
//   https://www.gladia.io/pricing                              (per-hour rates)
// (last checked 2026-08-13).
//
// The two ids below are the documented values of the `model` request field.
// solaria-1 also backs the LIVE (WebSocket) API, which unmodel does not
// validate; the per-minute rates here are the ASYNC (pre-recorded) Starter
// rates. Realtime on the same plan is $0.75/hr, and the Growth plan drops
// async to "as low as $0.20/hr" — commitment pricing that cannot be
// catalogued per model.

import type { ModelInfo, ProviderInfo } from "../../core/catalog-types";

export const provider = {
  id: "gladia",
  name: "Gladia",
  env: ["GLADIA_API_KEY"],
  doc: "https://docs.gladia.io",
} as const satisfies ProviderInfo;

/**
 * Unit conversion: gladia.io/pricing quotes "Async at $0.61 /hr" on the
 * Starter (pay-as-you-go) plan; `ModelCost.perAudioMinute` is USD per MINUTE,
 * so $0.61/hr ÷ 60 = $0.010166…/min. Both models bill at the same rate — the
 * pricing page prices the API, not the model.
 */
const ASYNC_USD_PER_MINUTE = 0.61 / 60;

/** "Real-time at $0.75 /hr" on the same plan — the live WebSocket API. */
export const REALTIME_USD_PER_MINUTE = 0.75 / 60;

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
    cost: { perAudioMinute: ASYNC_USD_PER_MINUTE },
  },
  "solaria-1": {
    id: "solaria-1",
    name: "Solaria-1",
    family: "solaria",
    ...STT,
    cost: { perAudioMinute: ASYNC_USD_PER_MINUTE },
  },
} as const satisfies Record<string, ModelInfo>;

export type GladiaModelId = keyof typeof models;

/** Runtime allow-list of documented `model` values. */
export const MODEL_IDS: readonly string[] = Object.keys(models);

/** "If omitted, the API uses the default model. (Solaria-1)". */
export const DEFAULT_MODEL = "solaria-1";

/**
 * "Async (pre-recorded) only — not available for live transcription" and
 * "Single language only — pass exactly one language in
 * `language_config.languages` (no code switching)", with
 * "Languages: English, French, German, Spanish, Italian".
 */
export const SOLARIA_3_LANGUAGES: readonly string[] = ["en", "fr", "de", "es", "it"];
