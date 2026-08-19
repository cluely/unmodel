/**
 * BytePlus ModelArk video generation (Seedance / Dreamina Seedance) —
 * POST https://ark.ap-southeast.bytepluses.com/api/v3/contents/generations/tasks
 *
 * Wire notes (verified against
 * https://docs.byteplus.com/en/docs/ModelArk/1520757 and the per-model
 * capability matrix at
 * https://docs.byteplus.com/en/docs/ModelArk/2298881#e7b4c498 on 2026-08-13):
 * - This is an ASYNC-JOB API: the POST returns `{ id }`. Poll
 *   `GET /api/v3/contents/generations/tasks/{id}` (transport, out of
 *   unmodel's scope — `contentGenerationTaskUrl(id)` builds it) or supply a
 *   `callback_url`. Task records live 7 days; result URLs expire after 24h.
 * - `content` is a chat-style array: `{type:"text"}`, `{type:"image_url"}`,
 *   `{type:"video_url"}`, `{type:"audio_url"}` and Seedance 1.5 pro's
 *   `{type:"draft_task"}`. `role` selects the scenario — `first_frame` /
 *   `last_frame` (image-to-video) versus `reference_image` /
 *   `reference_video` / `reference_audio` (omni reference); the docs state
 *   those scenarios "cannot be mixed", which is enforced here.
 * - Output specs (`resolution`, `ratio`, `duration`, `frames`, `seed`,
 *   `camera_fixed`, `watermark`) have TWO documented input forms: request
 *   body fields ("Conventional method (recommended) … uses strict
 *   validation") and `--rs/--rt/--dur/--seed/--cf/--wm` commands appended to
 *   the prompt text ("Legacy method … Invalid parameters are ignored or cause
 *   an error"). unmodel validates the body fields; text commands ride inside
 *   `content[].text` untouched, so prefer the body form to get any checking
 *   at all.
 * - `duration: -1` means "the model picks the length" (2.x and 1.5 pro only)
 *   and `frames` (Seedance 1.0 only) takes precedence over `duration`.
 * - This route is AP-only: `eu-west-1` currently serves the chat and image
 *   APIs (https://docs.byteplus.com/en/docs/ModelArk/2191806).
 * - `model` also accepts a per-account Endpoint ID (`ep-…`), which cannot be
 *   cataloged; such requests validate with an `unknown_model` warning.
 * - Auth is `Authorization: Bearer <ARK_API_KEY>` — unmodel never touches
 *   keys; add the header yourself when fetching.
 */

import { z } from "zod";
import { createValidator, type PipelineContext } from "../../core/pipeline";
import { toValidated, JSON_HEADERS, type Validated, type ExactKeys } from "../../core/request";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";
import type { ModelInfo } from "../../core/catalog-types";
import type { EndpointConstraints } from "../../core/constraint-types";
import { videoModels } from "./models";
import {
  CONTENT_ROLES,
  EXECUTION_EXPIRES_RANGE,
  FRAMES_RANGE,
  OMNI_REFERENCE_TASK_TYPES,
  PRIORITY_RANGE,
  SAFETY_IDENTIFIER_MAX_LENGTH,
  SERVICE_TIERS,
  VIDEO_API_SOURCE,
  VIDEO_IMAGE_INPUT_RULE,
  VIDEO_MODELS_SOURCE,
  VIDEO_OUTPUT_FORMATS,
  VIDEO_RATIOS,
  VIDEO_SEED_RANGE,
  videoConstraints,
  videoShapeRules,
} from "./constraints";
import { arkBaseUrl, checkInlineImage, type ArkRegion } from "./shared";
import { videoCostUSD } from "./pricing";

/** Video-task URL for a ModelArk region (default, and currently only, AP). */
export function contentGenerationTasksUrl(region: ArkRegion = "ap-southeast-1"): string {
  return `${arkBaseUrl(region)}/contents/generations/tasks`;
}

export const CONTENT_GENERATION_TASKS_URL = contentGenerationTasksUrl();

/**
 * Polling URL for a submitted task (`GET …/tasks/{id}`). Polling is
 * transport — out of unmodel's scope; exported so callers don't hard-code it.
 */
export function contentGenerationTaskUrl(
  id: string,
  region: ArkRegion = "ap-southeast-1",
): string {
  return `${contentGenerationTasksUrl(region)}/${encodeURIComponent(id)}`;
}

// ---------------------------------------------------------------------------
// Wire types
// ---------------------------------------------------------------------------

export type ArkVideoRatio = (typeof VIDEO_RATIOS)[number];
export type ArkContentRole = (typeof CONTENT_ROLES)[number];

export interface ArkTextContent {
  type: "text";
  /** Prompt text; may carry legacy `--rs/--rt/--dur/…` commands. */
  text: string;
}

export interface ArkImageContent {
  type: "image_url";
  /** HTTPS URL, `data:image/<fmt>;base64,…`, or `asset://<ASSET_ID>`. */
  image_url: { url: string };
  /** Omit (or `first_frame`) for first-frame image-to-video. */
  role?: "first_frame" | "last_frame" | "reference_image";
}

export interface ArkVideoContent {
  type: "video_url";
  /** HTTPS URL or `asset://<ASSET_ID>` (mp4/mov). */
  video_url: { url: string };
  role?: "reference_video";
}

export interface ArkAudioContent {
  type: "audio_url";
  /** HTTPS URL, `data:audio/<fmt>;base64,…`, or `asset://<ASSET_ID>`. */
  audio_url: { url: string };
  role?: "reference_audio";
}

/** Seedance 1.5 pro draft mode: generate the final video from a draft task. */
export interface ArkDraftTaskContent {
  type: "draft_task";
  draft_task: { id: string };
}

/** Content items the omni-reference models (2.5 / 2.0 series) accept. */
export type ArkOmniContent =
  | ArkTextContent
  | ArkImageContent
  | ArkVideoContent
  | ArkAudioContent;

interface ContentGenerationTasksCore {
  /** POST target for the async result; ModelArk POSTs task status changes. */
  callback_url?: string;
  /** Also return the generated video's last frame as a PNG. Default false. */
  return_last_frame?: boolean;
  /** Task expiry in seconds, 3600–259200. Default 172800. */
  execution_expires_after?: number;
  /** Hashed end-user id, ≤ 64 chars. */
  safety_identifier?: string;
  /** Output aspect ratio; `adaptive` follows the input. */
  ratio?: ArkVideoRatio;
  /** Output length in seconds; range per model. */
  duration?: number;
  /** "AI Generated" watermark. Default false. */
  watermark?: boolean;
}

/** Dreamina Seedance 2.5: omni reference (incl. audio-only), mp4/mov output. */
export interface DreaminaSeedance25Body extends ContentGenerationTasksCore {
  model: "dreamina-seedance-2-5-260628";
  content: ArkOmniContent[];
  resolution?: "480p" | "720p";
  /** Synchronized audio in the output. Default true. */
  generate_audio?: boolean;
  /** Queue priority 0–9. Default 0. */
  priority?: number;
  /** Validates the omni sub-task's constraints at submit time. */
  omni_reference_task_type?: "auto" | "reference" | "edit" | "extend";
  /** Output container. Default "mp4". */
  output_format?: "mp4" | "mov";
  /** Online inference only for this model — `flex` is not supported. */
  service_tier?: "default";
  /** Seedance 1.5 pro / 1.0 only. */
  seed?: never;
  /** Seedance 1.5 pro / 1.0 only. */
  camera_fixed?: never;
  /** Seedance 1.0 only. */
  frames?: never;
  /** Seedance 1.5 pro only. */
  draft?: never;
}

interface Seedance20Fields extends ContentGenerationTasksCore {
  content: ArkOmniContent[];
  /** Synchronized audio in the output. Default true. */
  generate_audio?: boolean;
  /** Queue priority 0–9. Default 0. */
  priority?: number;
  /** Online inference only for the 2.0 series — `flex` is not supported. */
  service_tier?: "default";
  /** Dreamina Seedance 2.5 only. */
  omni_reference_task_type?: never;
  /** Dreamina Seedance 2.5 only — the 2.0 series always outputs mp4. */
  output_format?: never;
  /** Seedance 1.5 pro / 1.0 only. */
  seed?: never;
  /** Seedance 1.5 pro / 1.0 only. */
  camera_fixed?: never;
  /** Seedance 1.0 only. */
  frames?: never;
  /** Seedance 1.5 pro only. */
  draft?: never;
}

/** Dreamina Seedance 2.0 — the only Seedance with 1080p and 4K output. */
export interface DreaminaSeedance20Body extends Seedance20Fields {
  model: "dreamina-seedance-2-0-260128";
  resolution?: "480p" | "720p" | "1080p" | "4k";
}

export interface DreaminaSeedance20FastBody extends Seedance20Fields {
  model: "dreamina-seedance-2-0-fast-260128";
  resolution?: "480p" | "720p";
}

export interface DreaminaSeedance20MiniBody extends Seedance20Fields {
  model: "dreamina-seedance-2-0-mini-260615";
  resolution?: "480p" | "720p";
}

/** Seedance 1.5 pro: image-to-video + audio + draft mode, no omni reference. */
export interface Seedance15ProBody extends ContentGenerationTasksCore {
  model: "seedance-1-5-pro-251215";
  content: Array<ArkTextContent | ArkImageContent | ArkDraftTaskContent>;
  resolution?: "480p" | "720p" | "1080p";
  /** Synchronized audio in the output. Default true. */
  generate_audio?: boolean;
  /** Cheap 480p preview pass; incompatible with `return_last_frame`/`flex`. */
  draft?: boolean;
  /** -1 (random) to 2147483647. Default -1. */
  seed?: number;
  /** Ask the model to hold the camera still. Default false. */
  camera_fixed?: boolean;
  service_tier?: "default" | "flex";
  /** Dreamina Seedance 2.5 only. */
  omni_reference_task_type?: never;
  /** Dreamina Seedance 2.5 only. */
  output_format?: never;
  /** Seedance 1.0 only. */
  frames?: never;
  /** Dreamina Seedance 2.5 / 2.0 series only. */
  priority?: never;
}

interface Seedance10Fields extends ContentGenerationTasksCore {
  content: Array<ArkTextContent | ArkImageContent>;
  resolution?: "480p" | "720p" | "1080p";
  /** -1 (random) to 2147483647. Default -1. */
  seed?: number;
  /** Ask the model to hold the camera still. Default false. */
  camera_fixed?: boolean;
  /** Frame count (25 + 4n, 29–289); wins over `duration`. */
  frames?: number;
  service_tier?: "default" | "flex";
  /** Seedance 1.0 always outputs silent video. */
  generate_audio?: never;
  /** Seedance 1.5 pro only. */
  draft?: never;
  /** Dreamina Seedance 2.5 / 2.0 series only. */
  priority?: never;
  /** Dreamina Seedance 2.5 only. */
  omni_reference_task_type?: never;
  /** Dreamina Seedance 2.5 only. */
  output_format?: never;
}

export interface Seedance10ProBody extends Seedance10Fields {
  model: "seedance-1-0-pro-250528";
}

/** Seedance 1.0 pro fast: first-frame image-to-video only (no last frame). */
export interface Seedance10ProFastBody extends Seedance10Fields {
  model: "seedance-1-0-pro-fast-251015";
}

/** Escape hatch for ids unmodel has no arm for (new models, `ep-…` endpoints). */
export interface UnknownVideoModelBody {
  model: string & {};
  content: unknown[];
  [key: string]: unknown;
}

export type ContentGenerationTasksBody =
  | DreaminaSeedance25Body
  | DreaminaSeedance20Body
  | DreaminaSeedance20FastBody
  | DreaminaSeedance20MiniBody
  | Seedance15ProBody
  | Seedance10ProBody
  | Seedance10ProFastBody
  | UnknownVideoModelBody;

interface VideoBodyByModel {
  "dreamina-seedance-2-5-260628": DreaminaSeedance25Body;
  "dreamina-seedance-2-0-260128": DreaminaSeedance20Body;
  "dreamina-seedance-2-0-fast-260128": DreaminaSeedance20FastBody;
  "dreamina-seedance-2-0-mini-260615": DreaminaSeedance20MiniBody;
  "seedance-1-5-pro-251215": Seedance15ProBody;
  "seedance-1-0-pro-250528": Seedance10ProBody;
  "seedance-1-0-pro-fast-251015": Seedance10ProFastBody;
}

/** Resolves a model id literal to its exact Tier-A arm. */
type VideoArm<M extends string> = M extends keyof VideoBodyByModel
  ? VideoBodyByModel[M]
  : UnknownVideoModelBody;

// ---------------------------------------------------------------------------
// Schema — permissive on `content[].type` so a newly documented content type
// warns instead of failing; the pairing rules are enforced in checks.
// ---------------------------------------------------------------------------

const urlObjectSchema = z.looseObject({ url: z.string().min(1) });

const contentItemSchema = z.looseObject({
  type: z.string(),
  text: z.string().optional(),
  image_url: urlObjectSchema.optional(),
  video_url: urlObjectSchema.optional(),
  audio_url: urlObjectSchema.optional(),
  draft_task: z.looseObject({ id: z.string().min(1) }).optional(),
  role: z.string().optional(),
});

const videoSchema = z.looseObject({
  model: z.string(),
  content: z.array(contentItemSchema).min(1, "content must contain at least one item"),
  callback_url: z.string().optional(),
  return_last_frame: z.boolean().optional(),
  service_tier: z.enum(SERVICE_TIERS).optional(),
  execution_expires_after: z
    .number()
    .int()
    .min(EXECUTION_EXPIRES_RANGE.min)
    .max(EXECUTION_EXPIRES_RANGE.max)
    .optional(),
  generate_audio: z.boolean().optional(),
  draft: z.boolean().optional(),
  safety_identifier: z.string().max(SAFETY_IDENTIFIER_MAX_LENGTH).optional(),
  priority: z.number().int().min(PRIORITY_RANGE.min).max(PRIORITY_RANGE.max).optional(),
  resolution: z.string().optional(),
  ratio: z.string().optional(),
  duration: z.number().int().optional(),
  omni_reference_task_type: z.enum(OMNI_REFERENCE_TASK_TYPES).optional(),
  frames: z.number().int().optional(),
  output_format: z.enum(VIDEO_OUTPUT_FORMATS).optional(),
  seed: z.number().int().min(VIDEO_SEED_RANGE.min).max(VIDEO_SEED_RANGE.max).optional(),
  camera_fixed: z.boolean().optional(),
  watermark: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

type AnyRecord = Record<string, unknown>;

interface ContentTally {
  text: number;
  firstFrame: number;
  lastFrame: number;
  referenceImage: number;
  referenceVideo: number;
  referenceAudio: number;
  draftTask: number;
  images: number;
  audio: number;
  video: number;
}

const KNOWN_CONTENT_TYPES = ["text", "image_url", "video_url", "audio_url", "draft_task"] as const;

function tallyContent(params: ContentGenerationTasksBody): ContentTally {
  const tally: ContentTally = {
    text: 0,
    firstFrame: 0,
    lastFrame: 0,
    referenceImage: 0,
    referenceVideo: 0,
    referenceAudio: 0,
    draftTask: 0,
    images: 0,
    audio: 0,
    video: 0,
  };
  for (const item of contentItems(params)) {
    const type = item["type"];
    const role = item["role"];
    if (type === "text") tally.text += 1;
    else if (type === "image_url") {
      tally.images += 1;
      if (role === "last_frame") tally.lastFrame += 1;
      else if (role === "reference_image") tally.referenceImage += 1;
      else tally.firstFrame += 1; // "first_frame" or blank
    } else if (type === "video_url") {
      tally.video += 1;
      tally.referenceVideo += 1;
    } else if (type === "audio_url") {
      tally.audio += 1;
      tally.referenceAudio += 1;
    } else if (type === "draft_task") tally.draftTask += 1;
  }
  return tally;
}

function contentItems(params: ContentGenerationTasksBody): AnyRecord[] {
  const content = (params as AnyRecord)["content"];
  if (!Array.isArray(content)) return [];
  return content.filter((item): item is AnyRecord => typeof item === "object" && item !== null);
}

/** Content item shapes, roles, per-model support and per-model counts. */
function checkContent(
  params: ContentGenerationTasksBody,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const items = contentItems(params);
  const model = params.model;

  items.forEach((item, index) => {
    const type = item["type"];
    if (typeof type !== "string") return;
    if (!KNOWN_CONTENT_TYPES.includes(type as (typeof KNOWN_CONTENT_TYPES)[number])) {
      ctx.report({
        code: "unknown_param",
        path: ["content", index, "type"],
        model,
        message: `\`content[${index}].type\` "${type}" is not a content type unmodel knows for this endpoint (${KNOWN_CONTENT_TYPES.join(", ")}); it was passed through unvalidated.`,
        meta: { source: VIDEO_API_SOURCE },
      });
      return;
    }
    const companion =
      type === "text"
        ? "text"
        : type === "draft_task"
          ? "draft_task"
          : type; // image_url / video_url / audio_url are their own companion key
    if (item[companion] == null) {
      ctx.report({
        code: "invalid_shape",
        path: ["content", index, companion],
        model,
        message: `\`content[${index}]\` has type "${type}" but no \`${companion}\` payload.`,
        meta: { source: VIDEO_API_SOURCE },
      });
    }
    const role = item["role"];
    if (typeof role === "string" && !CONTENT_ROLES.includes(role as ArkContentRole)) {
      ctx.report({
        code: "invalid_enum_value",
        path: ["content", index, "role"],
        model,
        message: `\`content[${index}].role\` must be one of ${CONTENT_ROLES.map((r) => JSON.stringify(r)).join(", ")}; got ${JSON.stringify(role)}.`,
        meta: { allowed: [...CONTENT_ROLES], value: role, source: VIDEO_API_SOURCE },
      });
    }
    if (type === "image_url") {
      const url = (item["image_url"] as AnyRecord | undefined)?.["url"];
      checkInlineImage(
        ctx,
        url,
        ["content", index, "image_url", "url"],
        model,
        VIDEO_IMAGE_INPUT_RULE,
        VIDEO_API_SOURCE,
      );
    }
  });

  if (info === undefined) return;
  const rule = videoShapeRules[model];
  if (rule === undefined) return;
  const tally = tallyContent(params);

  const cap = (
    count: number,
    limit: number,
    label: string,
    path: Array<string | number>,
    unsupportedHint: string,
  ): void => {
    if (count <= limit) return;
    ctx.report({
      code: "unsupported_capability",
      path,
      model,
      message:
        limit === 0
          ? `"${model}" does not accept ${label}: ${unsupportedHint}`
          : `"${model}" accepts at most ${limit} ${label}; got ${count}.`,
      meta: { count, limit, source: VIDEO_MODELS_SOURCE },
    });
  };

  cap(tally.referenceImage, rule.maxReferenceImages, "reference images", ["content"], "omni reference-to-video is a Dreamina Seedance 2.5 / 2.0 series capability.");
  cap(tally.referenceVideo, rule.maxReferenceVideos, "reference videos", ["content"], "video input is a Dreamina Seedance 2.5 / 2.0 series capability.");
  cap(tally.referenceAudio, rule.maxReferenceAudio, "reference audio clips", ["content"], "audio input is a Dreamina Seedance 2.5 / 2.0 series capability.");
  cap(tally.firstFrame, 1, "first-frame images", ["content"], "");
  cap(tally.lastFrame, rule.supportsLastFrame ? 1 : 0, "last-frame images", ["content"], "it supports first-frame image-to-video only.");
  cap(tally.draftTask, model === "seedance-1-5-pro-251215" ? 1 : 0, "draft task references", ["content"], "draft mode is a Seedance 1.5 pro capability.");

  const frames = tally.firstFrame + tally.lastFrame;
  const references = tally.referenceImage + tally.referenceVideo + tally.referenceAudio;
  if (frames > 0 && references > 0) {
    ctx.report({
      code: "unsupported_capability",
      path: ["content"],
      model,
      message:
        "image-to-video (`first_frame`/`last_frame`) and omni reference (`reference_image`/`reference_video`/`reference_audio`) are mutually exclusive scenarios and cannot be mixed in one request.",
      meta: { frames, references, source: VIDEO_API_SOURCE },
    });
  }

  if (
    !rule.supportsAudioOnlyReference &&
    tally.referenceAudio > 0 &&
    tally.referenceImage === 0 &&
    tally.referenceVideo === 0
  ) {
    ctx.report({
      code: "unsupported_capability",
      path: ["content"],
      model,
      message: `"${model}" does not support audio-only input: include at least one reference image or reference video.`,
      meta: { source: VIDEO_API_SOURCE },
    });
  }
}

/** `duration` range (and the documented `-1` "model picks" value) per model. */
function checkDuration(
  params: ContentGenerationTasksBody,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const duration = (params as AnyRecord)["duration"];
  if (typeof duration !== "number" || info === undefined) return;
  const rule = videoShapeRules[params.model];
  if (rule === undefined) return;
  if (duration === -1) {
    if (rule.allowsAutoDuration) return;
    ctx.report({
      code: "invalid_enum_value",
      path: ["duration"],
      model: params.model,
      message: `\`duration: -1\` (model-selected length) is documented for Dreamina Seedance 2.x and Seedance 1.5 pro; "${params.model}" takes ${rule.minDuration}–${rule.maxDuration} seconds.`,
      meta: { min: rule.minDuration, max: rule.maxDuration, source: VIDEO_API_SOURCE },
    });
    return;
  }
  if (duration < rule.minDuration || duration > rule.maxDuration) {
    ctx.report({
      code: "invalid_enum_value",
      path: ["duration"],
      model: params.model,
      message: `\`duration\` must be ${rule.minDuration}–${rule.maxDuration} seconds${rule.allowsAutoDuration ? " (or -1)" : ""} for "${params.model}"; got ${duration}.`,
      meta: { min: rule.minDuration, max: rule.maxDuration, value: duration, source: VIDEO_API_SOURCE },
    });
  }
}

/** `frames` must be 25 + 4n within [29, 289]. */
function checkFrames(
  params: ContentGenerationTasksBody,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const frames = (params as AnyRecord)["frames"];
  if (typeof frames !== "number") return;
  const inRange = frames >= FRAMES_RANGE.min && frames <= FRAMES_RANGE.max;
  const onStep = (frames - FRAMES_RANGE.base) % FRAMES_RANGE.step === 0;
  if (inRange && onStep) return;
  ctx.report({
    code: "invalid_enum_value",
    path: ["frames"],
    model: params.model,
    message: `\`frames\` must be an integer in [${FRAMES_RANGE.min}, ${FRAMES_RANGE.max}] of the form 25 + 4n; got ${frames}.`,
    meta: { min: FRAMES_RANGE.min, max: FRAMES_RANGE.max, value: frames, source: VIDEO_API_SOURCE },
  });
}

/** `ratio` rules that depend on the task the content describes. */
function checkRatio(
  params: ContentGenerationTasksBody,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const ratio = (params as AnyRecord)["ratio"];
  if (typeof ratio !== "string" || info === undefined) return;
  const rule = videoShapeRules[params.model];
  if (rule === undefined) return;
  const tally = tallyContent(params);
  const imageToVideo = tally.firstFrame + tally.lastFrame > 0;

  if (ratio === "adaptive" && !imageToVideo && !rule.supportsAdaptiveRatioForTextToVideo) {
    ctx.report({
      code: "invalid_enum_value",
      path: ["ratio"],
      model: params.model,
      message: `"${params.model}" does not support \`ratio: "adaptive"\` for text-to-video; name an aspect ratio explicitly.`,
      meta: { value: ratio, source: VIDEO_API_SOURCE },
    });
  }
  if (ratio !== "adaptive" && imageToVideo && rule.forcesAdaptiveRatioForImageToVideo) {
    ctx.report({
      code: "invalid_enum_value",
      path: ["ratio"],
      model: params.model,
      message: `"${params.model}" preserves the first-frame image's aspect ratio: image-to-video "defaults to and only supports \`adaptive\`", got ${JSON.stringify(ratio)}.`,
      meta: { value: ratio, source: VIDEO_API_SOURCE },
    });
  }
}

/**
 * `omni_reference_task_type` sub-task constraints — the docs state the API
 * validates these at submit time when the type is set explicitly.
 */
function checkOmniTaskType(
  params: ContentGenerationTasksBody,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const taskType = (params as AnyRecord)["omni_reference_task_type"];
  if (taskType !== "edit" && taskType !== "extend") return;
  const record = params as AnyRecord;
  const tally = tallyContent(params);
  if (tally.referenceVideo === 0) {
    ctx.report({
      code: "invalid_shape",
      path: ["content"],
      model: params.model,
      message: `\`omni_reference_task_type: "${taskType}"\` requires at least one \`reference_video\` content item.`,
      meta: { source: VIDEO_API_SOURCE },
    });
  }
  const ratio = record["ratio"];
  if (typeof ratio === "string" && ratio !== "adaptive") {
    ctx.report({
      code: "invalid_enum_value",
      path: ["ratio"],
      model: params.model,
      message: `\`omni_reference_task_type: "${taskType}"\` requires \`ratio: "adaptive"\`; got ${JSON.stringify(ratio)}.`,
      meta: { value: ratio, source: VIDEO_API_SOURCE },
    });
  }
  const duration = record["duration"];
  if (taskType === "edit" && typeof duration === "number" && duration !== -1) {
    ctx.report({
      code: "invalid_enum_value",
      path: ["duration"],
      model: params.model,
      message: `\`omni_reference_task_type: "edit"\` keeps the input length: \`duration\` must be -1, got ${duration}.`,
      meta: { value: duration, source: VIDEO_API_SOURCE },
    });
  }
}

/** Draft mode (Seedance 1.5 pro) forces 480p and excludes flex/last-frame. */
function checkDraft(
  params: ContentGenerationTasksBody,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const record = params as AnyRecord;
  if (record["draft"] !== true) return;
  const source = "https://docs.byteplus.com/en/docs/ModelArk/2298881#5acd28c8";
  const resolution = record["resolution"];
  if (typeof resolution === "string" && resolution !== "480p") {
    ctx.report({
      code: "invalid_enum_value",
      path: ["resolution"],
      model: params.model,
      message: `draft mode generates 480p only ("using other resolutions will cause an error"); got ${JSON.stringify(resolution)}.`,
      meta: { value: resolution, source },
    });
  }
  if (record["return_last_frame"] === true) {
    ctx.report({
      code: "unsupported_capability",
      path: ["return_last_frame"],
      model: params.model,
      message: "draft mode does not support the last-frame return function.",
      meta: { source },
    });
  }
  if (record["service_tier"] === "flex") {
    ctx.report({
      code: "unsupported_capability",
      path: ["service_tier"],
      model: params.model,
      message: "draft mode does not support offline inference (`service_tier: \"flex\"`).",
      meta: { source },
    });
  }
}

// ---------------------------------------------------------------------------
// Estimation — documented USD/second × output seconds (see ./pricing.ts).
// A request that feeds reference video also bills for the input seconds,
// which a URL does not reveal: those estimates are a floor.
// ---------------------------------------------------------------------------

function estimate(params: ContentGenerationTasksBody, info: ModelInfo | undefined) {
  if (info === undefined) return {};
  const record = params as AnyRecord;
  const costUSD = videoCostUSD(params.model, {
    resolution: typeof record["resolution"] === "string" ? (record["resolution"] as string) : undefined,
    duration: typeof record["duration"] === "number" ? (record["duration"] as number) : undefined,
    frames: typeof record["frames"] === "number" ? (record["frames"] as number) : undefined,
    generateAudio:
      typeof record["generate_audio"] === "boolean" ? (record["generate_audio"] as boolean) : undefined,
    draft: typeof record["draft"] === "boolean" ? (record["draft"] as boolean) : undefined,
  });
  return costUSD === undefined ? {} : { costUSD };
}

/**
 * The one `.toSdk("bytedance")` target for this endpoint — the Volcengine
 * ARK SDK takes wire-shaped params. Derived from the `sdk` literal in
 * `finalize`; it must stay an object type with no index signature, or
 * `toSdk` would accept any string.
 */
type BytedanceSdkTargets<B> = { bytedance: () => B };

function finalize(params: ContentGenerationTasksBody): unknown {
  const body = { ...params };
  return toValidated(body, {
    url: CONTENT_GENERATION_TASKS_URL,
    method: "POST",
    headers: JSON_HEADERS,
  }, {
    sdk: { bytedance: () => body },
  });
}

const validator = createValidator<ContentGenerationTasksBody, unknown>({
  endpoint: "bytedance.video",
  schema: videoSchema,
  modelId: (params) => params.model,
  catalog: videoModels,
  constraints: videoConstraints,
  checks: [checkContent, checkDuration, checkFrames, checkRatio, checkOmniTaskType, checkDraft],
  estimate,
  finalize,
});

/**
 * Validates wire params for BytePlus ModelArk
 * `POST /api/v3/contents/generations/tasks` (Seedance video generation).
 * Known models get their exact param surface at compile time (e.g. `seed` is
 * a compile error for Dreamina Seedance 2.5, `frames` for anything but
 * Seedance 1.0); unknown ids fall back to a loose arm with a runtime
 * `unknown_model` warning.
 *
 * The returned object's enumerable props are the exact fetch JSON body.
 * BytePlus ships no official JS SDK, so `.toSdk("bytedance")` returns it unchanged. The
 * POST only creates a task (`{ id }`) — poll `contentGenerationTaskUrl(id)`
 * or pass a `callback_url`. Auth is your job: add
 * `authorization: Bearer <ARK_API_KEY>` when fetching.
 *
 * ```ts
 * const params = bytedance.video({
 *   model: "seedance-1-5-pro-251215",
 *   content: [{ type: "text", text: "The kitten is yawning at the camera." }],
 *   resolution: "720p",
 *   ratio: "16:9",
 *   duration: 5,
 * });
 * const res = await fetch(params.request.url, {
 *   method: params.request.method,
 *   headers: { ...params.request.headers, authorization: `Bearer ${process.env.ARK_API_KEY}` },
 *   body: JSON.stringify(params),
 * });
 * const { id } = await res.json(); // then poll contentGenerationTaskUrl(id)
 * ```
 */
export const video = validator as unknown as {
  <M extends ContentGenerationTasksBody["model"], T extends VideoArm<M>>(
    params: T & VideoArm<M> & { model: M } & ExactKeys<T, VideoArm<M>>,
    options?: ValidateOptions,
  ): Validated<T, BytedanceSdkTargets<T>>;
  safe<M extends ContentGenerationTasksBody["model"], T extends VideoArm<M>>(
    params: T & VideoArm<M> & { model: M } & ExactKeys<T, VideoArm<M>>,
    options?: ValidateOptions,
  ): ValidateResult<Validated<T, BytedanceSdkTargets<T>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
