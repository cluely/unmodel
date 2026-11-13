// Hand-maintained — Black Forest Labs (FLUX API) is not in models.dev; refresh from
//   https://api.bfl.ai/openapi.json         (routes + request schemas; ground truth)
//   https://bfl.ai/pricing                  (USD rates as text, incl. FLUX.1 [dev] and the tools)
//   https://docs.bfl.ml/quick_start/pricing (the same rates in credits; rendered client-side
//                                            from an embedded `rates` table, so its text shows blanks)
//   https://docs.bfl.ml/llms.txt            (docs index; also served at docs.bfl.ai)
// Verified 2026-11-12.
//
// Every id below is a REAL BFL route (`POST https://api.bfl.ai/v1/{id}`) taken
// from the OpenAPI `paths` list — the model is the route on this API, so the
// catalog key doubles as the URL segment (including the `flux-tools/` prefix
// on the FLUX tools routes). The one exception is the FLUX.2 [klein]
// `-finetuned` LoRA family, which the OpenAPI omits and
// https://docs.bfl.ml/flux_2/flux2_lora_inference documents.
//
// Pricing conversions (documented so the arithmetic never rots unexplained):
// - FLUX.2 rates are megapixel-based, quoted "from $X/MP": the first output
//   megapixel is billed at the flat base rate and additional megapixels add
//   incrementally (docs: "a 2MP image with Klein 4B costs $0.014 + $0.001").
//   `cost.perImage` records the 1MP text-to-image base price — the documented
//   floor for one generated image. Larger outputs and editing requests cost
//   more (each reference image adds its own per-MP rate: flux-2-pro editing
//   starts at $0.045, flux-2-max and flux-2-flex at $0.10); the BFL
//   response's `cost` field reports the exact charge per request, in credits
//   ("Cost in credits for this request").
// - FLUX.1 is flat per-image pricing (1 credit = $0.01): Kontext [pro] 4
//   credits $0.04, Kontext [max] 8 credits $0.08, FLUX1.1 [pro] 4 credits
//   $0.04, FLUX1.1 [pro] Ultra 6 credits $0.06 (Raw mode is the same 6
//   credits), FLUX.1 Fill [pro] 5 credits $0.05, FLUX.1 [dev] $0.025 (a
//   bfl.ai/pricing row only; the docs `rates` table has none).
// - Fine-tuned endpoints are "billed at the same rate as their base
//   endpoints" during public beta, so the -finetuned rows copy their base
//   route's price — except flux-2-klein-9b-kv-bf16-finetuned, whose base
//   route no pricing page names.
// - The `flux-tools/` routes are priced per megapixel with no per-image
//   floor a row could state, so their rows carry no `cost` and the rates
//   live in ./pricing.ts (outpainting estimates exactly from its canvas).
// - Routes with NO published price carry no `cost` (no estimate, no budget
//   check): the `-preview` routes, `flux-pro-1.0-expand` (no row on either
//   pricing page), the VTO routes (one "FLUX VTO" row, two routes, no
//   per-route rate) and flux-2-klein-9b-kv-bf16-finetuned.

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
    // https://bfl.ai/pricing (2026-11-12): "FLUX.2 [max] 1st MP $0.07 Add'l
    // MP $0.03 Ref img $0.03 /MP" — text-to-image from $0.07, editing from
    // $0.10 (one 1 MP reference).
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
    // https://bfl.ai/pricing (2026-11-12): "FLUX.2 [pro] 1st MP $0.03 Add'l
    // MP $0.015 Ref img $0.015 /MP" — editing from $0.045, not captured here.
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
    // https://docs.bfl.ml/quick_start/pricing `rates` (2026-11-12):
    // "/v1/flux-2-flex":{firstMpPrice:5,mpPrice:5,inputMpPrice:5} credits →
    // $0.05 first MP; editing from $0.10.
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
    // https://bfl.ai/pricing (2026-11-12): "FLUX.2 [klein] 9B 1st MP $0.015
    // Add'l MP $0.002 Ref img $0.002 /MP".
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
    // https://bfl.ai/pricing (2026-11-12): "FLUX.2 [klein] 4B 1st MP $0.014
    // Add'l MP $0.001 Ref img $0.001 /MP".
    cost: { perImage: 0.014 },
  },
  // FLUX.2 [klein] LoRA routes — https://docs.bfl.ml/flux_2/flux2_lora_inference
  // (2026-11-12). Docs-only: absent from the OpenAPI `paths`. "Each supported
  // base model has a corresponding `-finetuned` endpoint. The request schema
  // matches the underlying base endpoint, with two added parameters:
  // `finetune_id` and `finetune_strength`." Beta status: "LoRA inference
  // endpoints are in public beta. Pricing, parameters, and endpoint names may
  // change before general availability." The base checkpoints are FLUX.2
  // [klein], whose weights are published (see flux-2-klein-9b).
  "flux-2-klein-4b-finetuned": {
    id: "flux-2-klein-4b-finetuned",
    name: "FLUX.2 [klein] 4B (finetuned)",
    family: "flux-2",
    attachment: true,
    reasoning: false,
    toolCall: false,
    openWeights: true,
    // "| `/v1/flux-2-klein-4b-finetuned` | FLUX.2 \[klein] 4B | FP8 |"
    status: "beta",
    modalities: { input: ["text", "image"], output: ["image"] },
    limit: { context: 0 },
    // Billed as its base route during the beta. https://bfl.ai/pricing
    // (2026-11-12): "FLUX.2 [klein] 4B 1st MP $0.014 Add'l MP $0.001 Ref img
    // $0.001 /MP".
    cost: { perImage: 0.014 },
  },
  "flux-2-klein-9b-finetuned": {
    id: "flux-2-klein-9b-finetuned",
    name: "FLUX.2 [klein] 9B (finetuned)",
    family: "flux-2",
    attachment: true,
    reasoning: false,
    toolCall: false,
    openWeights: true,
    // "| `/v1/flux-2-klein-9b-finetuned` | FLUX.2 \[klein] 9B | FP8 |"
    status: "beta",
    modalities: { input: ["text", "image"], output: ["image"] },
    limit: { context: 0 },
    // Billed as its base route during the beta. https://bfl.ai/pricing
    // (2026-11-12): "FLUX.2 [klein] 9B 1st MP $0.015 Add'l MP $0.002 Ref img
    // $0.002 /MP".
    cost: { perImage: 0.015 },
  },
  "flux-2-klein-9b-kv-finetuned": {
    id: "flux-2-klein-9b-kv-finetuned",
    name: "FLUX.2 [klein] 9B KV (finetuned)",
    family: "flux-2",
    attachment: true,
    reasoning: false,
    toolCall: false,
    openWeights: true,
    // KV-cached 9B, FP8. https://docs.bfl.ml/release-notes (2026-11-12):
    // "`POST /v1/{base_model}-finetuned`, e.g. `/v1/flux-2-klein-9b-kv-finetuned`".
    status: "beta",
    modalities: { input: ["text", "image"], output: ["image"] },
    limit: { context: 0 },
    // https://docs.bfl.ml/quick_start/pricing (2026-11-12): "a request to
    // `flux-2-klein-9b-kv-finetuned` costs the same as the equivalent
    // `flux-2-klein-9b` request at the same resolution." → $0.015 first MP.
    cost: { perImage: 0.015 },
  },
  "flux-2-klein-9b-kv-bf16-finetuned": {
    id: "flux-2-klein-9b-kv-bf16-finetuned",
    name: "FLUX.2 [klein] 9B KV BF16 (finetuned)",
    family: "flux-2",
    attachment: true,
    reasoning: false,
    toolCall: false,
    openWeights: true,
    // "BF16 is currently available only for `flux-2-klein-9b-kv` and maps to
    // `/v1/flux-2-klein-9b-kv-bf16-finetuned`." The LoRA must be uploaded
    // with BF16 selected.
    status: "beta",
    modalities: { input: ["text", "image"], output: ["image"] },
    limit: { context: 0 },
    // No cost: the docs pricing table maps only the FP8 kv route
    // ("| `flux-2-klein-9b-kv-finetuned` | `flux-2-klein-9b` |") and no page
    // states what the BF16 route bills as.
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
    // $0.04 per image (flat) — https://docs.bfl.ml/quick_start/pricing `rates`
    // (2026-11-12): "/v1/flux-kontext-pro":{priceUnit:4} credits.
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
    // https://bfl.ai/pricing (2026-11-12): "FLUX.1 Kontext [max] Per image
    // $0.08 /img".
    cost: { perImage: 0.08 },
  },
} as const satisfies Record<string, ModelInfo>;

/** Previous-generation FLUX.1 text-to-image routes, flat per-image prices. */
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
    // 4 credits per image → $0.04 — https://docs.bfl.ml/quick_start/pricing
    // `rates` (2026-11-12): "/v1/flux-pro-1.1":{priceUnit:4}.
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
    // 6 credits per image → $0.06 (Raw mode is the same 6 credits) —
    // https://docs.bfl.ml/quick_start/pricing `rates` (2026-11-12):
    // "/v1/flux-pro-1.1-ultra":{priceUnit:6}.
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
    // Deprecated with the FLUX.1 Finetuning API, still served (in the OpenAPI
    // `paths` on 2026-11-12). https://docs.bfl.ml/release-notes: "As of
    // today, the Flux Pro 1.0 endpoints (`flux-pro-1.0`, `flux-pro-1.0-depth`,
    // `flux-pro-1.0-canny`) and the Finetuning API are officially
    // deprecated." The finetuning list names "* `flux-pro-1.1-ultra-finetuned`"
    // under "No migration path available. Finetuning functionality will be
    // discontinued."
    status: "deprecated",
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
    // https://bfl.ai/pricing (2026-11-12): "FLUX.1 [dev] Per image $0.025
    // /img Our distilled model of FLUX.1 [pro]." (no docs `rates` entry).
    cost: { perImage: 0.025 },
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
    // 5 credits per image → $0.05 — https://docs.bfl.ml/quick_start/pricing
    // `rates` (2026-11-12): "/v1/flux-pro-1.0-fill":{priceUnit:5}.
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
    // No row on either pricing page (2026-11-12) → no cost estimate.
  },
} as const satisfies Record<string, ModelInfo>;

/**
 * FLUX tools routes (`POST /v1/flux-tools/{tool}`). The catalog id is the
 * route path so `bflModelUrl()` interpolates it verbatim. They bill per
 * megapixel with no flat floor, so no row carries a `cost`: outpainting,
 * erase and deblur rates live in ./pricing.ts, and VTO has no per-route rate.
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
