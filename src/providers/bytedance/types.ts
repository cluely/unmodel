/**
 * `unmodel/bytedance/types` — every `bytedance` type, and nothing else.
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
 * import type { ImageBody } from "unmodel/bytedance/types";
 *
 * const body = {
 *   // … the documented fields, checked at compile time
 * } satisfies ImageBody;
 * ```
 *
 * Two families of name live here, and `docs/decisions.md` §2 is why:
 *
 * - the **wire names** (`ImageGenerationsBody`, `Seedream50ProBody`,
 *   `Seedream50Body`, …) — re-exported verbatim, because they are how you
 *   find the endpoint in the provider's own documentation;
 * - the **uniform category aliases** (`ImageBody`, `VideoBody`) — one per
 *   endpoint address this provider serves, named after the word you already
 *   type at `unmodel/bytedance` and on the CLI.
 *
 * The aliases are pure `export type X = Y`: additions, never renames. Where an
 * alias name already IS the wire name, the wire name wins and no duplicate is
 * declared.
 *
 * Runtime values — validators, `check*` helpers, URL constants, the models
 * table — stay on `unmodel/bytedance`, which tree-shakes to the few bytes a
 * URL constant costs.
 *
 * Endpoints:
 *
 * - `bytedance.image` → `ImageBody`
 * - `bytedance.video` → `VideoBody`
 */

import type { ImageGenerationsBody } from "./image";
import type { ContentGenerationTasksBody } from "./video";

export type {
  BytedanceImageSize,
  ImageGenerationsBody,
  Seedream50ProBody,
  Seedream50Body,
  Seedream50LiteBody,
  Seedream45Body,
  Seedream40Body,
  UnknownImageModelBody,
  OptimizePromptOptions,
  StandardOnlyOptimizePromptOptions,
  SequentialImageGenerationOptions,
} from "./image";

export type {
  ContentGenerationTasksBody,
  DreaminaSeedance25Body,
  DreaminaSeedance20Body,
  DreaminaSeedance20FastBody,
  DreaminaSeedance20MiniBody,
  Seedance15ProBody,
  Seedance10ProBody,
  Seedance10ProFastBody,
  UnknownVideoModelBody,
  ArkTextContent,
  ArkImageContent,
  ArkVideoContent,
  ArkAudioContent,
  ArkDraftTaskContent,
  ArkOmniContent,
  ArkVideoRatio,
  ArkContentRole,
} from "./video";

export type { ArkRegion, ArkImageRule } from "./shared";

export type { BytedanceImageSizeKeyword, ImageShapeRule, VideoShapeRule } from "./constraints";

export type { ImagePricingFields, VideoPricingFields } from "./pricing";

export type { BytedanceModelId, BytedanceImageModelId, BytedanceVideoModelId } from "./models";

// ---------------------------------------------------------------------------
// Uniform category aliases — one per endpoint address this provider serves.
// Pure type aliases: no rename, no runtime, no cost.
// ---------------------------------------------------------------------------

export type ImageBody<FutureModel extends string = never> = ImageGenerationsBody<FutureModel>;
export type VideoBody<FutureModel extends string = never> = ContentGenerationTasksBody<FutureModel>;
