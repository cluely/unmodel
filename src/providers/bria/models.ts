// Hand-maintained — Bria is not in models.dev; refresh from
//   https://docs.bria.ai/_bundle/image-generation.yaml (OpenAPI for /v2/image/generate[/lite]; ground truth)
//   https://docs.bria.ai/_bundle/image-editing.yaml    (OpenAPI for /v2/image/edit and the editing routes)
//   https://docs.bria.ai/image-generation.md           (generation reference as Markdown)
//   https://docs.bria.ai/image-editing.md              (editing reference as Markdown)
//   (the rendered /image-generation and /image-editing pages are a JS app whose
//   static HTML carries none of the parameter text; append `.md` to any docs
//   page for its text — "Every page of these docs is available as Markdown by
//   appending `.md` to its URL", https://docs.bria.ai/llms.txt, 2026-11-12)
//   https://bria.ai/pricing                            ("API Price List" — per-call USD)
//   https://docs.bria.ai/llms.txt                      (docs index)
// Verified 2026-11-12.
//
// Catalog modeling: Bria's v2 API selects the model with `model_version`, but
// the enum is single-valued per route ("FIBO" on both generate routes,
// "FIBO-edit" on the edit route) — the *route* is what picks the pipeline and
// the price. So each row below is a route:
//   FIBO        POST /v2/image/generate       — Gemini 2.5 Flash VLM bridge + Fibo 2
//   FIBO-lite   POST /v2/image/generate/lite  — open-source FIBO-VLM bridge + Fibo Lite
//   FIBO-edit   POST /v2/image/edit           — Fibo 2 instruction/mask editing, 1–4 images
// "FIBO" and "FIBO-edit" are literal `model_version` values; "FIBO-lite" is an
// unmodel pseudo-id for the lite route, whose own `model_version` enum is also
// "FIBO" even though it bills at the Fibo Lite rate. (The 2026-11-12 bundles do
// not declare `model_version` on these three routes; see image.ts.)
//
// /v2/image/generate and /v2/image/edit run Fibo 2 — "Image generation now runs
// on Fibo 2, with 12 more aspect ratios and no code changes."
// (https://docs.bria.ai/image-generation-overview.md) and "Instruction-based
// editing now runs on Fibo 2, with no code changes."
// (https://docs.bria.ai/image-editing-overview.md), both read 2026-11-12 — so
// those rows' display names name Fibo 2 while their ids stay the route ids. The
// lite route runs Fibo Lite.
//
// Pricing (https://bria.ai/pricing, "API Price List", per image; the platform
// bills per API call with no per-request image count on these routes), read
// 2026-11-12: "Fibo | $0.032 / Image", "Fibo Lite | $0.0288 / Image",
// "Fibo Edit | $0.032 / Image", "Fibo Structured Prompt | $0.02 / Call".
// (artificialanalysis quotes $40/1k for FIBO and FIBO Edit; that is their own
// measured figure, not Bria's published rate.)
//
// NOT modeled: `/v2/structured_prompt/generate[/lite]` and
// `/v2/structured_prompt/generate_from_diff` (JSON-prompt authoring, $0.02 per
// call); their edit-side twin `/v2/structured_instruction/generate` ("It only
// returns the JSON string and does not generate an image."; no price-list
// row); the ~20 specialized editing routes, served under
// `https://engine.prod.bria-api.com/v2/image/edit` (`/v2/image/edit/erase`,
// `/v2/image/edit/expand`, `/v2/image/edit/remove_background`, …), among them
// `/v2/image/edit/replace_background`, whose `mode: "fibo2"` is the one other
// place Fibo 2 renders; tailored generation, product-shot and video
// endpoints (all read 2026-11-12). Also not modeled: Bria 3.2 and the other
// v1 `/v1/text-to-image/…` models — the current documentation exposes only
// the FIBO v2 surface.

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
  // FIBO is published on Hugging Face (github.com/Bria-AI/FIBO), and so is
  // Fibo 2 (huggingface.co/briaai/Fibo-2.0-dev and
  // huggingface.co/briaai/Fibo-2.0-edit-turbo, linked from
  // https://docs.bria.ai/whats-new/fibo-2.md, read 2026-11-12); these rows
  // describe Bria's hosted routes.
  openWeights: true,
  modalities: { input: ["text", "image"], output: ["image"] },
} as const;

export const models = {
  FIBO: {
    ...base,
    id: "FIBO",
    // "Image generation now runs on Fibo 2" — image-generation-overview.md, 2026-11-12.
    name: "Fibo 2",
    family: "fibo",
    limit: { context: 0 },
    // "Fibo | $0.032 / Image" — https://bria.ai/pricing, 2026-11-12.
    cost: { perImage: 0.032 },
  },
  "FIBO-lite": {
    ...base,
    id: "FIBO-lite",
    name: "Fibo Lite",
    family: "fibo",
    limit: { context: 0 },
    // "Fibo Lite | $0.0288 / Image" — https://bria.ai/pricing, 2026-11-12.
    cost: { perImage: 0.0288 },
  },
  "FIBO-edit": {
    ...base,
    id: "FIBO-edit",
    // "Instruction-based editing now runs on Fibo 2" — image-editing-overview.md, 2026-11-12.
    name: "Fibo 2 Edit",
    family: "fibo",
    limit: { context: 0 },
    // "Fibo Edit | $0.032 / Image" — https://bria.ai/pricing, 2026-11-12.
    cost: { perImage: 0.032 },
  },
} as const satisfies Record<string, ModelInfo>;

export type BriaModelId = keyof typeof models;

/**
 * USD per call for `/v2/structured_prompt/generate[/lite]` — "Fibo Structured
 * Prompt | $0.02 / Call", https://bria.ai/pricing, 2026-11-12.
 */
export const BRIA_STRUCTURED_PROMPT_COST_USD = 0.02;
