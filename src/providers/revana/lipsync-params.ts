/**
 * The `revana/…` lipsync adapter's **data**: the roster and the per-model
 * narrowing table.
 *
 * A leaf, import-free apart from the one generated table it re-exports (A10b in
 * `test/import-graph.test.ts`), so `unmodel/revana/values` can publish these
 * rows without the validator, the zod schema or the unified kernel behind them.
 * The adapter beside it reads the very same objects. See `./video-params.ts`
 * for the argument in full, and `scripts/codegen-revana.ts` for each lowering.
 *
 * The roster is curated (`data/revana/curation.json`, `views.lipsync`): Revana
 * files a lip-sync model as an ordinary `video_to_video` one.
 */

export {
  REVANA_LIPSYNC_UNIFIED_PARAMS as REVANA_LIPSYNC_MODEL_PARAMS,
  REVANA_LIPSYNC_UNIFIED_MODELS as MODELS,
} from "./gen/lipsync-params.gen";
