/**
 * `unmodel/topaz/types` — every `topaz` type, and nothing else.
 *
 * **Zero runtime.** Every export in this module is a `type`, so the emitted
 * JavaScript is an empty module: importing it adds nothing to a bundle. That is
 * pinned, against a real build, by `test/types-entries.test.ts`.
 *
 * Reach for this entry when you want unmodel's doc-corrected request shapes at
 * compile time and are sending the request yourself. Topaz ships no JavaScript
 * SDK, so "yourself" is the normal case here:
 *
 * ```ts
 * import type { UpscaleBody } from "unmodel/topaz/types";
 *
 * const body = {
 *   source_url: "https://example.com/portrait.jpg",
 *   model: "Standard V2",
 *   output_width: 4096,
 * } satisfies UpscaleBody;
 * ```
 *
 * Two families of name live here, and `docs/decisions.md` §2 is why:
 *
 * - the **wire names** (`TopazUpscaleParams`, `TopazUpscaleGenerativeParams`) —
 *   re-exported verbatim, because they are how you find the endpoint in Topaz's
 *   own documentation;
 * - the **uniform category aliases** (`UpscaleBody`, `UpscaleGenerativeBody`) —
 *   one per endpoint address this provider serves, named after the word you
 *   already type at `unmodel/topaz` and on the CLI.
 *
 * The aliases are pure `export type X = Y`: additions, never renames.
 *
 * Runtime values — the validators, `toFormData`, the URL helpers, the settings
 * table, the credit arithmetic, the models table — stay on `unmodel/topaz`,
 * which tree-shakes to the few bytes a URL constant costs.
 *
 * Endpoints:
 *
 * - `topaz.upscale` → `UpscaleBody`
 * - `topaz.upscaleGenerative` → `UpscaleGenerativeBody`
 */

import type { TopazUpscaleParams } from "./upscale";
import type { TopazUpscaleGenerativeParams } from "./upscale-generative";

export type { TopazUpscaleParams } from "./upscale";

export type { TopazUpscaleGenerativeParams } from "./upscale-generative";

export type {
  TopazEnhanceGenModel,
  TopazEnhanceGenSettings,
  TopazEnhanceModel,
  TopazEnhanceSettings,
  TopazEnhancementStrength,
  TopazFaceSettings,
  TopazGrainModel,
  TopazModelId,
  TopazModelSettings,
  TopazOutputFormat,
  TopazStatus,
  TopazSubjectDetection,
} from "./shared";

export type { TopazCostInputs, TopazPricingFamily } from "./pricing";

export type { TopazCatalogModelId } from "./models";

// ---------------------------------------------------------------------------
// Uniform category aliases — one per endpoint address this provider serves.
// Pure type aliases: no rename, no runtime, no cost.
// ---------------------------------------------------------------------------

export type UpscaleBody = TopazUpscaleParams;
export type UpscaleGenerativeBody = TopazUpscaleGenerativeParams;
