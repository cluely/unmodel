/**
 * The `revana/…` video adapter's **data**: the roster and the per-model
 * narrowing table.
 *
 * A leaf rather than a section of the adapter beside it, because
 * `unmodel/revana/values` publishes these for client-side pickers while the
 * adapter imports this provider's validator, its zod schema and the compile
 * helpers in `core/unified/derive`. The adapter reads the very same objects, so
 * what a picker offers and what the request sends cannot drift.
 *
 * Import-free apart from the one generated table it re-exports — the leaf rule
 * (A10b in `test/import-graph.test.ts`). The rows are GENERATED from Revana's
 * own keyless catalog by `scripts/codegen-revana.ts`, which is where each
 * key's lowering is written down.
 *
 * The roster is every `kind: "video"` model except the lip-sync and
 * talking-avatar ones: those need a sound, `unmodel/video` has no word for one,
 * and `unmodel/lipsync` and `unmodel/avatar` address them.
 */

export {
  REVANA_VIDEO_UNIFIED_PARAMS as REVANA_VIDEO_MODEL_PARAMS,
  REVANA_VIDEO_UNIFIED_MODELS as MODELS,
} from "./gen/video-params.gen";
