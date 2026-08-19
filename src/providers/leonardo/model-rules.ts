/**
 * Per-model rule tables for `POST /v2/generations`.
 *
 * Leonardo's v2 request body is a discriminated union: `model` selects one of
 * ~74 `…GenerationRequest` schemas, each with its OWN `parameters` object.
 * Because the differing params are nested under `parameters` (not top-level),
 * they cannot ride on the pipeline's generic `EndpointConstraints` deny/enum
 * tables — this file holds the equivalent data and generations.ts applies it.
 *
 * Ground truth: the OpenAPI v2 spec embedded in
 * https://docs.leonardo.ai/reference/creategeneration-1 (fetch the raw
 * document as `…/creategeneration-1.md`), cross-checked against the prose
 * tables on https://docs.leonardo.ai/docs/lucid-origin and
 * https://docs.leonardo.ai/docs/phoenix. Verified 2026-08-13.
 *
 * Only Leonardo's own image models are tabled here. The same endpoint also
 * routes ~60 third-party models (FLUX, Imagen, Seedream, Veo, Kling, …) and
 * Leonardo's video/audio/3D models; those belong to their own providers'
 * catalogs and each carries a different `parameters` schema, so unmodel treats
 * them as unknown models on this endpoint (warning + no per-param checks)
 * rather than pretending to validate them.
 */

export const LEONARDO_DOCS_URL = "https://docs.leonardo.ai/reference/creategeneration-1";

/**
 * The Lucid Origin prose page. Cite this — not the OpenAPI reference — for the
 * limits that exist only in Leonardo's written parameter tables. The Phoenix
 * page (https://docs.leonardo.ai/docs/phoenix) repeats the same wording.
 */
export const LEONARDO_STYLE_LIMIT_DOCS_URL = "https://docs.leonardo.ai/docs/lucid-origin";

/** `prompt_enhance` — identical across Leonardo's image models. */
export const LEONARDO_PROMPT_ENHANCE = ["AUTO", "ON", "OFF"] as const;
export type LeonardoPromptEnhance = (typeof LEONARDO_PROMPT_ENHANCE)[number];

/** `contrast` — Phoenix only. */
export const LEONARDO_CONTRASTS = ["LOW", "MEDIUM", "HIGH"] as const;
export type LeonardoContrast = (typeof LEONARDO_CONTRASTS)[number];

/** `image.type` on a guidance reference. */
export const LEONARDO_IMAGE_TYPES = [
  "INIT",
  "GENERATION",
  "UPLOADED",
  "GENERATED",
  "VARIATION",
] as const;
export type LeonardoImageType = (typeof LEONARDO_IMAGE_TYPES)[number];

/** Strength scale for style guidance (two extra steps beyond the others). */
export const LEONARDO_STYLE_STRENGTHS = ["LOW", "MID", "HIGH", "ULTRA", "MAX"] as const;
/** Strength scale for content / character / image_to_image guidance. */
export const LEONARDO_GUIDANCE_STRENGTHS = ["LOW", "MID", "HIGH"] as const;
export type LeonardoStyleStrength = (typeof LEONARDO_STYLE_STRENGTHS)[number];
export type LeonardoGuidanceStrength = (typeof LEONARDO_GUIDANCE_STRENGTHS)[number];

/**
 * "Array of style UUIDs used to apply a preset style to the output (limited to
 * 1 style)." — the prose parameter tables on LEONARDO_STYLE_LIMIT_DOCS_URL and
 * the Phoenix page.
 *
 * ADVISORY, not a wire constraint. The OpenAPI document embedded in
 * LEONARDO_DOCS_URL gives `style_ids` an `items.enum` but NO `maxItems` (210
 * `maxItems` occurrences in that document, none of them on any of the 58
 * `style_ids` schemas), so the API accepts a longer array. generations.ts
 * therefore reports going over this as a WARNING, and cites the prose page —
 * the reference page does not support the claim.
 */
export const LEONARDO_MAX_STYLE_IDS = 1;

const LUCID_ORIGIN_STYLE_IDS = [
  "a5632c7c-ddbb-4e2f-ba34-8456ab3ac436",
  "6fedbf1f-4a17-45ec-84fb-92fe524a29ef",
  "111dc692-d470-4eec-b791-3475abac4c46",
  "594c4a08-a522-4e0e-b7ff-e4dac4b6b622",
  "ab5a4220-7c42-41e5-a578-eddb9fed3d75",
  "5bdc3f2a-1be6-4d1c-8e77-992a30824a2c",
  "dee282d3-891f-4f73-ba02-7f8131e5541b",
  "556c1ee5-ec38-42e8-955a-1e82dad0ffa1",
] as const;

const LUCID_REALISM_STYLE_IDS = [
  "9fdc5e8c-4d13-49b4-9ce6-5a74cbb19177",
  "a5632c7c-ddbb-4e2f-ba34-8456ab3ac436",
  "cc53f935-884c-40a0-b7eb-1f5c42821fb5",
  "6fedbf1f-4a17-45ec-84fb-92fe524a29ef",
  "111dc692-d470-4eec-b791-3475abac4c46",
  "594c4a08-a522-4e0e-b7ff-e4dac4b6b622",
  "85da2dcc-c373-464c-9a7a-5624359be859",
  "d574325d-1278-4fe2-974b-768525f253c3",
  "97c20e5c-1af6-4d42-b227-54d03d8f0727",
  "335e6010-a75c-45d9-afc5-032c65e9180e",
  "30c1d34f-e3a9-479a-b56f-c018bbc9c02a",
  "cadc8cd6-7838-4c99-b645-df76be8ba8d8",
  "a2f7ea66-959b-4bbe-b508-6133238b76b6",
  "621e1c9a-6319-4bee-a12d-ae40659162fa",
  "0d914779-c822-430a-b976-30075033f1c4",
  "ab5a4220-7c42-41e5-a578-eddb9fed3d75",
  "6105baa2-851b-446e-9db5-08a671a8c42f",
  "5bdc3f2a-1be6-4d1c-8e77-992a30824a2c",
  "62736842-6e4b-4028-b79a-4f1a1606e893",
  "dee282d3-891f-4f73-ba02-7f8131e5541b",
  "556c1ee5-ec38-42e8-955a-1e82dad0ffa1",
] as const;

/** Phoenix 1.0 and 0.9 "accept the same set of style UUIDs". */
const PHOENIX_STYLE_IDS = [
  "debdf72a-91a4-467b-bf61-cc02bdeb69c6",
  "9fdc5e8c-4d13-49b4-9ce6-5a74cbb19177",
  "a5632c7c-ddbb-4e2f-ba34-8456ab3ac436",
  "33abbb99-03b9-4dd7-9761-ee98650b2c88",
  "6fedbf1f-4a17-45ec-84fb-92fe524a29ef",
  "111dc692-d470-4eec-b791-3475abac4c46",
  "594c4a08-a522-4e0e-b7ff-e4dac4b6b622",
  "2e74ec31-f3a4-4825-b08b-2894f6d13941",
  "1fbb6a68-9319-44d2-8d56-2957ca0ece6a",
  "645e4195-f63d-4715-a3f2-3fb1e6eb8c70",
  "30c1d34f-e3a9-479a-b56f-c018bbc9c02a",
  "cadc8cd6-7838-4c99-b645-df76be8ba8d8",
  "621e1c9a-6319-4bee-a12d-ae40659162fa",
  "ab5a4220-7c42-41e5-a578-eddb9fed3d75",
  "22a9a7d2-2166-4d86-80ff-22e2643adbcf",
  "7c3f932b-a572-47cb-9b9b-f20211e63b5b",
  "581ba6d6-5aac-4492-bebe-54c424a0d46e",
  "b504f83c-3326-4947-82e1-7fe9e839ec0f",
  "be8c6b58-739c-4d44-b9c1-b032ed308b61",
  "093accc3-7633-4ffd-82da-d34000dfc0d6",
  "5bdc3f2a-1be6-4d1c-8e77-992a30824a2c",
  "dee282d3-891f-4f73-ba02-7f8131e5541b",
  "556c1ee5-ec38-42e8-955a-1e82dad0ffa1",
] as const;

/** "Dynamic" — the documented default for `style_ids`. */
export const LEONARDO_DEFAULT_STYLE_ID = "111dc692-d470-4eec-b791-3475abac4c46";

export interface LeonardoDimensionRule {
  min: number;
  max: number;
  /** `multipleOf` — every image model sizes in multiples of 8. */
  multipleOf: number;
}

export interface LeonardoGuidanceRule {
  maxItems: number;
  strengths: readonly string[];
}

export interface LeonardoModelRule {
  /** `mode` enum — "Use this instead of `quality` for all proprietary models!" */
  modes: readonly string[];
  width: LeonardoDimensionRule;
  height: LeonardoDimensionRule;
  promptMaxLength: number;
  negativePromptMaxLength?: number;
  quantity: { min: number; max: number };
  seed: { min: number; max?: number };
  /** Guidance kinds this model accepts, with their per-kind limits. */
  guidances: Readonly<Record<string, LeonardoGuidanceRule>>;
  styleIds: readonly string[];
  /** Every key this model's `parameters` object accepts. */
  parameters: readonly string[];
}

const IMAGE_GUIDANCE = {
  style: { maxItems: 1, strengths: LEONARDO_STYLE_STRENGTHS },
  content: { maxItems: 1, strengths: LEONARDO_GUIDANCE_STRENGTHS },
} as const;

const PHOENIX_GUIDANCE = {
  style: { maxItems: 4, strengths: LEONARDO_STYLE_STRENGTHS },
  content: { maxItems: 1, strengths: LEONARDO_GUIDANCE_STRENGTHS },
  character: { maxItems: 1, strengths: LEONARDO_GUIDANCE_STRENGTHS },
  image_to_image: { maxItems: 1, strengths: LEONARDO_GUIDANCE_STRENGTHS },
} as const;

const LUCID_PARAMETERS = [
  "mode",
  "seed",
  "width",
  "height",
  "prompt",
  "quantity",
  "guidances",
  "style_ids",
  "prompt_enhance",
] as const;

const PHOENIX_PARAMETERS = [
  ...LUCID_PARAMETERS,
  "tiling",
  "contrast",
  "negative_prompt",
] as const;

const PHOENIX_RULE: LeonardoModelRule = {
  modes: ["FAST", "QUALITY", "ULTRA"],
  width: { min: 32, max: 2048, multipleOf: 8 },
  height: { min: 32, max: 2048, multipleOf: 8 },
  promptMaxLength: 2000,
  negativePromptMaxLength: 1000,
  quantity: { min: 1, max: 8 },
  seed: { min: 0 },
  guidances: PHOENIX_GUIDANCE,
  styleIds: PHOENIX_STYLE_IDS,
  parameters: PHOENIX_PARAMETERS,
};

export const LEONARDO_MODEL_RULES: Readonly<Record<string, LeonardoModelRule>> = {
  "lucid-origin": {
    modes: ["FAST", "ULTRA"],
    width: { min: 16, max: 3840, multipleOf: 8 },
    height: { min: 16, max: 3616, multipleOf: 8 },
    promptMaxLength: 2000,
    quantity: { min: 1, max: 8 },
    seed: { min: 0, max: 2147483647 },
    guidances: IMAGE_GUIDANCE,
    styleIds: LUCID_ORIGIN_STYLE_IDS,
    parameters: LUCID_PARAMETERS,
  },
  "lucid-realism": {
    modes: ["FAST", "ULTRA"],
    width: { min: 16, max: 2496, multipleOf: 8 },
    height: { min: 16, max: 2496, multipleOf: 8 },
    // Lucid Realism is the outlier: its schema allows a 9999-character prompt.
    promptMaxLength: 9999,
    quantity: { min: 1, max: 8 },
    seed: { min: 0, max: 2147483647 },
    guidances: IMAGE_GUIDANCE,
    styleIds: LUCID_REALISM_STYLE_IDS,
    parameters: LUCID_PARAMETERS,
  },
  "phoenix-v1.0": PHOENIX_RULE,
  "phoenix-v0.9": PHOENIX_RULE,
};

/** Every parameter key any tabled model accepts — used to phrase messages. */
export const LEONARDO_KNOWN_PARAMETERS: readonly string[] = [...PHOENIX_PARAMETERS];
