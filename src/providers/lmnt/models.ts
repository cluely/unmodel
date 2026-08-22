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

const ttsModels = {
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

/**
 * Voice cloning — POST /v1/ai/voice, validated by ./voice-clone. The wire has
 * no model field: `voice-clone` is a SYNTHETIC route-noun id so the validator
 * has a catalog address. No rate is published for voice creation, so `cost`
 * is omitted.
 */
const voiceCloneModels = {
  "voice-clone": {
    id: "voice-clone",
    name: "LMNT Voice Cloning",
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

export type LmntModelId = keyof typeof models;
/** Model ids the speech endpoints' `model` field documents. */
export type LmntTtsModelId = keyof typeof ttsModels;
/** The synthetic id addressing POST /v1/ai/voice (no model field on the wire). */
export type LmntVoiceCloneModelId = keyof typeof voiceCloneModels;

/** Runtime allow-list backing the speech endpoints' model gate. */
export const TTS_MODEL_IDS: readonly string[] = Object.keys(ttsModels);
