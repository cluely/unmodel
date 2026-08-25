// Hand-maintained — the MAI image models are Microsoft-Foundry-only and not in
// models.dev; refresh from
//   https://learn.microsoft.com/en-us/azure/foundry/foundry-models/how-to/use-foundry-models-mai-image
//     (endpoints, request parameters, pixel rules, models-at-a-glance table)
//   https://learn.microsoft.com/en-us/azure/foundry/foundry-models/concepts/models-sold-directly-by-azure
//     (per-model capabilities: modalities, "Output: One image", PNG-only,
//      32,000-token context, `width`/`height`/`prompt` parameter list)
// Verified 2026-08-24.
//
// Catalog modeling: rows are keyed by the CANONICAL model names Microsoft
// deploys ("MAI-Image-2.5", version 2026-06-02, etc.), but the wire `model`
// field on the /mai/ surface carries the caller's user-chosen DEPLOYMENT
// name. The validators therefore wrap this table in
// `createDeploymentCatalog` (same doctrine as azure chat): deployments named
// after the underlying model resolve to these rows and get the full
// model-dependent checks; unrelated custom names get an `unknown_model`
// warning and model-dependent checks are skipped. Matching is case-sensitive,
// like azure chat's.
//
// All four models are (Preview) — `status: "beta"` is the closest ModelInfo
// arm. `MAI-Image-2e` is text-to-image only (the models-at-a-glance table
// lists it without "Image-to-image edits"); the 2.5 family supports both.
//
// `limit.context: 0` per HAND_CATALOGS.md — the endpoint is not token-metered
// on the request side and the pipeline must skip context-window checks. The
// documented prompt cap ("Maximum context length: 32,000 tokens") is carried
// as MAI_IMAGE_PROMPT_MAX_TOKENS below; it is a TOKEN cap, so it cannot be
// enforced as a `ModelLimit.characters` value without inventing a ratio.
//
// Pricing: deliberately absent. Microsoft publishes no per-image USD rate on
// learn.microsoft.com — MAI image billing is token-based (separate text-input
// / image-input / image-output rates surfaced only through the Azure pricing
// calculator, with third-party mirrors quoting conflicting numbers), and
// output-token counts are unknown before the call. `ModelCost.perImage` has
// no defensible value, so no `cost` is declared — an absent rate yields no
// estimate rather than a wrong one (same policy as openai's dall-e rows).

import type { ModelInfo } from "../../core/catalog-types";

/** The MAI how-to page — the `source:` URL every MAI image issue cites. */
export const MAI_IMAGE_DOCS =
  "https://learn.microsoft.com/en-us/azure/foundry/foundry-models/how-to/use-foundry-models-mai-image";

/** "Both `width` and `height` must be at least 768 pixels each." */
export const MAI_IMAGE_MIN_DIMENSION = 768;

/**
 * "The maximum total pixel count is 1,048,576 (equivalent to 1024×1024).
 * Either dimension can exceed 1024 as long as the total pixel count stays
 * within the limit."
 */
export const MAI_IMAGE_MAX_TOTAL_PIXELS = 1_048_576;

/**
 * "The text prompt that describes the image to generate or edits to make.
 * Maximum context length: 32,000 tokens." — a TOKEN cap, so it is published
 * here for callers but not enforced pre-call (token counts are unknowable
 * without the model's tokenizer).
 */
export const MAI_IMAGE_PROMPT_MAX_TOKENS = 32_000;

const base = {
  reasoning: false,
  toolCall: false,
  openWeights: false,
  family: "mai-image",
  status: "beta", // (Preview)
  limit: { context: 0 },
} as const;

/** The 2.5 family: text-to-image generation AND image-to-image edits. */
const editCapable = {
  ...base,
  attachment: true,
  modalities: { input: ["text", "image"], output: ["image"] },
} as const;

export const maiImageModels = {
  "MAI-Image-2.5": {
    ...editCapable,
    id: "MAI-Image-2.5",
    name: "MAI-Image-2.5",
    releaseDate: "2026-06-02", // model version
  },
  "MAI-Image-2.5-Pro": {
    ...editCapable,
    id: "MAI-Image-2.5-Pro",
    name: "MAI-Image-2.5-Pro",
    releaseDate: "2026-06-19", // model version
  },
  "MAI-Image-2.5-Flash": {
    ...editCapable,
    id: "MAI-Image-2.5-Flash",
    name: "MAI-Image-2.5-Flash",
    releaseDate: "2026-06-02", // model version
  },
  "MAI-Image-2e": {
    ...base,
    id: "MAI-Image-2e",
    name: "MAI-Image-2e",
    releaseDate: "2026-04-09", // model version
    // Text-to-image generation only — the models-at-a-glance table lists no
    // "Image-to-image edits" for it, so /mai/v1/images/edits refuses it.
    attachment: false,
    modalities: { input: ["text"], output: ["image"] },
  },
} as const satisfies Record<string, ModelInfo>;

/** Canonical MAI image model names — catalog keys, not deployment names. */
export type AzureMaiImageModelId = keyof typeof maiImageModels;

/** The models `/mai/v1/images/edits` documents (the 2.5 family; not 2e). */
export type AzureMaiImageEditModelId = Exclude<AzureMaiImageModelId, "MAI-Image-2e">;

/** Every model `/mai/v1/images/generations` documents. */
export const MAI_IMAGE_MODEL_IDS = [
  "MAI-Image-2.5",
  "MAI-Image-2.5-Pro",
  "MAI-Image-2.5-Flash",
  "MAI-Image-2e",
] as const satisfies readonly AzureMaiImageModelId[];

/** Every model `/mai/v1/images/edits` documents — "MAI-Image-2e" is absent. */
export const MAI_IMAGE_EDIT_MODEL_IDS = [
  "MAI-Image-2.5",
  "MAI-Image-2.5-Pro",
  "MAI-Image-2.5-Flash",
] as const satisfies readonly AzureMaiImageEditModelId[];
