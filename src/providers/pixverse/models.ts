// Hand-maintained — PixVerse is not in models.dev; refresh from
//   https://docs.platform.pixverse.ai/text-to-video-generation-13016634e0  (t2v wire schema)
//   https://docs.platform.pixverse.ai/image-to-video-generation-13016633e0 (i2v wire schema)
//   https://docs.platform.pixverse.ai/pricing-796039m0                     (credit tables + credit price)
//   https://docs.platform.pixverse.ai/model-overview-2140345m0             (model roster)
//   https://docs.platform.pixverse.ai/capability-matrix-2144288m0          (per-model capabilities)
//   https://docs.platform.pixverse.ai/v6-2056814m0                         (V6 parameter matrix)
// Verified 2026-08-13.
//
// Pricing conversion (documented so the arithmetic never rots unexplained):
// PixVerse bills in credits, and its credit packs are all priced at exactly
// $0.01 per credit — $10/1,000, $50/5,000, $100/10,000, $500/50,000,
// $2,000/200,000 and $5,000/500,000 (docs/pricing, "Buy Credits Video Unit
// Price"). So USD = credits × 0.01.
//
// Why most entries carry no `cost`: `quality` is a REQUIRED request field with
// no documented default, and the credit rate is a function of it —
//   - v6 / c1 bill PER SECOND: 5–18 credits/s (v6) or 6–19 (c1) silent,
//     7–23 / 8–24 with audio, by quality tier.
//   - v5.6 / v5.5 / v5 / v4.5 / v4 / v3.5 bill PER GENERATION by
//     quality × duration (× audio, × multi-clip, × motion_mode), which
//     `ModelCost` has no unit for at all.
// A single number would therefore have to pick a tier and lie about the rest,
// so the full tables live in ./pricing.ts and the endpoints estimate per
// request.
//
// Model coverage vs. the artificialanalysis census: PixVerse V6, V5.6, V5.5,
// V5 and V4.5 are all documented `model` values and all appear below, together
// with the V4 / V3.5 legacy ids and the C1 cinematic model.

import type { ModelInfo, ProviderInfo } from "../../core/catalog-types";

export const provider = {
  id: "pixverse",
  name: "PixVerse",
  // Auth is an `API-KEY` header — https://docs.platform.pixverse.ai/how-to-get-api-key-882968m0
  env: ["PIXVERSE_API_KEY"],
  doc: "https://docs.platform.pixverse.ai/",
} as const satisfies ProviderInfo;

/** USD per PixVerse credit — https://docs.platform.pixverse.ai/pricing-796039m0 */
export const CREDIT_USD = 0.01;

const videoModality = { input: ["text", "image"], output: ["video"] } as const;

export const models = {
  c1: {
    id: "c1",
    name: "PixVerse C1",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: videoModality,
    limit: { context: 0 },
    // Per second, 6–19 credits silent / 8–24 with audio by quality tier.
  },
  v6: {
    id: "v6",
    name: "PixVerse V6",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: videoModality,
    limit: { context: 0 },
    // Per second, 5–18 credits silent / 7–23 with audio by quality tier.
  },
  "v5.6": {
    id: "v5.6",
    name: "PixVerse V5.6",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: videoModality,
    limit: { context: 0 },
    // Per generation, 35–195 credits by quality × duration × audio.
  },
  "v5.5": {
    id: "v5.5",
    name: "PixVerse V5.5",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: videoModality,
    limit: { context: 0 },
    // Per generation, 45–280 credits by quality × duration × audio × clips.
  },
  v5: {
    id: "v5",
    name: "PixVerse V5",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: videoModality,
    limit: { context: 0 },
    // Per generation, 45–240 credits by quality × duration.
  },
  "v4.5": {
    id: "v4.5",
    name: "PixVerse V4.5",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: videoModality,
    limit: { context: 0 },
    // Per generation, 45–120 credits by quality × motion_mode × duration.
  },
  v4: {
    id: "v4",
    name: "PixVerse V4",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: videoModality,
    limit: { context: 0 },
  },
  "v3.5": {
    id: "v3.5",
    name: "PixVerse V3.5",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: videoModality,
    limit: { context: 0 },
  },
} as const satisfies Record<string, ModelInfo>;

export type PixverseModelId = keyof typeof models;
