// Hand-maintained — Leonardo.Ai is not in models.dev; refresh from
//   https://docs.leonardo.ai/reference/creategeneration (OpenAPI v2 for POST /generations; ground truth)
//   https://docs.leonardo.ai/docs/lucid-origin            (Lucid Origin param table + style ids)
//   https://docs.leonardo.ai/docs/phoenix                 (Phoenix param table + style ids)
//   https://docs.leonardo.ai/docs/payg-guide              (Pay-As-You-Go billing)
//   https://docs.leonardo.ai/llms.txt                     (docs index)
// Verified 2026-11-12.
//
// Scope: the image models on the v2 generations endpoint that no other
// provider in unmodel serves — Lucid, Phoenix, and the nine Elements models
// below. The same endpoint routes 74 more ids: third-party image, video and 3D
// models (FLUX, Imagen, Ideogram, Seedream, GPT Image, Kling, Veo, …) plus the
// Motion video, upscaler, background-removal and audio models. The third-party
// ones belong to their own providers' catalogs, and every one carries a
// different `parameters` schema, so they are deliberately absent here.
//
// NO PRICING IS RECORDED, on purpose. Leonardo bills API generations from a
// US-dollar Pay-As-You-Go balance ("Each API generation deducts from this
// balance based on the model and settings you use"), but the per-model rate is
// only exposed through the app's authenticated pricing calculator
// (https://app.leonardo.ai/api-access/pricing-calculator) — no public docs page
// states a dollar or credit figure per model/mode. Guessing one would be worse
// than omitting it, so these rows carry no `cost`: unmodel reports no cost
// estimate and `maxCostUSD` cannot fire for this provider. The generation
// response itself carries a `cost` object ("showing the amount charged and the
// unit (dollars or credits)") — that is authoritative.
//
// Cost is also mode-dependent (FAST / QUALITY / ULTRA) and multiplied by
// `quantity`, so a single per-model number would be misleading even if
// published.

import type { ModelInfo, ProviderInfo } from "../../core/catalog-types";

export const provider = {
  id: "leonardo",
  name: "Leonardo.Ai",
  env: ["LEONARDO_API_KEY"],
  doc: "https://docs.leonardo.ai/reference/creategeneration",
  api: "https://cloud.leonardo.ai/api/rest/v2",
} as const satisfies ProviderInfo;

const base = {
  // Image guidance (style / content / character / image_to_image references).
  attachment: true,
  reasoning: false,
  toolCall: false,
  openWeights: false,
  modalities: { input: ["text", "image"], output: ["image"] },
} as const;

export const models = {
  "lucid-origin": {
    ...base,
    id: "lucid-origin",
    name: "Lucid Origin",
    family: "lucid",
    limit: { context: 0 },
  },
  "lucid-realism": {
    ...base,
    id: "lucid-realism",
    name: "Lucid Realism",
    family: "lucid",
    limit: { context: 0 },
  },
  "phoenix-v1.0": {
    ...base,
    id: "phoenix-v1.0",
    name: "Phoenix 1.0",
    family: "phoenix",
    limit: { context: 0 },
  },
  "phoenix-v0.9": {
    ...base,
    id: "phoenix-v0.9",
    name: "Phoenix 0.9",
    family: "phoenix",
    limit: { context: 0 },
  },

  // The nine Elements models (model-rules.ts ELEMENTS_PARAMETERS). Each id is a
  // discriminator key on https://docs.leonardo.ai/reference/creategeneration
  // (read 2026-11-12) and each `name` is its schema's `title`, quoted below.
  // They have no guide page, no vendor prefix and no `family`: no vendor page
  // names who trained them or a lineage, so none is recorded. No cost, for the
  // reason in the header.

  // "kino-xl": "#/components/schemas/KinoXlGenerationRequest" — "title": "Cinematic Kino"
  "kino-xl": { ...base, id: "kino-xl", name: "Cinematic Kino", limit: { context: 0 } },
  // "anime-xl": "#/components/schemas/AnimeXlGenerationRequest" — "title": "Anime"
  "anime-xl": { ...base, id: "anime-xl", name: "Anime", limit: { context: 0 } },
  // "portrait-perfect": "#/components/schemas/PortraitPerfectGenerationRequest" — "title": "Portrait Perfect"
  "portrait-perfect": {
    ...base,
    id: "portrait-perfect",
    name: "Portrait Perfect",
    limit: { context: 0 },
  },
  // "stock-photography": "#/components/schemas/StockPhotographyGenerationRequest" — "title": "Stock Photography"
  "stock-photography": {
    ...base,
    id: "stock-photography",
    name: "Stock Photography",
    limit: { context: 0 },
  },
  // "illustrative-albedo": "#/components/schemas/IllustrativeAlbedoGenerationRequest" — "title": "Illustrative Albedo"
  "illustrative-albedo": {
    ...base,
    id: "illustrative-albedo",
    name: "Illustrative Albedo",
    limit: { context: 0 },
  },
  // "concept-art": "#/components/schemas/ConceptArtGenerationRequest" — "title": "Concept Art"
  "concept-art": { ...base, id: "concept-art", name: "Concept Art", limit: { context: 0 } },
  // "lifelike-vision": "#/components/schemas/LifelikeVisionGenerationRequest" — "title": "Lifelike Vision"
  "lifelike-vision": {
    ...base,
    id: "lifelike-vision",
    name: "Lifelike Vision",
    limit: { context: 0 },
  },
  // "graphic-design": "#/components/schemas/GraphicDesignGenerationRequest" — "title": "Graphic Design"
  "graphic-design": {
    ...base,
    id: "graphic-design",
    name: "Graphic Design",
    limit: { context: 0 },
  },
  // "lightning-xl": "#/components/schemas/LightningXlGenerationRequest" — "title": "Leonardo Lightning"
  "lightning-xl": {
    ...base,
    id: "lightning-xl",
    name: "Leonardo Lightning",
    limit: { context: 0 },
  },
} as const satisfies Record<string, ModelInfo>;

export type LeonardoModelId = keyof typeof models;
