// Hand-maintained — Leonardo.Ai is not in models.dev; refresh from
//   https://docs.leonardo.ai/reference/creategeneration-1 (OpenAPI v2 for POST /generations; ground truth)
//   https://docs.leonardo.ai/docs/lucid-origin              (Lucid Origin param table + style ids)
//   https://docs.leonardo.ai/docs/phoenix                   (Phoenix param table + style ids)
//   https://docs.leonardo.ai/docs/payg-guide                (Pay-As-You-Go billing)
//   https://docs.leonardo.ai/llms.txt                       (docs index)
// Verified 2026-08-13.
//
// Scope: Leonardo's own image models on the v2 generations endpoint. The same
// endpoint routes ~60 third-party models (FLUX, Imagen, Ideogram, Seedream,
// GPT Image, Kling, Veo, …) plus Leonardo's video/audio/3D models; those belong
// to their own providers' catalogs and each carries a different `parameters`
// schema, so they are deliberately absent here.
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
  doc: "https://docs.leonardo.ai/reference/creategeneration-1",
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
} as const satisfies Record<string, ModelInfo>;

export type LeonardoModelId = keyof typeof models;
