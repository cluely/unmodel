/**
 * `unmodel/reve/types` — every `reve` type, and nothing else.
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
 * import type { ImageBody } from "unmodel/reve/types";
 *
 * const body = {
 *   // … the documented fields, checked at compile time
 * } satisfies ImageBody;
 * ```
 *
 * Two families of name live here, and `docs/decisions.md` §2 is why:
 *
 * - the **wire names** (`CreateParams`, `EditParams`, `RemixParams`, …) —
 *   re-exported verbatim, because they are how you find the endpoint in the
 *   provider's own documentation;
 * - the **uniform category aliases** (`ImageBody`, `ImageEditBody`,
 *   `ImageEditRemixBody`, …) — one per endpoint address this provider serves,
 *   named after the word you already type at `unmodel/reve` and on the CLI.
 *
 * The aliases are pure `export type X = Y`: additions, never renames. Where an
 * alias name already IS the wire name, the wire name wins and no duplicate is
 * declared.
 *
 * Runtime values — validators, `check*` helpers, URL constants, the models
 * table — stay on `unmodel/reve`, which tree-shakes to the few bytes a
 * URL constant costs.
 *
 * Endpoints:
 *
 * - `reve.image` → `ImageBody`
 * - `reve.imageEdit` → `ImageEditBody`
 * - `reve.imageEditRemix` → `ImageEditRemixBody`
 * - `reve.imageV2` → `ImageV2Body`
 */

import type { CreateParams } from "./image";
import type { EditParams, RemixParams } from "./image-edit";
import type { CreateV2Params } from "./image-v2";

export type { CreateParams } from "./image";

export type { EditParams, RemixParams } from "./image-edit";

export type {
  CreateV2Params,
  ReveAsyncImageFormat,
  ReveAsyncOptions,
  ReveImageInput,
} from "./image-v2";

export type {
  ReveV1AspectRatio,
  ReveV2AspectRatio,
  ReveProcess,
  ReveUpscaleFactor,
  ReveUpscaleOperation,
  ReveRemoveBackgroundOperation,
  ReveFitImageOperation,
  ReveEffectOperation,
  RevePostprocessingOperation,
} from "./shared";

export type {
  ReveModelId,
  ReveCreateVersion,
  ReveEditVersion,
  ReveRemixVersion,
  ReveV2CreateVersion,
} from "./models";

// ---------------------------------------------------------------------------
// Uniform category aliases — one per endpoint address this provider serves.
// Pure type aliases: no rename, no runtime, no cost.
// ---------------------------------------------------------------------------

export type ImageBody = CreateParams;
export type ImageEditBody = EditParams;
export type ImageEditRemixBody = RemixParams;
export type ImageV2Body = CreateV2Params;
