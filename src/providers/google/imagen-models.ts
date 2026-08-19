// Hand-maintained — Imagen is absent from models.dev's google catalog
// (src/catalog/google.gen.ts has no imagen-* ids at all); refresh from
//   https://ai.google.dev/gemini-api/docs/imagen    (model codes, parameters, limits)
//   https://ai.google.dev/gemini-api/docs/pricing   (per-image prices)
//
// Provenance note (2026-08-13): the Imagen guide's "Model versions" section
// lists exactly three Gemini API model codes — imagen-4.0-generate-001,
// imagen-4.0-ultra-generate-001 and imagen-4.0-fast-generate-001 — under the
// heading "Imagen 4 (Deprecated)", with the banner "Imagen models are
// deprecated and will be shut down on August 17, 2026". They are cataloged
// with `status: "deprecated"` so callers get a deprecated_model warning that
// names the situation, rather than an unknown_model shrug.
//
// "Imagen 3 … has been shut down." — no imagen-3.0-* id is cataloged.
//
// Pricing (pricing page, "Paid Tier, per Image in USD"): Fast $0.02,
// Standard $0.04, Ultra $0.06. Free tier: "Not available".
//
// `limit.context: 0` — Imagen is not a token-context model (HAND_CATALOGS.md
// rule). The documented prompt cap ("Maximum prompt length is 480 tokens")
// rides on `limit.input`, which ./generate-images checks.

import type { ModelInfo } from "../../core/catalog-types";

const IMAGEN_MAX_PROMPT_TOKENS = 480;

const IMAGEN_SHARED = {
  family: "imagen",
  attachment: false,
  reasoning: false,
  toolCall: false,
  // The predict body has no temperature knob at all.
  temperature: false,
  openWeights: false,
  releaseDate: "2025-06-24",
  lastUpdated: "2025-06",
  status: "deprecated",
  // "Supported data types — Input: Text; Output: Images"; English-only prompts.
  modalities: { input: ["text"], output: ["image"] },
  limit: { context: 0, input: IMAGEN_MAX_PROMPT_TOKENS },
} as const;

/** The three Imagen 4 model codes the Gemini API documents. */
export const imagenModels = {
  "imagen-4.0-generate-001": {
    ...IMAGEN_SHARED,
    id: "imagen-4.0-generate-001",
    name: "Imagen 4 Standard",
    cost: { perImage: 0.04 },
  },
  "imagen-4.0-ultra-generate-001": {
    ...IMAGEN_SHARED,
    id: "imagen-4.0-ultra-generate-001",
    name: "Imagen 4 Ultra",
    cost: { perImage: 0.06 },
  },
  "imagen-4.0-fast-generate-001": {
    ...IMAGEN_SHARED,
    id: "imagen-4.0-fast-generate-001",
    name: "Imagen 4 Fast",
    cost: { perImage: 0.02 },
  },
} as const satisfies Record<string, ModelInfo>;

/** Catalog consumed by the generateImages validator. */
export const generateImagesModels: Record<string, ModelInfo> = imagenModels;

/** Imagen model ids servable by `models.{model}:predict`. */
export type GoogleImagenModelId = keyof typeof imagenModels;
