/**
 * `unmodel/ideogram/types` — every `ideogram` type, and nothing else.
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
 * import type { ImageBody } from "unmodel/ideogram/types";
 *
 * const body = {
 *   // … the documented fields, checked at compile time
 * } satisfies ImageBody;
 * ```
 *
 * Two families of name live here, and `docs/decisions.md` §2 is why:
 *
 * - the **wire names** (`GenerateParams`, `GenerateV4Params`, `EditParams`,
 *   …) — re-exported verbatim, because they are how you find the endpoint in
 *   the provider's own documentation;
 * - the **uniform category aliases** (`ImageBody`, `ImageEditBody`,
 *   `ImageEditReframeBody`, …) — one per endpoint address this provider
 *   serves, named after the word you already type at `unmodel/ideogram` and
 *   on the CLI.
 *
 * The aliases are pure `export type X = Y`: additions, never renames. Where an
 * alias name already IS the wire name, the wire name wins and no duplicate is
 * declared.
 *
 * Runtime values — validators, `check*` helpers, URL constants, the models
 * table — stay on `unmodel/ideogram`, which tree-shakes to the few bytes a
 * URL constant costs.
 *
 * Endpoints:
 *
 * - `ideogram.image` → `ImageBody`
 * - `ideogram.imageEdit` → `ImageEditBody`
 * - `ideogram.imageEditReframe` → `ImageEditReframeBody`
 * - `ideogram.imageEditRemix` → `ImageEditRemixBody`
 * - `ideogram.imageEditReplaceBackground` → `ImageEditReplaceBackgroundBody`
 * - `ideogram.imageV4` → `ImageV4Body`
 */

import type { GenerateParams } from "./image";
import type {
  EditParams,
  ReframeParams,
  RemixParams,
  ReplaceBackgroundParams,
} from "./image-edit";
import type { GenerateV4Params } from "./image-v4";

export type {
  GenerateParams,
  IdeogramRenderingSpeed,
  IdeogramMagicPromptOption,
  IdeogramStyleType,
  IdeogramAspectRatio,
  IdeogramResolution,
  IdeogramStylePreset,
  IdeogramColorPalettePreset,
  IdeogramColorPalette,
  IdeogramColorPaletteMember,
} from "./image";

export type {
  GenerateV4Params,
  IdeogramResolutionV4,
  IdeogramV4RenderingSpeed,
  V4JsonPrompt,
  V4StyleDescription,
  V4CompositionalDeconstruction,
  V4PromptElement,
} from "./image-v4";

export type {
  EditParams,
  RemixParams,
  ReframeParams,
  ReplaceBackgroundParams,
} from "./image-edit";

export type { IdeogramModelId } from "./models";

// ---------------------------------------------------------------------------
// Uniform category aliases — one per endpoint address this provider serves.
// Pure type aliases: no rename, no runtime, no cost.
// ---------------------------------------------------------------------------

export type ImageBody = GenerateParams;
export type ImageEditBody = EditParams;
export type ImageEditReframeBody = ReframeParams;
export type ImageEditRemixBody = RemixParams;
export type ImageEditReplaceBackgroundBody = ReplaceBackgroundParams;
export type ImageV4Body = GenerateV4Params;
