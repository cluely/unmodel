/**
 * The `fal.image` adapter's **data**: the endpoint roster and the per-model
 * narrowing table.
 *
 * A leaf rather than a section of the adapter beside it, because
 * `unmodel/fal/values` publishes these for client-side pickers and the adapter
 * imports this provider's validator, its zod schema and the compile helpers in
 * `core/unified/derive`. The adapter reads the very same objects, so what a
 * picker offers and what the request sends cannot drift.
 *
 * Import-free apart from the one generated table it re-exports — that is the
 * leaf rule (A10b in `test/import-graph.test.ts`), and it is what keeps zod
 * and the unified kernel from ending up behind `unmodel/fal/values`.
 *
 * ## Why this file is three lines of re-export
 *
 * Every other provider's `*-params.ts` hand-writes its rows. fal's are
 * GENERATED, from fal's own published OpenAPI: the sizes are that endpoint's
 * `image_size` presets, the ratios are its `aspect_ratio` enum, the tiers are
 * its `resolution` enum mapped onto the canonical three, and the extras are
 * every parameter it declares that the canonical vocabulary has no word for,
 * typed from that endpoint's own wire interface. Hand-writing 28 rows of that
 * would be 28 transcriptions to keep in step with a weekly refresh.
 *
 * So the table an adapter compiles with, the table a picker renders and the
 * schema a request is validated against all come from one source, and the
 * identity is literal — `IMAGE_MODEL_PARAMS` IS `FAL_IMAGE_PARAM_SHAPES`, not
 * a copy of it.
 */

export {
  FAL_IMAGE_PARAM_SHAPES as FAL_IMAGE_MODEL_PARAMS,
  FAL_IMAGE_MODELS as MODELS,
} from "./gen/image-params.gen";
