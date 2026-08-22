/**
 * `unmodel/pixverse/types` — every `pixverse` type, and nothing else.
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
 * import type { VideoBody } from "unmodel/pixverse/types";
 *
 * const body = {
 *   // … the documented fields, checked at compile time
 * } satisfies VideoBody;
 * ```
 *
 * Two families of name live here, and `docs/decisions.md` §2 is why:
 *
 * - the **wire names** (`TextToVideoParams`, `ImageToVideoParams`) —
 *   re-exported verbatim, because they are how you find the endpoint in the
 *   provider's own documentation;
 * - the **uniform category aliases** (`VideoBody`, `VideoFromImageBody`) —
 *   one per endpoint address this provider serves, named after the word you
 *   already type at `unmodel/pixverse` and on the CLI.
 *
 * The aliases are pure `export type X = Y`: additions, never renames. Where an
 * alias name already IS the wire name, the wire name wins and no duplicate is
 * declared.
 *
 * Runtime values — validators, `check*` helpers, URL constants, the models
 * table — stay on `unmodel/pixverse`, which tree-shakes to the few bytes a
 * URL constant costs.
 *
 * Endpoints:
 *
 * - `pixverse.video` → `VideoBody`
 * - `pixverse.videoFromImage` → `VideoFromImageBody`
 */

import type { TextToVideoParams } from "./video";
import type { ImageToVideoParams } from "./video-from-image";

export type { TextToVideoParams } from "./video";

export type { ImageToVideoParams } from "./video-from-image";

export type { PixverseAspectRatio, PixverseMotionMode, PixverseQualityValue } from "./shared";

export type { PixverseQuality, VideoCostInputs } from "./pricing";

export type { PixverseModelId } from "./models";

// ---------------------------------------------------------------------------
// Uniform category aliases — one per endpoint address this provider serves.
// Pure type aliases: no rename, no runtime, no cost.
// ---------------------------------------------------------------------------

export type VideoBody = TextToVideoParams;
export type VideoFromImageBody = ImageToVideoParams;
