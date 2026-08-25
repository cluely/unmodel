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

import type { ModelInfo, ProviderInfo } from "../../core/catalog-types";
import { avatarModels } from "./gen/models-avatar.gen";
import { imageModels } from "./gen/models-image.gen";
import { imageEditModels } from "./gen/models-image-edit.gen";
import { lipsyncModels } from "./gen/models-lipsync.gen";
import { musicModels } from "./gen/models-music.gen";
import { sttModels } from "./gen/models-stt.gen";
import { threeDModels } from "./gen/models-three-d.gen";
import { ttsModels } from "./gen/models-tts.gen";
import { upscaleModels } from "./gen/models-upscale.gen";
import { videoModels } from "./gen/models-video.gen";

/**
 * The provider identity: who this is, and where the key comes from.
 *
 * Hand-written and not generated, because none of it is in fal's OpenAPI
 * documents. `env` in particular is a fact about the ECOSYSTEM rather than
 * about the wire — `FAL_KEY` is the name fal's own client reads — and the auth
 * scheme it belongs to is one fal's own security scheme states WRONGLY: the
 * spec declares a bare apiKey header, and the header fal actually wants is
 * `Authorization: Key <FAL_KEY>`, with the `Key ` prefix. That prefix is
 * hand-stated everywhere in this provider and never derived, for exactly that
 * reason.
 *
 * Here rather than in `./index.ts` so it sits with the rows it describes, which
 * is where every other hand catalog in the library keeps it.
 */
export const provider = {
  id: "fal",
  name: "fal.ai",
  env: ["FAL_KEY"],
  doc: "https://fal.ai/docs",
} as const satisfies ProviderInfo;

/**
 * Every fal model unmodel serves, keyed by endpoint id — all nine verbs, 146
 * endpoints.
 *
 * Spread in the verbs' own alphabetical order, which is also `scripts/
 * codegen-fal.ts`'s emission order, so a new slice lands in one obvious place.
 * The ids are disjoint by construction: `data/fal/curation.json` maps each id
 * to exactly one verb, and a duplicate would be a curation bug rather than a
 * merge conflict.
 */
export const models = {
  ...avatarModels,
  ...imageModels,
  ...imageEditModels,
  ...lipsyncModels,
  ...musicModels,
  ...sttModels,
  ...threeDModels,
  ...ttsModels,
  ...upscaleModels,
  ...videoModels,
} as const satisfies Record<string, ModelInfo>;

export type FalModelId = keyof typeof models;
