/**
 * MiniMax Video Generation V2 (MiniMax-H3) —
 * POST https://api.minimax.io/v2/video_generation
 *
 * Wire notes (transcribed from the OpenAPI document embedded in
 * https://platform.minimax.io/docs/api-reference/video-generation-v2-create on
 * 2026-08-13):
 * - ASYNC submit like the v1 route, with its own task API: poll
 *   `GET /v2/query/video_generation/{task_id}` (videoV2QueryUrl) or supply a
 *   `callback_url`. Statuses are queued / running / succeeded / failed /
 *   cancelled.
 * - Inputs are a single multimodal `content` array instead of separate image
 *   fields. EVERY request needs exactly one non-empty `text` item; images,
 *   videos and audio are labelled with a `role`, and the scenarios are:
 *     text-to-video          text only
 *     image-to-video         text + first_frame and/or last_frame image
 *     reference-to-video     text + reference_image/_video/_audio items
 *   Image-to-video and reference-to-video are MUTUALLY EXCLUSIVE.
 * - `ratio` is required (and cannot be "adaptive") for text-to-video; for
 *   image-to-video it is always adaptive (a concrete value is accepted but
 *   ignored).
 * - Billing is per second of OUTPUT: $0.08/s at 768P, $0.13/s at 2K. Input
 *   material is billed separately — the first 5 images are free and further
 *   ones are $0.04 each (folded into the estimate), while reference VIDEO is
 *   billed by its own duration, which the wire does not carry, so it is not
 *   estimated.
 * - Auth is `Authorization: Bearer <MINIMAX_API_KEY>` — unmodel never touches
 *   keys; add the header yourself when fetching.
 */

import { z } from "zod";
import { createValidator, type PipelineContext } from "../../core/pipeline";
import { JSON_HEADERS, toValidated, type ExactKeys, type Validated } from "../../core/request";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";
import type { ModelInfo } from "../../core/catalog-types";
import type { EndpointConstraints } from "../../core/constraint-types";
import { videoV2Models, type MinimaxVideoV2ModelId } from "./models";

export const VIDEO_GENERATION_V2_URL = "https://api.minimax.io/v2/video_generation";
/** Polling endpoint for a submitted v2 task: `${VIDEO_V2_QUERY_URL}/{task_id}`. */
export const VIDEO_V2_QUERY_URL = "https://api.minimax.io/v2/query/video_generation";

const VIDEO_V2_DOCS = "https://platform.minimax.io/docs/api-reference/video-generation-v2-create";

/** Models this route serves. */
export const VIDEO_V2_MODEL_IDS: readonly string[] = ["MiniMax-H3"];

/** Documented `resolution` values. */
export const VIDEO_V2_RESOLUTIONS = ["768P", "2K"] as const;
export type MinimaxVideoV2Resolution = (typeof VIDEO_V2_RESOLUTIONS)[number];

/** Documented `duration` values, in seconds (4–15). */
export const VIDEO_V2_DURATIONS = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] as const;
/** One documented `duration`; the runtime checks membership of the same list. */
export type MinimaxVideoV2Duration = (typeof VIDEO_V2_DURATIONS)[number];

/** Documented `ratio` values; "adaptive" is the default. */
export const VIDEO_V2_RATIOS = [
  "adaptive",
  "21:9",
  "16:9",
  "4:3",
  "1:1",
  "3:4",
  "9:16",
] as const;
export type MinimaxVideoV2Ratio = (typeof VIDEO_V2_RATIOS)[number];

/** `content[].type` values. */
export const VIDEO_V2_CONTENT_TYPES = ["text", "image_url", "video_url", "audio_url"] as const;
/** `content[].role` values. */
export const VIDEO_V2_ROLES = [
  "first_frame",
  "last_frame",
  "reference_image",
  "reference_video",
  "reference_audio",
] as const;

/** "Length is counted by characters, with a maximum of 7000 characters per `text`." */
export const VIDEO_V2_TEXT_MAX_CHARACTERS = 7000;

/** Documented input-count caps: first/last frame ≤ 1, reference images ≤ 9. */
export const VIDEO_V2_MAX_REFERENCE_IMAGES = 9;
/** Reference videos ≤ 3, reference audio ≤ 3. */
export const VIDEO_V2_MAX_REFERENCE_VIDEOS = 3;
export const VIDEO_V2_MAX_REFERENCE_AUDIO = 3;

/** USD per second of generated video, by resolution (768P is the catalog rate). */
export const VIDEO_V2_USD_PER_SECOND: Readonly<Record<string, number>> = {
  "768P": 0.08,
  "2K": 0.13,
};

/** "First 5 images free; $0.04 per additional image." */
export const VIDEO_V2_FREE_IMAGES = 5;
export const VIDEO_V2_USD_PER_EXTRA_IMAGE = 0.04;

// ---------------------------------------------------------------------------
// Wire types — mirror the raw JSON body exactly (snake_case).
// ---------------------------------------------------------------------------

/** A media location: public URL, `mm_file://{file_id}`, or a base64 data URI. */
export interface MinimaxMediaUrl {
  url: string;
}

export interface MinimaxV2ContentItem {
  type: (typeof VIDEO_V2_CONTENT_TYPES)[number] | (string & {});
  /** Set when `type` is "text"; up to 7000 characters. */
  text?: string;
  /** Set when `type` is "image_url". */
  image_url?: MinimaxMediaUrl;
  /** Set when `type` is "video_url" (reference scenario only). */
  video_url?: MinimaxMediaUrl;
  /** Set when `type` is "audio_url" (reference scenario only). */
  audio_url?: MinimaxMediaUrl;
  /** Position/purpose of this item; conditionally required. */
  role?: (typeof VIDEO_V2_ROLES)[number] | (string & {});
}

export interface VideoGenerationV2Params {
  /** Currently "MiniMax-H3". Required. */
  model: MinimaxVideoV2ModelId | (string & {});
  /** Multimodal input; exactly one non-empty `text` item is required. */
  content: MinimaxV2ContentItem[];
  /** Output resolution. Required; "768P" and "2K" are the whole documented set. */
  resolution: MinimaxVideoV2Resolution;
  /** Output duration in seconds. Required; every integer 4–15 is documented. */
  duration: MinimaxVideoV2Duration;
  /** Aspect ratio; required and non-adaptive for text-to-video. */
  ratio?: MinimaxVideoV2Ratio;
  /** URL MiniMax POSTs task status changes to. */
  callback_url?: string;
}

// ---------------------------------------------------------------------------
// Schema (loose: unknown keys pass through with a warning).
// ---------------------------------------------------------------------------

const mediaUrlSchema = z.looseObject({ url: z.string() });

const contentItemSchema = z.looseObject({
  type: z.string(),
  text: z
    .string()
    .max(
      VIDEO_V2_TEXT_MAX_CHARACTERS,
      `each text item allows at most ${VIDEO_V2_TEXT_MAX_CHARACTERS} characters`,
    )
    .optional(),
  image_url: mediaUrlSchema.optional(),
  video_url: mediaUrlSchema.optional(),
  audio_url: mediaUrlSchema.optional(),
  role: z.string().optional(),
});

const videoGenerationV2Schema = z.looseObject({
  model: z.string().min(1, "model is required"),
  content: z.array(contentItemSchema).min(1, "content must contain at least one item"),
  resolution: z.string(),
  duration: z.number().int(),
  ratio: z.string().optional(),
  callback_url: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

const MODEL_SET = new Set<string>(VIDEO_V2_MODEL_IDS);
const RESOLUTION_SET = new Set<string>(VIDEO_V2_RESOLUTIONS);
const RATIO_SET = new Set<string>(VIDEO_V2_RATIOS);
const CONTENT_TYPE_SET = new Set<string>(VIDEO_V2_CONTENT_TYPES);
const ROLE_SET = new Set<string>(VIDEO_V2_ROLES);
const DURATION_SET = new Set<number>(VIDEO_V2_DURATIONS);

function checkModelEnum(
  params: VideoGenerationV2Params,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (MODEL_SET.has(params.model)) return;
  ctx.report({
    code: "invalid_enum_value",
    path: ["model"],
    model: params.model,
    message: `\`model\` must be one of ${VIDEO_V2_MODEL_IDS.map((v) => JSON.stringify(v)).join(", ")} on /v2/video_generation; got ${JSON.stringify(params.model)}.`,
    meta: { allowed: [...VIDEO_V2_MODEL_IDS], value: params.model, source: VIDEO_V2_DOCS },
  });
}

function checkResolutionDuration(
  params: VideoGenerationV2Params,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (!RESOLUTION_SET.has(params.resolution)) {
    ctx.report({
      code: "invalid_enum_value",
      path: ["resolution"],
      model: params.model,
      message: `\`resolution\` must be one of ${VIDEO_V2_RESOLUTIONS.map((v) => JSON.stringify(v)).join(", ")}; got ${JSON.stringify(params.resolution)}.`,
      meta: { allowed: [...VIDEO_V2_RESOLUTIONS], value: params.resolution, source: VIDEO_V2_DOCS },
    });
  }
  if (!DURATION_SET.has(params.duration)) {
    ctx.report({
      code: "invalid_enum_value",
      path: ["duration"],
      model: params.model,
      message: `\`duration\` must be an integer between ${VIDEO_V2_DURATIONS[0]} and ${VIDEO_V2_DURATIONS[VIDEO_V2_DURATIONS.length - 1]} seconds; got ${params.duration}.`,
      meta: { allowed: [...VIDEO_V2_DURATIONS], value: params.duration, source: VIDEO_V2_DOCS },
    });
  }
}

interface ContentSummary {
  texts: number;
  nonEmptyTexts: number;
  firstFrames: number;
  lastFrames: number;
  referenceImages: number;
  referenceVideos: number;
  referenceAudio: number;
  images: number;
}

/** Counts the content array by type and role, defaulting a lone image to first_frame. */
function summarize(content: MinimaxV2ContentItem[]): ContentSummary {
  const summary: ContentSummary = {
    texts: 0,
    nonEmptyTexts: 0,
    firstFrames: 0,
    lastFrames: 0,
    referenceImages: 0,
    referenceVideos: 0,
    referenceAudio: 0,
    images: 0,
  };
  for (const item of content) {
    if (item?.type === "text") {
      summary.texts += 1;
      if ((item.text ?? "").trim() !== "") summary.nonEmptyTexts += 1;
    } else if (item?.type === "image_url") {
      summary.images += 1;
      // "when there is a single image and no role is set, it defaults to first_frame".
      const role = item.role ?? "first_frame";
      if (role === "reference_image") summary.referenceImages += 1;
      else if (role === "last_frame") summary.lastFrames += 1;
      else summary.firstFrames += 1;
    } else if (item?.type === "video_url") {
      summary.referenceVideos += 1;
    } else if (item?.type === "audio_url") {
      summary.referenceAudio += 1;
    }
  }
  return summary;
}

/**
 * The documented content rules: a non-empty text item is always required, the
 * per-role counts are capped, and image-to-video cannot be mixed with
 * reference-to-video.
 */
function checkContent(
  params: VideoGenerationV2Params,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const content = params.content;
  if (!Array.isArray(content)) return;

  for (const [index, item] of content.entries()) {
    if (item?.type !== undefined && !CONTENT_TYPE_SET.has(item.type)) {
      ctx.report({
        code: "invalid_enum_value",
        path: ["content", index, "type"],
        message: `\`content[${index}].type\` must be one of ${VIDEO_V2_CONTENT_TYPES.map((v) => JSON.stringify(v)).join(", ")}; got ${JSON.stringify(item.type)}.`,
        meta: { allowed: [...VIDEO_V2_CONTENT_TYPES], value: item.type, source: VIDEO_V2_DOCS },
      });
    }
    if (item?.role !== undefined && !ROLE_SET.has(item.role)) {
      ctx.report({
        code: "invalid_enum_value",
        path: ["content", index, "role"],
        message: `\`content[${index}].role\` must be one of ${VIDEO_V2_ROLES.map((v) => JSON.stringify(v)).join(", ")}; got ${JSON.stringify(item.role)}.`,
        meta: { allowed: [...VIDEO_V2_ROLES], value: item.role, source: VIDEO_V2_DOCS },
      });
    }
  }

  const summary = summarize(content);
  if (summary.nonEmptyTexts === 0) {
    ctx.report({
      code: "invalid_shape",
      path: ["content"],
      message:
        "Every request must include one non-empty `text` item — the prompt is required in every scenario.",
      meta: { source: VIDEO_V2_DOCS },
    });
  }
  if (summary.firstFrames > 1) {
    ctx.report({
      code: "invalid_shape",
      path: ["content"],
      message: `At most one first-frame image is allowed; got ${summary.firstFrames}.`,
      meta: { max: 1, count: summary.firstFrames, source: VIDEO_V2_DOCS },
    });
  }
  if (summary.lastFrames > 1) {
    ctx.report({
      code: "invalid_shape",
      path: ["content"],
      message: `At most one last-frame image is allowed; got ${summary.lastFrames}.`,
      meta: { max: 1, count: summary.lastFrames, source: VIDEO_V2_DOCS },
    });
  }
  if (summary.referenceImages > VIDEO_V2_MAX_REFERENCE_IMAGES) {
    ctx.report({
      code: "invalid_shape",
      path: ["content"],
      message: `At most ${VIDEO_V2_MAX_REFERENCE_IMAGES} reference images are allowed; got ${summary.referenceImages}.`,
      meta: {
        max: VIDEO_V2_MAX_REFERENCE_IMAGES,
        count: summary.referenceImages,
        source: VIDEO_V2_DOCS,
      },
    });
  }
  if (summary.referenceVideos > VIDEO_V2_MAX_REFERENCE_VIDEOS) {
    ctx.report({
      code: "invalid_shape",
      path: ["content"],
      message: `At most ${VIDEO_V2_MAX_REFERENCE_VIDEOS} reference videos are allowed; got ${summary.referenceVideos}.`,
      meta: {
        max: VIDEO_V2_MAX_REFERENCE_VIDEOS,
        count: summary.referenceVideos,
        source: VIDEO_V2_DOCS,
      },
    });
  }
  if (summary.referenceAudio > VIDEO_V2_MAX_REFERENCE_AUDIO) {
    ctx.report({
      code: "invalid_shape",
      path: ["content"],
      message: `At most ${VIDEO_V2_MAX_REFERENCE_AUDIO} reference audio clips are allowed; got ${summary.referenceAudio}.`,
      meta: {
        max: VIDEO_V2_MAX_REFERENCE_AUDIO,
        count: summary.referenceAudio,
        source: VIDEO_V2_DOCS,
      },
    });
  }

  const hasFrames = summary.firstFrames > 0 || summary.lastFrames > 0;
  const hasReferences =
    summary.referenceImages > 0 || summary.referenceVideos > 0 || summary.referenceAudio > 0;
  if (hasFrames && hasReferences) {
    ctx.report({
      code: "invalid_shape",
      path: ["content"],
      message:
        "Image-to-video and reference-to-video are mutually exclusive: `first_frame`/`last_frame` cannot appear alongside `reference_image`/`reference_video`/`reference_audio`.",
      meta: { source: VIDEO_V2_DOCS },
    });
  }

  // "Text-to-video: `ratio` is required and cannot be `adaptive`."
  const textToVideo = !hasFrames && !hasReferences;
  if (params.ratio !== undefined && !RATIO_SET.has(params.ratio)) {
    ctx.report({
      code: "invalid_enum_value",
      path: ["ratio"],
      message: `\`ratio\` must be one of ${VIDEO_V2_RATIOS.map((v) => JSON.stringify(v)).join(", ")}; got ${JSON.stringify(params.ratio)}.`,
      meta: { allowed: [...VIDEO_V2_RATIOS], value: params.ratio, source: VIDEO_V2_DOCS },
    });
  } else if (textToVideo && (params.ratio === undefined || params.ratio === "adaptive")) {
    ctx.report({
      code: "invalid_shape",
      path: ["ratio"],
      message:
        '`ratio` is required for text-to-video requests and cannot be "adaptive" — pick a concrete ratio such as "16:9".',
      meta: {
        allowed: VIDEO_V2_RATIOS.filter((r) => r !== "adaptive"),
        source: VIDEO_V2_DOCS,
      },
    });
  }
}

// ---------------------------------------------------------------------------
// Estimation — per second of output, plus the documented per-image surcharge.
// Reference VIDEO material is billed by its own duration, which the request
// body does not carry, so it is deliberately left out of the estimate.
// ---------------------------------------------------------------------------

function estimate(
  params: VideoGenerationV2Params,
  info: ModelInfo | undefined,
  _ctx: PipelineContext,
) {
  const rate = VIDEO_V2_USD_PER_SECOND[params.resolution] ?? info?.cost?.perVideoSecond;
  if (rate === undefined || typeof params.duration !== "number") return {};
  const images = Array.isArray(params.content) ? summarize(params.content).images : 0;
  const extraImages = Math.max(0, images - VIDEO_V2_FREE_IMAGES);
  return { costUSD: rate * params.duration + extraImages * VIDEO_V2_USD_PER_EXTRA_IMAGE };
}

// ---------------------------------------------------------------------------
// Finalize — the whole params object is the wire body.
// ---------------------------------------------------------------------------

/** Polling URL for a submitted v2 task id. */
export function videoV2QueryUrl(taskId: string): string {
  return `${VIDEO_V2_QUERY_URL}/${encodeURIComponent(taskId)}`;
}

/**
 * Written as a `type` kept in lockstep with the object literal in `finalize`:
 * an `interface extends Record<string, …>` would inherit a string index
 * signature and collapse `keyof` to `string`, so `.toSdk("anything")` would
 * type-check. See `SdkFormatters` in core/request.ts.
 */
type MinimaxSdkTargets<B> = { minimax: () => B };

function finalize(params: VideoGenerationV2Params): unknown {
  const body = { ...params };
  return toValidated(
    body,
    { url: VIDEO_GENERATION_V2_URL, method: "POST", headers: JSON_HEADERS },
    { sdk: { minimax: () => body } },
  );
}

const validator = createValidator<VideoGenerationV2Params, unknown>({
  endpoint: "minimax.videoGenerationV2",
  schema: videoGenerationV2Schema,
  modelId: (params) => params.model,
  catalog: videoV2Models,
  checks: [checkModelEnum, checkResolutionDuration, checkContent],
  estimate,
  finalize,
});

/**
 * Validates raw wire params for MiniMax `POST /v2/video_generation`
 * (MiniMax-H3: text-to-video, image-to-video and reference-to-video from one
 * multimodal `content` array, up to 2K).
 *
 * The returned object's enumerable props are the exact fetch JSON body;
 * MiniMax ships no official JS SDK for this API, so `.toSdk("minimax")` returns it
 * unchanged. The call is asynchronous: the response carries a task id you poll
 * with `videoV2QueryUrl(taskId)`. Auth is your job: add
 * `authorization: Bearer <MINIMAX_API_KEY>` when fetching.
 *
 * Cost is estimated as duration x the resolution rate ($0.08/s at 768P,
 * $0.13/s at 2K) plus $0.04 for every input image beyond the first five.
 *
 * ```ts
 * const params = minimax.videoGenerationV2({
 *   model: "MiniMax-H3",
 *   content: [{ type: "text", text: "A neon-lit street at night, slow dolly in" }],
 *   resolution: "768P",
 *   duration: 6,
 *   ratio: "16:9",
 * });
 * ```
 */
export const videoGenerationV2 = validator as unknown as {
  <T extends VideoGenerationV2Params>(
    params: T & ExactKeys<T, VideoGenerationV2Params>,
    options?: ValidateOptions,
  ): Validated<T, MinimaxSdkTargets<T>>;
  safe<T extends VideoGenerationV2Params>(
    params: T & ExactKeys<T, VideoGenerationV2Params>,
    options?: ValidateOptions,
  ): ValidateResult<Validated<T, MinimaxSdkTargets<T>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
