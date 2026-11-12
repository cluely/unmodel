// Hand-maintained overlay on the generated cohere catalog — refresh from
//   https://docs.cohere.com/docs/models                     (model table: ids, status, limits)
//   https://docs.cohere.com/docs/north-small-translate-1.0  (model page: id, specifications, capabilities, pricing)
//   https://docs.cohere.com/docs/north-mini-code-1.0        (model page: capabilities)
//   https://docs.cohere.com/changelog                       (release entries)
// Verified 2026-11-12.
//
// `cohere.chat` validates against `chatModels`, not the generated table:
// models.dev's cohere snapshot states facts Cohere's own pages contradict, and
// scripts/codegen.ts has no per-field override, so each correction lives here
// with its source. Every field not restated below is the generated row,
// unchanged. `models.test.ts` pins each correction against the generated row,
// so an upstream models.dev fix surfaces as a test diff, not silent drift.
//
// Reading a Cohere capability card: each model page renders every capability
// as a badge, and one the model lacks is the same badge greyed out
// (`opacity:0.5;color:#9ca3af` in its style attribute). docs.cohere.com's
// markdown variant drops the cards and the changelog dates — read the HTML.

import type { ModelInfo } from "../../core/catalog-types";
import { models } from "../../catalog/cohere.gen";

/**
 * "Context Window: 16K tokens Max Output Tokens: 16K tokens" —
 * https://docs.cohere.com/docs/north-small-translate-1.0 (2026-11-12); the
 * model table, the changelog and the HuggingFace card ("16K input & 16K
 * output") agree. models.dev carries 32768. Cohere prints the figure only as
 * "16K": 16,000 follows the exact counts its Command pages print for the same
 * shorthand ("Context Window: 8,000 tokens Max Output Tokens: 8,000 tokens" —
 * https://docs.cohere.com/docs/command-a-translate) and models.dev's own output
 * figure for this row; whether the API means 16,384 is unpublished.
 */
const NORTH_SMALL_TRANSLATE_CONTEXT_TOKENS = 16000;

// models.dev spells North Small Translate `north-small-translate-09-2026`; no
// Cohere page does. "API Endpoints Model ID north-small-translate-1.0 Chat V2
// Chat V1 Chat Completions" (model page), "**Model name**:
// `north-small-translate-1.0`" (changelog, September 9, 2026) — and models.dev's
// own canonical_model_id is `cohere/north-small-translate-1-0`. The validator
// matches ids exactly, so the generated spelling would leave a real request at
// `unknown_model`, skipping every capability check.
const { "north-small-translate-09-2026": northSmallTranslate, ...served } = models;

/**
 * The catalog `cohere.chat` validates against: the generated cohere catalog
 * with the corrections above layered on.
 *
 * `as const satisfies`, not an annotation — the annotation would erase every
 * row's literal flags and collapse `keyof` to `string`.
 */
export const chatModels = {
  ...served,
  // Every other field is the generated row and matches the model page's card:
  // only "Multilingual" is active; Reasoning, Image Inputs, Safety Modes,
  // Citations, Tool Use and Structured Outputs are greyed. Cost 0/0: "For both
  // trial keys and production keys, North Small Translate is free until rate
  // limits are reached." No page states another price.
  "north-small-translate-1.0": {
    ...northSmallTranslate,
    id: "north-small-translate-1.0",
    limit: { ...northSmallTranslate.limit, context: NORTH_SMALL_TRANSLATE_CONTEXT_TOKENS },
  },
  // models.dev carries structured_output false; the model page's card renders
  // "Structured Outputs" active, beside Reasoning and Tool Use (Multilingual,
  // Image Inputs, Safety Modes and Citations are the greyed ones) —
  // https://docs.cohere.com/docs/north-mini-code-1.0 (2026-11-12). Restating
  // it keeps `response_format: json_object` from a false refusal.
  "north-mini-code-1-0": { ...served["north-mini-code-1-0"], structuredOutput: true },
} as const satisfies Record<string, ModelInfo>;

/** Every model id `cohere.chat` knows — the keys of {@link chatModels}. */
export type CohereChatModelId = keyof typeof chatModels;
