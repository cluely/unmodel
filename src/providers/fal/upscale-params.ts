/**
 * The `fal.upscale` adapter's **data**: the endpoint roster and the per-model
 * narrowing table.
 *
 * The leaf rule (A10b in `test/import-graph.test.ts`) again: import-free apart
 * from the one generated table it re-exports, so `unmodel/fal/values` can
 * publish these rows without dragging zod or the unified kernel behind them.
 *
 * Two fields matter here and both are per model. `sources` says whether the
 * route takes a still or a clip — and unlike the two performance categories,
 * where every row in a category agrees, this one genuinely splits: seven rows
 * say `["image"]` and three say `["video"]`. `factors` says what multipliers
 * the route offers, with `[]` meaning it offers none at all.
 */

export {
  FAL_UPSCALE_PARAM_SHAPES as FAL_UPSCALE_MODEL_PARAMS,
  FAL_UPSCALE_MODELS as MODELS,
} from "./gen/upscale-params.gen";
