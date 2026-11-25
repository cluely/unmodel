/**
 * The `higgsfield.video` adapter's **data**: the routes `unmodel/video`
 * addresses and the per-route narrowing table.
 *
 * The image sibling's header explains the leaf rule. What a video row carries
 * beyond a picture row: `durations` (a closed list, or absent where the route
 * takes a range), `resolutions` (the canonical tiers the route can express —
 * empty at `minimax/h3/*`, whose one size is `2K`), and `roles`: which of
 * `first` / `last` / `reference` the route has a parameter for, with the
 * parameter each lands on. The roles are what let eighty-odd routes share one
 * adapter; see `./unified-video.ts`.
 */

export {
  HIGGSFIELD_VIDEO_UNIFIED_PARAMS as HIGGSFIELD_VIDEO_MODEL_PARAMS,
  HIGGSFIELD_VIDEO_UNIFIED_MODELS as MODELS,
} from "./gen/video-params.gen";
