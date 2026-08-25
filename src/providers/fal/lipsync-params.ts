/**
 * The `fal.lipsync` adapter's **data**: the endpoint roster and the per-model
 * narrowing table.
 *
 * The leaf rule (A10b in `test/import-graph.test.ts`) again: import-free apart
 * from the one generated table it re-exports, so `unmodel/fal/values` can
 * publish these rows without dragging zod or the unified kernel behind them.
 *
 * The one field that matters here is `sources` — which shape the performance
 * arrives in. Every row in this category says `["video"]`, and that is a
 * finding rather than a constant: it is what separates these eight endpoints
 * from the eight in `./avatar-params.ts`, which say `["image"]` or `[]`.
 */

export {
  FAL_LIPSYNC_PARAM_SHAPES as FAL_LIPSYNC_MODEL_PARAMS,
  FAL_LIPSYNC_MODELS as MODELS,
} from "./gen/lipsync-params.gen";
