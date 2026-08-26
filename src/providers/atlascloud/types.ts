/**
 * `unmodel/atlascloud/types` — every `atlascloud` type, and nothing else.
 *
 * **Zero runtime.** Every export in this module is a `type`, so the emitted
 * JavaScript is an empty module: importing it adds nothing to a bundle. That
 * is pinned, against a real build, by `test/types-entries.test.ts`.
 *
 * Reach for this entry when you want unmodel's doc-corrected request shapes at
 * compile time and are sending the request yourself:
 *
 * ```ts
 * import type { VideoBody } from "unmodel/atlascloud/types";
 *
 * const body = {
 *   model: "bytedance/seedance-2.5/reference-to-video",
 *   reference_images: ["asset://abc123"],
 *   duration: -1,
 * } satisfies VideoBody;
 * ```
 *
 * Two families of name live here, and `docs/decisions.md` §2 is why:
 *
 * - the **wire names** (`GenerateVideoBody`, and one arm per curated model id)
 *   — Atlas titles every model's request schema `Input`, so the union takes the
 *   route's own name (`generateVideo`) and each arm is named after the model id
 *   it belongs to;
 * - the **uniform category alias** (`VideoBody`) — one per endpoint address
 *   this provider serves, named after the word you already type at
 *   `unmodel/atlascloud` and on the CLI.
 *
 * Runtime values — the validator, the URL helpers, the models table, the
 * pricing caveat — stay on `unmodel/atlascloud`.
 *
 * Endpoints:
 *
 * - `atlascloud.video` → `VideoBody`
 */

import type { GenerateVideoBody } from "./video";

export type {
  GenerateVideoBody,
  UnknownVideoModelBody,
  AtlasMediaRef,
  AtlasMediaUrl,
  AtlasMediaDataUrl,
  AtlasAssetRef,
  AtlasVideoRatio,
  AtlasWanRatio,
  AtlasSeedance15AspectRatio,
  AtlasVeoAspectRatio,
  AtlasOutputFormat,
  AtlasBitrateMode,
  AtlasOmniReferenceTaskType,
  AtlasSeedance25Resolution,
  AtlasSeedance20Resolution,
  AtlasSeedance20SmallResolution,
  AtlasSeedance15Resolution,
  AtlasSeedance15FastResolution,
  AtlasWanPrimeResolution,
  AtlasWanResolution,
  AtlasVeoResolution,
  Seedance25TextToVideoBody,
  Seedance25ImageToVideoBody,
  Seedance25ReferenceToVideoBody,
  Seedance20TextToVideoBody,
  Seedance20ImageToVideoBody,
  Seedance20ReferenceToVideoBody,
  Seedance20MiniTextToVideoBody,
  Seedance20MiniImageToVideoBody,
  Seedance20MiniReferenceToVideoBody,
  Seedance20FastTextToVideoBody,
  Seedance20FastImageToVideoBody,
  Seedance20FastReferenceToVideoBody,
  Seedance15ProTextToVideoBody,
  Seedance15ProImageToVideoBody,
  Seedance15ProTextToVideoFastBody,
  Seedance15ProImageToVideoFastBody,
  Wan30PrimeTextToVideoBody,
  Wan30PrimeImageToVideoBody,
  Wan30TextToVideoBody,
  Wan30ImageToVideoBody,
  Veo31TextToVideoBody,
  Veo31ImageToVideoBody,
  Veo31ReferenceToVideoBody,
} from "./video";

export type { VideoShapeRule } from "./constraints";

export type { AtlascloudListedPrice } from "./pricing";

export type { AtlascloudModelId, AtlascloudVideoModelId } from "./models";

// ---------------------------------------------------------------------------
// Uniform category aliases — one per endpoint address this provider serves.
// Pure type aliases: no rename, no runtime, no cost.
// ---------------------------------------------------------------------------

export type VideoBody<FutureModel extends string = never> = GenerateVideoBody<FutureModel>;
