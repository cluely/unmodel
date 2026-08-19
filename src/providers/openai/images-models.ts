// Hand-maintained supplement — models.dev tracks only the `gpt-image-*` ids,
// so the image ids the Images API still documents (`dall-e-2`, `dall-e-3` and
// the dated `gpt-image-2` snapshot) are added here. Refresh from
//   https://developers.openai.com/api/docs/api-reference/images/create     (model ids, prompt caps)
//   https://developers.openai.com/api/docs/api-reference/images/createEdit (edit-only model ids)
//   https://developers.openai.com/api/docs/guides/image-generation         (per-model capabilities)
//   https://developers.openai.com/api/docs/pricing                         (token rates)
// Verified 2026-08-13.
//
// Prompt caps (`ModelLimit.characters`) are documented verbatim on the create
// reference: "The maximum length is 32000 characters for the GPT image
// models, 1000 characters for `dall-e-2` and 4000 characters for `dall-e-3`."
// The generated entries carry no `characters` limit, so this file re-adds it
// (same merge pattern as src/providers/google/veo-models.ts).
//
// Pricing: the pricing page lists per-token rates for the GPT image models
// only (already on the generated entries). It publishes NO dall-e rates, so
// the dall-e entries deliberately carry no `cost` — an absent rate yields no
// estimate rather than a wrong one.

import type { ModelInfo } from "../../core/catalog-types";
import { models } from "../../catalog/openai.gen";

/** Prompt cap for the GPT image models — images/create reference. */
export const GPT_IMAGE_PROMPT_MAX_CHARACTERS = 32_000;
/** Prompt cap for dall-e-2 — images/create + images/createEdit reference. */
export const DALL_E_2_PROMPT_MAX_CHARACTERS = 1_000;
/** Prompt cap for dall-e-3 — images/create reference. */
export const DALL_E_3_PROMPT_MAX_CHARACTERS = 4_000;

const withPromptCap = <T extends ModelInfo>(info: T, characters: number) => ({
  ...info,
  limit: { ...info.limit, characters },
});

/**
 * Image ids the Images API documents but models.dev does not track.
 * `gpt-image-2-2026-04-21` is the dated snapshot of gpt-image-2 (same
 * capabilities and rates — the pricing page prices the family, not the
 * snapshot).
 */
export const imagesSupplementModels = {
  "gpt-image-2-2026-04-21": {
    ...withPromptCap(models["gpt-image-2"], GPT_IMAGE_PROMPT_MAX_CHARACTERS),
    id: "gpt-image-2-2026-04-21",
    name: "gpt-image-2 (2026-04-21)",
    releaseDate: "2026-04-21",
  },
  "dall-e-3": {
    id: "dall-e-3",
    name: "DALL·E 3",
    family: "dall-e",
    // dall-e-3 is generation-only; the edits endpoint does not accept it.
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text"], output: ["image"] },
    // Flat per-image pricing; the pricing page publishes no dall-e rate, so
    // no `cost` is declared (see header).
    limit: { context: 0, characters: DALL_E_3_PROMPT_MAX_CHARACTERS },
  },
  "dall-e-2": {
    id: "dall-e-2",
    name: "DALL·E 2",
    family: "dall-e",
    // dall-e-2 accepts an input image on /v1/images/edits.
    attachment: true,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text", "image"], output: ["image"] },
    limit: { context: 0, characters: DALL_E_2_PROMPT_MAX_CHARACTERS },
  },
} as const satisfies Record<string, ModelInfo>;

/**
 * The catalog both image endpoints validate against: the generated openai
 * catalog, with prompt caps re-added to the GPT image entries and the
 * documented dall-e / snapshot ids merged in.
 */
export const imagesModels: Record<string, ModelInfo> = {
  ...models,
  "gpt-image-1": withPromptCap(models["gpt-image-1"], GPT_IMAGE_PROMPT_MAX_CHARACTERS),
  "gpt-image-1-mini": withPromptCap(models["gpt-image-1-mini"], GPT_IMAGE_PROMPT_MAX_CHARACTERS),
  "gpt-image-1.5": withPromptCap(models["gpt-image-1.5"], GPT_IMAGE_PROMPT_MAX_CHARACTERS),
  "gpt-image-2": withPromptCap(models["gpt-image-2"], GPT_IMAGE_PROMPT_MAX_CHARACTERS),
  "chatgpt-image-latest": withPromptCap(
    models["chatgpt-image-latest"],
    GPT_IMAGE_PROMPT_MAX_CHARACTERS,
  ),
  ...imagesSupplementModels,
};

/** Image ids added by hand (absent from the generated catalog). */
export type OpenaiImagesSupplementModelId = keyof typeof imagesSupplementModels;
