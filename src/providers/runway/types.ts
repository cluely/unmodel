/**
 * `unmodel/runway/types` — every `runway` type, and nothing else.
 *
 * **Zero runtime.** Every export in this module is a `type`, so the emitted
 * JavaScript is an empty module: importing it adds nothing to a bundle. That
 * is pinned, against a real build, by `test/types-entries.test.ts`.
 *
 * Reach for this entry when you want unmodel's doc-corrected request shapes at
 * compile time and are sending the request yourself — with `fetch`, with the
 * vendor SDK, or through your own client:
 *
 * ```ts
 * import type { ImageBody } from "unmodel/runway/types";
 *
 * const body = {
 *   // … the documented fields, checked at compile time
 * } satisfies ImageBody;
 * ```
 *
 * Two families of name live here, and `docs/decisions.md` §2 is why:
 *
 * - the **wire names** (`ImageToVideoParams`, `TextToVideoParams`,
 *   `VideoToVideoParams`, …) — re-exported verbatim, because they are how you
 *   find the endpoint in the provider's own documentation;
 * - the **uniform category aliases** (`ImageBody`, `VideoBody`,
 *   `VideoFromImageBody`, …) — one per endpoint address this provider serves,
 *   named after the word you already type at `unmodel/runway` and on the CLI.
 *
 * The aliases are pure `export type X = Y`: additions, never renames. Where an
 * alias name already IS the wire name, the wire name wins and no duplicate is
 * declared.
 *
 * Runtime values — validators, `check*` helpers, URL constants, the models
 * table — stay on `unmodel/runway`, which tree-shakes to the few bytes a
 * URL constant costs.
 *
 * Endpoints:
 *
 * - `runway.image` → `ImageBody`
 * - `runway.video` → `VideoBody`
 * - `runway.videoFromImage` → `VideoFromImageBody`
 * - `runway.videoFromVideo` → `VideoFromVideoBody`
 */

import type { TextToImageParams } from "./image";
import type { TextToVideoParams } from "./video";
import type { ImageToVideoParams } from "./video-from-image";
import type { VideoToVideoParams } from "./video-from-video";

export type { ImageToVideoParams } from "./video-from-image";

export type { TextToVideoParams } from "./video";

export type {
  VideoToVideoParams,
  RunwayVideoKeyframe,
  RunwayKeyframeRange,
} from "./video-from-video";

export type { TextToImageParams, RunwayReferenceImage } from "./image";

export type {
  RunwayPromptImage,
  RunwayAudioReference,
  RunwayVideoReference,
  RunwayImageReference,
  RunwayContentModeration,
  ModelShapeRules,
} from "./shared";

export type {
  RunwayVideoRatio,
  RunwayVideoResolution,
  RunwayTargetAspectRatio,
  RunwayImageRatio,
  RunwayImageQuality,
  RunwayImageOutputFormat,
} from "./constraints";

export type { VideoRoute } from "./pricing";

export type { RunwayModelId, RunwayVideoModelId, RunwayImageModelId } from "./models";

// ---------------------------------------------------------------------------
// Uniform category aliases — one per endpoint address this provider serves.
// Pure type aliases: no rename, no runtime, no cost.
// ---------------------------------------------------------------------------

export type ImageBody = TextToImageParams;
export type VideoBody = TextToVideoParams;
export type VideoFromImageBody = ImageToVideoParams;
export type VideoFromVideoBody = VideoToVideoParams;
