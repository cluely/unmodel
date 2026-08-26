/**
 * The `fal.video` adapter's **data**: the endpoint roster and the per-model
 * narrowing table.
 *
 * A leaf rather than a section of the adapter beside it, because
 * `unmodel/fal/values` publishes these for client-side pickers and the adapter
 * imports this provider's validator, its zod schema and the compile helpers in
 * `core/unified/derive`. The adapter reads the very same objects, so what a
 * picker offers and what the request sends cannot drift.
 *
 * Import-free apart from the one generated table it re-exports — that is the
 * leaf rule (A10b in `test/import-graph.test.ts`).
 *
 * ## What a video row carries that an image row does not
 *
 * `durations` (the clip lengths, in canonical SECONDS, whatever the endpoint
 * spells them), `resolutions` (the canonical tiers it can express, which is an
 * EMPTY list at `minimax/h3` — it offers `"768P"` and `"2K"`, neither of which
 * is one), and `roles`: which of `first` / `last` / `reference` this endpoint's
 * route serves, plus the wire name each lands on. The roles are what let
 * thirty-five endpoints share one address; see `./unified-video.ts`.
 */

export {
  FAL_VIDEO_PARAM_SHAPES as FAL_VIDEO_MODEL_PARAMS,
  FAL_VIDEO_MODELS as MODELS,
} from "./gen/video-params.gen";
