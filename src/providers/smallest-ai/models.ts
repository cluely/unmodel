// Hand-maintained — Smallest AI is not in models.dev; refresh from
// https://docs.smallest.ai/api-reference/models/text-to-speech/synthesize-speech,
// https://docs.smallest.ai/model-cards/text-to-speech/lightning-v-3-1,
// https://docs.smallest.ai/model-cards/text-to-speech/lightning-v-3-1-pro,
// https://docs.smallest.ai/api-reference/deprecations/models
// and https://smallest.ai/pricing/models (last checked 2026-11-12).
//
// MODEL IDS: the Waves TTS routes take a single `model` enum with three values
// — "Allowed values: `lightning_v3.1`, `lightning_v3.1_pro`,
// `lightning_v3.1_pro_10_26`" (endpoint reference,
// https://docs.smallest.ai/api-reference/models/text-to-speech/synthesize-speech,
// read 2026-11-12). The first two are model *pools*, so successive builds ship
// behind one stable id. New Pro builds are previewed under dated ids: "A dated
// ID such as `lightning_v3.1_pro_10_26` lets you try a new checkpoint during its
// 30-day preview" (https://docs.smallest.ai/model-cards/text-to-speech/lightning-v-3-1-pro,
// read 2026-11-12), after which the checkpoint becomes the stable Pro id and
// the dated id stays served for a further 30 days.
// Lightning v2 and lightning-large are documented only as deprecated
// predecessors with no current endpoint reference, so they are not catalogued.
//
// PRICING: https://smallest.ai/pricing/models publishes a per-character rate
// for both pools, in its visible table ("Lightning V3.1 ~$0.175/10K
// characters", "Lightning V3.1 Pro ~$0.195/10K characters") and in its JSON-LD
// offers: "Usage-based Lightning v3.1 text-to-speech pricing at approximately
// USD 0.175 per 10,000 characters." and "Usage-based Lightning v3.1 Pro
// text-to-speech pricing at approximately USD 0.195 per 10,000 characters."
// (read 2026-11-12) → $17.50 and $19.50 per 1M characters (× 100). The model
// cards' pricing rows only link to https://smallest.ai/pricing, which now
// serves per-minute voice-agent rates, so they are not the source. After the
// 2026-11-30 retirement `lightning_v3.1` requests are served by Pro, and no
// page states which rate such a request is billed at.
//
// CONSEQUENCE — read this before relying on `maxCostUSD`: `model` is optional
// on the wire, and "If you omit `model`, it's picked from the voice: Pro
// catalog voices use `lightning_v3.1_pro`, all others `lightning_v3.1`."
// (endpoint reference, read 2026-11-12). The validator cannot see which pool a
// voice belongs to, so an omitted `model` resolves no row and yields no
// `costUSD`, and a `maxCostUSD` budget has nothing to compare against — it
// silently does not fire. Pin `model` to have the budget enforced.
//
// LIMITS: "Max 8000 characters after trim; whitespace-only strings are
// rejected." (endpoint reference, sync and SSE pages, read 2026-11-12),
// encoded as `limit.characters` on every row. Both model cards still give "Max
// chunk size 250 characters" beside "Optimal throughput at ~140 characters per
// request" — a throughput figure the reference does not enforce, which
// ./tts.ts reports as a warning. `limit.context: 0` disables token-window
// checks — these are not token models.

import type { ModelInfo, ProviderInfo } from "../../core/catalog-types";

export const provider = {
  id: "smallest-ai",
  name: "Smallest AI",
  env: ["SMALLEST_API_KEY"],
  doc: "https://docs.smallest.ai",
} as const satisfies ProviderInfo;

export const models = {
  // "Premium 44.1 kHz text-to-speech pool with improved naturalness and a
  // curated voice catalog", 31 languages.
  "lightning_v3.1_pro": {
    id: "lightning_v3.1_pro",
    name: "Lightning v3.1 Pro",
    family: "lightning-v3.1",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text"], output: ["audio"] },
    limit: { context: 0, characters: 8000 },
    // "approximately USD 0.195 per 10,000 characters" — see PRICING above.
    cost: { perMillionCharacters: 19.5 },
  },
  // The Pro pool's preview checkpoint: "`lightning_v3.1_pro_10_26` — [preview]
  // New Lightning v3.1 Pro checkpoint for English, Spanish and Hindi. Accepts
  // every Pro voice. On 2026-11-28, it becomes the stable `lightning_v3.1_pro`
  // for these three languages only; all other languages are unchanged.
  // `lightning_v3.1_pro_10_26` remains available until 2026-12-28." (endpoint
  // reference, read 2026-11-12). Released 2026-10-29
  // (https://docs.smallest.ai/changelog/lightning-v-3-1/2026/10/29). The row
  // is removed in a changeset once the id stops being served.
  "lightning_v3.1_pro_10_26": {
    id: "lightning_v3.1_pro_10_26",
    name: "Lightning v3.1 Pro (10_26 preview)",
    family: "lightning-v3.1",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    releaseDate: "2026-10-29",
    status: "beta",
    modalities: { input: ["text"], output: ["audio"] },
    // "Endpoints, regions, sample rates, pricing, concurrency and features are
    // the same as `lightning_v3.1_pro`." (changelog 2026-10-29, read
    // 2026-11-12), so the limit is the Pro row's — see LIMITS above.
    limit: { context: 0, characters: 8000 },
    // Same changelog quote for pricing; the Pro pool's rate is "Usage-based
    // Lightning v3.1 Pro text-to-speech pricing at approximately USD 0.195 per
    // 10,000 characters." (https://smallest.ai/pricing/models, read
    // 2026-11-12) → $19.50 per 1M characters.
    cost: { perMillionCharacters: 19.5 },
  },
  // "44.1 kHz audio output, ~200ms TTFB, expressive human-like speech, and
  // voice cloning." Retiring: "`lightning_v3.1`: standard Lightning v3.1.
  // Retiring on Nov 30, 2026; use `lightning_v3.1_pro`." (endpoint reference,
  // read 2026-11-12). The id is not refused afterwards — "requests with
  // `"model": "lightning_v3.1"` or no `model` will be served by
  // `lightning_v3.1_pro`, so the voice and sound may change"
  // (https://docs.smallest.ai/api-reference/deprecations/models, read
  // 2026-11-12) — so the row stays, marked deprecated.
  "lightning_v3.1": {
    id: "lightning_v3.1",
    name: "Lightning v3.1",
    family: "lightning-v3.1",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    status: "deprecated",
    modalities: { input: ["text"], output: ["audio"] },
    limit: { context: 0, characters: 8000 },
    // "approximately USD 0.175 per 10,000 characters" — see PRICING above.
    cost: { perMillionCharacters: 17.5 },
  },
} as const satisfies Record<string, ModelInfo>;

export type SmallestModelId = keyof typeof models;
/** Every catalogued id serves the TTS routes. */
export type SmallestTtsModelId = SmallestModelId;

export const SMALLEST_MODEL_IDS = [
  "lightning_v3.1",
  "lightning_v3.1_pro",
  "lightning_v3.1_pro_10_26",
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

/**
 * The `date_format` enum: "Controls how all-numeric dates (e.g. `05/03/2024`)
 * are read out, independent of the synthesis voice", "Allowed values: `EU`,
 * `US`" (endpoint reference, read 2026-11-12). "Any other value returns `400`
 * with `invalid_enum_value`" (https://docs.smallest.ai/changelog/lightning-v-3-1/2026/10/14).
 */
export const DATE_FORMATS = ["EU", "US"] as const;
export type SmallestDateFormat = (typeof DATE_FORMATS)[number];

/**
 * `content_filter.action`: "Allowed values: `reject`, `flag`, `redact`"; the
 * default is `reject` (endpoint reference and
 * https://docs.smallest.ai/models/text-to-speech/content-filter, read
 * 2026-11-12).
 */
export const CONTENT_FILTER_ACTIONS = ["reject", "flag", "redact"] as const;
export type SmallestContentFilterAction = (typeof CONTENT_FILTER_ACTIONS)[number];

/**
 * The `content_filter` body object — "Supported on `lightning_v3.1`,
 * `lightning_v3.1_pro` and `lightning_v3.1_pro_10_26` (preview)." (content
 * filter guide). `redact` "removes the matched term and speaks the rest of the
 * sentence" (https://docs.smallest.ai/changelog/lightning-v-3-1/2026/10/17).
 */
export interface SmallestContentFilter {
  /**
   * "Must be the literal `true` to enable the filter. Any other value leaves
   * it off." Default false.
   */
  enabled?: boolean;
  /** "What happens when the text matches"; default "reject". */
  action?: SmallestContentFilterAction;
}
