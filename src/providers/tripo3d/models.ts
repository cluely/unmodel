// Hand-maintained — Tripo is not in models.dev; refresh from
//   https://developers.tripo3d.ai/en/docs/generation-text-to-model/standard  (H-series text wire schema)
//   https://developers.tripo3d.ai/en/docs/generation-text-to-model/p         (P-series text wire schema)
//   https://developers.tripo3d.ai/en/docs/generation-image-to-model/standard (H-series image wire schema)
//   https://developers.tripo3d.ai/en/docs/generation-image-to-model/p        (P-series image wire schema)
//   https://developers.tripo3d.ai/en/docs/models-and-versions                (model roster)
//   https://developers.tripo3d.ai/en/pricing                                 (credit tables + credit price)
//   https://developers.tripo3d.ai/en/docs/billing                            (freeze/deduct/refund model)
// Verified 2026-08-25. Every doc route also serves raw Markdown at `<route>.md`,
// which is what was read.
//
// Pricing conversion, documented so the arithmetic never rots unexplained:
// Tripo bills in CREDITS and states the rate on the pricing page as
// "1 credit = $0.01 USD" / "100 credits = $1.00 USD". So USD = credits × 0.01.
//
// Why no row carries a `cost`: `ModelCost` has four media fields — `perImage`,
// `perVideoSecond`, `perMillionCharacters`, `perAudioMinute` — and a mesh is
// none of those. There is no per-generation field, and inventing one for this
// provider would widen a core type on one witness. The credit tables therefore
// live in ./pricing.ts and each endpoint estimates per request, which it can do
// EXACTLY here: unlike an upscaler (billed on the output's pixel count, which a
// URL does not reveal) a Tripo generation's price is a pure function of the
// request body — the base task type plus the add-ons the body switched on.
//
// The one exception is P1, and it is a gap rather than a decision: the pricing
// page renders its H-Series table server-side and its P-Series and Splat-Series
// tables only in the browser, so the P credit figures are not readable from the
// published page. `tripo3dCostUSD` returns `undefined` for P1 rather than
// borrowing the H numbers, which are demonstrably different (fal resells P1 at
// twice the H rate).
//
// Model coverage: all four ids the endpoint reference pages publish. Tripo's
// text-to-image / image-to-image routes are deliberately NOT served — they
// resell seedream, gemini and gpt-image, which unmodel already carries natively
// from the vendors themselves, and a `tripo3d.image` would duplicate them under
// a middleman's name.

import type { ModelInfo, ProviderInfo } from "../../core/catalog-types";

export const provider = {
  id: "tripo3d",
  name: "Tripo",
  // `Authorization: Bearer <TRIPO_API_KEY>` —
  // https://developers.tripo3d.ai/en/docs/authentication
  env: ["TRIPO_API_KEY"],
  doc: "https://developers.tripo3d.ai/en/docs/introduction",
} as const satisfies ProviderInfo;

/** USD per Tripo credit — https://developers.tripo3d.ai/en/pricing */
export const CREDIT_USD = 0.01;

/**
 * Both moods on both series: a Tripo model is reached by describing an object
 * or by showing one, and the model id does not change between them — the ROUTE
 * does. That is the opposite of how fal serves the same models, where each
 * mood is its own endpoint id.
 */
const threeDModality = { input: ["text", "image"], output: ["3d"] } as const;

export const models = {
  "v3.1-20260211": {
    id: "v3.1-20260211",
    name: "Tripo v3.1",
    family: "tripo-v3",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    releaseDate: "2026-02-11",
    modalities: threeDModality,
    limit: { context: 0 },
    // 10/20 credits text, 20/30 image, plus stacking add-ons. See ./pricing.ts.
  },
  "v3.0-20250812": {
    id: "v3.0-20250812",
    name: "Tripo v3.0",
    family: "tripo-v3",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    releaseDate: "2025-08-12",
    modalities: threeDModality,
    limit: { context: 0 },
  },
  "v2.5-20250123": {
    id: "v2.5-20250123",
    name: "Tripo v2.5",
    family: "tripo-v2",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    releaseDate: "2025-01-23",
    modalities: threeDModality,
    limit: { context: 0 },
    // The legacy generation. It takes NONE of the version-gated parameters —
    // no texture_quality, no geometry_quality, no quad, no smart_low_poly —
    // which is the sharpest per-model narrowing this provider has.
  },
  "P1-20260311": {
    id: "P1-20260311",
    name: "Tripo P1",
    family: "tripo-p",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    releaseDate: "2026-03-11",
    modalities: threeDModality,
    limit: { context: 0 },
    // The low-poly series: `face_limit` runs 50–20,000 here where the H series
    // takes millions. Its credit table is browser-rendered only, so estimates
    // for it return `undefined` — see the header.
  },
} as const satisfies Record<string, ModelInfo>;

export type Tripo3dCatalogModelId = keyof typeof models;
