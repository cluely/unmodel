// Hand-maintained — Higgsfield is not in models.dev; refresh from
// https://docs.higgsfield.ai/docs/models/soul-id/create-character.md and
// https://dash.higgsfield.ai/models/soul-id/llms.txt.

/**
 * The catalog row of `higgsfield.characterTrain`, the one Higgsfield route
 * whose body is typed by hand.
 *
 * Its own module, and not a row of `./models.ts`: that file merges every
 * generated slice and is importable from `./index.ts` alone, while
 * `./character-train.ts` needs this row as its catalog. `./models.ts` spreads
 * it beside the generated slices. Type-only imports, so the training address
 * does not carry the generated roster to reach its own id.
 */

import type { ModelInfo } from "../../core/catalog-types";

/** The one route `higgsfield.characterTrain` posts to, as a route id: the path under `https://api.higgsfield.ai/`. */
export const CHARACTER_TRAIN_ENDPOINT = "v1/custom-references";

export const characterTrainModels = {
  // The id is the path a caller POSTs to, like every other Higgsfield catalog
  // id. The console files this product under the slug `soul-id`, which is not
  // a path: "This is not an image-generation endpoint; do not POST to
  // /soul-id."
  // (https://docs.higgsfield.ai/docs/models/soul-id/create-character.md, read
  // 2026-11-24). The body has no route parameter, so the validator pins this
  // id with `modelId`.
  //
  // UNPRICED. No surface states a price for training: the console document's
  // pricing paragraph is "Public pricing information is not available for
  // this model." (https://dash.higgsfield.ai/models/soul-id/llms.txt, read
  // 2026-11-24), and its model page has no price sentence. No release date is
  // published either.
  [CHARACTER_TRAIN_ENDPOINT]: {
    id: CHARACTER_TRAIN_ENDPOINT,
    name: "Soul ID",
    attachment: true,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    // It answers a character reference, not a file; `Modality` has no word
    // for that, so the output is the kind of model the reference is for.
    modalities: { input: ["image"], output: ["image"] },
    limit: { context: 0 },
  },
} as const satisfies Record<string, ModelInfo>;
