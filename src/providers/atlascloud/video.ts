/**
 * Atlas Cloud video generation — `POST https://api.atlascloud.ai/api/v1/model/generateVideo`.
 *
 * # This is ModelArk's vocabulary with `content[]` flattened
 *
 * Read this before "unifying" it with `bytedance.video`, because the two look
 * alike and are not the same wire. Atlas resells ByteDance's Seedance models
 * (plus Alibaba's Wan 3.0 and Google's Veo 3.1) and keeps ModelArk's *words* —
 * `ratio`, the `duration: -1` sentinel, `watermark`, `output_format`,
 * `omni_reference_task_type`, `asset://<ASSET_ID>` references — while changing
 * the two things that decide how a request is built:
 *
 * | | `bytedance` (ModelArk) | `atlascloud` |
 * |---|---|---|
 * | reference input | one chat-style `content[]` array whose items carry a `role` | three FLAT string arrays: `reference_images` / `reference_videos` / `reference_audios` |
 * | route selection | one url, `model` names the model | one url, `model` names the model **and the route**: `bytedance/seedance-2.5/text-to-video` |
 * | Seedance 2.5 `resolution` | 2 values | **11** — the `-sr`/`-esr` upscale ladder up to `4k-esr` |
 * | Seedance 2.5 i2v `ratio` | the 7-member enum | `adaptive` only |
 *
 * `src/providers/bytedance/video.ts` is the same weights through ByteDance's own
 * API and `fal.video` is the same weights through fal's queue; feeding one
 * provider's body to another's validator fails, which is the point of having
 * three (`docs/decisions.md` §1).
 *
 * # `model` is a REAL required field, not a pseudo-param
 *
 * fal routes by putting the endpoint id in the URL path, so `fal.video` takes an
 * `endpoint` pseudo-param that never reaches the wire. Atlas is simpler and
 * blunter: there is ONE url for every video model, `model` is a declared,
 * `required` property of every Input schema, and it is what selects both the
 * model and the task. So `model` here is an ordinary body field — it appears in
 * the JSON exactly as written — and no `endpoint` machinery exists.
 *
 * # Async job
 *
 * The POST creates a prediction and answers
 * `{ code, message, data: { id, status, outputs } }`. Poll
 * `predictionUrl(id)` (see ./urls.ts, which also records the second spelling
 * five of these schemas use) until `status` leaves `processing`. Polling is
 * transport and stays out of unmodel's scope.
 *
 * Auth is `Authorization: Bearer <ATLASCLOUD_API_KEY>` — unmodel never touches
 * keys; add the header yourself when fetching.
 *
 * Wire facts transcribed 2026-08-26 from the 23 committed snapshots in
 * `data/atlascloud/openapi/` and from https://www.atlascloud.ai/docs/models/video.
 */

import { z } from "zod";
import { createValidator, type PipelineContext } from "../../core/pipeline";
import { toValidated, JSON_HEADERS, type Validated, type ExactKeys } from "../../core/request";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";
import type { FutureModelId, ModelInfo } from "../../core/catalog-types";
import type { EndpointConstraints } from "../../core/constraint-types";
import { videoModels } from "./models";
import {
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
  VIDEO_OUTPUT_FORMATS,
  VIDEO_RATIOS,
  VIDEO_SEED_RANGE,
  WAN_PRIME_RESOLUTIONS,
  WAN_RATIOS,
  WAN_RESOLUTIONS,
  videoConstraints,
  videoShapeRules,
} from "./constraints";
import { GENERATE_VIDEO_URL } from "./urls";

// ---------------------------------------------------------------------------
// Media references — the three forms Atlas documents, typed
// ---------------------------------------------------------------------------

/**
 * A media reference, in each of the three forms Atlas's schemas name:
 *
 * > "Reference image URLs, Base64, or asset references (asset://<ASSET_ID>)."
 *
 * The three template literals are what autocomplete shows; the open tail is
 * what keeps a **bare** Base64 payload (the second documented form, which
 * carries no prefix of any kind) from being a compile error. Losing the tail
 * would make the type a lie in the other direction.
 */
export type AtlasMediaUrl = `https://${string}` | `http://${string}`;

/** A `data:` URL — the prefixed spelling of the Base64 form. */
export type AtlasMediaDataUrl = `data:${string}`;

/** `asset://<ASSET_ID>` — an id from `POST /api/v1/model/uploadMedia`. */
export type AtlasAssetRef = `asset://${string}`;

/** URL | Base64 | `asset://<ASSET_ID>`. */
export type AtlasMediaRef = AtlasMediaUrl | AtlasMediaDataUrl | AtlasAssetRef | (string & {});

// ---------------------------------------------------------------------------
// Wire types — one arm per curated model id, because at Atlas the ROUTE IS
// THE MODEL and the three routes of a family declare three different schemas.
// ---------------------------------------------------------------------------

/** `ratio` on the Seedance 2.x models; `adaptive` follows the primary input. */
export type AtlasVideoRatio = (typeof VIDEO_RATIOS)[number];
/** `ratio` on Wan 3.0 text-to-video — no `21:9`. */
export type AtlasWanRatio = (typeof WAN_RATIOS)[number];
/** `aspect_ratio` on Seedance v1.5 pro. */
export type AtlasSeedance15AspectRatio = (typeof SEEDANCE_15_ASPECT_RATIOS)[number];
/** `aspect_ratio` on Veo 3.1. */
export type AtlasVeoAspectRatio = (typeof VEO_ASPECT_RATIOS)[number];
/** `output_format` — Seedance 2.5 only. */
export type AtlasOutputFormat = (typeof VIDEO_OUTPUT_FORMATS)[number];
/** `bitrate_mode` — the Seedance 2.0 series only. */
export type AtlasBitrateMode = (typeof BITRATE_MODES)[number];
/** `omni_reference_task_type` — Seedance 2.5 reference-to-video only. */
export type AtlasOmniReferenceTaskType = (typeof OMNI_REFERENCE_TASK_TYPES)[number];

export type AtlasSeedance25Resolution = (typeof SEEDANCE_25_RESOLUTIONS)[number];
export type AtlasSeedance20Resolution = (typeof SEEDANCE_20_RESOLUTIONS)[number];
export type AtlasSeedance20SmallResolution = (typeof SEEDANCE_20_SMALL_RESOLUTIONS)[number];
export type AtlasSeedance15Resolution = (typeof SEEDANCE_15_RESOLUTIONS)[number];
export type AtlasSeedance15FastResolution = (typeof SEEDANCE_15_FAST_RESOLUTIONS)[number];
export type AtlasWanPrimeResolution = (typeof WAN_PRIME_RESOLUTIONS)[number];
export type AtlasWanResolution = (typeof WAN_RESOLUTIONS)[number];
export type AtlasVeoResolution = (typeof VEO_RESOLUTIONS)[number];

/** The frame fields — `/image-to-video` routes only. */
interface NoFrames {
  /** `/image-to-video` routes only — at Atlas the route IS the model. */
  image?: never;
  /** `/image-to-video` routes only. */
  last_image?: never;
}

/** The Seedance reference arrays — `/reference-to-video` routes only. */
interface NoReferenceArrays {
  /** Seedance `/reference-to-video` routes only. */
  reference_images?: never;
  /** Seedance `/reference-to-video` routes only. */
  reference_videos?: never;
  /** Seedance `/reference-to-video` routes only. */
  reference_audios?: never;
}

/** Fields that belong to some other family on this route. */
interface NotVeo {
  /** Veo 3.1 only. */
  negative_prompt?: never;
  /** Veo 3.1 reference-to-video only. */
  images?: never;
}

interface NotSeedance15 {
  /** Seedance v1.5 pro only. */
  camera_fixed?: never;
}

interface NotWan {
  /** Wan 3.0 spells its audio toggle `audio`. */
  audio?: never;
}

interface NotSeedance25 {
  /** Seedance 2.5 only. */
  output_format?: never;
  /** Seedance 2.5 reference-to-video only. */
  omni_reference_task_type?: never;
}

interface NotSeedance20 {
  /** The Seedance 2.0 / 2.0-fast / 2.0-mini series only. */
  bitrate_mode?: never;
}

interface NotSeedance2x {
  /** Seedance 2.x only on Atlas. */
  watermark?: never;
  /** Seedance 2.x only on Atlas. */
  return_last_frame?: never;
}

/** `aspect_ratio` is the Seedance v1.5 pro / Veo 3.1 spelling. */
interface NoAspectRatio {
  /** Seedance v1.5 pro and Veo 3.1 spell it `aspect_ratio`; this route has `ratio`. */
  aspect_ratio?: never;
}

/** `ratio` is the Seedance 2.x / Wan 3.0 spelling. */
interface NoRatio {
  /** The Seedance 2.x and Wan 3.0 routes spell it `ratio`; this route has `aspect_ratio`. */
  ratio?: never;
}

// --- Seedance 2.5 ----------------------------------------------------------

interface Seedance25Shared
  extends NotVeo,
    NotSeedance15,
    NotWan,
    NotSeedance20,
    NoAspectRatio {
  /** Text prompt. Cite references in submission order with `@Image1`, `@Video1`, `@Audio1`. */
  prompt?: string;
  /** 4–30 seconds, or `-1` for the model to choose. Default 5. */
  duration?: number;
  /** Default `"720p"`. `-sr`/`-esr` tiers upscale a smaller native render. */
  resolution?: AtlasSeedance25Resolution;
  /** Synchronized audio in the output. Default true. */
  generate_audio?: boolean;
  /** "AI generated" watermark. Default false. */
  watermark?: boolean;
  /** Also return the clip's last frame as a separate image. Default false. */
  return_last_frame?: boolean;
  /** `"mov"` encodes yuv444p for multi-round editing pipelines. Default `"mp4"`. */
  output_format?: AtlasOutputFormat;
  /** Seedance 2.5's schemas declare no `seed`. */
  seed?: never;
}

export interface Seedance25TextToVideoBody extends Seedance25Shared, NoFrames, NoReferenceArrays {
  model: "bytedance/seedance-2.5/text-to-video";
  prompt: string;
  ratio?: AtlasVideoRatio;
  omni_reference_task_type?: never;
}

export interface Seedance25ImageToVideoBody extends Seedance25Shared, NoReferenceArrays {
  model: "bytedance/seedance-2.5/image-to-video";
  /** First frame: URL, Base64, or `asset://<ASSET_ID>`. */
  image: AtlasMediaRef;
  /** Last frame; the model interpolates from `image` to this one. */
  last_image?: AtlasMediaRef;
  /**
   * "Seedance 2.5 image-to-video (first-frame and first+last-frame) accepts
   * only 'adaptive': the output preserves the source image's aspect ratio."
   */
  ratio?: "adaptive";
  omni_reference_task_type?: never;
}

export interface Seedance25ReferenceToVideoBody extends Seedance25Shared, NoFrames {
  model: "bytedance/seedance-2.5/reference-to-video";
  /** Up to 30 reference images. */
  reference_images?: AtlasMediaRef[];
  /** Up to 10 reference videos; combined duration ≤ 30s. */
  reference_videos?: AtlasMediaRef[];
  /** Up to 10 reference audios; audio-only referencing is unique to 2.5. */
  reference_audios?: AtlasMediaRef[];
  ratio?: AtlasVideoRatio;
  /**
   * Validates the omni sub-task's constraints at submit time instead of
   * failing the job asynchronously. `"edit"` requires exactly one
   * `reference_videos` entry, `ratio: "adaptive"` and `duration: -1`.
   */
  omni_reference_task_type?: AtlasOmniReferenceTaskType;
}

// --- Seedance 2.0 / 2.0-mini / 2.0-fast ------------------------------------

interface Seedance20Shared
  extends NotVeo,
    NotSeedance15,
    NotWan,
    NotSeedance25,
    NoAspectRatio {
  /** Text prompt. "References like 'image 1', 'video 1' refer to inputs in order." */
  prompt?: string;
  /** 4–15 seconds, or `-1` for the model to choose. Default 5. */
  duration?: number;
  /** Aspect ratio; `adaptive` uses the primary media's. Default `"adaptive"`. */
  ratio?: AtlasVideoRatio;
  /** `"high"` encodes at a higher bitrate. "Does not affect token cost." */
  bitrate_mode?: AtlasBitrateMode;
  /** Synchronized audio in the output. Default true. */
  generate_audio?: boolean;
  /** "Value range: [-1, 2^32-1]. The default -1 means a random seed is used." */
  seed?: number;
  /** "AI generated" watermark. Default false. */
  watermark?: boolean;
  /** Also return the clip's last frame as a separate image. Default false. */
  return_last_frame?: boolean;
}

/** The full 2.0 model is the only Seedance here with native `4k`. */
export interface Seedance20TextToVideoBody extends Seedance20Shared, NoFrames, NoReferenceArrays {
  model: "bytedance/seedance-2.0/text-to-video";
  prompt: string;
  resolution?: AtlasSeedance20Resolution;
}

export interface Seedance20ImageToVideoBody extends Seedance20Shared, NoReferenceArrays {
  model: "bytedance/seedance-2.0/image-to-video";
  image: AtlasMediaRef;
  last_image?: AtlasMediaRef;
  resolution?: AtlasSeedance20Resolution;
}

export interface Seedance20ReferenceToVideoBody extends Seedance20Shared, NoFrames {
  model: "bytedance/seedance-2.0/reference-to-video";
  /** Up to 9 reference images. */
  reference_images?: AtlasMediaRef[];
  /** Up to 3 reference videos; total duration ≤ 15s. */
  reference_videos?: AtlasMediaRef[];
  /** Up to 3 reference audios. "Must include at least 1 reference video or image." */
  reference_audios?: AtlasMediaRef[];
  resolution?: AtlasSeedance20Resolution;
}

export interface Seedance20MiniTextToVideoBody
  extends Seedance20Shared,
    NoFrames,
    NoReferenceArrays {
  model: "bytedance/seedance-2.0-mini/text-to-video";
  prompt: string;
  resolution?: AtlasSeedance20SmallResolution;
}

export interface Seedance20MiniImageToVideoBody extends Seedance20Shared, NoReferenceArrays {
  model: "bytedance/seedance-2.0-mini/image-to-video";
  image: AtlasMediaRef;
  last_image?: AtlasMediaRef;
  resolution?: AtlasSeedance20SmallResolution;
}

export interface Seedance20MiniReferenceToVideoBody extends Seedance20Shared, NoFrames {
  model: "bytedance/seedance-2.0-mini/reference-to-video";
  reference_images?: AtlasMediaRef[];
  reference_videos?: AtlasMediaRef[];
  reference_audios?: AtlasMediaRef[];
  resolution?: AtlasSeedance20SmallResolution;
}

export interface Seedance20FastTextToVideoBody
  extends Seedance20Shared,
    NoFrames,
    NoReferenceArrays {
  model: "bytedance/seedance-2.0-fast/text-to-video";
  prompt: string;
  resolution?: AtlasSeedance20SmallResolution;
}

export interface Seedance20FastImageToVideoBody extends Seedance20Shared, NoReferenceArrays {
  model: "bytedance/seedance-2.0-fast/image-to-video";
  image: AtlasMediaRef;
  last_image?: AtlasMediaRef;
  resolution?: AtlasSeedance20SmallResolution;
}

export interface Seedance20FastReferenceToVideoBody extends Seedance20Shared, NoFrames {
  model: "bytedance/seedance-2.0-fast/reference-to-video";
  reference_images?: AtlasMediaRef[];
  reference_videos?: AtlasMediaRef[];
  reference_audios?: AtlasMediaRef[];
  resolution?: AtlasSeedance20SmallResolution;
}

// --- Seedance v1.5 pro -----------------------------------------------------

/**
 * The family that breaks the Atlas house dialect: `aspect_ratio` rather than
 * `ratio`, a `[4, 12]` RANGE rather than an enum, and no `-1` sentinel.
 */
interface Seedance15Shared
  extends NotVeo,
    NotWan,
    NotSeedance25,
    NotSeedance20,
    NotSeedance2x,
    NoRatio,
    NoReferenceArrays {
  prompt?: string;
  /** 4–12 seconds. Default 5. A range, not an enum — and no `-1`. */
  duration?: number;
  aspect_ratio?: AtlasSeedance15AspectRatio;
  /** Hold the camera still. Default false. */
  camera_fixed?: boolean;
  generate_audio?: boolean;
  /** "-1 means a random seed will be used." */
  seed?: number;
}

export interface Seedance15ProTextToVideoBody extends Seedance15Shared, NoFrames {
  model: "bytedance/seedance-v1.5-pro/text-to-video";
  prompt: string;
  resolution?: AtlasSeedance15Resolution;
}

export interface Seedance15ProImageToVideoBody extends Seedance15Shared {
  model: "bytedance/seedance-v1.5-pro/image-to-video";
  image: AtlasMediaRef;
  last_image?: AtlasMediaRef;
  resolution?: AtlasSeedance15Resolution;
}

export interface Seedance15ProTextToVideoFastBody extends Seedance15Shared, NoFrames {
  model: "bytedance/seedance-v1.5-pro/text-to-video-fast";
  prompt: string;
  resolution?: AtlasSeedance15FastResolution;
}

export interface Seedance15ProImageToVideoFastBody extends Seedance15Shared {
  model: "bytedance/seedance-v1.5-pro/image-to-video-fast";
  image: AtlasMediaRef;
  last_image?: AtlasMediaRef;
  resolution?: AtlasSeedance15FastResolution;
}

// --- Alibaba Wan 3.0 -------------------------------------------------------

/** Wan spells the audio toggle `audio` and requires `prompt` on both routes. */
interface WanShared
  extends NotVeo,
    NotSeedance15,
    NotSeedance25,
    NotSeedance20,
    NotSeedance2x,
    NoAspectRatio,
    NoReferenceArrays {
  /** Required on both Wan routes. "up to 20000 characters". */
  prompt: string;
  /** 2–30 seconds, or `-1` for "smart-duration". Default 5. */
  duration?: number;
  /** "Whether the output video includes an audio track. Same price either way." */
  audio?: boolean;
  /** "-1 means a random seed will be used." */
  seed?: number;
  /** Wan's schemas declare no `generate_audio`; the toggle is `audio`. */
  generate_audio?: never;
}

export interface Wan30PrimeTextToVideoBody extends WanShared, NoFrames {
  model: "alibaba/wan-3.0-prime/text-to-video";
  /** UPPER-case `P`, unlike every other resolution enum on this provider. */
  resolution?: AtlasWanPrimeResolution;
  ratio?: AtlasWanRatio;
}

export interface Wan30PrimeImageToVideoBody extends WanShared {
  model: "alibaba/wan-3.0-prime/image-to-video";
  /** "First frame of the video (strict first-frame mode). Public URL." */
  image: AtlasMediaRef;
  last_image?: AtlasMediaRef;
  resolution?: AtlasWanPrimeResolution;
  /** Wan's image-to-video schema has no `ratio`: the first frame decides it. */
  ratio?: never;
}

export interface Wan30TextToVideoBody extends WanShared, NoFrames {
  model: "alibaba/wan-3.0/text-to-video";
  /** Lower-case, with an `-esr` enhancement ladder the prime tier lacks. */
  resolution?: AtlasWanResolution;
  ratio?: AtlasWanRatio;
}

export interface Wan30ImageToVideoBody extends WanShared {
  model: "alibaba/wan-3.0/image-to-video";
  image: AtlasMediaRef;
  last_image?: AtlasMediaRef;
  resolution?: AtlasWanResolution;
  ratio?: never;
}

// --- Google Veo 3.1 --------------------------------------------------------

interface VeoShared
  extends NotSeedance15,
    NotWan,
    NotSeedance25,
    NotSeedance20,
    NotSeedance2x,
    NoRatio,
    NoReferenceArrays {
  /** Required on all three Veo routes. */
  prompt: string;
  /** 8, 4 or 6 seconds. Default 8. `1080p`/`4k` lock it to 8. */
  duration?: number;
  /** Default **false** here — the opposite of Seedance's default. */
  generate_audio?: boolean;
  negative_prompt?: string;
  resolution?: AtlasVeoResolution;
  seed?: number;
}

export interface Veo31TextToVideoBody extends VeoShared, NoFrames {
  model: "google/veo3.1/text-to-video";
  aspect_ratio?: AtlasVeoAspectRatio;
  images?: never;
}

export interface Veo31ImageToVideoBody extends VeoShared {
  model: "google/veo3.1/image-to-video";
  image: AtlasMediaRef;
  last_image?: AtlasMediaRef;
  aspect_ratio?: AtlasVeoAspectRatio;
  images?: never;
}

export interface Veo31ReferenceToVideoBody extends VeoShared, NoFrames {
  model: "google/veo3.1/reference-to-video";
  /** "Accepts 1 to 3 images" — URL or Base64, ≤ 50MB each. */
  images: AtlasMediaRef[];
  /** Fixed at 8: this route's `duration` enum has one member. */
  duration?: 8;
  /**
   * Absent from the schema's `properties`, even though its
   * `x-order-properties` lists it — an Atlas schema bug, recorded in
   * ./models.ts. The reference images decide the shape.
   */
  aspect_ratio?: never;
}

// --- The union -------------------------------------------------------------

/** Escape hatch for ids unmodel has no arm for (new Atlas models). */
export interface UnknownVideoModelBody<Model extends string> {
  model: FutureModelId<Model, keyof VideoBodyByModel>;
  [key: string]: unknown;
}

/**
 * Closed over the curated models by default. Supply a future id to opt into the
 * loose arm: `GenerateVideoBody<"kwaivgi/kling-v3.0-pro/text-to-video">`.
 */
export type GenerateVideoBody<FutureModel extends string = never> =
  | Seedance25TextToVideoBody
  | Seedance25ImageToVideoBody
  | Seedance25ReferenceToVideoBody
  | Seedance20TextToVideoBody
  | Seedance20ImageToVideoBody
  | Seedance20ReferenceToVideoBody
  | Seedance20MiniTextToVideoBody
  | Seedance20MiniImageToVideoBody
  | Seedance20MiniReferenceToVideoBody
  | Seedance20FastTextToVideoBody
  | Seedance20FastImageToVideoBody
  | Seedance20FastReferenceToVideoBody
  | Seedance15ProTextToVideoBody
  | Seedance15ProImageToVideoBody
  | Seedance15ProTextToVideoFastBody
  | Seedance15ProImageToVideoFastBody
  | Wan30PrimeTextToVideoBody
  | Wan30PrimeImageToVideoBody
  | Wan30TextToVideoBody
  | Wan30ImageToVideoBody
  | Veo31TextToVideoBody
  | Veo31ImageToVideoBody
  | Veo31ReferenceToVideoBody
  | UnknownVideoModelBody<FutureModel>;

interface VideoBodyByModel {
  "bytedance/seedance-2.5/text-to-video": Seedance25TextToVideoBody;
  "bytedance/seedance-2.5/image-to-video": Seedance25ImageToVideoBody;
  "bytedance/seedance-2.5/reference-to-video": Seedance25ReferenceToVideoBody;
  "bytedance/seedance-2.0/text-to-video": Seedance20TextToVideoBody;
  "bytedance/seedance-2.0/image-to-video": Seedance20ImageToVideoBody;
  "bytedance/seedance-2.0/reference-to-video": Seedance20ReferenceToVideoBody;
  "bytedance/seedance-2.0-mini/text-to-video": Seedance20MiniTextToVideoBody;
  "bytedance/seedance-2.0-mini/image-to-video": Seedance20MiniImageToVideoBody;
  "bytedance/seedance-2.0-mini/reference-to-video": Seedance20MiniReferenceToVideoBody;
  "bytedance/seedance-2.0-fast/text-to-video": Seedance20FastTextToVideoBody;
  "bytedance/seedance-2.0-fast/image-to-video": Seedance20FastImageToVideoBody;
  "bytedance/seedance-2.0-fast/reference-to-video": Seedance20FastReferenceToVideoBody;
  "bytedance/seedance-v1.5-pro/text-to-video": Seedance15ProTextToVideoBody;
  "bytedance/seedance-v1.5-pro/image-to-video": Seedance15ProImageToVideoBody;
  "bytedance/seedance-v1.5-pro/text-to-video-fast": Seedance15ProTextToVideoFastBody;
  "bytedance/seedance-v1.5-pro/image-to-video-fast": Seedance15ProImageToVideoFastBody;
  "alibaba/wan-3.0-prime/text-to-video": Wan30PrimeTextToVideoBody;
  "alibaba/wan-3.0-prime/image-to-video": Wan30PrimeImageToVideoBody;
  "alibaba/wan-3.0/text-to-video": Wan30TextToVideoBody;
  "alibaba/wan-3.0/image-to-video": Wan30ImageToVideoBody;
  "google/veo3.1/text-to-video": Veo31TextToVideoBody;
  "google/veo3.1/image-to-video": Veo31ImageToVideoBody;
  "google/veo3.1/reference-to-video": Veo31ReferenceToVideoBody;
}

/** Resolves a model id literal to its exact Tier-A arm. */
type VideoArm<M extends string> = M extends keyof VideoBodyByModel
  ? VideoBodyByModel[M]
  : UnknownVideoModelBody<M>;

/** Runtime implementation type; the public alias stays closed by default. */
type AnyGenerateVideoBody = GenerateVideoBody<string>;
type VideoModelInput = keyof VideoBodyByModel | (string & {});

// ---------------------------------------------------------------------------
// Schema — the UNION of every curated model's fields, deliberately loose.
//
// Atlas publishes one Input schema per model, so no single zod object is any
// model's schema. What this one is for is layer 1: shapes and types, plus the
// `unknown_param` sweep over keys no Atlas video model declares. Which fields a
// given model actually has is `videoConstraints`' `deny` table, and which of
// them it REQUIRES is `videoShapeRules[model].required` (checkRequired below).
// ---------------------------------------------------------------------------

const mediaArraySchema = z.array(z.string().min(1));

const videoSchema = z.looseObject({
  model: z.string().min(1),
  prompt: z.string().optional(),
  image: z.string().min(1).optional(),
  last_image: z.string().min(1).optional(),
  images: mediaArraySchema.optional(),
  reference_images: mediaArraySchema.optional(),
  reference_videos: mediaArraySchema.optional(),
  reference_audios: mediaArraySchema.optional(),
  duration: z.number().int().optional(),
  resolution: z.string().optional(),
  ratio: z.string().optional(),
  aspect_ratio: z.string().optional(),
  camera_fixed: z.boolean().optional(),
  generate_audio: z.boolean().optional(),
  audio: z.boolean().optional(),
  negative_prompt: z.string().optional(),
  watermark: z.boolean().optional(),
  return_last_frame: z.boolean().optional(),
  output_format: z.enum(VIDEO_OUTPUT_FORMATS).optional(),
  omni_reference_task_type: z.enum(OMNI_REFERENCE_TASK_TYPES).optional(),
  bitrate_mode: z.enum(BITRATE_MODES).optional(),
  seed: z.number().int().min(VIDEO_SEED_RANGE.min).max(VIDEO_SEED_RANGE.max).optional(),
});

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

type AnyRecord = Record<string, unknown>;

/**
 * The fields a model's own schema lists as `required`, minus `model` (which the
 * zod schema already demands).
 *
 * This is per-model rather than per-schema because Atlas's twenty-three
 * documents disagree: `prompt` is required on every text route and on both Wan
 * image routes, optional on the Seedance image routes ("Optional but
 * recommended"), and absent from the required list on the Seedance reference
 * routes — where the *references* are the input.
 */
function checkRequired(
  params: AnyGenerateVideoBody,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (info === undefined) return;
  const rule = videoShapeRules[params.model];
  if (rule === undefined) return;
  const record = params as AnyRecord;
  for (const field of rule.required) {
    const value = record[field];
    if (value !== undefined && !(Array.isArray(value) && value.length === 0)) continue;
    ctx.report({
      code: "invalid_shape",
      path: [field],
      model: params.model,
      message: `\`${field}\` is required by "${params.model}" (its Input schema lists it in \`required\`).`,
      meta: { source: VIDEO_API_SOURCE },
    });
  }
}

/**
 * `duration` — the enum where the schema publishes one, the bounds where it
 * publishes a range, and the `-1` sentinel where it is a member.
 */
function checkDuration(
  params: AnyGenerateVideoBody,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const duration = (params as AnyRecord)["duration"];
  if (typeof duration !== "number" || info === undefined) return;
  const rule = videoShapeRules[params.model];
  if (rule === undefined) return;

  if (duration === AUTO_DURATION) {
    if (rule.allowsAutoDuration) return;
    ctx.report({
      code: "invalid_enum_value",
      path: ["duration"],
      model: params.model,
      message: `\`duration: -1\` (model-selected length) is an enum member on the Seedance 2.x and Wan 3.0 models; "${params.model}" takes ${rule.minDuration}–${rule.maxDuration} seconds.`,
      meta: { min: rule.minDuration, max: rule.maxDuration, source: VIDEO_API_SOURCE },
    });
    return;
  }

  const allowed = rule.durations;
  if (allowed !== undefined && !allowed.includes(duration)) {
    ctx.report({
      code: "invalid_enum_value",
      path: ["duration"],
      model: params.model,
      message: `\`duration\` must be one of ${allowed.join(", ")}${rule.allowsAutoDuration ? " (or -1)" : ""} for "${params.model}"; got ${duration}.`,
      meta: { allowed: [...allowed], value: duration, source: VIDEO_API_SOURCE },
    });
    return;
  }
  if (allowed === undefined && (duration < rule.minDuration || duration > rule.maxDuration)) {
    ctx.report({
      code: "invalid_enum_value",
      path: ["duration"],
      model: params.model,
      message: `\`duration\` must be ${rule.minDuration}–${rule.maxDuration} seconds for "${params.model}"; got ${duration}.`,
      meta: { min: rule.minDuration, max: rule.maxDuration, value: duration, source: VIDEO_API_SOURCE },
    });
  }
}

/**
 * Veo 3.1's `allOf` conditional, which is the one cross-field rule Atlas
 * expresses in JSON Schema rather than in prose:
 *
 * > "When resolution is 1080p or 4k, duration must be 8 (seconds)."
 */
function checkResolutionDuration(
  params: AnyGenerateVideoBody,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (info === undefined) return;
  const rule = videoShapeRules[params.model];
  const locked = rule?.durationLockedAtHighResolution;
  if (locked === undefined) return;
  const record = params as AnyRecord;
  const resolution = record["resolution"];
  const duration = record["duration"];
  if (resolution !== "1080p" && resolution !== "4k") return;
  if (typeof duration !== "number" || locked.includes(duration)) return;
  ctx.report({
    code: "invalid_enum_value",
    path: ["duration"],
    model: params.model,
    message: `"When resolution is 1080p or 4k, duration must be ${locked.join(" or ")} (seconds)." — got ${duration} at \`resolution: ${JSON.stringify(resolution)}\`.`,
    meta: { allowed: [...locked], value: duration, source: VIDEO_API_SOURCE },
  });
}

interface ReferenceCounts {
  images: number;
  videos: number;
  audios: number;
}

function referenceCounts(params: AnyGenerateVideoBody): ReferenceCounts {
  const record = params as AnyRecord;
  const count = (key: string): number => {
    const value = record[key];
    return Array.isArray(value) ? value.length : 0;
  };
  return {
    // Veo 3.1 spells its reference array `images`; Seedance spells it
    // `reference_images`. One counter, because both are capped the same way.
    images: count("reference_images") + count("images"),
    videos: count("reference_videos"),
    audios: count("reference_audios"),
  };
}

/** The `minItems`/`maxItems` bounds, and the audio-only rule the 2.0 series has. */
function checkReferences(
  params: AnyGenerateVideoBody,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (info === undefined) return;
  const rule = videoShapeRules[params.model];
  if (rule === undefined) return;
  const counts = referenceCounts(params);
  const record = params as AnyRecord;

  const cap = (count: number, max: number, min: number, key: string, label: string): void => {
    if (record[key] === undefined) return;
    // A field this model does not have at all is `videoConstraints`' business:
    // its deny rule names the id to pick instead, which is the better message.
    if (max === 0) return;
    // …and a REQUIRED array that arrived empty is `checkRequired`'s, so the
    // caller reads one issue rather than two spellings of it.
    if (count === 0 && rule.required.includes(key)) return;
    if (count > max) {
      ctx.report({
        code: "unsupported_capability",
        path: [key],
        model: params.model,
        message: `"${params.model}" accepts at most ${max} ${label}; got ${count}.`,
        meta: { count, limit: max, source: VIDEO_API_SOURCE },
      });
      return;
    }
    if (count < min) {
      ctx.report({
        code: "invalid_shape",
        path: [key],
        model: params.model,
        message: `\`${key}\` must contain at least ${min} ${label} for "${params.model}"; got ${count}.`,
        meta: { count, min, source: VIDEO_API_SOURCE },
      });
    }
  };

  cap(counts.images, rule.maxReferenceImages, rule.minReferenceImages, "reference_images", "reference images");
  cap(counts.images, rule.maxReferenceImages, rule.minReferenceImages, "images", "reference images");
  cap(counts.videos, rule.maxReferenceVideos, 1, "reference_videos", "reference videos");
  cap(counts.audios, rule.maxReferenceAudios, 1, "reference_audios", "reference audio clips");

  if (
    !rule.supportsAudioOnlyReference &&
    counts.audios > 0 &&
    counts.images === 0 &&
    counts.videos === 0
  ) {
    ctx.report({
      code: "unsupported_capability",
      path: ["reference_audios"],
      model: params.model,
      message: `"${params.model}" does not support audio-only input: "Must include at least 1 reference video or image."`,
      meta: { source: VIDEO_API_SOURCE },
    });
  }
}

/**
 * `omni_reference_task_type` — Seedance 2.5's submit-time sub-task validation.
 *
 * "'edit' edits an existing video and requires exactly one reference_videos
 * entry of 4-30s, ratio 'adaptive', and duration -1. 'extend' extends an
 * existing video and requires exactly one reference_videos entry and ratio
 * 'adaptive'."
 */
function checkOmniTaskType(
  params: AnyGenerateVideoBody,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const taskType = (params as AnyRecord)["omni_reference_task_type"];
  if (taskType !== "edit" && taskType !== "extend") return;
  const record = params as AnyRecord;
  const videos = referenceCounts(params).videos;
  if (videos !== 1) {
    ctx.report({
      code: "invalid_shape",
      path: ["reference_videos"],
      model: params.model,
      message: `\`omni_reference_task_type: "${taskType}"\` requires exactly one \`reference_videos\` entry; got ${videos}.`,
      meta: { count: videos, source: VIDEO_API_SOURCE },
    });
  }
  const ratio = record["ratio"];
  if (typeof ratio === "string" && ratio !== "adaptive") {
    ctx.report({
      code: "invalid_enum_value",
      path: ["ratio"],
      model: params.model,
      message: `\`omni_reference_task_type: "${taskType}"\` requires \`ratio: "adaptive"\` (the source video's ratio is preserved); got ${JSON.stringify(ratio)}.`,
      meta: { value: ratio, source: VIDEO_API_SOURCE },
    });
  }
  const duration = record["duration"];
  if (taskType === "edit" && typeof duration === "number" && duration !== AUTO_DURATION) {
    ctx.report({
      code: "invalid_enum_value",
      path: ["duration"],
      model: params.model,
      message: `\`omni_reference_task_type: "edit"\` keeps the input clip's length: \`duration\` must be -1, got ${duration}.`,
      meta: { value: duration, source: VIDEO_API_SOURCE },
    });
  }
}

/**
 * The two models whose shape field is pinned to `adaptive` by the schema, said
 * with the schema's own sentence rather than as a bare enum miss.
 *
 * `videoConstraints` already narrows `ratio` to `["adaptive"]` on Seedance 2.5
 * image-to-video, so this check exists for the message: the reason is a
 * property of the ROUTE ("the output preserves the source image's aspect
 * ratio"), and an `invalid_enum_value` listing one member does not say it.
 */
function checkAdaptiveRatio(
  params: AnyGenerateVideoBody,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (info === undefined) return;
  const rule = videoShapeRules[params.model];
  if (rule?.forcesAdaptiveRatio !== true) return;
  const ratio = (params as AnyRecord)["ratio"];
  if (typeof ratio !== "string" || ratio === "adaptive") return;
  ctx.report({
    code: "unsupported_capability",
    path: ["ratio"],
    model: params.model,
    message: `"Seedance 2.5 image-to-video (first-frame and first+last-frame) accepts only 'adaptive': the output preserves the source image's aspect ratio." — got ${JSON.stringify(ratio)}.`,
    meta: { value: ratio, source: VIDEO_API_SOURCE },
  });
}

/**
 * The one `.toSdk("atlascloud")` target — Atlas ships no typed client SDK (its
 * GitHub org publishes an MCP server, a CLI and a ComfyUI node), so the target
 * is the wire body unchanged. Derived from the `sdk` literal in `finalize`.
 */
type AtlascloudSdkTargets<B> = { atlascloud: () => B };

function finalize(params: AnyGenerateVideoBody): unknown {
  const body = { ...params };
  return toValidated(
    body,
    { url: GENERATE_VIDEO_URL, method: "POST", headers: JSON_HEADERS },
    { sdk: { atlascloud: () => body } },
  );
}

const validator = createValidator<AnyGenerateVideoBody, unknown>({
  endpoint: "atlascloud.video",
  schema: videoSchema,
  modelId: (params) => params.model,
  catalog: videoModels,
  constraints: videoConstraints,
  checks: [
    checkRequired,
    checkDuration,
    checkResolutionDuration,
    checkReferences,
    checkOmniTaskType,
    checkAdaptiveRatio,
  ],
  finalize,
});

/**
 * Validates wire params for Atlas Cloud
 * `POST /api/v1/model/generateVideo`.
 *
 * `model` is a REAL body field here and it names the route as well as the
 * model, so a known id gets that route's exact param surface at compile time
 * (`reference_images` is an error on a `/text-to-video` id, `ratio` on a Wan
 * `/image-to-video` id, `seed` on any Seedance 2.5 id); an unknown id falls
 * back to a loose arm with a runtime `unknown_model` warning.
 *
 * The returned object's enumerable props are the exact fetch JSON body. Atlas
 * ships no JS SDK, so `.toSdk("atlascloud")` returns it unchanged. The POST
 * only creates a prediction — poll `predictionUrl(id)`. Auth is your job: add
 * `authorization: Bearer <ATLASCLOUD_API_KEY>` when fetching.
 *
 * ```ts
 * const params = atlascloud.video({
 *   model: "bytedance/seedance-2.5/reference-to-video",
 *   prompt: "@Image1 walks into the snowfield at dusk",
 *   reference_images: ["https://example.com/fox.png"],
 *   ratio: "adaptive",
 *   duration: -1,
 * });
 * const res = await fetch(params.request.url, {
 *   method: params.request.method,
 *   headers: {
 *     ...params.request.headers,
 *     authorization: `Bearer ${process.env.ATLASCLOUD_API_KEY}`,
 *   },
 *   body: JSON.stringify(params),
 * });
 * const { data } = await res.json(); // then poll predictionUrl(data.id)
 * ```
 */
export const video = validator as unknown as {
  <M extends VideoModelInput, T extends VideoArm<M>>(
    params: T & VideoArm<M> & { model: M } & ExactKeys<T, VideoArm<M>>,
    options?: ValidateOptions<T>,
  ): Validated<T, AtlascloudSdkTargets<T>>;
  safe<M extends VideoModelInput, T extends VideoArm<M>>(
    params: T & VideoArm<M> & { model: M } & ExactKeys<T, VideoArm<M>>,
    options?: ValidateOptions<T>,
  ): ValidateResult<Validated<T, AtlascloudSdkTargets<T>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
