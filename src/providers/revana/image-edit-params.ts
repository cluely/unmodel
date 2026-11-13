/**
 * The `revana/…` image-edit adapter's **data**: the roster and the per-model
 * narrowing table.
 *
 * A leaf, import-free apart from the one generated table it re-exports (A10b in
 * `test/import-graph.test.ts`), so `unmodel/revana/values` can publish these
 * rows without the validator, the zod schema or the unified kernel behind them.
 * The adapter beside it reads the very same objects. See `./video-params.ts`
 * for the argument in full, and `scripts/codegen-revana.ts` for each lowering.
 *
 * The roster is the picture models whose `tasks` include `image_to_image` — the
 * ids `revana.imageEdit` serves.
 */

export {
  REVANA_IMAGE_EDIT_UNIFIED_PARAMS as REVANA_IMAGE_EDIT_MODEL_PARAMS,
  REVANA_IMAGE_EDIT_UNIFIED_MODELS as MODELS,
} from "./gen/image-edit-params.gen";
