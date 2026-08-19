// Hand-maintained — Runway is not in models.dev; refresh from
//   https://docs.dev.runwayml.com/guides/models.md   (model ids per route)
//   https://docs.dev.runwayml.com/guides/pricing.md  (credit costs; "Credit costs are documented only in /guides/pricing.md")
//   https://docs.dev.runwayml.com/openapi.json       (wire schemas; spec version 2024-11-06)
// Verified 2026-08-13.
//
// Pricing conversion (documented so the arithmetic never rots unexplained):
// Runway bills in credits; "Credits can be purchased for $0.01 per credit"
// (guides/pricing.md), so USD = credits × 0.01. Video models are billed in
// credits per second of output → `cost.perVideoSecond` = credits/s × $0.01.
// Image models billed per image → `cost.perImage` = credits × $0.01.
//
// Models whose credit rate depends on request fields (audio on/off,
// resolution, ratio tier, quality) cannot be expressed as a single catalog
// number; their catalog entry carries either the documented
// default-configuration rate (when the driving field has a documented
// default) or no cost at all, with the tier table in a comment. Request-aware
// estimation for all tiers lives in ./pricing.ts.
//
// Ids that appear in the API but are NOT generation models, and so are
// deliberately absent here (openapi.json, verified 2026-08-13):
//   gen3a_turbo, gen4_aleph, act_two — `gen3a_turbo` and `gen4_aleph` survive
//     only in the GET /v1/organization and POST /v1/organization/usage
//     response enums (historical credit reporting); neither has an arm in any
//     generation route's request union, so neither is callable. `gen4_aleph`
//     was superseded by `aleph2` on POST /v1/video_to_video.
//   act_two, gwm1_avatars, magnific_* , seed_audio, eleven_* — real models on
//     routes unmodel does not yet validate (character_performance,
//     image_upscale, video_upscale, and the audio routes).

import type { ModelInfo, ProviderInfo } from "../../core/catalog-types";

export const provider = {
  id: "runway",
  name: "Runway",
  // The official SDK (@runwayml/sdk) reads RUNWAYML_API_SECRET.
  env: ["RUNWAYML_API_SECRET"],
  doc: "https://docs.dev.runwayml.com/",
} as const satisfies ProviderInfo;

/** USD per Runway credit — https://docs.dev.runwayml.com/guides/pricing.md */
export const CREDIT_USD = 0.01;

/**
 * Models accepted by the video routes (image_to_video / text_to_video /
 * video_to_video). Route coverage is per model — `gen4_turbo` is
 * image_to_video-only and `aleph2` is video_to_video-only — and is enforced
 * from `*_MODELS` in ./constraints.ts, not from this catalog.
 */
export const videoModels = {
  aleph2: {
    id: "aleph2",
    name: "Aleph 2",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    // video_to_video only: edits an input video (≤30s) with text + keyframes.
    modalities: { input: ["text", "image", "video"], output: ["video"] },
    limit: { context: 0 },
    // 28 credits/s, 56-credit minimum per generation — guides/pricing.md.
    // Output duration follows the input video, which unmodel cannot read from
    // a URI, so no per-request estimate is produced (see ./pricing.ts).
    cost: { perVideoSecond: 28 * CREDIT_USD },
  },
  "gen4.5": {
    id: "gen4.5",
    name: "Gen-4.5",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text", "image"], output: ["video"] },
    limit: { context: 0 },
    // 12 credits/s — guides/pricing.md
    cost: { perVideoSecond: 12 * CREDIT_USD },
  },
  gen4_turbo: {
    id: "gen4_turbo",
    name: "Gen-4 Turbo",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    // image_to_video only (models.md lists input: Image).
    modalities: { input: ["text", "image"], output: ["video"] },
    limit: { context: 0 },
    // 5 credits/s — guides/pricing.md
    cost: { perVideoSecond: 5 * CREDIT_USD },
  },
  "veo3.1": {
    id: "veo3.1",
    name: "Veo 3.1",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text", "image"], output: ["video"] },
    limit: { context: 0 },
    // 40 credits/s with audio (the documented default, `audio` defaults to
    // true in the request schema); 20 credits/s with `audio: false` —
    // guides/pricing.md. ./pricing.ts picks the right tier per request.
    cost: { perVideoSecond: 40 * CREDIT_USD },
  },
  "veo3.1_fast": {
    id: "veo3.1_fast",
    name: "Veo 3.1 Fast",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text", "image"], output: ["video"] },
    limit: { context: 0 },
    // 15 credits/s with audio (default true); 10 credits/s without —
    // guides/pricing.md.
    cost: { perVideoSecond: 15 * CREDIT_USD },
  },
  hailuo3: {
    id: "hailuo3",
    name: "Hailuo 3.0",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text", "image", "video"], output: ["video"] },
    limit: { context: 0 },
    // No single rate: 10 credits/s at 768P, 15 credits/s at 2K, plus 2
    // credits per reference image (guides/pricing.md); no documented default
    // resolution, so the catalog carries no cost. See ./pricing.ts.
  },
  happyhorse_1_0: {
    id: "happyhorse_1_0",
    name: "Happyhorse 1.0",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text", "image"], output: ["video"] },
    limit: { context: 0 },
    // No single rate: 15 credits/s at 720P, 30 credits/s at 1080P
    // (guides/pricing.md); no documented default resolution. See ./pricing.ts.
  },
  seedance2: {
    id: "seedance2",
    name: "Seedance 2.0",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text", "image", "video"], output: ["video"] },
    limit: { context: 0 },
    // No single rate: 36 credits/s at 480p/720p ratios, 40 at 1080p ratios,
    // 150 at 4K ratios (guides/pricing.md); the tier follows the requested
    // `ratio`. See ./pricing.ts.
  },
  seedance2_fast: {
    id: "seedance2_fast",
    name: "Seedance 2.0 Fast",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text", "image", "video"], output: ["video"] },
    limit: { context: 0 },
    // 29 credits/s (this model only offers 480p/720p ratios) — guides/pricing.md
    cost: { perVideoSecond: 29 * CREDIT_USD },
  },
  seedance2_mini: {
    id: "seedance2_mini",
    name: "Seedance 2.0 Mini",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text", "image", "video"], output: ["video"] },
    limit: { context: 0 },
    // 16 credits/s, 64-credit minimum per generation — guides/pricing.md
    cost: { perVideoSecond: 16 * CREDIT_USD },
  },
  seedance2_5: {
    id: "seedance2_5",
    name: "Seedance 2.5",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text", "image", "video"], output: ["video"] },
    limit: { context: 0 },
    // No single rate: 30 credits/s of output at 720p ratios, 20 at 480p
    // ratios, plus 15 (720p) / 10 (480p) credits/s of input & reference
    // video, 80-credit minimum (guides/pricing.md). See ./pricing.ts.
  },
  grok_imagine_1_5: {
    id: "grok_imagine_1_5",
    name: "Grok Imagine Video 1.5",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text", "image"], output: ["video"] },
    limit: { context: 0 },
    // No single rate: 10/16/29 credits/s at 480p/720p/1080p, plus 1 credit
    // per image or audio reference (guides/pricing.md). See ./pricing.ts.
  },
  gemini_omni_flash: {
    id: "gemini_omni_flash",
    name: "Gemini Omni Flash",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text", "image", "video"], output: ["video"] },
    limit: { context: 0 },
    // 10 credits/s (text- and image-to-video; image-to-video adds 1 credit
    // for the first-frame image) — guides/pricing.md
    cost: { perVideoSecond: 10 * CREDIT_USD },
  },
} as const satisfies Record<string, ModelInfo>;

/** Models accepted by the text_to_image route. */
export const imageModels = {
  gen4_image: {
    id: "gen4_image",
    name: "Gen-4 Image",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text", "image"], output: ["image"] },
    limit: { context: 0 },
    // "5 credits per 720p image, or 8 credits per 1080p image"
    // (guides/pricing.md) — the ratio→tier mapping is not documented, so no
    // single catalog rate; ./pricing.ts estimates worst-case (8 credits).
  },
  gen4_image_turbo: {
    id: "gen4_image_turbo",
    name: "Gen-4 Image Turbo",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text", "image"], output: ["image"] },
    limit: { context: 0 },
    // 2 credits per image, any resolution — guides/pricing.md
    cost: { perImage: 2 * CREDIT_USD },
  },
  gpt_image_2: {
    id: "gpt_image_2",
    name: "GPT Image 2",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text", "image"], output: ["image"] },
    limit: { context: 0 },
    // 1–41 credits per image by quality × resolution tier (default quality
    // is high: 20 credits at 1K/2K, 41 at 4K/auto) — guides/pricing.md.
    // See ./pricing.ts for the full tier table.
  },
  gemini_image3_pro: {
    id: "gemini_image3_pro",
    name: "Gemini Image 3 Pro",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text", "image"], output: ["image"] },
    limit: { context: 0 },
    // 20 credits per 1K/2K image, 40 per 4K image — guides/pricing.md.
    // See ./pricing.ts.
  },
  "gemini_image3.1_flash": {
    id: "gemini_image3.1_flash",
    name: "Gemini Image 3.1 Flash",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text", "image"], output: ["image"] },
    limit: { context: 0 },
    // Not yet listed on guides/pricing.md (verified 2026-08-13) — no cost.
  },
  seedream5_pro: {
    id: "seedream5_pro",
    name: "Seedream 5.0 Pro",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text", "image"], output: ["image"] },
    limit: { context: 0 },
    // 5 credits per 1K image, 9 per 2K image (auto_1k/auto_2k bill at their
    // tier) — guides/pricing.md. See ./pricing.ts.
  },
  seedream5_lite: {
    id: "seedream5_lite",
    name: "Seedream 5.0 Lite",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text", "image"], output: ["image"] },
    limit: { context: 0 },
    // 4 credits per image, any resolution — guides/pricing.md
    cost: { perImage: 4 * CREDIT_USD },
  },
  grok_imagine_image_2: {
    id: "grok_imagine_image_2",
    name: "Grok Imagine Image 2",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text", "image"], output: ["image"] },
    limit: { context: 0 },
    // Billed as outputCount × perImage + referenceCount × 1, where perImage
    // is 4 (low/1K), 6 (low/2K or medium/1K), or 8 (medium/2K) credits —
    // guides/pricing.md. See ./pricing.ts.
  },
  "gemini_2.5_flash": {
    id: "gemini_2.5_flash",
    name: "Gemini 2.5 Flash Image",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text", "image"], output: ["image"] },
    limit: { context: 0 },
    // 5 credits per image, any resolution — guides/pricing.md
    cost: { perImage: 5 * CREDIT_USD },
  },
} as const satisfies Record<string, ModelInfo>;

export const models = {
  ...videoModels,
  ...imageModels,
} as const satisfies Record<string, ModelInfo>;

export type RunwayVideoModelId = keyof typeof videoModels;
export type RunwayImageModelId = keyof typeof imageModels;
export type RunwayModelId = keyof typeof models;
