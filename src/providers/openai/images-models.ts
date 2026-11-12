// Hand-maintained supplement — models.dev tracks only the `gpt-image-*` ids it
// has rows for, so the image ids the Images API documents beyond those
// (`dall-e-2`, `dall-e-3`, the dated `gpt-image-2` snapshot, and the
// GPT-Image-2.5 / 2.6 Sunburst and Flare families) are added here. Refresh from
//   https://developers.openai.com/api/reference/resources/images/methods/generate.md (model ids, prompt caps)
//   https://developers.openai.com/api/reference/resources/images/methods/edit.md     (edit-only model ids)
//   https://developers.openai.com/api/docs/guides/image-generation                   (per-model capabilities)
//   https://developers.openai.com/api/docs/pricing                                    (token rates)
// Verified 2026-11-12.
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
 * The GPT-Image-2.5 and 2.6 Sunburst/Flare rows share one shape and one rate
 * card. Rates, read off https://developers.openai.com/api/docs/pricing on
 * 2026-11-12: "| gpt-image-2.5-flare | Image | $8.00 | $30.00 | $2.00 |" and
 * "| gpt-image-2.6-sunburst | Image | $8.00 | $30.00 | $2.00 |" (image input /
 * image output / cached image input), with the text rates from the
 * image-generation guide: "$30 per million image output tokens, $5 per million
 * text input tokens, and $1.25 per million cached text input tokens." The
 * mapping below is the one models.dev already uses for `gpt-image-2`
 * (`input` = text input, `cacheRead` = cached text input, `output` = image
 * output); `ModelCost` has no field for the $8 / $2 image-input rates, so they
 * are documented here rather than invented into another field.
 */
const GPT_IMAGE_SUNBURST_FLARE_BASE = {
  family: "gpt-image",
  attachment: true,
  reasoning: false,
  toolCall: false,
  temperature: false,
  openWeights: false,
  modalities: { input: ["text", "image"], output: ["image"] },
  limit: { context: 0, output: 0, input: 0, characters: GPT_IMAGE_PROMPT_MAX_CHARACTERS },
  cost: { input: 5, output: 30, cacheRead: 1.25 },
} as const;

/**
 * Image ids the Images API documents but models.dev does not track.
 * `gpt-image-2-2026-04-21` is the dated snapshot of gpt-image-2 (same
 * capabilities and rates — the pricing page prices the family, not the
 * snapshot).
 *
 * GPT-Image-2.5 (released 2026-09-08) and GPT-Image-2.6 (released 2026-11-04)
 * each ship a Sunburst and a Flare model. Only the 2.5 pair has dated
 * snapshots — "Default snapshot: `gpt-image-2.5-sunburst-2026-09-08`" and
 * "Default snapshot: `gpt-image-2.5-flare-2026-09-08`" on their model pages
 * (2026-11-12); the generate reference lists both aliases "including their
 * `2026-09-08` snapshots" and names `gpt-image-2.6-sunburst` /
 * `gpt-image-2.6-flare` with no snapshot. Every one of the six is
 * "| Image edit | `v1/images/edits` | Supported |" on its model page.
 */
export const imagesSupplementModels = {
  "gpt-image-2-2026-04-21": {
    ...withPromptCap(models["gpt-image-2"], GPT_IMAGE_PROMPT_MAX_CHARACTERS),
    id: "gpt-image-2-2026-04-21",
    name: "gpt-image-2 (2026-04-21)",
    releaseDate: "2026-04-21",
  },
  "gpt-image-2.5-sunburst": {
    ...GPT_IMAGE_SUNBURST_FLARE_BASE,
    id: "gpt-image-2.5-sunburst",
    name: "GPT-Image-2.5 Sunburst",
    releaseDate: "2026-09-08",
  },
  "gpt-image-2.5-sunburst-2026-09-08": {
    ...GPT_IMAGE_SUNBURST_FLARE_BASE,
    id: "gpt-image-2.5-sunburst-2026-09-08",
    name: "GPT-Image-2.5 Sunburst (2026-09-08)",
    releaseDate: "2026-09-08",
  },
  "gpt-image-2.5-flare": {
    ...GPT_IMAGE_SUNBURST_FLARE_BASE,
    id: "gpt-image-2.5-flare",
    name: "GPT-Image-2.5 Flare",
    releaseDate: "2026-09-08",
  },
  "gpt-image-2.5-flare-2026-09-08": {
    ...GPT_IMAGE_SUNBURST_FLARE_BASE,
    id: "gpt-image-2.5-flare-2026-09-08",
    name: "GPT-Image-2.5 Flare (2026-09-08)",
    releaseDate: "2026-09-08",
  },
  "gpt-image-2.6-sunburst": {
    ...GPT_IMAGE_SUNBURST_FLARE_BASE,
    id: "gpt-image-2.6-sunburst",
    name: "GPT-Image-2.6 Sunburst",
    releaseDate: "2026-11-04",
  },
  "gpt-image-2.6-flare": {
    ...GPT_IMAGE_SUNBURST_FLARE_BASE,
    id: "gpt-image-2.6-flare",
    name: "GPT-Image-2.6 Flare",
    releaseDate: "2026-11-04",
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
 * documented dall-e / snapshot / Sunburst-Flare ids merged in.
 */
export const imagesModels: Record<string, ModelInfo> = {
  ...models,
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
