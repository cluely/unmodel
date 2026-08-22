/**
 * `unmodel/stability/types` — every `stability` type, and nothing else.
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
 * import type { ImageBody } from "unmodel/stability/types";
 *
 * const body = {
 *   // … the documented fields, checked at compile time
 * } satisfies ImageBody;
 * ```
 *
 * Two families of name live here, and `docs/decisions.md` §2 is why:
 *
 * - the **wire names** (`StableImageUltraParams`, `StableImageCoreParams`,
 *   `StableImageSd3Params`, …) — re-exported verbatim, because they are how
 *   you find the endpoint in the provider's own documentation;
 * - the **uniform category aliases** (`ImageBody`, `ImageCoreBody`,
 *   `ImageEditEraseBody`, …) — one per endpoint address this provider serves,
 *   named after the word you already type at `unmodel/stability` and on the
 *   CLI.
 *
 * The aliases are pure `export type X = Y`: additions, never renames. Where an
 * alias name already IS the wire name, the wire name wins and no duplicate is
 * declared.
 *
 * Runtime values — validators, `check*` helpers, URL constants, the models
 * table — stay on `unmodel/stability`, which tree-shakes to the few bytes a
 * URL constant costs.
 *
 * Endpoints:
 *
 * - `stability.image` → `ImageBody`
 * - `stability.imageCore` → `ImageCoreBody`
 * - `stability.imageEditErase` → `ImageEditEraseBody`
 * - `stability.imageEditInpaint` → `ImageEditInpaintBody`
 * - `stability.imageEditOutpaint` → `ImageEditOutpaintBody`
 * - `stability.imageEditRemoveBackground` → `ImageEditRemoveBackgroundBody`
 * - `stability.imageEditSearchAndRecolor` → `ImageEditSearchAndRecolorBody`
 * - `stability.imageEditSearchAndReplace` → `ImageEditSearchAndReplaceBody`
 * - `stability.imageSd3` → `ImageSd3Body`
 * - `stability.music` → `MusicBody`
 * - `stability.musicFromAudio` → `MusicFromAudioBody`
 * - `stability.musicInpaint` → `MusicInpaintBody`
 */

import type { StableImageUltraParams, StableImageCoreParams, StableImageSd3Params } from "./image";
import type {
  StableImageEraseParams,
  StableImageInpaintParams,
  StableImageOutpaintParams,
  StableImageRemoveBackgroundParams,
  StableImageSearchAndRecolorParams,
  StableImageSearchAndReplaceParams,
} from "./image-edit";
import type {
  StableAudioTextToAudioParams,
  StableAudioAudioToAudioParams,
  StableAudioInpaintParams,
} from "./music";

export type {
  StableImageUltraParams,
  StableImageCoreParams,
  StableImageSd3Params,
  StabilityAspectRatio,
  StabilityStylePreset,
  StabilityOutputFormat,
} from "./image";

export type {
  StableImageEraseParams,
  StableImageInpaintParams,
  StableImageOutpaintParams,
  StableImageSearchAndReplaceParams,
  StableImageSearchAndRecolorParams,
  StableImageRemoveBackgroundParams,
  StabilityAlphaOutputFormat,
} from "./image-edit";

export type {
  StableAudioTextToAudioParams,
  StableAudioAudioToAudioParams,
  StableAudioInpaintParams,
  StableAudioOutputFormat,
} from "./music";

export type {
  StabilityModelId,
  StabilitySd3ModelId,
  StabilityEditRouteId,
  StabilityAudioModelId,
} from "./models";

// ---------------------------------------------------------------------------
// Uniform category aliases — one per endpoint address this provider serves.
// Pure type aliases: no rename, no runtime, no cost.
// ---------------------------------------------------------------------------

export type ImageBody = StableImageUltraParams;
export type ImageCoreBody = StableImageCoreParams;
export type ImageEditEraseBody = StableImageEraseParams;
export type ImageEditInpaintBody = StableImageInpaintParams;
export type ImageEditOutpaintBody = StableImageOutpaintParams;
export type ImageEditRemoveBackgroundBody = StableImageRemoveBackgroundParams;
export type ImageEditSearchAndRecolorBody = StableImageSearchAndRecolorParams;
export type ImageEditSearchAndReplaceBody = StableImageSearchAndReplaceParams;
export type ImageSd3Body = StableImageSd3Params;
export type MusicBody = StableAudioTextToAudioParams;
export type MusicFromAudioBody = StableAudioAudioToAudioParams;
export type MusicInpaintBody = StableAudioInpaintParams;
