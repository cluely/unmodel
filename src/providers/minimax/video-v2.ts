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
 * - Four models share the route — MiniMax-H3, -Highspeed, -Lite and -Max —
 *   and differ in resolutions, durations, one ratio rule, the `extra` options
 *   object and price (VIDEO_V2_MODEL_RULES, read off the OpenAPI document
 *   https://platform.minimax.io/docs/api-reference/video/generation/api/v2-video-generation.json
 *   and https://platform.minimax.io/docs/pricing/overview on 2026-11-12).
 * - Billing is per second of OUTPUT, by model and resolution. Input material
 *   is billed separately — images beyond a per-model free quota at a
 *   per-model rate (folded into the estimate), while reference VIDEO is
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

/** Models this route serves — the v2 catalog's ids. */
export const VIDEO_V2_MODEL_IDS: readonly string[] = Object.keys(videoV2Models);

/**
 * Documented `resolution` values across the route (the OpenAPI enum); each
 * model renders a subset — see {@link VIDEO_V2_MODEL_RULES}.
 */
export const VIDEO_V2_RESOLUTIONS = ["480P", "768P", "2K"] as const;
export type MinimaxVideoV2Resolution = (typeof VIDEO_V2_RESOLUTIONS)[number];

/**
 * Documented `duration` values across the route, in seconds (4–15); each
 * model takes a subset — see {@link VIDEO_V2_MODEL_RULES}.
 */
export const VIDEO_V2_DURATIONS = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] as const;
/** One documented `duration`; the runtime checks membership of the model's list. */
export type MinimaxVideoV2Duration = (typeof VIDEO_V2_DURATIONS)[number];

/**
 * `extra.prompt_expansion_mode` — "`disabled` disables prompt expansion;
 * `balanced` uses balanced expansion and is the default; `quality` prioritizes
 * expansion quality." (v2-video-generation.json, 2026-11-12)
 */
export const VIDEO_V2_PROMPT_EXPANSION_MODES = ["disabled", "balanced", "quality"] as const;
export type MinimaxVideoV2PromptExpansionMode = (typeof VIDEO_V2_PROMPT_EXPANSION_MODES)[number];

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
/**
 * The `content[].type` vocabulary, closed — like `MinimaxVideoV2Resolution` and
 * `MinimaxVideoV2Ratio` and unlike `model`. Protocol vocabulary, not an id:
 * `checkContentEnums` already refuses an off-list value with
 * `invalid_enum_value`, and `summarize` funnels an unrecognised item into the
 * first-frame branch, so a typo used to earn a second, misleading diagnostic.
 */
export type MinimaxV2ContentType = (typeof VIDEO_V2_CONTENT_TYPES)[number];
/** `content[].role` values. */
export const VIDEO_V2_ROLES = [
  "first_frame",
  "last_frame",
  "reference_image",
  "reference_video",
  "reference_audio",
] as const;
/** The `content[].role` vocabulary, closed for the reasons on {@link MinimaxV2ContentType}. */
export type MinimaxV2Role = (typeof VIDEO_V2_ROLES)[number];

/** "Length is counted by characters, with a maximum of 7000 characters per `text`." */
export const VIDEO_V2_TEXT_MAX_CHARACTERS = 7000;

/** Documented input-count caps: first/last frame ≤ 1, reference images ≤ 9. */
export const VIDEO_V2_MAX_REFERENCE_IMAGES = 9;
/** Reference videos ≤ 3, reference audio ≤ 3. */
export const VIDEO_V2_MAX_REFERENCE_VIDEOS = 3;
export const VIDEO_V2_MAX_REFERENCE_AUDIO = 3;

/** What one model on this route accepts and costs. */
export interface VideoV2ModelRule {
  /**
   * USD per second of OUTPUT video, by resolution. The key set is the
   * resolutions the model renders; the 768P entry is the catalog's
   * `perVideoSecond`.
   */
  readonly usdPerSecond: Readonly<Partial<Record<MinimaxVideoV2Resolution, number>>>;
  /** The `duration` values the model takes. */
  readonly durations: readonly MinimaxVideoV2Duration[];
  /** Input images per task billed at nothing. */
  readonly freeImages: number;
  /** USD per input image beyond `freeImages`. */
  readonly usdPerExtraImage: number;
  /** Reference-to-video accepts `ratio: "adaptive"`, its default. */
  readonly referenceAdaptiveRatio: boolean;
  /** The `extra` options object is documented for this model. */
  readonly extra: boolean;
}

/**
 * Per-model resolutions, durations, ratio and `extra` support, from the
 * `model`, `resolution`, `duration`, `ratio` and `extra` descriptions of
 * https://platform.minimax.io/docs/api-reference/video/generation/api/v2-video-generation.json,
 * and per-model rates from the "H3 Series Flagship Models" / "H3 Series
 * Extended Models" tables of https://platform.minimax.io/docs/pricing/overview
 * (both read 2026-11-12). A pricing row reads: output resolution | output
 * video per second | input video per second | input image beyond the free
 * quota. "**Image input**: The first **5 images** per task are free" for the
 * flagship three; "**MiniMax-H3-Max**: The first **2 images** per task are
 * free".
 */
export const VIDEO_V2_MODEL_RULES: Readonly<Record<MinimaxVideoV2ModelId, VideoV2ModelRule>> = {
  // "- **`MiniMax-H3`**: `768P`, `2K`"; "- **`MiniMax-H3`**: `4`–`15`".
  // Pricing: "2K | $0.13 | $0.13 | $0.04" and "768P | $0.08 | $0.08 | $0.04".
  "MiniMax-H3": {
    usdPerSecond: { "768P": 0.08, "2K": 0.13 },
    durations: VIDEO_V2_DURATIONS,
    freeImages: 5,
    usdPerExtraImage: 0.04,
    referenceAdaptiveRatio: true,
    extra: false,
  },
  // "- **`MiniMax-H3-Highspeed`**: `480P`, `768P` (`2K` is not supported)";
  // "- **`MiniMax-H3-Highspeed`**: `4`–`15`".
  // Pricing: "768P | $0.06 | $0.06 | $0.03" and "480P | $0.04 | $0.04 | $0.03".
  "MiniMax-H3-Highspeed": {
    usdPerSecond: { "480P": 0.04, "768P": 0.06 },
    durations: VIDEO_V2_DURATIONS,
    freeImages: 5,
    usdPerExtraImage: 0.03,
    referenceAdaptiveRatio: true,
    extra: false,
  },
  // "- **`MiniMax-H3-Lite`**: `480P`, `768P` (`2K` is not supported)";
  // "- **`MiniMax-H3-Lite`**: `4`–`15`"; and in the reference-to-video `ratio`
  // paragraph: "`MiniMax-H3-Lite` does not support `adaptive` yet; specify a
  // concrete ratio."
  // Pricing: "768P | $0.04 | $0.04 | $0.02" and "480P | $0.025 | $0.025 | $0.02".
  "MiniMax-H3-Lite": {
    usdPerSecond: { "480P": 0.025, "768P": 0.04 },
    durations: VIDEO_V2_DURATIONS,
    freeImages: 5,
    usdPerExtraImage: 0.02,
    referenceAdaptiveRatio: false,
    extra: false,
  },
  // "- **`MiniMax-H3-Max`**: `480P`, `768P` (`2K` is not supported)";
  // "- **`MiniMax-H3-Max`**: `5`–`15` (4 seconds is not supported)"; `extra`:
  // "Additional generation options for `MiniMax-H3-Max`."
  // Pricing: "768P | $0.08 | $0.143 | $0.074" and "480P | $0.05 | $0.0553 | $0.074".
  "MiniMax-H3-Max": {
    usdPerSecond: { "480P": 0.05, "768P": 0.08 },
    durations: [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    freeImages: 2,
    usdPerExtraImage: 0.074,
    referenceAdaptiveRatio: true,
    extra: true,
  },
};

// ---------------------------------------------------------------------------
// Wire types — mirror the raw JSON body exactly (snake_case).
// ---------------------------------------------------------------------------

/** A media location: public URL, `mm_file://{file_id}`, or a base64 data URI. */
export interface MinimaxMediaUrl {
  url: string;
}

export interface MinimaxV2ContentItem {
  type: MinimaxV2ContentType;
  /** Set when `type` is "text"; up to 7000 characters. */
  text?: string;
  /** Set when `type` is "image_url". */
  image_url?: MinimaxMediaUrl;
  /** Set when `type` is "video_url" (reference scenario only). */
  video_url?: MinimaxMediaUrl;
  /** Set when `type` is "audio_url" (reference scenario only). */
  audio_url?: MinimaxMediaUrl;
  /** Position/purpose of this item; conditionally required. */
  role?: MinimaxV2Role;
}

/** The `extra` options object — documented for MiniMax-H3-Max only. */
export interface MinimaxVideoV2Extra {
  /** "balanced" when `extra` or this property is omitted. */
  prompt_expansion_mode?: MinimaxVideoV2PromptExpansionMode;
}

export interface VideoGenerationV2Params {
  /** "MiniMax-H3", "MiniMax-H3-Highspeed", "MiniMax-H3-Lite" or "MiniMax-H3-Max". Required. */
  model: MinimaxVideoV2ModelId | (string & {});
  /** Multimodal input; exactly one non-empty `text` item is required. */
  content: MinimaxV2ContentItem[];
  /** Output resolution. Required; MiniMax-H3 renders 768P/2K, the other three 480P/768P. */
  resolution: MinimaxVideoV2Resolution;
  /** Output duration in seconds. Required; 4–15 (5–15 on MiniMax-H3-Max). */
  duration: MinimaxVideoV2Duration;
  /** Aspect ratio; required and non-adaptive for text-to-video. */
  ratio?: MinimaxVideoV2Ratio;
  /** Generation options for MiniMax-H3-Max; undeclared fields are refused. */
  extra?: MinimaxVideoV2Extra;
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

const videoV2Schema = z.looseObject({
  model: z.string().min(1, "model is required"),
  content: z.array(contentItemSchema).min(1, "content must contain at least one item"),
  resolution: z.string(),
  duration: z.number().int(),
  ratio: z.string().optional(),
  // "Do not pass `balance`, an empty string, a Boolean value, or other
  // undeclared fields" — `additionalProperties: false` in the OpenAPI schema.
  extra: z.strictObject({ prompt_expansion_mode: z.string().optional() }).optional(),
  callback_url: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

const MODEL_SET = new Set<string>(VIDEO_V2_MODEL_IDS);
const RATIO_SET = new Set<string>(VIDEO_V2_RATIOS);
const CONTENT_TYPE_SET = new Set<string>(VIDEO_V2_CONTENT_TYPES);
const ROLE_SET = new Set<string>(VIDEO_V2_ROLES);
const PROMPT_EXPANSION_SET = new Set<string>(VIDEO_V2_PROMPT_EXPANSION_MODES);

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

/**
 * `resolution` and `duration` against the model's own lists, or against the
 * route's documented enums when the model is off the route.
 */
function checkResolutionDuration(
  params: VideoGenerationV2Params,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const rule = ruleFor(params.model);
  const forModel = rule === undefined ? "" : ` for "${params.model}"`;
  const resolutions: readonly string[] =
    rule === undefined ? VIDEO_V2_RESOLUTIONS : Object.keys(rule.usdPerSecond);
  if (!resolutions.includes(params.resolution)) {
    ctx.report({
      code: "invalid_enum_value",
      path: ["resolution"],
      model: params.model,
      message: `\`resolution\` must be one of ${resolutions.map((v) => JSON.stringify(v)).join(", ")}${forModel}; got ${JSON.stringify(params.resolution)}.`,
      meta: { allowed: [...resolutions], value: params.resolution, source: VIDEO_V2_DOCS },
    });
  }
  const durations: readonly number[] = rule?.durations ?? VIDEO_V2_DURATIONS;
  if (!durations.includes(params.duration)) {
    ctx.report({
      code: "invalid_enum_value",
      path: ["duration"],
      model: params.model,
      message: `\`duration\` must be an integer between ${durations[0]} and ${durations[durations.length - 1]} seconds${forModel}; got ${params.duration}.`,
      meta: { allowed: [...durations], value: params.duration, source: VIDEO_V2_DOCS },
    });
  }
}

/**
 * The `extra` object: a documented `prompt_expansion_mode`, on the model it is
 * documented for. Nothing says whether MiniMax refuses or ignores `extra` on
 * the other three, so that half is a warning rather than a refusal.
 */
function checkExtra(
  params: VideoGenerationV2Params,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (params.extra === undefined) return;
  const mode = params.extra.prompt_expansion_mode;
  if (mode !== undefined && !PROMPT_EXPANSION_SET.has(mode)) {
    ctx.report({
      code: "invalid_enum_value",
      path: ["extra", "prompt_expansion_mode"],
      model: params.model,
      message: `\`extra.prompt_expansion_mode\` must be one of ${VIDEO_V2_PROMPT_EXPANSION_MODES.map((v) => JSON.stringify(v)).join(", ")}; got ${JSON.stringify(mode)}.`,
      meta: { allowed: [...VIDEO_V2_PROMPT_EXPANSION_MODES], value: mode, source: VIDEO_V2_DOCS },
    });
  }
  if (ruleFor(params.model)?.extra === false) {
    ctx.report({
      code: "unsupported_param",
      severity: "warning",
      path: ["extra"],
      model: params.model,
      message: `\`extra\` is documented for "MiniMax-H3-Max" only; "${params.model}" has no documented use for it.`,
      meta: { source: VIDEO_V2_DOCS },
    });
  }
}

/** The model's row, or undefined for an id off the route (checkModelEnum reports it). */
function ruleFor(model: string): VideoV2ModelRule | undefined {
  return Object.hasOwn(VIDEO_V2_MODEL_RULES, model)
    ? VIDEO_V2_MODEL_RULES[model as MinimaxVideoV2ModelId]
    : undefined;
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
  const adaptive = params.ratio === undefined || params.ratio === "adaptive";
  if (params.ratio !== undefined && !RATIO_SET.has(params.ratio)) {
    ctx.report({
      code: "invalid_enum_value",
      path: ["ratio"],
      message: `\`ratio\` must be one of ${VIDEO_V2_RATIOS.map((v) => JSON.stringify(v)).join(", ")}; got ${JSON.stringify(params.ratio)}.`,
      meta: { allowed: [...VIDEO_V2_RATIOS], value: params.ratio, source: VIDEO_V2_DOCS },
    });
  } else if (textToVideo && adaptive) {
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
  } else if (hasReferences && adaptive && ruleFor(params.model)?.referenceAdaptiveRatio === false) {
    // Reference-to-video defaults `ratio` to "adaptive", which
    // "`MiniMax-H3-Lite` does not support … yet; specify a concrete ratio."
    ctx.report({
      code: "invalid_shape",
      path: ["ratio"],
      model: params.model,
      message: `"${params.model}" does not support an "adaptive" \`ratio\` for reference-to-video, and "adaptive" is the default when \`ratio\` is omitted — pick a concrete ratio such as "16:9".`,
      meta: {
        allowed: VIDEO_V2_RATIOS.filter((r) => r !== "adaptive"),
        source: VIDEO_V2_DOCS,
      },
    });
  }
}

// ---------------------------------------------------------------------------
// Estimation — per second of output, plus the model's per-image surcharge.
// Reference VIDEO material is billed by its own duration, which the request
// body does not carry, so it is deliberately left out of the estimate.
// ---------------------------------------------------------------------------

function estimate(
  params: VideoGenerationV2Params,
  _info: ModelInfo | undefined,
  _ctx: PipelineContext,
) {
  const rule = ruleFor(params.model);
  const rate = rule?.usdPerSecond[params.resolution];
  if (rule === undefined || rate === undefined || typeof params.duration !== "number") return {};
  const images = Array.isArray(params.content) ? summarize(params.content).images : 0;
  const extraImages = Math.max(0, images - rule.freeImages);
  return { costUSD: rate * params.duration + extraImages * rule.usdPerExtraImage };
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
  endpoint: "minimax.videoV2",
  schema: videoV2Schema,
  modelId: (params) => params.model,
  catalog: videoV2Models,
  checks: [checkModelEnum, checkResolutionDuration, checkContent, checkExtra],
  estimate,
  finalize,
});

/**
 * Validates raw wire params for MiniMax `POST /v2/video_generation`
 * (MiniMax-H3, -Highspeed, -Lite and -Max: text-to-video, image-to-video and
 * reference-to-video from one multimodal `content` array, up to 2K on
 * MiniMax-H3).
 *
 * The returned object's enumerable props are the exact fetch JSON body;
 * MiniMax ships no official JS SDK for this API, so `.toSdk("minimax")` returns it
 * unchanged. The call is asynchronous: the response carries a task id you poll
 * with `videoV2QueryUrl(taskId)`. Auth is your job: add
 * `authorization: Bearer <MINIMAX_API_KEY>` when fetching.
 *
 * Cost is estimated as duration x the model's rate at that resolution (e.g.
 * MiniMax-H3: $0.08/s at 768P, $0.13/s at 2K) plus the model's surcharge for
 * every input image beyond its free quota — VIDEO_V2_MODEL_RULES.
 *
 * ```ts
 * const params = minimax.videoV2({
 *   model: "MiniMax-H3",
 *   content: [{ type: "text", text: "A neon-lit street at night, slow dolly in" }],
 *   resolution: "768P",
 *   duration: 6,
 *   ratio: "16:9",
 * });
 * ```
 */
export const videoV2 = validator as unknown as {
  <T extends VideoGenerationV2Params>(
    params: T & ExactKeys<T, VideoGenerationV2Params>,
    options?: ValidateOptions<T>,
  ): Validated<T, MinimaxSdkTargets<T>>;
  safe<T extends VideoGenerationV2Params>(
    params: T & ExactKeys<T, VideoGenerationV2Params>,
    options?: ValidateOptions<T>,
  ): ValidateResult<Validated<T, MinimaxSdkTargets<T>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
