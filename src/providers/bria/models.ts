// Hand-maintained — Bria is not in models.dev; refresh from
//   https://docs.bria.ai/_bundle/image-generation.yaml (OpenAPI for /v2/image/generate[/lite]; ground truth)
//   https://docs.bria.ai/_bundle/image-editing.yaml    (OpenAPI for /v2/image/edit and the editing routes)
//   https://docs.bria.ai/image-generation              (rendered generation reference)
//   https://docs.bria.ai/image-editing                 (rendered editing reference)
//   https://bria.ai/pricing                            ("API Price List" — per-call USD)
//   https://docs.bria.ai/llms.txt                      (docs index)
// Verified 2026-08-13.
//
// Catalog modeling: Bria's v2 API selects the model with `model_version`, but
// the enum is single-valued per route ("FIBO" on both generate routes,
// "FIBO-edit" on the edit route) — the *route* is what picks the pipeline and
// the price. So each row below is a route:
//   FIBO        POST /v2/image/generate       — Gemini 2.5 Flash VLM bridge + full FIBO
//   FIBO-lite   POST /v2/image/generate/lite  — open-source FIBO-VLM bridge + Fibo Lite
//   FIBO-edit   POST /v2/image/edit           — instruction/mask editing
// "FIBO" and "FIBO-edit" are literal `model_version` values; "FIBO-lite" is an
// unmodel pseudo-id for the lite route, whose own `model_version` enum is also
// "FIBO" even though it bills at the Fibo Lite rate.
//
// Pricing (https://bria.ai/pricing, "API Price List", per image; the platform
// bills per API call with no per-request image count on these routes):
//   Fibo $0.03 · Fibo Lite $0.02 · Fibo Edit $0.03 · Fibo Structured Prompt
//   $0.02/call. (artificialanalysis quotes $40/1k for FIBO and FIBO Edit; that
//   is their own measured figure, not Bria's published rate.)
//
// NOT modeled: `/v2/structured_prompt/generate[/lite]` and
// `/v2/structured_prompt/generate_from_diff` (JSON-prompt authoring, $0.02 per
// call), the ~20 specialized editing routes (`/v2/erase`, `/v2/expand`,
// `/v2/remove_background`, …), tailored generation, product-shot and video
// endpoints. Also not modeled: Bria 3.2 and the other v1 `/v1/text-to-image/…`
// models — the current documentation exposes only the FIBO v2 surface.

import type { ModelInfo, ProviderInfo } from "../../core/catalog-types";

export const provider = {
  id: "bria",
  name: "Bria",
  env: ["BRIA_API_TOKEN"],
  doc: "https://docs.bria.ai/image-generation",
  api: "https://engine.prod.bria-api.com/v2",
} as const satisfies ProviderInfo;

const base = {
  attachment: true,
  reasoning: false,
  toolCall: false,
  // FIBO is published on Hugging Face (github.com/Bria-AI/FIBO); these rows
  // describe Bria's hosted routes.
  openWeights: true,
  modalities: { input: ["text", "image"], output: ["image"] },
} as const;

export const models = {
  FIBO: {
    ...base,
    id: "FIBO",
    name: "FIBO",
    family: "fibo",
    limit: { context: 0 },
    cost: { perImage: 0.03 },
  },
  "FIBO-lite": {
    ...base,
    id: "FIBO-lite",
    name: "Fibo Lite",
    family: "fibo",
    limit: { context: 0 },
    cost: { perImage: 0.02 },
  },
  "FIBO-edit": {
    ...base,
    id: "FIBO-edit",
    name: "FIBO Edit",
    family: "fibo",
    limit: { context: 0 },
    cost: { perImage: 0.03 },
  },
} as const satisfies Record<string, ModelInfo>;

export type BriaModelId = keyof typeof models;

/** USD per call for `/v2/structured_prompt/generate[/lite]` — https://bria.ai/pricing. */
export const BRIA_STRUCTURED_PROMPT_COST_USD = 0.02;
