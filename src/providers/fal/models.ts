/**
 * The merged `unmodel/fal` catalog — every curated endpoint, across every verb
 * this provider serves.
 *
 * **Importable from `./index.ts` and nowhere else.** This module is the union
 * of every category's slice, so anything that reaches it pulls in every
 * category's rows: the `unmodel/image` pack would ship the editing catalog,
 * `unmodel/image-edit` would ship the generation one, and both would grow with
 * every verb the following waves add. Each validator therefore imports its own
 * `gen/models-<verb>.gen.ts` slice directly, and `test/import-graph.test.ts`
 * asserts (A12) that no `unified-*.ts` and no validator reaches this file —
 * an explicit assertion, because the same-directory rule A7 cannot catch it.
 *
 * The rows themselves are generated: the SHAPE from fal's own published
 * listing and OpenAPI, the PRICING hand-transcribed from each endpoint's model
 * page with a quote and a date. See `src/providers/HAND_CATALOGS.md`.
 */

import type { ModelInfo } from "../../core/catalog-types";
import { imageModels } from "./gen/models-image.gen";
import { imageEditModels } from "./gen/models-image-edit.gen";

/** Every fal model unmodel serves, keyed by endpoint id. */
export const models = {
  ...imageModels,
  ...imageEditModels,
} as const satisfies Record<string, ModelInfo>;

export type FalModelId = keyof typeof models;
