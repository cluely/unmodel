/**
 * MiniMax Video Generation — POST https://api.minimax.io/v1/video_generation
 *
 * Wire notes (transcribed from the OpenAPI documents embedded in the four
 * scenario pages of https://platform.minimax.io/docs/api-reference —
 * video-generation-t2v, -i2v, -fl2v and -s2v, all of which POST to the SAME
 * route with different field subsets — on 2026-08-13):
 * - ASYNC submit: the response is `{task_id, base_resp}`. Poll
 *   `GET /v1/query/video_generation?task_id=…` (VIDEO_QUERY_URL) until
 *   `status` is "success", then fetch the `file_id` through the Files API, or
 *   set `callback_url` and let MiniMax push status changes to you.
 * - The scenario is chosen by which inputs you send, and each model supports a
 *   different set: `first_frame_image` (image-to-video), `first_frame_image` +
 *   `last_frame_image` (MiniMax-Hailuo-02 only) or `subject_reference`
 *   (S2V-01 only). VIDEO_MODEL_RULES encodes those tables and the checks
 *   below enforce them.
 * - `duration` and `resolution` are jointly constrained per model (e.g.
 *   1080P is 6-second only), which is also where the price comes from: MiniMax
 *   publishes a FLAT USD price per finished video for each
 *   model/resolution/duration triple (VIDEO_PRICE_USD).
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
import { videoModels, VIDEO_MODEL_IDS, type MinimaxVideoGenerationModelId } from "./models";

export const VIDEO_GENERATION_URL = "https://api.minimax.io/v1/video_generation";
/** Polling endpoint for a submitted task (`?task_id=…`). */
export const VIDEO_QUERY_URL = "https://api.minimax.io/v1/query/video_generation";

const VIDEO_DOCS = "https://platform.minimax.io/docs/api-reference/video-generation-t2v";

/** "Text description of the video, up to 2000 characters." */
export const VIDEO_PROMPT_MAX_CHARACTERS = 2000;

/** Documented `resolution` values across all scenarios. */
export const VIDEO_RESOLUTIONS = ["512P", "720P", "768P", "1080P"] as const;
export type MinimaxVideoResolution = (typeof VIDEO_RESOLUTIONS)[number];

/** Server-side default when `duration` is omitted ("Default is 6"). */
export const DEFAULT_VIDEO_DURATION = 6;

interface VideoModelRule {
  /** Allowed durations per resolution; the key set is the allowed resolutions. */
  durations: Readonly<Record<string, readonly number[]>>;
  /** Resolution used when `resolution` is omitted. */
  defaultResolution: MinimaxVideoResolution;
  /** Accepts `first_frame_image` (image-to-video). */
  firstFrame: boolean;
  /** Requires `first_frame_image` — the model has no text-to-video mode. */
  firstFrameRequired?: boolean;
  /** Accepts `last_frame_image` (first & last frame generation). */
  lastFrame: boolean;
  /** Accepts (and requires) `subject_reference`. */
  subjectReference: boolean;
  /** Accepts `fast_pretreatment`. */
  fastPretreatment: boolean;
  /** Resolutions that only exist in the image-to-video scenario. */
  imageOnlyResolutions?: readonly string[];
}

/**
 * Per-model input, resolution and duration support, from the four scenario
 * pages' own tables. "Other models" in those tables means the 01 generation,
 * which is 720P/6s only.
 */
export const VIDEO_MODEL_RULES: Readonly<Record<string, VideoModelRule>> = {
  "MiniMax-Hailuo-2.3": {
    durations: { "768P": [6, 10], "1080P": [6] },
    defaultResolution: "768P",
    firstFrame: true,
    lastFrame: false,
    subjectReference: false,
    fastPretreatment: true,
  },
  "MiniMax-Hailuo-2.3-Fast": {
    durations: { "768P": [6, 10], "1080P": [6] },
    defaultResolution: "768P",
    firstFrame: true,
    // The Fast variant is listed only in the image-to-video model enum.
    firstFrameRequired: true,
    lastFrame: false,
    subjectReference: false,
    fastPretreatment: true,
  },
  "MiniMax-Hailuo-02": {
    durations: { "512P": [6, 10], "768P": [6, 10], "1080P": [6] },
    defaultResolution: "768P",
    firstFrame: true,
    lastFrame: true,
    subjectReference: false,
    fastPretreatment: true,
    // 512P appears only in the image-to-video table, and first & last frame
    // generation explicitly "does not support 512P resolution".
    imageOnlyResolutions: ["512P"],
  },
  "T2V-01-Director": {
    durations: { "720P": [6] },
    defaultResolution: "720P",
    firstFrame: false,
    lastFrame: false,
    subjectReference: false,
    fastPretreatment: false,
  },
  "T2V-01": {
    durations: { "720P": [6] },
    defaultResolution: "720P",
    firstFrame: false,
    lastFrame: false,
    subjectReference: false,
    fastPretreatment: false,
  },
  "I2V-01-Director": {
    durations: { "720P": [6] },
    defaultResolution: "720P",
    firstFrame: true,
    firstFrameRequired: true,
    lastFrame: false,
    subjectReference: false,
    fastPretreatment: false,
  },
  "I2V-01-live": {
    durations: { "720P": [6] },
    defaultResolution: "720P",
    firstFrame: true,
    firstFrameRequired: true,
    lastFrame: false,
    subjectReference: false,
    fastPretreatment: false,
  },
  "I2V-01": {
    durations: { "720P": [6] },
    defaultResolution: "720P",
    firstFrame: true,
    firstFrameRequired: true,
    lastFrame: false,
    subjectReference: false,
    fastPretreatment: false,
  },
  "S2V-01": {
    durations: { "720P": [6] },
    defaultResolution: "720P",
    firstFrame: false,
    lastFrame: false,
    subjectReference: true,
    fastPretreatment: false,
  },
};

/**
 * Flat USD list price of one finished video, keyed
 * model → resolution → duration, from the "Video" section of
 * https://platform.minimax.io/docs/guides/pricing-paygo. The 01 generation
 * publishes no rate, so it is absent and produces no estimate.
 */
export const VIDEO_PRICE_USD: Readonly<
  Record<string, Readonly<Record<string, Readonly<Record<number, number>>>>>
> = {
  "MiniMax-Hailuo-2.3": { "768P": { 6: 0.28, 10: 0.56 }, "1080P": { 6: 0.49 } },
  "MiniMax-Hailuo-2.3-Fast": { "768P": { 6: 0.19, 10: 0.32 }, "1080P": { 6: 0.33 } },
  "MiniMax-Hailuo-02": {
    "512P": { 6: 0.1, 10: 0.15 },
    "768P": { 6: 0.28, 10: 0.56 },
    "1080P": { 6: 0.49 },
  },
};

// ---------------------------------------------------------------------------
// Wire types — mirror the raw JSON body exactly (snake_case).
// ---------------------------------------------------------------------------

/** A subject-reference entry (S2V-01): one character image. */
export interface MinimaxSubjectReference {
  /** "currently only `character` (face of a person)". */
  type: "character" | (string & {});
  /** Exactly one image: a public URL or a base64 data URL. */
  image: string[];
}

export interface VideoGenerationParams {
  /** Model id. Required. */
  model: MinimaxVideoGenerationModelId | (string & {});
  /**
   * Text description of the video, up to 2000 characters. Required for
   * text-to-video; optional when an image or subject reference is supplied.
   * `[Push in]`-style camera commands are supported by the Hailuo and
   * Director models.
   */
  prompt?: string;
  /** Auto-optimize the prompt. Default true. */
  prompt_optimizer?: boolean;
  /** Reduce optimization latency; Hailuo models only. Default false. */
  fast_pretreatment?: boolean;
  /** Video length in seconds; allowed values depend on model and resolution. */
  duration?: number;
  /**
   * Output resolution. VIDEO_RESOLUTIONS is the complete documented set across
   * all four scenarios; which of them a given model accepts (and with which
   * durations) is narrowed at runtime from VIDEO_MODEL_RULES.
   */
  resolution?: MinimaxVideoResolution;
  /** Starting frame: public URL or `data:image/jpeg;base64,…`. */
  first_frame_image?: string;
  /** Ending frame (MiniMax-Hailuo-02 first & last frame generation). */
  last_frame_image?: string;
  /** Subject reference images (S2V-01). */
  subject_reference?: MinimaxSubjectReference[];
  /** URL MiniMax POSTs task status changes to. */
  callback_url?: string;
}

// ---------------------------------------------------------------------------
// Schema (loose: unknown keys pass through with a warning).
// ---------------------------------------------------------------------------

const videoSchema = z.looseObject({
  model: z.string().min(1, "model is required"),
  prompt: z
    .string()
    .max(
      VIDEO_PROMPT_MAX_CHARACTERS,
      `prompt allows at most ${VIDEO_PROMPT_MAX_CHARACTERS} characters`,
    )
    .optional(),
  prompt_optimizer: z.boolean().optional(),
  fast_pretreatment: z.boolean().optional(),
  duration: z.number().int().optional(),
  resolution: z.string().optional(),
  first_frame_image: z.string().optional(),
  last_frame_image: z.string().optional(),
  subject_reference: z
    .array(z.looseObject({ type: z.string(), image: z.array(z.string()) }))
    .optional(),
  callback_url: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

const VIDEO_MODEL_ID_SET = new Set<string>(VIDEO_MODEL_IDS);

function checkModelEnum(
  params: VideoGenerationParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (VIDEO_MODEL_ID_SET.has(params.model)) return;
  ctx.report({
    code: "invalid_enum_value",
    path: ["model"],
    model: params.model,
    message: `\`model\` must be one of ${VIDEO_MODEL_IDS.map((v) => JSON.stringify(v)).join(", ")}; got ${JSON.stringify(params.model)}.`,
    meta: { allowed: [...VIDEO_MODEL_IDS], value: params.model, source: VIDEO_DOCS },
  });
}

/** Which inputs the chosen model accepts, and which it requires. */
function checkScenarioInputs(
  params: VideoGenerationParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const rule = VIDEO_MODEL_RULES[params.model];
  if (rule === undefined) return; // unknown model: already reported by checkModelEnum
  const model = params.model;

  if (params.first_frame_image !== undefined && !rule.firstFrame) {
    ctx.report({
      code: "unsupported_param",
      path: ["first_frame_image"],
      model,
      message: `"${model}" is a text-to-video model and does not accept \`first_frame_image\`.`,
      meta: { source: VIDEO_DOCS },
    });
  }
  if (params.last_frame_image !== undefined && !rule.lastFrame) {
    ctx.report({
      code: "unsupported_param",
      path: ["last_frame_image"],
      model,
      message: `\`last_frame_image\` (first & last frame generation) is only supported by "MiniMax-Hailuo-02"; "${model}" does not accept it.`,
      meta: { source: VIDEO_DOCS },
    });
  }
  if (params.subject_reference !== undefined && !rule.subjectReference) {
    ctx.report({
      code: "unsupported_param",
      path: ["subject_reference"],
      model,
      message: `\`subject_reference\` is only supported by "S2V-01"; "${model}" does not accept it.`,
      meta: { source: VIDEO_DOCS },
    });
  }
  if (params.fast_pretreatment !== undefined && !rule.fastPretreatment) {
    ctx.report({
      code: "unsupported_param",
      path: ["fast_pretreatment"],
      model,
      message: `\`fast_pretreatment\` applies only to the MiniMax-Hailuo models; "${model}" does not accept it.`,
      meta: { source: VIDEO_DOCS },
    });
  }
  if (rule.firstFrameRequired === true && params.first_frame_image === undefined) {
    ctx.report({
      code: "invalid_shape",
      path: ["first_frame_image"],
      model,
      message: `"${model}" is an image-to-video model: \`first_frame_image\` is required.`,
      meta: { source: VIDEO_DOCS },
    });
  }
  if (rule.subjectReference && params.subject_reference === undefined) {
    ctx.report({
      code: "invalid_shape",
      path: ["subject_reference"],
      model,
      message: `"${model}" is a subject-reference model: \`subject_reference\` is required.`,
      meta: { source: VIDEO_DOCS },
    });
  }
  // Text-to-video needs a prompt; with an image or subject reference it is
  // optional ("with optional text input").
  const hasVisualInput =
    params.first_frame_image !== undefined ||
    params.last_frame_image !== undefined ||
    params.subject_reference !== undefined;
  if (!hasVisualInput && (params.prompt ?? "") === "") {
    ctx.report({
      code: "invalid_shape",
      path: ["prompt"],
      model,
      message: "`prompt` is required for text-to-video requests.",
      meta: { source: VIDEO_DOCS },
    });
  }
  for (const [index, reference] of (params.subject_reference ?? []).entries()) {
    if (Array.isArray(reference?.image) && reference.image.length !== 1) {
      ctx.report({
        code: "invalid_shape",
        path: ["subject_reference", index, "image"],
        model,
        message: `\`subject_reference[${index}].image\` must contain exactly one image; got ${reference.image.length}.`,
        meta: { source: VIDEO_DOCS },
      });
    }
  }
}

/** Resolution / duration pairs the chosen model supports. */
function checkResolutionDuration(
  params: VideoGenerationParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const rule = VIDEO_MODEL_RULES[params.model];
  if (rule === undefined) return;
  const resolution = params.resolution ?? rule.defaultResolution;
  const allowedResolutions = Object.keys(rule.durations);
  if (!allowedResolutions.includes(resolution)) {
    ctx.report({
      code: "invalid_enum_value",
      path: ["resolution"],
      model: params.model,
      message: `\`resolution\` must be one of ${allowedResolutions.map((v) => JSON.stringify(v)).join(", ")} for "${params.model}"; got ${JSON.stringify(resolution)}.`,
      meta: { allowed: allowedResolutions, value: resolution, source: VIDEO_DOCS },
    });
    return;
  }
  const duration = params.duration ?? DEFAULT_VIDEO_DURATION;
  const allowedDurations = rule.durations[resolution]!;
  if (!allowedDurations.includes(duration)) {
    ctx.report({
      code: "invalid_enum_value",
      path: ["duration"],
      model: params.model,
      message: `\`duration\` must be ${allowedDurations.join(" or ")} seconds at ${resolution} for "${params.model}"; got ${duration}.`,
      meta: {
        allowed: [...allowedDurations],
        value: duration,
        resolution,
        source: VIDEO_DOCS,
      },
    });
  }
  if (rule.imageOnlyResolutions?.includes(resolution)) {
    if (params.first_frame_image === undefined) {
      ctx.report({
        code: "unsupported_capability",
        path: ["resolution"],
        model: params.model,
        message: `${resolution} is only available for image-to-video requests with "${params.model}"; send \`first_frame_image\` or pick another resolution.`,
        meta: { source: VIDEO_DOCS },
      });
    }
    if (params.last_frame_image !== undefined) {
      ctx.report({
        code: "unsupported_capability",
        path: ["resolution"],
        model: params.model,
        message: `First & last frame generation does not support ${resolution}.`,
        meta: { source: VIDEO_DOCS },
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Estimation — MiniMax publishes a flat price per finished video for each
// model/resolution/duration triple, so the estimate is exact for the Hailuo
// line and absent for the (unpriced) 01 generation.
// ---------------------------------------------------------------------------

/** Flat USD list price of one video, or undefined when MiniMax publishes none. */
export function videoPriceUSD(
  model: string,
  resolution?: string,
  duration?: number,
): number | undefined {
  const rule = VIDEO_MODEL_RULES[model];
  const effectiveResolution = resolution ?? rule?.defaultResolution;
  if (effectiveResolution === undefined) return undefined;
  return VIDEO_PRICE_USD[model]?.[effectiveResolution]?.[duration ?? DEFAULT_VIDEO_DURATION];
}

function estimate(
  params: VideoGenerationParams,
  _info: ModelInfo | undefined,
  _ctx: PipelineContext,
) {
  const costUSD = videoPriceUSD(params.model, params.resolution, params.duration);
  return costUSD === undefined ? {} : { costUSD };
}

// ---------------------------------------------------------------------------
// Finalize — the whole params object is the wire body.
// ---------------------------------------------------------------------------

/** Polling URL for a submitted task id. */
export function videoQueryUrl(taskId: string): string {
  return `${VIDEO_QUERY_URL}?${new URLSearchParams({ task_id: taskId }).toString()}`;
}

/**
 * Written as a `type` kept in lockstep with the object literal in `finalize`:
 * an `interface extends Record<string, …>` would inherit a string index
 * signature and collapse `keyof` to `string`, so `.toSdk("anything")` would
 * type-check. See `SdkFormatters` in core/request.ts.
 */
type MinimaxSdkTargets<B> = { minimax: () => B };

function finalize(params: VideoGenerationParams): unknown {
  const body = { ...params };
  return toValidated(
    body,
    { url: VIDEO_GENERATION_URL, method: "POST", headers: JSON_HEADERS },
    { sdk: { minimax: () => body } },
  );
}

const validator = createValidator<VideoGenerationParams, unknown>({
  endpoint: "minimax.video",
  schema: videoSchema,
  modelId: (params) => params.model,
  catalog: videoModels,
  checks: [checkModelEnum, checkScenarioInputs, checkResolutionDuration],
  estimate,
  finalize,
});

/**
 * Validates raw wire params for MiniMax `POST /v1/video_generation` — the
 * text-to-video, image-to-video, first & last frame and subject-reference
 * scenarios of the Hailuo and 01-generation video models.
 *
 * The returned object's enumerable props are the exact fetch JSON body;
 * MiniMax ships no official JS SDK for this API, so `.toSdk("minimax")` returns it
 * unchanged. The call is asynchronous: the response is `{task_id}`, which you
 * poll with `videoQueryUrl(taskId)`. Auth is your job: add
 * `authorization: Bearer <MINIMAX_API_KEY>` when fetching.
 *
 * Cost is the flat published price of the requested
 * model/resolution/duration (e.g. MiniMax-Hailuo-2.3 at 768P/6s = $0.28); the
 * 01-generation models publish no rate and produce no estimate.
 *
 * ```ts
 * const params = minimax.video({
 *   model: "MiniMax-Hailuo-2.3",
 *   prompt: "A man picks up a book [Pedestal up], then reads [Static shot].",
 *   duration: 6,
 *   resolution: "1080P",
 * });
 * const res = await fetch(params.request.url, {
 *   method: params.request.method,
 *   headers: {
 *     ...params.request.headers,
 *     authorization: `Bearer ${process.env.MINIMAX_API_KEY}`,
 *   },
 *   body: JSON.stringify(params),
 * });
 * const { task_id } = await res.json();
 * ```
 */
export const video = validator as unknown as {
  <T extends VideoGenerationParams>(
    params: T & ExactKeys<T, VideoGenerationParams>,
    options?: ValidateOptions,
  ): Validated<T, MinimaxSdkTargets<T>>;
  safe<T extends VideoGenerationParams>(
    params: T & ExactKeys<T, VideoGenerationParams>,
    options?: ValidateOptions,
  ): ValidateResult<Validated<T, MinimaxSdkTargets<T>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
