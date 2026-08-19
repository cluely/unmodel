// Hand-maintained — LMNT is not in models.dev; refresh from
//   https://docs.lmnt.com/models/overview        (model ids, capabilities, language count)
//   https://docs.lmnt.com/api/speech/generate    (per-request character cap, param support)
//   https://www.lmnt.com/pricing                 (USD character rates)
// Verified 2026-08-13.
//
// PRICING: LMNT publishes subscription tiers with an included character
// allowance plus a per-1K-character overage rate — there is no
// zero-commitment pay-as-you-go rate. `perMillionCharacters` carries the
// LOWEST-COMMITMENT paid overage rate, Indie's "$0.05 per 1K characters
// after" → 0.05 × 1,000 = $50 per 1M characters. Higher tiers step down:
// Pro "$0.045 per 1K characters after" → $45/1M, Premium "$0.035 per 1K
// characters after" → $35/1M. Estimates are therefore a ceiling for Pro and
// Premium accounts, and ignore each plan's included allowance.
//
// LIMITS: "max 5000 characters per request (including spaces)" for `text`,
// encoded as `limit.characters`. `limit.context: 0` disables token-window
// checks — this is not a token model.

import type { ModelInfo, ProviderInfo } from "../../core/catalog-types";

export const provider = {
  id: "lmnt",
  name: "LMNT",
  env: ["LMNT_API_KEY"],
  doc: "https://docs.lmnt.com",
} as const satisfies ProviderInfo;

/** "max 5000 characters per request (including spaces)" — api/speech/generate. */
export const LMNT_MAX_CHARACTERS = 5000;

/** Indie tier overage: "$0.05 per 1K characters after" → USD per 1M characters. */
const PER_MILLION_CHARACTERS = 50;

export const models = {
  // "LMNT's current major model in their Blizzard family, which receives
  // regular updates" — 31 languages, voice cloning, accent control, word
  // timestamps, streaming and speech sessions. The only value the `model`
  // field of the speech endpoints documents.
  blizzard: {
    id: "blizzard",
    name: "Blizzard 2.0",
    family: "blizzard",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text"], output: ["audio"] },
    limit: { context: 0, characters: LMNT_MAX_CHARACTERS },
    cost: { perMillionCharacters: PER_MILLION_CHARACTERS },
  },
} as const satisfies Record<string, ModelInfo>;

export type LmntModelId = keyof typeof models;
/** Every LMNT model is a TTS model — there is no public STT API. */
export type LmntTtsModelId = LmntModelId;

/** Runtime allow-list backing the speech endpoints' model gate. */
export const TTS_MODEL_IDS: readonly string[] = Object.keys(models);
