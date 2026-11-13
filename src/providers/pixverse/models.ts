// Hand-maintained — PixVerse is not in models.dev; refresh from
//   https://docs.platform.pixverse.ai/text-to-video-13016634e0                    (t2v wire schema)
//   https://docs.platform.pixverse.ai/image-to-video-and-video-templates-13016633e0 (i2v wire schema)
//   https://docs.platform.pixverse.ai/pixverse-api-pricing-2394995m0              (credit tables + USD rate)
//   https://docs.platform.pixverse.ai/model-capability-map-2394982m0              (roster + per-model capabilities)
//   https://docs.platform.pixverse.ai/changelog-2394996m0                         (model releases)
// Verified 2026-11-12. Append `.md` to any of them for the raw OpenAPI YAML and
// tables; a rendered fetch drops table cells.
//
// Pricing conversion (documented so the arithmetic never rots unexplained):
// PixVerse bills in credits and publishes one USD reference rate, "225 Credits
// = USD 1; 1 Credit ≈ USD 0.004444", computing every USD cell on its pricing
// page as "total Credits ÷ 225". So USD = credits ÷ 225. The same page warns
// "Plans, volume agreements, promotions, and free allowances may change your
// effective cost", so an estimate is the vendor's reference price, not your
// bill (https://docs.platform.pixverse.ai/pixverse-api-pricing-2394995m0,
// 2026-11-12).
//
// Why most entries carry no `cost`: `quality` is a REQUIRED request field with
// no documented default, and the credit rate is a function of it —
//   - v6-max / v6 / c1 bill PER SECOND: 6–22 credits/s (v6-max), 5–18 (v6) or
//     6–19 (c1) silent, 9–28 / 7–23 / 8–24 with audio, by quality tier.
//   - v5.6 / v5.5 / v5 bill PER GENERATION by quality × duration (× audio,
//     × multi-clip), which `ModelCost` has no unit for at all.
// A single number would therefore have to pick a tier and lie about the rest,
// so the full tables live in ./pricing.ts and the endpoints estimate per
// request.
//
// v4.5 / v4 / v3.5 have no published rate: the pricing page prices C1, V6,
// V6 Max, V5.6, V5.5 and V5 only and says "Legacy-model availability depends
// on the active endpoint and your account" (2026-11-12). They stay catalogued,
// because both routes' `model` enums still list them, and estimate nothing.
//
// Model coverage vs. the artificialanalysis census: PixVerse V6, V5.6, V5.5,
// V5 and V4.5 are all documented `model` values and all appear below, together
// with the V4 / V3.5 legacy ids, the C1 cinematic model and V6 Max.
//
// `v5-fast` is a value of both routes' `model` enum but has no row, because
// nothing about it is published to transcribe (all verified 2026-11-12): the
// image-to-video schema says "Access to v5-fast depends on account
// permissions"
// (https://docs.platform.pixverse.ai/image-to-video-and-video-templates-13016633e0),
// the pricing page lists no rate for it ("Not listed: no public rate is
// provided"; https://docs.platform.pixverse.ai/pixverse-api-pricing-2394995m0),
// and the capability map covers only "V6 Max, C1, V6, V5.6, or V5"
// (https://docs.platform.pixverse.ai/model-capability-map-2394982m0). It
// validates with an `unknown_model` warning and no per-model checks.

import type { ModelInfo, ProviderInfo } from "../../core/catalog-types";

export const provider = {
  id: "pixverse",
  name: "PixVerse",
  // Auth is an `API-KEY` header — https://docs.platform.pixverse.ai/start-here-2394989m0
  // (2026-11-12): "| `API-KEY` | Yes | API Key used for authentication |".
  env: ["PIXVERSE_API_KEY"],
  doc: "https://docs.platform.pixverse.ai/",
} as const satisfies ProviderInfo;

/**
 * USD per PixVerse credit, the vendor's reference rate —
 * https://docs.platform.pixverse.ai/pixverse-api-pricing-2394995m0 (2026-11-12):
 * "225 Credits = USD 1; 1 Credit ≈ USD 0.004444."
 */
export const CREDIT_USD = 1 / 225;

const videoModality = { input: ["text", "image"], output: ["video"] } as const;

export const models = {
  "v6-max": {
    id: "v6-max",
    name: "PixVerse V6 Max",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: videoModality,
    limit: { context: 0 },
    // Per second, 6–22 credits silent / 9–28 with audio by quality tier.
    // https://docs.platform.pixverse.ai/changelog-2394996m0 (2026-11-12):
    // "Added V6-max support for Text-to-Video and Image-to-Video."
  },
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
