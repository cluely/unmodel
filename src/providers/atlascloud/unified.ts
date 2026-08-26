/**
 * Atlas Cloud's unified adapters — one, because unmodel serves Atlas's video
 * route only (the scope is recorded in ./models.ts).
 *
 * A barrel over one module rather than the adapter itself, for the reason
 * `openai/unified.ts` states: the shape is what lets a second category join
 * without moving every import, and `unmodel/video` reaches
 * `./unified-video.ts` directly so the pack pays for one adapter either way.
 */
export {
  video,
  type AtlascloudVideoResult,
  type AtlascloudVideoWire,
} from "./unified-video";
