/**
 * The `revana/…` music adapter's **data**: the roster and the per-model
 * narrowing table.
 *
 * A leaf, import-free apart from the one generated table it re-exports (A10b in
 * `test/import-graph.test.ts`), so `unmodel/revana/values` can publish these
 * rows without the validator, the zod schema or the unified kernel behind them.
 * The adapter beside it reads the very same objects. See `./video-params.ts`
 * for the argument in full, and `scripts/codegen-revana.ts` for each lowering.
 *
 * The roster is the models whose `tasks` include `text_to_music`. Every row
 * carries `style` and `lyrics` as extras: a Revana music request needs one of
 * them, and `unmodel/music` has a word for neither.
 */

export {
  REVANA_MUSIC_UNIFIED_PARAMS as REVANA_MUSIC_MODEL_PARAMS,
  REVANA_MUSIC_UNIFIED_MODELS as MODELS,
} from "./gen/music-params.gen";
