/**
 * `unmodel/luma/types` — every `luma` type, and nothing else.
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
 * import type { ImageBody } from "unmodel/luma/types";
 *
 * const body = {
 *   // … the documented fields, checked at compile time
 * } satisfies ImageBody;
 * ```
 *
 * Two families of name live here, and `docs/decisions.md` §2 is why:
 *
 * - the **wire names** (`GenerationsParams`, `ImageGenerationsParams`,
 *   `ModifyVideoParams`, …) — re-exported verbatim, because they are how you
 *   find the endpoint in the provider's own documentation;
 * - the **uniform category aliases** (`ImageBody`, `ImageEditReframeBody`,
 *   `VideoBody`, …) — one per endpoint address this provider serves, named
 *   after the word you already type at `unmodel/luma` and on the CLI.
 *
 * The aliases are pure `export type X = Y`: additions, never renames. Where an
 * alias name already IS the wire name, the wire name wins and no duplicate is
 * declared.
 *
 * Runtime values — validators, `check*` helpers, URL constants, the models
 * table — stay on `unmodel/luma`, which tree-shakes to the few bytes a
 * URL constant costs.
 *
 * Endpoints:
 *
 * - `luma.image` → `ImageBody`
 * - `luma.imageEditReframe` → `ImageEditReframeBody`
 * - `luma.video` → `VideoBody`
 * - `luma.videoAddAudio` → `VideoAddAudioBody`
 * - `luma.videoModify` → `VideoModifyBody`
 * - `luma.videoReframe` → `VideoReframeBody`
 * - `luma.videoUpscale` → `VideoUpscaleBody`
 */

import type { ImageGenerationsParams } from "./image";
import type { ReframeImageParams } from "./image-edit-reframe";
import type { GenerationsParams } from "./video";
import type { AddAudioParams } from "./video-add-audio";
import type { ModifyVideoParams } from "./video-modify";
import type { ReframeVideoParams } from "./video-reframe";
import type { UpscaleParams } from "./video-upscale";

export type {
  GenerationsParams,
  LumaAspectRatio,
  LumaVideoDuration,
  LumaVideoResolution,
  LumaKeyframe,
  LumaKeyframes,
  LumaConcept,
} from "./video";

export type { ImageGenerationsParams, LumaImageRef, LumaCharacterRef } from "./image";

export type { ModifyVideoParams, LumaModifyMode } from "./video-modify";

export type { ReframeVideoParams } from "./video-reframe";

export type { ReframeImageParams } from "./image-edit-reframe";

export type { UpscaleParams } from "./video-upscale";

export type { AddAudioParams } from "./video-add-audio";

export type { LumaMedia, LumaReframeGeometry } from "./shared";

export type { ModifyVideoCostInputs } from "./pricing";

export type { LumaModelId, LumaVideoModelId, LumaImageModelId } from "./models";

// ---------------------------------------------------------------------------
// Uniform category aliases — one per endpoint address this provider serves.
// Pure type aliases: no rename, no runtime, no cost.
// ---------------------------------------------------------------------------

export type ImageBody = ImageGenerationsParams;
export type ImageEditReframeBody = ReframeImageParams;
export type VideoBody = GenerationsParams;
export type VideoAddAudioBody = AddAudioParams;
export type VideoModifyBody = ModifyVideoParams;
export type VideoReframeBody = ReframeVideoParams;
export type VideoUpscaleBody = UpscaleParams;
