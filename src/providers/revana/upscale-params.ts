/**
 * The `revana/…` upscale adapter's **data**: the roster and the per-model
 * narrowing table.
 *
 * A leaf, import-free apart from the one generated table it re-exports (A10b in
 * `test/import-graph.test.ts`), so `unmodel/revana/values` can publish these
 * rows without the validator, the zod schema or the unified kernel behind them.
 * The adapter beside it reads the very same objects. See `./video-params.ts`
 * for the argument in full, and `scripts/codegen-revana.ts` for each lowering.
 *
 * The roster is the models whose `tasks` include `upscale` — the ids
 * `revana.upscale` serves. Every row says a still and no multiplier;
 * `lowerUpscaleParams` in the generator records why.
 */

export {
  REVANA_UPSCALE_UNIFIED_PARAMS as REVANA_UPSCALE_MODEL_PARAMS,
  REVANA_UPSCALE_UNIFIED_MODELS as MODELS,
} from "./gen/upscale-params.gen";
