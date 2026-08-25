/**
 * `unmodel/tripo3d/types` — every `tripo3d` type, and nothing else.
 *
 * **Zero runtime.** Every export in this module is a `type`, so the emitted
 * JavaScript is an empty module: importing it adds nothing to a bundle. That is
 * pinned, against a real build, by `test/types-entries.test.ts`.
 *
 * Reach for this entry when you want unmodel's doc-corrected request shapes at
 * compile time and are sending the request yourself — with `fetch`, with
 * Tripo's own JavaScript SDK, or through your own client:
 *
 * ```ts
 * import type { ThreeDBody } from "unmodel/tripo3d/types";
 *
 * const body = {
 *   model: "v3.1-20260211",
 *   prompt: "a brass astrolabe on a walnut stand",
 * } satisfies ThreeDBody;
 * ```
 *
 * Two families of name live here, and `docs/decisions.md` §2 is why:
 *
 * - the **wire names** (`TextToModelParams`, `ImageToModelParams`) —
 *   re-exported verbatim, because they are how you find the endpoint in Tripo's
 *   own documentation;
 * - the **uniform category aliases** (`ThreeDBody`, `ThreeDFromImageBody`) —
 *   one per endpoint address this provider serves, named after the word you
 *   already type at `unmodel/tripo3d` and on the CLI. `ThreeDBody` rather than
 *   `3dBody` because the alias is named after the VERB, and `3d` is not an
 *   identifier; the category id and the package subpath stay `unmodel/3d`.
 *
 * The aliases are pure `export type X = Y`: additions, never renames.
 *
 * Runtime values — the validators, the `check*` helpers, the URL constants, the
 * credit tables, the models table — stay on `unmodel/tripo3d`, which
 * tree-shakes to the few bytes a URL constant costs.
 *
 * Endpoints:
 *
 * - `tripo3d.threeD` → `ThreeDBody`
 * - `tripo3d.threeDFromImage` → `ThreeDFromImageBody`
 */

import type { TextToModelParams } from "./three-d";
import type { ImageToModelParams } from "./three-d-from-image";

export type { TextToModelParams } from "./three-d";

export type { ImageToModelParams } from "./three-d-from-image";

export type {
  Tripo3dCompression,
  Tripo3dGeometryQuality,
  Tripo3dModelId,
  Tripo3dOrientation,
  Tripo3dTaskStatus,
  Tripo3dTextureAlignment,
  Tripo3dTextureQuality,
} from "./shared";

export type { Tripo3dCostInputs, Tripo3dTaskType } from "./pricing";

export type { Tripo3dCatalogModelId } from "./models";

// ---------------------------------------------------------------------------
// Uniform category aliases — one per endpoint address this provider serves.
// Pure type aliases: no rename, no runtime, no cost.
// ---------------------------------------------------------------------------

export type ThreeDBody = TextToModelParams;
export type ThreeDFromImageBody = ImageToModelParams;
