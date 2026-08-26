/**
 * `unmodel/atlascloud` — Atlas Cloud's video generation route.
 *
 * One address (`atlascloud.video`), one url
 * (`POST https://api.atlascloud.ai/api/v1/model/generateVideo`), and a `model`
 * field that names both the model and the route. Auth is
 * `Authorization: Bearer <ATLASCLOUD_API_KEY>`.
 *
 * Atlas resells other vendors' weights, so two of the three families here are
 * reachable through unmodel more than once — `bytedance/seedance-*` also at
 * `bytedance.video` (ByteDance's own ModelArk) and `fal.video` (fal's queue),
 * `google/veo3.1/*` also at `google.video` and `fal.video`. Those are three
 * different wires for one set of weights and unmodel keeps them apart on
 * purpose (`docs/decisions.md` §1); `src/providers/atlascloud/video.ts` opens
 * with the diff table.
 */

export {
  video,
  type GenerateVideoBody,
  type UnknownVideoModelBody,
  type AtlasMediaRef,
  type AtlasMediaUrl,
  type AtlasMediaDataUrl,
  type AtlasAssetRef,
  type AtlasVideoRatio,
  type AtlasWanRatio,
  type AtlasSeedance15AspectRatio,
  type AtlasVeoAspectRatio,
  type AtlasOutputFormat,
  type AtlasBitrateMode,
  type AtlasOmniReferenceTaskType,
  type AtlasSeedance25Resolution,
  type AtlasSeedance20Resolution,
  type AtlasSeedance20SmallResolution,
  type AtlasSeedance15Resolution,
  type AtlasSeedance15FastResolution,
  type AtlasWanPrimeResolution,
  type AtlasWanResolution,
  type AtlasVeoResolution,
  type Seedance25TextToVideoBody,
  type Seedance25ImageToVideoBody,
  type Seedance25ReferenceToVideoBody,
  type Seedance20TextToVideoBody,
  type Seedance20ImageToVideoBody,
  type Seedance20ReferenceToVideoBody,
  type Seedance20MiniTextToVideoBody,
  type Seedance20MiniImageToVideoBody,
  type Seedance20MiniReferenceToVideoBody,
  type Seedance20FastTextToVideoBody,
  type Seedance20FastImageToVideoBody,
  type Seedance20FastReferenceToVideoBody,
  type Seedance15ProTextToVideoBody,
  type Seedance15ProImageToVideoBody,
  type Seedance15ProTextToVideoFastBody,
  type Seedance15ProImageToVideoFastBody,
  type Wan30PrimeTextToVideoBody,
  type Wan30PrimeImageToVideoBody,
  type Wan30TextToVideoBody,
  type Wan30ImageToVideoBody,
  type Veo31TextToVideoBody,
  type Veo31ImageToVideoBody,
  type Veo31ReferenceToVideoBody,
} from "./video";

export {
  ATLASCLOUD_BASE_URL,
  GENERATE_VIDEO_URL,
  MODELS_CATALOG_URL,
  UPLOAD_MEDIA_URL,
  modelSchemaUrl,
  predictionUrl,
  resultUrl,
  uploadMediaUrl,
} from "./urls";

export {
  videoConstraints,
  videoShapeRules,
  AUTO_DURATION,
  BITRATE_MODES,
  OMNI_REFERENCE_TASK_TYPES,
  SEEDANCE_15_ASPECT_RATIOS,
  SEEDANCE_15_FAST_RESOLUTIONS,
  SEEDANCE_15_RESOLUTIONS,
  SEEDANCE_20_RESOLUTIONS,
  SEEDANCE_20_SMALL_RESOLUTIONS,
  SEEDANCE_25_RESOLUTIONS,
  VEO_ASPECT_RATIOS,
  VEO_RESOLUTIONS,
  VIDEO_API_SOURCE,
  VIDEO_MODELS_SOURCE,
  VIDEO_OUTPUT_FORMATS,
  VIDEO_RATIOS,
  VIDEO_SCHEMA_SOURCE,
  VIDEO_SEED_RANGE,
  VIDEO_VERIFIED,
  WAN_PRIME_RESOLUTIONS,
  WAN_RATIOS,
  WAN_RESOLUTIONS,
} from "./constraints";
export type { VideoShapeRule } from "./constraints";

export {
  ATLASCLOUD_LISTED_BASE_PRICE_USD,
  ATLASCLOUD_PRICING_CAVEAT,
  ATLASCLOUD_PRICING_SOURCE,
  ATLASCLOUD_PRICING_VERIFIED,
  ATLASCLOUD_VIDEO_TOKEN_FORMULA,
  listedPrice,
} from "./pricing";
export type { AtlascloudListedPrice } from "./pricing";

// No response checker, and no cost estimator either. The POST answers
// `{ code, message, data: { id, status, outputs } }` — a created prediction, not
// a result — so there is nothing response-side to check that is not polling,
// which is transport. And Atlas publishes no usable price UNIT (see ./pricing.ts
// and ATLASCLOUD_PRICING_CAVEAT), so `atlascloud.video` declares no `estimate`
// rather than returning a number whose meaning nobody can state.

export { models, videoModels, provider } from "./models";
export type { AtlascloudModelId, AtlascloudVideoModelId } from "./models";

// Declaration-portability carriers. One type-only line; see
// src/core/carriers.ts for why a consumer that emits its own `.d.ts` cannot
// name this entry's inferred result types without it (TS2742 / TS2883).
export type * from "../../core/carriers";
