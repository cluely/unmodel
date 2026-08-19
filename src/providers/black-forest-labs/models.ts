// Hand-maintained — Black Forest Labs (FLUX API) is not in models.dev; refresh from
//   https://api.bfl.ai/openapi.json         (routes + request schemas; ground truth)
//   https://docs.bfl.ml/quick_start/pricing (per-image / per-megapixel rates)
//   https://docs.bfl.ml/llms.txt            (docs index; also served at docs.bfl.ai)
// Verified 2026-08-13.
//
// Every id below is a REAL BFL route (`POST https://api.bfl.ai/v1/{id}`) taken
// from the OpenAPI `paths` list — the model is the route on this API, so the
// catalog key doubles as the URL segment (including the `flux-tools/` prefix
// on the FLUX tools routes).
//
// Pricing conversions (documented so the arithmetic never rots unexplained):
// - FLUX.2 rates are megapixel-based, quoted "from $X/MP": the first output
//   megapixel is billed at the flat base rate and additional megapixels add
//   incrementally (docs: "a 2MP image with Klein 4B costs $0.014 + $0.001").
//   `cost.perImage` records the 1MP text-to-image base price — the documented
//   floor for one generated image. Larger outputs and editing requests cost
//   more (flux-2-pro editing is quoted from $0.045/MP); the BFL response's
//   `cost` field reports the exact charge per request.
// - FLUX.1 is flat per-image pricing (1 credit = $0.01): Kontext [pro] 4
//   credits $0.04, Kontext [max] 8 credits $0.08, FLUX1.1 [pro] 4 credits
//   $0.04, FLUX1.1 [pro] Ultra 6 credits $0.06 (Raw mode is the same 6
//   credits), FLUX.1 Fill [pro] 5 credits $0.05.
// - Fine-tuned endpoints are "billed at the same rate as their base
//   endpoints" during public beta, so the -finetuned rows copy their base
//   route's price.
// - Routes with NO published price carry no `cost` (no estimate, no budget
//   check): the `-preview` routes, `flux-dev`, `flux-pro-1.0-expand` and the
//   whole `flux-tools/` family.

import type { ModelInfo, ProviderInfo } from "../../core/catalog-types";

export const provider = {
  id: "black-forest-labs",
  name: "Black Forest Labs",
  env: ["BFL_API_KEY"],
  doc: "https://docs.bfl.ai",
} as const satisfies ProviderInfo;

const flux2Models = {
  "flux-2-max": {
    id: "flux-2-max",
    name: "FLUX.2 [max]",
    family: "flux-2",
    attachment: true,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text", "image"], output: ["image"] },
    limit: { context: 0 },
    // from $0.07/MP (text-to-image and editing) — docs.bfl.ml/quick_start/pricing
    cost: { perImage: 0.07 },
  },
  "flux-2-pro": {
    id: "flux-2-pro",
    name: "FLUX.2 [pro]",
    family: "flux-2",
    attachment: true,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text", "image"], output: ["image"] },
    limit: { context: 0 },
    // from $0.03/MP text-to-image (editing from $0.045/MP, not captured here).
    cost: { perImage: 0.03 },
  },
  "flux-2-pro-preview": {
    id: "flux-2-pro-preview",
    name: "FLUX.2 [pro] preview",
    family: "flux-2",
    attachment: true,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    // Preview route kept alongside the released flux-2-pro; no published price.
    status: "beta",
    modalities: { input: ["text", "image"], output: ["image"] },
    limit: { context: 0 },
  },
  "flux-2-flex": {
    id: "flux-2-flex",
    name: "FLUX.2 [flex]",
    family: "flux-2",
    attachment: true,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text", "image"], output: ["image"] },
    limit: { context: 0 },
    // from $0.05/MP — docs.bfl.ml/quick_start/pricing
    cost: { perImage: 0.05 },
  },
  "flux-2-klein-9b": {
    id: "flux-2-klein-9b",
    name: "FLUX.2 [klein] 9B",
    family: "flux-2",
    attachment: true,
    reasoning: false,
    toolCall: false,
    // FLUX.2 [klein] weights are published on Hugging Face — https://docs.bfl.ai
    openWeights: true,
    modalities: { input: ["text", "image"], output: ["image"] },
    limit: { context: 0 },
    // from $0.015/MP — docs.bfl.ml/quick_start/pricing
    cost: { perImage: 0.015 },
  },
  "flux-2-klein-9b-preview": {
    id: "flux-2-klein-9b-preview",
    name: "FLUX.2 [klein] 9B preview",
    family: "flux-2",
    attachment: true,
    reasoning: false,
    toolCall: false,
    openWeights: true,
    // Preview route kept alongside the released flux-2-klein-9b; no published price.
    status: "beta",
    modalities: { input: ["text", "image"], output: ["image"] },
    limit: { context: 0 },
  },
  "flux-2-klein-4b": {
    id: "flux-2-klein-4b",
    name: "FLUX.2 [klein] 4B",
    family: "flux-2",
    attachment: true,
    reasoning: false,
    toolCall: false,
    openWeights: true,
    modalities: { input: ["text", "image"], output: ["image"] },
    limit: { context: 0 },
    // from $0.014/MP — docs.bfl.ml/quick_start/pricing
    cost: { perImage: 0.014 },
  },
} as const satisfies Record<string, ModelInfo>;

const kontextModels = {
  "flux-kontext-pro": {
    id: "flux-kontext-pro",
    name: "FLUX.1 Kontext [pro]",
    family: "flux-kontext",
    attachment: true,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text", "image"], output: ["image"] },
    limit: { context: 0 },
    // $0.04 per image (flat) — docs.bfl.ml/quick_start/pricing
    cost: { perImage: 0.04 },
  },
  "flux-kontext-max": {
    id: "flux-kontext-max",
    name: "FLUX.1 Kontext [max]",
    family: "flux-kontext",
    attachment: true,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text", "image"], output: ["image"] },
    limit: { context: 0 },
    // $0.08 per image (flat) — docs.bfl.ml/quick_start/pricing
    cost: { perImage: 0.08 },
  },
} as const satisfies Record<string, ModelInfo>;

/**
 * Previous-generation FLUX.1 text-to-image routes. `flux-dev` is open-weights
 * and has no row on the pricing page, so it carries no cost.
 */
const flux1Models = {
  "flux-pro-1.1": {
    id: "flux-pro-1.1",
    name: "FLUX1.1 [pro]",
    family: "flux-1",
    attachment: true,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text", "image"], output: ["image"] },
    limit: { context: 0 },
    // 4 credits per image → $0.04 — docs.bfl.ml/quick_start/pricing
    cost: { perImage: 0.04 },
  },
  "flux-pro-1.1-ultra": {
    id: "flux-pro-1.1-ultra",
    name: "FLUX1.1 [pro] Ultra",
    family: "flux-1",
    attachment: true,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text", "image"], output: ["image"] },
    limit: { context: 0 },
    // 6 credits per image → $0.06 (Raw mode is the same 6 credits).
    cost: { perImage: 0.06 },
  },
  "flux-pro-1.1-ultra-finetuned": {
    id: "flux-pro-1.1-ultra-finetuned",
    name: "FLUX1.1 [pro] Ultra (finetuned)",
    family: "flux-1",
    attachment: true,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text", "image"], output: ["image"] },
    limit: { context: 0 },
    // Fine-tuned endpoints bill at the base endpoint's rate.
    cost: { perImage: 0.06 },
  },
  "flux-dev": {
    id: "flux-dev",
    name: "FLUX.1 [dev]",
    family: "flux-1",
    attachment: true,
    reasoning: false,
    toolCall: false,
    // FLUX.1 [dev] weights are published on Hugging Face.
    openWeights: true,
    modalities: { input: ["text", "image"], output: ["image"] },
    limit: { context: 0 },
    // No row on the pricing page → no cost estimate.
  },
} as const satisfies Record<string, ModelInfo>;

/** FLUX.1 Tools editing routes: inpainting (fill) and border expansion. */
const flux1EditModels = {
  "flux-pro-1.0-fill": {
    id: "flux-pro-1.0-fill",
    name: "FLUX.1 Fill [pro]",
    family: "flux-1-tools",
    attachment: true,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text", "image"], output: ["image"] },
    limit: { context: 0 },
    // 5 credits per image → $0.05 — docs.bfl.ml/quick_start/pricing
    cost: { perImage: 0.05 },
  },
  "flux-pro-1.0-fill-finetuned": {
    id: "flux-pro-1.0-fill-finetuned",
    name: "FLUX.1 Fill [pro] (finetuned)",
    family: "flux-1-tools",
    attachment: true,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text", "image"], output: ["image"] },
    limit: { context: 0 },
    cost: { perImage: 0.05 },
  },
  "flux-pro-1.0-expand": {
    id: "flux-pro-1.0-expand",
    name: "FLUX.1 Expand [pro]",
    family: "flux-1-tools",
    attachment: true,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text", "image"], output: ["image"] },
    limit: { context: 0 },
    // No row on the pricing page → no cost estimate.
  },
} as const satisfies Record<string, ModelInfo>;

/**
 * FLUX tools routes (`POST /v1/flux-tools/{tool}`). The catalog id is the
 * route path so `bflModelUrl()` interpolates it verbatim. None of them are
 * itemized on the pricing page, so none carry a cost.
 */
const fluxToolsModels = {
  "flux-tools/outpainting-v1": {
    id: "flux-tools/outpainting-v1",
    name: "FLUX Outpainting v1",
    family: "flux-tools",
    attachment: true,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text", "image"], output: ["image"] },
    limit: { context: 0 },
  },
  "flux-tools/erase-v1": {
    id: "flux-tools/erase-v1",
    name: "FLUX Erase v1",
    family: "flux-tools",
    attachment: true,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["image"], output: ["image"] },
    limit: { context: 0 },
  },
  "flux-tools/deblur-v1": {
    id: "flux-tools/deblur-v1",
    name: "FLUX Deblur v1",
    family: "flux-tools",
    attachment: true,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["image"], output: ["image"] },
    limit: { context: 0 },
  },
  "flux-tools/vto-v1": {
    id: "flux-tools/vto-v1",
    name: "FLUX Virtual Try-On v1",
    family: "flux-tools",
    attachment: true,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text", "image"], output: ["image"] },
    limit: { context: 0 },
  },
  "flux-tools/vto-v2": {
    id: "flux-tools/vto-v2",
    name: "FLUX Virtual Try-On v2",
    family: "flux-tools",
    attachment: true,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text", "image"], output: ["image"] },
    limit: { context: 0 },
  },
} as const satisfies Record<string, ModelInfo>;

export const models = {
  ...flux2Models,
  ...kontextModels,
  ...flux1Models,
  ...flux1EditModels,
  ...fluxToolsModels,
} as const satisfies Record<string, ModelInfo>;

export type BflFlux2ModelId = keyof typeof flux2Models;
export type BflKontextModelId = keyof typeof kontextModels;
export type BflFlux1ModelId = keyof typeof flux1Models;
export type BflFlux1EditModelId = keyof typeof flux1EditModels;
export type BflFluxToolsModelId = keyof typeof fluxToolsModels;
export type BflModelId = keyof typeof models;
