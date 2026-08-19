// Hand-maintained — Recraft is not in models.dev; refresh from
//   https://www.recraft.ai/docs/api-reference/endpoints   (GROUND TRUTH: model ids,
//     param compatibility, per-route model lists)
//   https://www.recraft.ai/docs/api-reference/pricing     (per-image API unit charges)
//   https://www.recraft.ai/docs/api-reference/appendix    (max prompt length, supported sizes)
//   https://external.api.recraft.ai/doc/spec/api/api.yaml (SECONDARY, and not the public
//     /v1/images spec: the internal backend OpenAPI document the Swagger UI at
//     https://external.api.recraft.ai/doc/ renders. Re-downloaded 2026-08-13 — it declares
//     ZERO paths and none of the /v1/images request schemas. The only thing taken from it
//     here is the `TransformModel` enum, and that enum is an internal one listing Recraft's
//     own ids next to third-party ones (flux2_pro, gpt_image_2, veo3, …), so it can show
//     that an id exists but never that the public endpoints accept it.)
// Verified 2026-08-13.
//
// Pricing conversions (documented so the arithmetic never rots unexplained):
// - Recraft bills in pre-purchased API units: USD $1.00 = 1,000 API units
//   (https://www.recraft.ai/docs/api-reference/pricing). The pricing table
//   lists every generation charge in both USD and units per image; the USD
//   figures below are copied verbatim from that table (units = USD × 1000).
// - Image generation is billed per generated image, so a request with `n` > 1
//   costs `n` × the per-image rate.
//
// The "max prompt length" appendix caps live on `ModelLimit.characters`
// (10,000 characters for the V4/V4.1 line, 1,000 for V2/V3); the generations
// validator enforces them against `prompt`. `limit.context: 0` marks these as
// non-token models so the pipeline skips context-window checks.

import type { ModelInfo, ProviderInfo } from "../../core/catalog-types";

export const provider = {
  id: "recraft",
  name: "Recraft",
  env: ["RECRAFT_API_TOKEN"],
  doc: "https://www.recraft.ai/docs/api-reference/endpoints",
} as const satisfies ProviderInfo;

/** Max prompt characters for the V4 / V4.1 line — pricing appendix. */
const V4_PROMPT_CHARACTERS = 10000;
/** Max prompt characters for V2 / V3 models — pricing appendix. */
const V2_V3_PROMPT_CHARACTERS = 1000;

const IMAGE_OUT = { input: ["text"], output: ["image"] } as const;

const base = {
  attachment: false,
  reasoning: false,
  toolCall: false,
  openWeights: false,
  modalities: IMAGE_OUT,
} as const;

export const models = {
  recraftv4_1: {
    ...base,
    id: "recraftv4_1",
    name: "Recraft V4.1",
    limit: { context: 0, characters: V4_PROMPT_CHARACTERS },
    cost: { perImage: 0.035 }, // 35 units
  },
  recraftv4_1_vector: {
    ...base,
    id: "recraftv4_1_vector",
    name: "Recraft V4.1 Vector",
    limit: { context: 0, characters: V4_PROMPT_CHARACTERS },
    cost: { perImage: 0.08 }, // 80 units
  },
  recraftv4_1_pro: {
    ...base,
    id: "recraftv4_1_pro",
    name: "Recraft V4.1 Pro",
    limit: { context: 0, characters: V4_PROMPT_CHARACTERS },
    cost: { perImage: 0.21 }, // 210 units
  },
  recraftv4_1_pro_vector: {
    ...base,
    id: "recraftv4_1_pro_vector",
    name: "Recraft V4.1 Pro Vector",
    limit: { context: 0, characters: V4_PROMPT_CHARACTERS },
    cost: { perImage: 0.3 }, // 300 units
  },
  recraftv4_1_utility: {
    ...base,
    id: "recraftv4_1_utility",
    name: "Recraft V4.1 Utility",
    limit: { context: 0, characters: V4_PROMPT_CHARACTERS },
    cost: { perImage: 0.035 }, // 35 units
  },
  recraftv4_1_utility_vector: {
    ...base,
    id: "recraftv4_1_utility_vector",
    name: "Recraft V4.1 Utility Vector",
    limit: { context: 0, characters: V4_PROMPT_CHARACTERS },
    cost: { perImage: 0.08 }, // 80 units
  },
  recraftv4_1_utility_pro: {
    ...base,
    id: "recraftv4_1_utility_pro",
    name: "Recraft V4.1 Utility Pro",
    limit: { context: 0, characters: V4_PROMPT_CHARACTERS },
    cost: { perImage: 0.21 }, // 210 units
  },
  recraftv4_1_utility_pro_vector: {
    ...base,
    id: "recraftv4_1_utility_pro_vector",
    name: "Recraft V4.1 Utility Pro Vector",
    limit: { context: 0, characters: V4_PROMPT_CHARACTERS },
    cost: { perImage: 0.3 }, // 300 units
  },
  recraftv4: {
    ...base,
    id: "recraftv4",
    name: "Recraft V4",
    limit: { context: 0, characters: V4_PROMPT_CHARACTERS },
    cost: { perImage: 0.04 }, // 40 units
  },
  recraftv4_vector: {
    ...base,
    id: "recraftv4_vector",
    name: "Recraft V4 Vector",
    limit: { context: 0, characters: V4_PROMPT_CHARACTERS },
    cost: { perImage: 0.08 }, // 80 units
  },
  recraftv4_pro: {
    ...base,
    id: "recraftv4_pro",
    name: "Recraft V4 Pro",
    limit: { context: 0, characters: V4_PROMPT_CHARACTERS },
    cost: { perImage: 0.25 }, // 250 units
  },
  recraftv4_pro_vector: {
    ...base,
    id: "recraftv4_pro_vector",
    name: "Recraft V4 Pro Vector",
    limit: { context: 0, characters: V4_PROMPT_CHARACTERS },
    cost: { perImage: 0.3 }, // 300 units
  },
  recraftv3: {
    ...base,
    id: "recraftv3",
    name: "Recraft V3",
    limit: { context: 0, characters: V2_V3_PROMPT_CHARACTERS },
    cost: { perImage: 0.04 }, // 40 units
  },
  recraftv3_vector: {
    ...base,
    id: "recraftv3_vector",
    name: "Recraft V3 Vector",
    limit: { context: 0, characters: V2_V3_PROMPT_CHARACTERS },
    cost: { perImage: 0.08 }, // 80 units
  },
  recraftv2: {
    ...base,
    id: "recraftv2",
    name: "Recraft V2",
    limit: { context: 0, characters: V2_V3_PROMPT_CHARACTERS },
    cost: { perImage: 0.022 }, // 22 units
  },
  recraftv2_vector: {
    ...base,
    id: "recraftv2_vector",
    name: "Recraft V2 Vector",
    limit: { context: 0, characters: V2_V3_PROMPT_CHARACTERS },
    cost: { perImage: 0.044 }, // 44 units
  },
  // Recraft's own earlier open model. It is a known Recraft id — it appears in
  // the internal `TransformModel` enum
  // (https://external.api.recraft.ai/doc/spec/api/api.yaml) — but it is absent
  // from the endpoints page's `model` compatibility list, from the pricing
  // table and from the appendix, so it is cataloged (no `unknown_model` noise
  // for an id Recraft itself ships) with no cost (no estimate, no budget
  // check) and no prompt cap. That enum is not evidence the public
  // /v1/images endpoints accept it.
  recraft20b: {
    ...base,
    id: "recraft20b",
    name: "Recraft 20B",
    limit: { context: 0 },
  },
} as const satisfies Record<string, ModelInfo>;

export type RecraftModelId = keyof typeof models;

/**
 * `model` values the /v1/images/imageToImage route accepts — "Recraft V3 / V4
 * models (raster and vector)" per the endpoints doc's compatibility column.
 * V2 is excluded.
 */
export const IMAGE_TO_IMAGE_MODELS = [
  "recraftv3",
  "recraftv3_vector",
  "recraftv4",
  "recraftv4_vector",
  "recraftv4_pro",
  "recraftv4_pro_vector",
  "recraftv4_1",
  "recraftv4_1_vector",
  "recraftv4_1_pro",
  "recraftv4_1_pro_vector",
  "recraftv4_1_utility",
  "recraftv4_1_utility_vector",
  "recraftv4_1_utility_pro",
  "recraftv4_1_utility_pro_vector",
] as const satisfies readonly RecraftModelId[];

/**
 * `model` values the inpaint / outpaint / replaceBackground /
 * generateBackground routes accept — every one of them documents
 * "Must be one of: `recraftv3`, `recraftv3_vector`".
 */
export const V3_ONLY_MODELS = ["recraftv3", "recraftv3_vector"] as const satisfies
  readonly RecraftModelId[];
