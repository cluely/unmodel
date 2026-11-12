/**
 * The `revana/…` image adapter's **data**: the roster and the per-model
 * narrowing table.
 *
 * A leaf, import-free apart from the one generated table it re-exports (A10b in
 * `test/import-graph.test.ts`), so `unmodel/revana/values` can publish these
 * rows without the validator, the zod schema or the unified kernel behind them.
 * The adapter beside it reads the very same objects. See `./video-params.ts`
 * for the argument in full, and `scripts/codegen-revana.ts` for each lowering.
 *
 * The roster is the picture models that can start from a prompt alone (`tasks`
 * includes `text_to_image`), which is what `unmodel/image` asks of one. The two
 * edit-only models and the upscaler are addressed by `unmodel/image-edit` and
 * `unmodel/upscale`.
 */

export {
  REVANA_IMAGE_UNIFIED_PARAMS as REVANA_IMAGE_MODEL_PARAMS,
  REVANA_IMAGE_UNIFIED_MODELS as MODELS,
} from "./gen/image-params.gen";
