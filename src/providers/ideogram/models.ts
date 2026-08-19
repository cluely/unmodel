// Hand-maintained — Ideogram is not in models.dev; refresh from
//   https://developer.ideogram.ai/api-reference/api-reference/generate-v3 (endpoint + params)
//   https://developer.ideogram.ai/openapi.json                            (authoritative schema)
//   https://ideogram.ai/api-pricing/                                      (per-image USD pricing)
// Verified 2026-08-13 (pricing page "Last revised August 6, 2025").
//
// Catalog modeling: the Ideogram 3.0 generate endpoint has no `model` wire
// param — the billable tier is selected by `rendering_speed` (FLASH / TURBO /
// DEFAULT / QUALITY), and the pricing page itemizes a distinct per-image rate
// for each speed. Each speed is therefore modeled as a pseudo-model row
// ("ideogram-3.0-<speed>"): the pipeline's catalog lookup keys on a model id,
// and a row per speed gives exact perImage cost estimation and lets each
// tier's metadata evolve independently. The validator maps
// `rendering_speed` (default DEFAULT) to these ids; they never appear on the
// wire.
//
// Pricing (USD per generated image; the pricing page states the same rates
// apply across Generate, Remix, Edit, Reframe and Replace Background):
// - 3.0 Flash $0.03, 3.0 Turbo $0.03, 3.0 Default $0.06, 3.0 Quality $0.09.
// - 4.0 Turbo $0.03, 4.0 Default $0.06, 4.0 Quality $0.10. Ideogram 4.0
//   publishes no FLASH rate because the API returns 400 for
//   `rendering_speed=FLASH` on the 4.0 routes ("coming soon" per the OpenAPI
//   description), so there is no 4.0 Flash row here.
// - With character reference (character_reference_images): 3.0 Turbo $0.10,
//   3.0 Default $0.15, 3.0 Quality $0.20. No Flash-with-character-reference
//   rate is published, so that combination gets no cost estimate.
// - A request with num_images > 1 costs num_images × the per-image rate.
//
// NOT modeled: the "Ideogram 4.0 with Gemini" rows ($0.20 for 1K/2K, $0.36
// for 4K) — the pricing page lists them but no API route in
// https://developer.ideogram.ai/openapi.json selects that pairing.

import type { ModelInfo, ProviderInfo } from "../../core/catalog-types";

export const provider = {
  id: "ideogram",
  name: "Ideogram",
  env: ["IDEOGRAM_API_KEY"],
  doc: "https://developer.ideogram.ai/api-reference/api-reference/generate-v3",
} as const satisfies ProviderInfo;

const base = {
  attachment: false,
  reasoning: false,
  toolCall: false,
  openWeights: false,
  // style/character reference images ride along with the text prompt.
  modalities: { input: ["text", "image"], output: ["image"] },
} as const;

export const models = {
  "ideogram-3.0-flash": {
    ...base,
    id: "ideogram-3.0-flash",
    name: "Ideogram 3.0 (FLASH rendering)",
    limit: { context: 0 },
    cost: { perImage: 0.03 },
  },
  "ideogram-3.0-turbo": {
    ...base,
    id: "ideogram-3.0-turbo",
    name: "Ideogram 3.0 (TURBO rendering)",
    limit: { context: 0 },
    cost: { perImage: 0.03 },
  },
  "ideogram-3.0-default": {
    ...base,
    id: "ideogram-3.0-default",
    name: "Ideogram 3.0 (DEFAULT rendering)",
    limit: { context: 0 },
    cost: { perImage: 0.06 },
  },
  "ideogram-3.0-quality": {
    ...base,
    id: "ideogram-3.0-quality",
    name: "Ideogram 3.0 (QUALITY rendering)",
    limit: { context: 0 },
    cost: { perImage: 0.09 },
  },
  "ideogram-4.0-turbo": {
    ...base,
    id: "ideogram-4.0-turbo",
    name: "Ideogram 4.0 (TURBO rendering)",
    limit: { context: 0 },
    cost: { perImage: 0.03 },
  },
  "ideogram-4.0-default": {
    ...base,
    id: "ideogram-4.0-default",
    name: "Ideogram 4.0 (DEFAULT rendering)",
    limit: { context: 0 },
    cost: { perImage: 0.06 },
  },
  "ideogram-4.0-quality": {
    ...base,
    id: "ideogram-4.0-quality",
    name: "Ideogram 4.0 (QUALITY rendering)",
    limit: { context: 0 },
    cost: { perImage: 0.1 },
  },
} as const satisfies Record<string, ModelInfo>;

export type IdeogramModelId = keyof typeof models;

/** Maps the `rendering_speed` wire value to its Ideogram 3.0 pseudo-model id. */
export const RENDERING_SPEED_TO_MODEL_ID: Readonly<Record<string, IdeogramModelId>> = {
  FLASH: "ideogram-3.0-flash",
  TURBO: "ideogram-3.0-turbo",
  DEFAULT: "ideogram-3.0-default",
  QUALITY: "ideogram-3.0-quality",
};

/**
 * Maps `rendering_speed` to its Ideogram 4.0 pseudo-model id. FLASH is absent
 * on purpose: the 4.0 routes return 400 for it today
 * (https://developer.ideogram.ai/openapi.json, GenerateImageRequestV4's
 * `rendering_speed` description), which the v4 endpoint reports as an
 * unsupported value rather than silently pricing a request the API rejects.
 */
export const RENDERING_SPEED_TO_V4_MODEL_ID: Readonly<Record<string, IdeogramModelId>> = {
  TURBO: "ideogram-4.0-turbo",
  DEFAULT: "ideogram-4.0-default",
  QUALITY: "ideogram-4.0-quality",
};

/**
 * USD per generated image when `character_reference_images` is used, keyed by
 * rendering speed — https://ideogram.ai/api-pricing/ ("with Character
 * Reference" rows). FLASH is absent because no such rate is published.
 */
export const CHARACTER_REFERENCE_PER_IMAGE: Readonly<Partial<Record<string, number>>> = {
  TURBO: 0.1,
  DEFAULT: 0.15,
  QUALITY: 0.2,
};
