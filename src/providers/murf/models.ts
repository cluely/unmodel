// Hand-maintained — Murf AI is not in models.dev; refresh from
//   https://murf.ai/api/docs/introduction/overview               (model line-up)
//   https://murf.ai/api/docs/text-to-speech-models/falcon-2      (Falcon 2 capabilities + its published rate)
//   https://murf.ai/api/docs/api-reference/text-to-speech/generate (Gen2 `modelVersion` enum)
//   https://murf.ai/api/docs/api-reference/text-to-speech/stream   (the `model` enum of the streaming endpoint)
//   https://murf.ai/api/docs/resources/faq                       (3,000-character per-request cap)
//   https://help.murf.ai/murf-api-plans-and-limits               (pay-as-you-go USD rate)
// Verified 2026-08-13.
//
// MODEL ID SPELLING: Murf names the same two models differently per
// endpoint. POST /v1/speech/generate takes `modelVersion: "GEN2"`
// (upper-case, GEN2-only); POST /v1/speech/stream takes
// `model: "falcon-2" | "gen2"` (lower-case). This catalog keys on the
// lower-case streaming spelling, and the /v1/speech/generate validator
// lower-cases `modelVersion` before catalog lookup so both spellings resolve
// to one entry.
//
// PRICING conversions (documented so the arithmetic never rots unexplained):
// - Falcon 2: "Falcon 2 costs 1 cent per 1000 characters"
//   → 0.01 × 1,000 = $10 per 1M characters.
// - Gen2: pay-as-you-go "you can purchase 1000 characters at $0.03"
//   → 0.03 × 1,000 = $30 per 1M characters. This is the self-serve list
//   rate; enterprise metered billing is negotiated separately.
//
// LIMITS: "The API supports up to 3,000 characters per request. For longer
// text, split it into multiple requests." — encoded as `limit.characters`.
// `limit.context: 0` disables token-window checks; these are not token models.

import type { ModelInfo, ProviderInfo } from "../../core/catalog-types";

export const provider = {
  id: "murf",
  name: "Murf AI",
  env: ["MURF_API_KEY"],
  doc: "https://murf.ai/api/docs",
} as const satisfies ProviderInfo;

/** "The API supports up to 3,000 characters per request." */
export const MURF_MAX_CHARACTERS = 3000;

/** "1 cent per 1000 characters" → USD per 1M characters. */
const FALCON2_PER_MILLION_CHARACTERS = 10;
/** Pay-as-you-go "1000 characters at $0.03" → USD per 1M characters. */
const GEN2_PER_MILLION_CHARACTERS = 30;

export const models = {
  // "Ultra-fast streaming model, optimized for conversational AI and
  // real-time voice agents" with "time-to-first-audio under 100ms".
  // STREAMING ONLY: `modelVersion` on POST /v1/speech/generate documents
  // GEN2 as its sole value, so Falcon 2 is reachable through
  // POST /v1/speech/stream (and the WebSocket API) alone.
  "falcon-2": {
    id: "falcon-2",
    name: "Falcon 2",
    family: "falcon",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text"], output: ["audio"] },
    limit: { context: 0, characters: MURF_MAX_CHARACTERS },
    cost: { perMillionCharacters: FALCON2_PER_MILLION_CHARACTERS },
  },
  // "The most customizable model, designed for studio-quality speech
  // synthesis" — the only model POST /v1/speech/generate serves, and the
  // only one that honours `variation`, `audioDuration` and `locale`.
  gen2: {
    id: "gen2",
    name: "Murf Speech Gen 2",
    family: "gen",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text"], output: ["audio"] },
    limit: { context: 0, characters: MURF_MAX_CHARACTERS },
    cost: { perMillionCharacters: GEN2_PER_MILLION_CHARACTERS },
  },
} as const satisfies Record<string, ModelInfo>;

export type MurfModelId = keyof typeof models;
/** Every Murf model in this catalog is a TTS model. */
export type MurfTtsModelId = MurfModelId;

/** `model` values POST /v1/speech/stream accepts. */
export const STREAM_MODEL_IDS: readonly string[] = ["falcon-2", "gen2"];
/**
 * Catalog ids POST /v1/speech/generate can serve — its `modelVersion` enum
 * documents `GEN2` and nothing else.
 */
export const GENERATE_MODEL_IDS: readonly string[] = ["gen2"];
/** The literal `modelVersion` spelling POST /v1/speech/generate accepts. */
export const GENERATE_MODEL_VERSIONS: readonly string[] = ["GEN2"];
