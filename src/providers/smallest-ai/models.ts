// Hand-maintained — Smallest AI is not in models.dev; refresh from
// https://docs.smallest.ai/models/api-reference/text-to-speech/synthesize-speech,
// https://docs.smallest.ai/models/model-cards/text-to-speech/lightning-v-3-1,
// https://docs.smallest.ai/models/model-cards/text-to-speech/lightning-v-3-1-pro
// and https://smallest.ai/pricing (last checked 2026-08-13).
//
// MODEL IDS: the Waves TTS routes take a single `model` enum with exactly two
// values — `lightning_v3.1` (default) and `lightning_v3.1_pro`. These are
// documented as model *pools*, so successive Pro builds ship behind the one
// `lightning_v3.1_pro` id; there is no dated or build-specific id to encode.
// Lightning v2 and lightning-large are documented only as deprecated
// predecessors with no current endpoint reference, so they are not catalogued.
//
// PRICING: the Lightning v3.1 Pro model card publishes "~$0.195/10K
// characters" on the Standard Plan → $19.50 per 1M characters ($0.195 / 10_000
// × 1_000_000). No equivalent per-character list price is published for the
// standard Lightning v3.1 pool, so its `cost` is omitted rather than guessed.
//
// Re-searched 2026-08-13, still not published. What was checked: the Pro model
// card's Model Overview table carries a `Pricing (Standard Plan)` row; the
// lightning_v3.1 card's equivalent table has no Pricing row at all, and its
// "Throughput, Latency & Pricing" section defers to the Concurrency & Limits
// page (https://docs.smallest.ai/models/api-reference/concurrency-and-limits),
// which turns out to carry concurrency and regions only — no money. A sweep of
// all 24 text-to-speech / getting-started / api-reference pages under
// docs.smallest.ai (via the `.md` raw form of each page listed in
// https://docs.smallest.ai/llms.txt) found exactly ONE per-character figure in
// the whole section: the Pro card's $0.195/10K. https://smallest.ai/pricing
// publishes only per-minute voice-agent rates ("Text to Speech ~$0.09/minutes",
// "$0.09 - $0.21/minutes"), which cannot be converted to a per-character rate.
// Third-party summaries quote "~$0.175/10K characters" for the standard pool,
// but no first-party page states it, so it is NOT encoded here.
//
// CONSEQUENCE — read this before relying on `maxCostUSD`: `model` is optional
// on the wire and defaults to `lightning_v3.1` (the endpoint reference:
// "`model` (enum, optional, default: lightning_v3.1)"), so the most common
// request shape resolves to the one catalogued model that has no rate. Cost
// estimation then yields no `costUSD` and a `maxCostUSD` budget has nothing to
// compare against — it silently does not fire. Callers who need the budget
// enforced must pin `model: "lightning_v3.1_pro"` or supply their own rate.
//
// LIMITS: both model cards state "Maximum chunk size is 250 characters
// (optimal throughput at ~140 characters per request)", encoded as
// `limit.characters`. `limit.context: 0` disables token-window checks —
// these are not token models.

import type { ModelInfo, ProviderInfo } from "../../core/catalog-types";

export const provider = {
  id: "smallest-ai",
  name: "Smallest AI",
  env: ["SMALLEST_API_KEY"],
  doc: "https://docs.smallest.ai",
} as const satisfies ProviderInfo;

export const models = {
  // "Premium 44.1 kHz text-to-speech pool with improved naturalness and a
  // curated voice catalog", 31 languages. Must be requested explicitly.
  "lightning_v3.1_pro": {
    id: "lightning_v3.1_pro",
    name: "Lightning v3.1 Pro",
    family: "lightning-v3.1",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text"], output: ["audio"] },
    limit: { context: 0, characters: 250 },
    // "Pricing (Standard Plan): ~$0.195/10K characters" (model card).
    cost: { perMillionCharacters: 19.5 },
  },
  // "44.1 kHz audio output, ~200ms TTFB, expressive human-like speech, and
  // voice cloning." The server default when `model` is omitted.
  // No `cost`: no per-character list price is published for this pool — see
  // the PRICING note above, including what that costs you in `maxCostUSD`.
  "lightning_v3.1": {
    id: "lightning_v3.1",
    name: "Lightning v3.1",
    family: "lightning-v3.1",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text"], output: ["audio"] },
    limit: { context: 0, characters: 250 },
  },
} as const satisfies Record<string, ModelInfo>;

export type SmallestModelId = keyof typeof models;
/** Both catalogued pools serve the TTS routes. */
export type SmallestTtsModelId = SmallestModelId;

export const SMALLEST_MODEL_IDS = [
  "lightning_v3.1",
  "lightning_v3.1_pro",
] as const satisfies readonly SmallestModelId[];

/**
 * The `language` enum, verbatim from the endpoint reference. `auto` routes
 * across languages. `lightning_v3.1` accepts 20 of these codes (10 European +
 * 10 Indic); `lightning_v3.1_pro` accepts all 31 — see `PRO_ONLY_LANGUAGES`.
 */
export const LANGUAGES = [
  "auto",
  "en",
  "hi",
  "mr",
  "kn",
  "ta",
  "bn",
  "gu",
  "te",
  "ml",
  "pa",
  "or",
  "es",
  "de",
  "fr",
  "it",
  "nl",
  "sv",
  "pt",
  "ru",
  "el",
  "fi",
  "no",
  "pl",
  "ar",
  "zh",
  "id",
  "ja",
  "ko",
  "ms",
  "tr",
  "vi",
] as const;

/**
 * The 11 codes the endpoint reference lists only under `lightning_v3.1_pro`
 * ("31 supported languages (adds 11 over base)"): Greek, Finnish, Norwegian
 * and the 8 Asian & Middle Eastern languages. The base pool's 20 codes are
 * everything else.
 */
export const PRO_ONLY_LANGUAGES = [
  "el",
  "fi",
  "no",
  "ar",
  "zh",
  "id",
  "ja",
  "ko",
  "ms",
  "tr",
  "vi",
] as const satisfies readonly SmallestLanguage[];

export type SmallestLanguage = (typeof LANGUAGES)[number];
