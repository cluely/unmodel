/**
 * `unmodel/kling/types` — every `kling` type, and nothing else.
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
 * import type { ImageBody } from "unmodel/kling/types";
 *
 * const body = {
 *   // … the documented fields, checked at compile time
 * } satisfies ImageBody;
 * ```
 *
 * Two families of name live here, and `docs/decisions.md` §2 is why:
 *
 * - the **wire names** (`TextToVideoParams`, `ImageToVideoParams`,
 *   `TextToVideoV3Params`, …) — re-exported verbatim, because they are how
 *   you find the endpoint in the provider's own documentation;
 * - the **uniform category aliases** (`ImageBody`, `ImageOmniBody`,
 *   `VideoBody`, …) — one per endpoint address this provider serves, named
 *   after the word you already type at `unmodel/kling` and on the CLI.
 *
 * The aliases are pure `export type X = Y`: additions, never renames. Where an
 * alias name already IS the wire name, the wire name wins and no duplicate is
 * declared.
 *
 * Runtime values — validators, `check*` helpers, URL constants, the models
 * table — stay on `unmodel/kling`, which tree-shakes to the few bytes a
 * URL constant costs.
 *
 * Endpoints:
 *
 * - `kling.image` → `ImageBody`
 * - `kling.imageOmni` → `ImageOmniBody`
 * - `kling.video` → `VideoBody`
 * - `kling.videoFromImage` → `VideoFromImageBody`
 * - `kling.videoOmni` → `VideoOmniBody`
 * - `kling.videoV3` → `VideoV3Body`
 * - `kling.videoV3FromImage` → `VideoV3FromImageBody`
 */

import type { ImageGenerationsParams } from "./image";
import type { OmniImageParams } from "./image-omni";
import type { TextToVideoParams } from "./video";
import type { ImageToVideoParams } from "./video-from-image";
import type { OmniVideoParams } from "./video-omni";
import type { TextToVideoV3Params } from "./video-v3";
import type { ImageToVideoV3Params } from "./video-v3-from-image";

export type { TextToVideoParams } from "./video";

export type {
  ImageToVideoParams,
  KlingDynamicMask,
  KlingTrajectoryPoint,
} from "./video-from-image";

export type { TextToVideoV3Params, TextToVideoV3Settings } from "./video-v3";

export type { ImageToVideoV3Params, ImageToVideoV3Settings } from "./video-v3-from-image";

export type { OmniVideoParams, OmniVideoSettings, KlingOmniVideoModelId } from "./video-omni";

export type {
  ImageGenerationsParams,
  KlingImageAspectRatio,
  KlingImageResolution,
} from "./image";

export type { OmniImageParams, KlingOmniImageResolution } from "./image-omni";

export type {
  KlingAspectRatio,
  KlingAudio,
  KlingContent,
  KlingContentType,
  KlingDuration,
  KlingMode,
  KlingOptions,
  KlingResolution,
  KlingWatermarkInfo,
  RouteModelRules,
  RouteRules,
} from "./shared";

export type {
  KlingCameraConfig,
  KlingCameraControl,
  KlingCameraType,
  KlingShot,
  KlingShotType,
  KlingV1Duration,
  V1ModelRules,
} from "./v1-routes";

export type { ImageMode, ImageCostInputs, VideoCostInputs } from "./pricing";

export type {
  KlingModelId,
  KlingVideoModelId,
  KlingV1VideoModelId,
  KlingPathVideoModelId,
  KlingImageModelId,
  KlingOmniImageModelId,
} from "./models";

// ---------------------------------------------------------------------------
// Uniform category aliases — one per endpoint address this provider serves.
// Pure type aliases: no rename, no runtime, no cost.
// ---------------------------------------------------------------------------

export type ImageBody = ImageGenerationsParams;
export type ImageOmniBody = OmniImageParams;
export type VideoBody = TextToVideoParams;
export type VideoFromImageBody = ImageToVideoParams;
export type VideoOmniBody = OmniVideoParams;
export type VideoV3Body = TextToVideoV3Params;
export type VideoV3FromImageBody = ImageToVideoV3Params;
