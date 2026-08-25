/**
 * The `fal.stt` adapter's **data**: the endpoint roster and the per-model
 * narrowing table.
 *
 * The leaf rule (A10b in `test/import-graph.test.ts`): import-free apart from
 * the one generated table it re-exports, so `unmodel/fal/values` can publish
 * these rows without dragging zod or the unified kernel behind them.
 *
 * The field worth knowing here is `timestamps`, and it says `[]` at five of the
 * six endpoints. That is not a gap: ElevenLabs Scribe always returns word
 * timings and offers no switch to turn them off, fal's own ASR returns whatever
 * it returns, and only `fal-ai/wizper` publishes a `chunk_level` a caller can
 * set. An empty list types `timestamps` as `never` at the call site, which says
 * "this route does not take the question" rather than "it answers no".
 */

export {
  FAL_STT_PARAM_SHAPES as FAL_STT_MODEL_PARAMS,
  FAL_STT_MODELS as MODELS,
} from "./gen/stt-params.gen";
