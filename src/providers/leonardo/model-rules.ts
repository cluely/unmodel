/**
 * Per-model rule tables for `POST /v2/generations`.
 *
 * Leonardo's v2 request body is a discriminated union: `model` selects one of
 * ~74 `…GenerationRequest` schemas, each with its OWN `parameters` object.
 * Because the differing params are nested under `parameters` (not top-level),
 * they cannot ride on the pipeline's generic `EndpointConstraints` deny/enum
 * tables — this file holds the equivalent data and image.ts applies it.
 *
 * Ground truth: the OpenAPI v2 spec embedded in
 * https://docs.leonardo.ai/reference/creategeneration-1 (fetch the raw
 * document as `…/creategeneration-1.md`), cross-checked against the prose
 * tables on https://docs.leonardo.ai/docs/lucid-origin and
 * https://docs.leonardo.ai/docs/phoenix. Verified 2026-08-13.
 *
 * Tabled here: the Lucid and Phoenix models, and the nine Elements models
 * (`kino-xl` … `lightning-xl`, see ELEMENTS_PARAMETERS) — image models no other
 * provider in unmodel serves. The same endpoint also routes ~60 third-party
 * models (FLUX, Imagen, Seedream, Veo, Kling, …) and Leonardo's
 * video/audio/3D models; those belong to their own providers' catalogs and
 * each carries a different `parameters` schema, so unmodel treats them as
 * unknown models on this endpoint (warning + no per-param checks) rather than
 * pretending to validate them.
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

/** `contrast` — Phoenix and the Elements models. */
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
/** Strength scale for every guidance kind but `style`. */
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
 * `style_ids` schemas), so the API accepts a longer array. image.ts
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

// The Elements models' allowlists, each the `style_ids.items.enum` of its own
// `…GenerationRequest` schema on https://docs.leonardo.ai/reference/creategeneration
// (read 2026-11-12; `"title": "Style IDs for Image Models"`), in the published
// order. kino-xl's `d574325d-1278-43fc-9159-e8ff2154e9f7` is not Lucid
// Realism's `d574325d-1278-4fe2-974b-768525f253c3`; both are transcribed
// exactly as published.

const KINO_XL_STYLE_IDS = [
  "a5632c7c-ddbb-4e2f-ba34-8456ab3ac436",
  "9fdc5e8c-4d13-49b4-9ce6-5a74cbb19177",
  "cc53f935-884c-40a0-b7eb-1f5c42821fb5",
  "6fedbf1f-4a17-45ec-84fb-92fe524a29ef",
  "594c4a08-a522-4e0e-b7ff-e4dac4b6b622",
  "85da2dcc-c373-464c-9a7a-5624359be859",
  "d574325d-1278-43fc-9159-e8ff2154e9f7",
  "97c20e5c-1af6-4d42-b227-54d03d8f0727",
  "b220bdb6-1378-43fc-9159-e8ff2154e9f7",
  "30c1d34f-e3a9-479a-b56f-c018bbc9c02a",
  "cadc8cd6-7838-4c99-b645-df76be8ba8d8",
  "a2f7ea66-959b-4bbe-b508-6133238b76b6",
  "621e1c9a-6319-4bee-a12d-ae40659162fa",
  "0d914779-c822-430a-b976-30075033f1c4",
  "6105baa2-851b-446e-9db5-08a671a8c42f",
  "5bdc3f2a-1be6-4d1c-8e77-992a30824a2c",
  "62736842-6e4b-4028-b79a-4f1a1606e893",
  "dee282d3-891f-4f73-ba02-7f8131e5541b",
  "111dc692-d470-4eec-b791-3475abac4c46",
  "ab5a4220-7c42-41e5-a578-eddb9fed3d75",
  "556c1ee5-ec38-42e8-955a-1e82dad0ffa1",
] as const;

const ANIME_XL_STYLE_IDS = [
  "32b653d2-8819-4363-bc82-a6466dfcb825",
  "5f611024-668e-41cc-b538-4569a7985cad",
  "df2def02-1104-46c8-a857-39292fcd9091",
  "aab2fcb9-3600-4039-9c25-a2a26515df5f",
  "1824f984-dc0b-4f72-aa32-0442091d488c",
  "16818741-bdbb-474f-a7a8-1e33d706658e",
  "bf0b8b5f-735f-4141-a365-8d8aa78fd147",
  "5d256598-5671-424c-8152-27943f1000f1",
  "726585f5-d231-4a3a-bee9-9a5e5d3df779",
  "b2a54a51-230b-4d4f-ad4e-8409bf58645f",
  "ca934804-ef39-4e1b-af37-608021452444",
  "e89ca6f0-7653-4db6-8a24-ded9d1267d84",
] as const;

const PORTRAIT_PERFECT_STYLE_IDS = [
  "4edb03c9-8a26-4041-9d01-f85b5d4abd71",
  "d4fb14b9-972b-4215-b461-616a51b6eeb8",
  "c9b08088-f497-4e30-b258-6d535d928cc5",
  "0717967c-1a32-4c67-bc56-b020e97b1b81",
  "39a14739-5d21-420b-a4ef-e8a80978185a",
  "3e645868-7d35-4b8c-974c-10bd8c2de972",
  "0d34f8e1-46d4-428f-8ddd-4b11811fa7c9",
  "556c1ee5-ec38-42e8-955a-1e82dad0ffa1",
] as const;

const STOCK_PHOTOGRAPHY_STYLE_IDS = [
  "5bdc3f2a-1be6-4d1c-8e77-992a30824a2c",
  "556c1ee5-ec38-42e8-955a-1e82dad0ffa1",
] as const;

const ILLUSTRATIVE_ALBEDO_STYLE_IDS = [
  "645e4195-f63d-4715-a3f2-3fb1e6eb8c70",
  "debdf72a-91a4-467b-bf61-cc02bdeb69c6",
  "b504f83c-3326-4947-82e1-7fe9e839ec0f",
  "6e13a467-7dde-415a-8020-0ce2b27bc4e8",
  "621e1c9a-6319-4bee-a12d-ae40659162fa",
  "ab5a4220-7c42-41e5-a578-eddb9fed3d75",
  "b2a54a51-230b-4d4f-ad4e-8409bf58645f",
  "e4d8224a-d804-4b00-b383-b1f3213b9faf",
  "5e931eed-1ab9-48a0-aad0-ea5c7d13d472",
  "cadc8cd6-7838-4c99-b645-df76be8ba8d8",
  "d574325d-1278-4fe2-974b-768525f253c3",
  "fed4e15f-84b3-4f6e-9b20-9d3a3798eab8",
  "be8c6b58-739c-4d44-b9c1-b032ed308b61",
  "093accc3-7633-4ffd-82da-d34000dfc0d6",
  "111dc692-d470-4eec-b791-3475abac4c46",
  "556c1ee5-ec38-42e8-955a-1e82dad0ffa1",
] as const;

const CONCEPT_ART_STYLE_IDS = [
  "726585f5-d231-4a3a-bee9-9a5e5d3df779",
  "5d256598-5671-424c-8152-27943f1000f1",
  "09d2b5b5-d7c5-4c02-905d-9f84051640f4",
  "6e13a467-7dde-415a-8020-0ce2b27bc4e8",
  "33abbb99-03b9-4dd7-9761-ee98650b2c88",
  "fed4e15f-84b3-4f6e-9b20-9d3a3798eab8",
  "5e931eed-1ab9-48a0-aad0-ea5c7d13d472",
  "e4d8224a-d804-4b00-b383-b1f3213b9faf",
] as const;

const LIFELIKE_VISION_STYLE_IDS = [
  "6fedbf1f-4a17-45ec-84fb-92fe524a29ef",
  "debdf72a-91a4-467b-bf61-cc02bdeb69c6",
  "a5632c7c-ddbb-4e2f-ba34-8456ab3ac436",
  "ab5a4220-7c42-41e5-a578-eddb9fed3d75",
  "645e4195-f63d-4715-a3f2-3fb1e6eb8c70",
  "594c4a08-a522-4e0e-b7ff-e4dac4b6b622",
  "dee282d3-891f-4f73-ba02-7f8131e5541b",
  "b504f83c-3326-4947-82e1-7fe9e839ec0f",
  "6105baa2-851b-446e-9db5-08a671a8c42f",
  "621e1c9a-6319-4bee-a12d-ae40659162fa",
  "a2f7ea66-959b-4bbe-b508-6133238b76b6",
  "cadc8cd6-7838-4c99-b645-df76be8ba8d8",
  "30c1d34f-e3a9-479a-b56f-c018bbc9c02a",
  "b220bdb6-1378-43fc-9159-e8ff2154e9f7",
  "85da2dcc-c373-464c-9a7a-5624359be859",
  "97c20e5c-1af6-4d42-b227-54d03d8f0727",
  "cc53f935-884c-40a0-b7eb-1f5c42821fb5",
  "9fdc5e8c-4d13-49b4-9ce6-5a74cbb19177",
  "111dc692-d470-4eec-b791-3475abac4c46",
  "556c1ee5-ec38-42e8-955a-1e82dad0ffa1",
] as const;

const GRAPHIC_DESIGN_STYLE_IDS = [
  "703d6fe5-7f1c-4a9e-8da0-5331f214d5cf",
  "7d7c2bc5-4b12-4ac3-81a9-630057e9e89f",
  "1fbb6a68-9319-44d2-8d56-2957ca0ece6a",
  "2e74ec31-f3a4-4825-b08b-2894f6d13941",
  "556c1ee5-ec38-42e8-955a-1e82dad0ffa1",
  "785d778b-cdd3-4cf5-8ec1-d6e995254077",
  "ee13fe69-c387-4728-b274-de390a067200",
] as const;

const LIGHTNING_XL_STYLE_IDS = [
  "a5632c7c-ddbb-4e2f-ba34-8456ab3ac436",
  "dee282d3-891f-4f73-ba02-7f8131e5541b",
  "645e4195-f63d-4715-a3f2-3fb1e6eb8c70",
  "6fedbf1f-4a17-45ec-84fb-92fe524a29ef",
  "594c4a08-a522-4e0e-b7ff-e4dac4b6b622",
  "5bdc3f2a-1be6-4d1c-8e77-992a30824a2c",
  "ab5a4220-7c42-41e5-a578-eddb9fed3d75",
  "debdf72a-91a4-467b-bf61-cc02bdeb69c6",
  "b504f83c-3326-4947-82e1-7fe9e839ec0f",
  "62736842-6e4b-4028-b79a-4f1a1606e893",
  "6105baa2-851b-446e-9db5-08a671a8c42f",
  "0d914779-c822-430a-b976-30075033f1c4",
  "a2f7ea66-959b-4bbe-b508-6133238b76b6",
  "621e1c9a-6319-4bee-a12d-ae40659162fa",
  "cadc8cd6-7838-4c99-b645-df76be8ba8d8",
  "d574325d-1278-4fe2-974b-768525f253c3",
  "85da2dcc-c373-464c-9a7a-5624359be859",
  "9fdc5e8c-4d13-49b4-9ce6-5a74cbb19177",
  "be8c6b58-739c-4d44-b9c1-b032ed308b61",
  "093accc3-7633-4ffd-82da-d34000dfc0d6",
  "111dc692-d470-4eec-b791-3475abac4c46",
  "556c1ee5-ec38-42e8-955a-1e82dad0ffa1",
] as const;

/**
 * "Dynamic" — the documented `style_ids` default on the Lucid and Phoenix
 * models, `lifelike-vision` and `lightning-xl`. The other Elements models each
 * default to a style of their own (`"default"` on their `style_ids` schema).
 */
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

/**
 * The Elements models — `kino-xl`, `anime-xl`, `portrait-perfect`,
 * `stock-photography`, `illustrative-albedo`, `concept-art`,
 * `lifelike-vision`, `graphic-design`, `lightning-xl` — share one `parameters`
 * shape. Read 2026-11-12 from their nine `…GenerationRequest` schemas on
 * https://docs.leonardo.ai/reference/creategeneration (OpenAPI updatedAt
 * 2026-09-01): Phoenix's twelve keys plus
 * - `transparency` — "Whether the image can be generated with a transparent background";
 * - `user_elements` — "An array of User Elements for image generation.";
 * - `platform_elements` — "An array of Platform Elements for image generation."
 *
 * Named for those two arrays, which no other tabled model takes. No vendor
 * page names who trained these models or a family for them.
 */
const ELEMENTS_PARAMETERS = [
  ...PHOENIX_PARAMETERS,
  "transparency",
  "user_elements",
  "platform_elements",
] as const;

/**
 * `user_elements` / `platform_elements` — `"maxItems": 4` on both, on every
 * Elements schema. Their items declare only `weight` (`"minimum": 0`) and no id
 * key, so that is all image.ts checks inside an entry.
 */
export const LEONARDO_MAX_ELEMENTS = 4;

/**
 * Eight guidance kinds on every Elements schema: Phoenix's four plus `edge`
 * ("Detects edges of any input image, and will use this to guide your image
 * generation."), `pose`, `depth` and `text_image` ("Takes in white text on a
 * black background, and will use this to guide your image generation."), each
 * `"maxItems": 1` except `style` (4).
 */
const ELEMENTS_GUIDANCE = {
  ...PHOENIX_GUIDANCE,
  edge: { maxItems: 1, strengths: LEONARDO_GUIDANCE_STRENGTHS },
  pose: { maxItems: 1, strengths: LEONARDO_GUIDANCE_STRENGTHS },
  depth: { maxItems: 1, strengths: LEONARDO_GUIDANCE_STRENGTHS },
  text_image: { maxItems: 1, strengths: LEONARDO_GUIDANCE_STRENGTHS },
} as const;

/**
 * Everything the nine Elements schemas agree on: `mode` FAST | QUALITY (no
 * ULTRA), height 32–1536, a 9999-character prompt, `negative_prompt` ≤ 1000,
 * quantity 1–8 and a seed with `"minimum": 0` and no maximum. Width (1536 or
 * 1584) and the style allowlist are per model.
 */
const ELEMENTS_RULE_BASE = {
  modes: ["FAST", "QUALITY"],
  height: { min: 32, max: 1536, multipleOf: 8 },
  promptMaxLength: 9999,
  negativePromptMaxLength: 1000,
  quantity: { min: 1, max: 8 },
  seed: { min: 0 },
  guidances: ELEMENTS_GUIDANCE,
  parameters: ELEMENTS_PARAMETERS,
} as const;

/** `"maximum": 1536` on width — kino-xl, portrait-perfect, stock-photography. */
const ELEMENTS_WIDTH_1536 = { min: 32, max: 1536, multipleOf: 8 } as const;
/** `"maximum": 1584` on width — the other six Elements models. */
const ELEMENTS_WIDTH_1584 = { min: 32, max: 1584, multipleOf: 8 } as const;

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
  "kino-xl": { ...ELEMENTS_RULE_BASE, width: ELEMENTS_WIDTH_1536, styleIds: KINO_XL_STYLE_IDS },
  "anime-xl": { ...ELEMENTS_RULE_BASE, width: ELEMENTS_WIDTH_1584, styleIds: ANIME_XL_STYLE_IDS },
  "portrait-perfect": {
    ...ELEMENTS_RULE_BASE,
    width: ELEMENTS_WIDTH_1536,
    styleIds: PORTRAIT_PERFECT_STYLE_IDS,
  },
  "stock-photography": {
    ...ELEMENTS_RULE_BASE,
    width: ELEMENTS_WIDTH_1536,
    styleIds: STOCK_PHOTOGRAPHY_STYLE_IDS,
  },
  "illustrative-albedo": {
    ...ELEMENTS_RULE_BASE,
    width: ELEMENTS_WIDTH_1584,
    styleIds: ILLUSTRATIVE_ALBEDO_STYLE_IDS,
  },
  "concept-art": {
    ...ELEMENTS_RULE_BASE,
    width: ELEMENTS_WIDTH_1584,
    styleIds: CONCEPT_ART_STYLE_IDS,
  },
  "lifelike-vision": {
    ...ELEMENTS_RULE_BASE,
    width: ELEMENTS_WIDTH_1584,
    styleIds: LIFELIKE_VISION_STYLE_IDS,
  },
  "graphic-design": {
    ...ELEMENTS_RULE_BASE,
    width: ELEMENTS_WIDTH_1584,
    styleIds: GRAPHIC_DESIGN_STYLE_IDS,
  },
  "lightning-xl": {
    ...ELEMENTS_RULE_BASE,
    width: ELEMENTS_WIDTH_1584,
    styleIds: LIGHTNING_XL_STYLE_IDS,
  },
};

/** Every parameter key any tabled model accepts — used to phrase messages. */
export const LEONARDO_KNOWN_PARAMETERS: readonly string[] = [...ELEMENTS_PARAMETERS];
