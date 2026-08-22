/**
 * `unmodel/vidu/types` — every `vidu` type, and nothing else.
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
 * import type { ImageFromReferenceBody } from "unmodel/vidu/types";
 *
 * const body = {
 *   // … the documented fields, checked at compile time
 * } satisfies ImageFromReferenceBody;
 * ```
 *
 * Two families of name live here, and `docs/decisions.md` §2 is why:
 *
 * - the **wire names** (`Text2VideoParams`, `Img2VideoParams`,
 *   `Reference2VideoParams`, …) — re-exported verbatim, because they are how
 *   you find the endpoint in the provider's own documentation;
 * - the **uniform category aliases** (`ImageFromReferenceBody`, `VideoBody`,
 *   `VideoFromImageBody`, …) — one per endpoint address this provider serves,
 *   named after the word you already type at `unmodel/vidu` and on the CLI.
 *
 * The aliases are pure `export type X = Y`: additions, never renames. Where an
 * alias name already IS the wire name, the wire name wins and no duplicate is
 * declared.
 *
 * Runtime values — validators, `check*` helpers, URL constants, the models
 * table — stay on `unmodel/vidu`, which tree-shakes to the few bytes a
 * URL constant costs.
 *
 * Endpoints:
 *
 * - `vidu.imageFromReference` → `ImageFromReferenceBody`
 * - `vidu.video` → `VideoBody`
 * - `vidu.videoFromImage` → `VideoFromImageBody`
 * - `vidu.videoFromReference` → `VideoFromReferenceBody`
 */

import type { Reference2ImageParams } from "./image-from-reference";
import type { Text2VideoParams } from "./video";
import type { Img2VideoParams } from "./video-from-image";
import type { Reference2VideoParams } from "./video-from-reference";

export type { Text2VideoParams } from "./video";

export type { Img2VideoParams } from "./video-from-image";

export type { Reference2VideoParams, ViduSubject } from "./video-from-reference";

export type {
  Reference2ImageParams,
  ViduImageAspectRatio,
  ViduImageResolution,
} from "./image-from-reference";

export type {
  ModelRouteSupport,
  RouteSupport,
  ViduAspectRatio,
  ViduAudioType,
  ViduMovementAmplitude,
  ViduResolution,
  ViduStyle,
} from "./shared";

export type { ViduModelId, ViduImageModelId } from "./models";

export type { ViduRoute, VideoCostInputs } from "./pricing";

// ---------------------------------------------------------------------------
// Uniform category aliases — one per endpoint address this provider serves.
// Pure type aliases: no rename, no runtime, no cost.
// ---------------------------------------------------------------------------

export type ImageFromReferenceBody = Reference2ImageParams;
export type VideoBody = Text2VideoParams;
export type VideoFromImageBody = Img2VideoParams;
export type VideoFromReferenceBody = Reference2VideoParams;
