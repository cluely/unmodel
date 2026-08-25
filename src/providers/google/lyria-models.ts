// Hand-maintained MIRROR of the generated google catalog's two batch Lyria 3
// rows, following ./tts-models rather than ./veo-models: importing
// `src/catalog/google.gen.ts` here would put the whole ~90-KiB generated
// catalog inside `unmodel/music` (the pack graphs are pinned in
// test/bundle-budget.test.ts), so the two rows are copied by hand —
// cross-check the mirrored fields against the generated file on each codegen
// refresh. This file also adds what the snapshot is missing: the per-song
// pricing the pricing page publishes and a row for the realtime id models.dev
// does not track. Refresh from
//   https://ai.google.dev/gemini-api/docs/music-generation  (model ids, capabilities)
//   https://ai.google.dev/gemini-api/docs/pricing           (per-song rates)
//
// Pricing (Gemini API pricing page, verified 2026-08-24; paid tier only, no
// free-tier access):
// - lyria-3-clip-preview: "$0.04 per song" (fixed 30-second clips).
// - lyria-3-pro-preview:  "$0.08 per song" (full songs, ~2 minutes).
// Billing is flat per generation request — not per second, not per token — so
// the rate lives here as its own constant rather than being forced into a
// `ModelCost` field whose unit it would lie about (`perVideoSecond` counts
// seconds, `perImage` counts images; there is no per-request field). The
// generated rows' `cost: { input: 0, output: 0 }` is a models.dev artifact and
// is left alone: `./music`'s own `estimate` answers before token math matters.

import type { ModelInfo } from "../../core/catalog-types";
import { LYRIA_REALTIME_MODEL_ID, type GoogleLyriaModelId } from "./music-params";

/** Shared shape of the two mirrored batch rows (field-for-field with the snapshot). */
const LYRIA_BATCH_BASE = {
  family: "lyria",
  attachment: true,
  reasoning: false,
  toolCall: false,
  structuredOutput: false,
  temperature: true,
  openWeights: false,
  releaseDate: "2026-03-25",
  lastUpdated: "2026-03-25",
  modalities: { input: ["text", "image"], output: ["text", "audio"] },
  limit: { context: 1048576, output: 65536 },
  // models.dev artifact, mirrored as-is — see the header note on pricing.
  cost: { input: 0, output: 0 },
} as const;

/**
 * USD per generated song, flat — the pricing page's "per song" rates verbatim.
 * `./music`'s `estimate` reads this; a model absent here estimates nothing.
 */
export const LYRIA_PRICE_PER_SONG_USD: Readonly<Record<GoogleLyriaModelId, number>> = {
  "lyria-3-clip-preview": 0.04,
  "lyria-3-pro-preview": 0.08,
};

/**
 * The realtime id, catalogued so a request naming it gets `./music`'s precise
 * "WebSocket only" error without an `unknown_model` warning muddying it.
 * models.dev carries no row; the shape below is the music-generation guide's
 * description of the model (interactive streaming, audio out, no batch REST
 * surface — hence `limit.context: 0`, the not-a-token-context-model rule).
 */
export const lyriaRealtimeModel: ModelInfo = {
  id: LYRIA_REALTIME_MODEL_ID,
  name: "Lyria RealTime",
  family: "lyria",
  attachment: false,
  reasoning: false,
  toolCall: false,
  temperature: false,
  openWeights: false,
  modalities: { input: ["text"], output: ["audio"] },
  limit: { context: 0 },
};

/**
 * Catalog used by the music validator: the two mirrored batch Lyria 3 rows
 * plus the realtime row above.
 */
export const musicModels: Record<string, ModelInfo> = {
  "lyria-3-clip-preview": {
    ...LYRIA_BATCH_BASE,
    id: "lyria-3-clip-preview",
    name: "Lyria 3 Clip Preview",
  },
  "lyria-3-pro-preview": {
    ...LYRIA_BATCH_BASE,
    id: "lyria-3-pro-preview",
    name: "Lyria 3 Pro Preview",
  },
  [LYRIA_REALTIME_MODEL_ID]: lyriaRealtimeModel,
};

export type { GoogleLyriaModelId };
