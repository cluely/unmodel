/**
 * The `higgsfield.image` adapter's **data**: the routes `unmodel/image`
 * addresses and the per-route narrowing table.
 *
 * A leaf, and import-free apart from the one generated table it re-exports
 * (A10b in `test/import-graph.test.ts`): `unmodel/higgsfield/values` publishes
 * these for client-side pickers, and the adapter beside it imports the
 * validator, its schema and the kernel's derivations. Both read these very
 * objects, so what a picker offers and what the request sends cannot drift.
 *
 * The rows are generated from each route's own published schema by
 * `scripts/codegen-higgsfield.ts`, which is where every lowering is written
 * down. The roster is the image routes that have a `prompt` and do not require
 * a source picture; the generated file lists the ones left out, each with its
 * reason, and `higgsfield.image` validates every one of them by id.
 */

export {
  HIGGSFIELD_IMAGE_UNIFIED_PARAMS as HIGGSFIELD_IMAGE_MODEL_PARAMS,
  HIGGSFIELD_IMAGE_UNIFIED_MODELS as MODELS,
} from "./gen/image-params.gen";
