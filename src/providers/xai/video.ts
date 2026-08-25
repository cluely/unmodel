/**
 * xAI Grok Imagine video generation —
 * POST https://api.x.ai/v1/videos/generations   (text / image / reference-to-video)
 * POST https://api.x.ai/v1/videos/edits         (edit an existing clip)
 * POST https://api.x.ai/v1/videos/extensions    (extend an existing clip)
 * poll GET  https://api.x.ai/v1/videos/{request_id}
 *
 * Wire notes (verified against
 * https://docs.x.ai/developers/model-capabilities/video/generation and the
 * REST reference at
 * https://docs.x.ai/developers/rest-api-reference/inference/videos on
 * 2026-08-24; xAI publishes no official JS SDK — the `xai` npm package is a
 * placeholder — so the REST reference is the wire authority):
 * - ASYNC submit: every POST answers `{request_id}`. Poll
 *   `videoStatusUrl(requestId)` until `status` is "done" (then `video.url`
 *   carries the MP4), "failed" (`error.code`/`error.message`) or "expired".
 * - `prompt` is required ("Required for text-to-video (T2V) and
 *   reference-to-video (R2V)"); with an `image` it drives the animation.
 * - `image` (i2v first frame, JPEG/PNG/WebP) and `reference_images` (R2V)
 *   are `{url}` or `{file_id}` objects and cannot be combined in one request.
 * - `reference_audios`: up to 3 voices ({url} of a ≤15s clip, or a preset
 *   {voice_id} from the TTS roster), referenced in the prompt as <AUDIO_0>…
 * - `duration` 1–15 s (default 8); edits have NO duration field (output
 *   matches the input, capped at 8.7 s); extensions take 2–10 s (default 6).
 * - `resolution` 480p/720p/1080p — 1080p is text-to-video and image-to-video
 *   only, and reference-to-video is capped at 720p.
 * - `model` is optional on the wire and xAI documents no server-side default,
 *   so an omitted model skips model-dependent checks and produces no estimate.
 * - Billing is per second of generated video (see ./models.ts).
 * - Auth is `Authorization: Bearer <XAI_API_KEY>` — unmodel never touches
 *   keys; add the header yourself when fetching.
 */

import { z } from "zod";
import { createValidator, type PipelineContext } from "../../core/pipeline";
import { JSON_HEADERS, toValidated, type ExactKeys, type Validated } from "../../core/request";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";
import type { ModelInfo } from "../../core/catalog-types";
import type { EndpointConstraints } from "../../core/constraint-types";
import { videoModels, VIDEO_MODEL_IDS, type XaiVideoGenerationModelId } from "./models";
import type { XaiStorageOptions } from "./image";

export const VIDEO_GENERATIONS_URL = "https://api.x.ai/v1/videos/generations";
export const VIDEO_EDITS_URL = "https://api.x.ai/v1/videos/edits";
export const VIDEO_EXTENSIONS_URL = "https://api.x.ai/v1/videos/extensions";
/** Base of the polling endpoint (`GET /v1/videos/{request_id}`). */
export const VIDEO_STATUS_URL = "https://api.x.ai/v1/videos";

/** Polling URL for a submitted request id. */
export function videoStatusUrl(requestId: string): string {
  return `${VIDEO_STATUS_URL}/${encodeURIComponent(requestId)}`;
}

const VIDEO_DOCS = "https://docs.x.ai/developers/model-capabilities/video/generation";
const VIDEO_REFERENCE = "https://docs.x.ai/developers/rest-api-reference/inference/videos";

/** Documented `resolution` values. Default is 480p. */
export const VIDEO_RESOLUTIONS = ["480p", "720p", "1080p"] as const;
export type XaiVideoResolution = (typeof VIDEO_RESOLUTIONS)[number];

/** Documented `aspect_ratio` values. Default is "16:9". */
export const VIDEO_ASPECT_RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"] as const;
export type XaiVideoAspectRatio = (typeof VIDEO_ASPECT_RATIOS)[number];

/** `duration` bounds on /generations ("Default: 8", range 1–15). */
export const VIDEO_MIN_DURATION = 1;
export const VIDEO_MAX_DURATION = 15;
export const DEFAULT_VIDEO_DURATION = 8;

/** `duration` bounds on /extensions (range 2–10, default 6). */
export const EXTENSION_MIN_DURATION = 2;
export const EXTENSION_MAX_DURATION = 10;
export const DEFAULT_EXTENSION_DURATION = 6;

/** "max 3 per request" — reference voices. */
export const VIDEO_MAX_REFERENCE_AUDIOS = 3;

// ---------------------------------------------------------------------------
// Wire types — mirror the raw JSON body exactly (snake_case).
// ---------------------------------------------------------------------------

/** An input asset: a public URL, or a handle from xAI's Files API. */
export interface XaiMediaInput {
  url?: string;
  file_id?: string;
}

/** A reference voice: a URL of a ≤15 s clip, or a preset TTS voice id. */
export interface XaiReferenceAudio {
  url?: string;
  /** Case-insensitive preset name from the Text-to-Speech roster, e.g. "eve". */
  voice_id?: string;
}

/** `output.upload_url`: a signed URL xAI PUTs the finished video to. */
export interface XaiVideoOutput {
  upload_url: string;
}

export interface VideoGenerationsParams {
  /**
   * Required for text-to-video and reference-to-video; with `image` it
   * describes the animation.
   */
  prompt: string;
  /** Optional on the wire; xAI documents no default, so name one explicitly. */
  model?: XaiVideoGenerationModelId | (string & {});
  /** First frame for image-to-video (JPEG, PNG, WebP). */
  image?: XaiMediaInput;
  /** Reference-to-video subject images. Cannot be combined with `image`. */
  reference_images?: XaiMediaInput[];
  /** Up to 3 reference voices, addressed in the prompt as <AUDIO_0>…<AUDIO_2>. */
  reference_audios?: XaiReferenceAudio[];
  /** Seconds, 1–15. Default 8. */
  duration?: number;
  /** Default "16:9". */
  aspect_ratio?: XaiVideoAspectRatio;
  /** Default "480p". 1080p is text-to-video / image-to-video only. */
  resolution?: XaiVideoResolution;
  /** Have xAI PUT the finished video to your own signed URL. */
  output?: XaiVideoOutput;
  /** Persist outputs to xAI-managed storage. */
  storage_options?: XaiStorageOptions;
  /** Unique identifier representing your end-user. */
  user?: string;
}

export interface VideoEditsParams {
  /** What to change. Required. */
  prompt: string;
  model?: XaiVideoGenerationModelId | (string & {});
  /** The clip to edit (MP4). Required. No duration field: output matches the input, capped at 8.7 s. */
  video: XaiMediaInput;
  output?: XaiVideoOutput;
  storage_options?: XaiStorageOptions;
  user?: string;
}

export interface VideoExtensionsParams {
  /** What happens next. Required. */
  prompt: string;
  model?: XaiVideoGenerationModelId | (string & {});
  /** The clip to extend (MP4). Required. */
  video: XaiMediaInput;
  /** Seconds of new footage, 2–10. Default 6. */
  duration?: number;
  output?: XaiVideoOutput;
  storage_options?: XaiStorageOptions;
  user?: string;
}

// ---------------------------------------------------------------------------
// Schemas (loose: unknown keys pass through with a warning).
// ---------------------------------------------------------------------------

const mediaInputSchema = z.looseObject({
  url: z.string().optional(),
  file_id: z.string().optional(),
});

const referenceAudioSchema = z.looseObject({
  url: z.string().optional(),
  voice_id: z.string().optional(),
});

const outputSchema = z.looseObject({ upload_url: z.string() });

const storageOptionsSchema = z.looseObject({
  filename: z.string(),
  expires_after: z.number().int().optional(),
  public_url: z.boolean().optional(),
});

const generationsSchema = z.looseObject({
  prompt: z.string().min(1, "prompt is required"),
  model: z.string().optional(),
  image: mediaInputSchema.optional(),
  reference_images: z.array(mediaInputSchema).optional(),
  reference_audios: z.array(referenceAudioSchema).optional(),
  duration: z.number().int().optional(),
  aspect_ratio: z.enum(VIDEO_ASPECT_RATIOS).optional(),
  resolution: z.enum(VIDEO_RESOLUTIONS).optional(),
  output: outputSchema.optional(),
  storage_options: storageOptionsSchema.optional(),
  user: z.string().optional(),
});

const editsSchema = z.looseObject({
  prompt: z.string().min(1, "prompt is required"),
  model: z.string().optional(),
  video: mediaInputSchema,
  output: outputSchema.optional(),
  storage_options: storageOptionsSchema.optional(),
  user: z.string().optional(),
});

const extensionsSchema = z.looseObject({
  prompt: z.string().min(1, "prompt is required"),
  model: z.string().optional(),
  video: mediaInputSchema,
  duration: z.number().int().optional(),
  output: outputSchema.optional(),
  storage_options: storageOptionsSchema.optional(),
  user: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

const VIDEO_MODEL_ID_SET = new Set<string>(VIDEO_MODEL_IDS);

function checkModelEnum(
  params: { model?: string },
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (params.model === undefined || VIDEO_MODEL_ID_SET.has(params.model)) return;
  ctx.report({
    code: "invalid_enum_value",
    path: ["model"],
    model: params.model,
    message: `\`model\` must be one of ${VIDEO_MODEL_IDS.map((v) => JSON.stringify(v)).join(", ")}; got ${JSON.stringify(params.model)}.`,
    meta: { allowed: [...VIDEO_MODEL_IDS], value: params.model, source: VIDEO_DOCS },
  });
}

/** `{url}` XOR `{file_id}` — an asset naming both (or neither) is undecidable. */
function checkMediaInput(
  input: XaiMediaInput | undefined,
  path: readonly (string | number)[],
  ctx: PipelineContext,
): void {
  if (input === undefined) return;
  const spellings = [input.url, input.file_id].filter((v) => v !== undefined).length;
  if (spellings === 1) return;
  ctx.report({
    code: "invalid_shape",
    path: [...path],
    message:
      spellings === 0
        ? `\`${path.join(".")}\` must carry a \`url\` or a \`file_id\`.`
        : `\`${path.join(".")}\` takes a \`url\` OR a \`file_id\`, not both.`,
    meta: { source: VIDEO_REFERENCE },
  });
}

function checkGenerationInputs(
  params: VideoGenerationsParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  checkMediaInput(params.image, ["image"], ctx);
  for (const [index, ref] of (params.reference_images ?? []).entries()) {
    checkMediaInput(ref, ["reference_images", index], ctx);
  }

  // "Cannot combine `image` + `reference_images` in one request."
  if (params.image !== undefined && params.reference_images !== undefined) {
    ctx.report({
      code: "invalid_shape",
      path: ["reference_images"],
      message:
        "`image` (image-to-video) and `reference_images` (reference-to-video) cannot be combined " +
        "in one request; send one or the other.",
      meta: { source: VIDEO_DOCS },
    });
  }

  const audios = params.reference_audios;
  if (audios !== undefined) {
    if (audios.length > VIDEO_MAX_REFERENCE_AUDIOS) {
      ctx.report({
        code: "invalid_shape",
        path: ["reference_audios"],
        message: `\`reference_audios\` accepts up to ${VIDEO_MAX_REFERENCE_AUDIOS} voices per request; got ${audios.length}.`,
        meta: { max: VIDEO_MAX_REFERENCE_AUDIOS, count: audios.length, source: VIDEO_DOCS },
      });
    }
    for (const [index, audio] of audios.entries()) {
      const spellings = [audio?.url, audio?.voice_id].filter((v) => v !== undefined).length;
      if (spellings !== 1) {
        ctx.report({
          code: "invalid_shape",
          path: ["reference_audios", index],
          message:
            spellings === 0
              ? `\`reference_audios[${index}]\` must carry a \`url\` or a preset \`voice_id\`.`
              : `\`reference_audios[${index}]\` takes a \`url\` OR a \`voice_id\`, not both.`,
          meta: { source: VIDEO_DOCS },
        });
      }
    }
  }
}

function checkGenerationDuration(
  params: VideoGenerationsParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const duration = params.duration;
  if (duration === undefined) return;
  if (Number.isInteger(duration) && duration >= VIDEO_MIN_DURATION && duration <= VIDEO_MAX_DURATION)
    return;
  ctx.report({
    code: "invalid_shape",
    path: ["duration"],
    message: `\`duration\` must be an integer between ${VIDEO_MIN_DURATION} and ${VIDEO_MAX_DURATION} seconds; got ${duration}.`,
    meta: { min: VIDEO_MIN_DURATION, max: VIDEO_MAX_DURATION, value: duration, source: VIDEO_DOCS },
  });
}

/**
 * "1080p is text-to-video / image-to-video only" and "reference-to-video:
 * resolution capped at 720p" — the same fact from both directions.
 */
function checkGenerationResolution(
  params: VideoGenerationsParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (params.resolution !== "1080p") return;
  if (params.reference_images === undefined && params.reference_audios === undefined) return;
  ctx.report({
    code: "unsupported_capability",
    path: ["resolution"],
    message:
      '"1080p" is available for text-to-video and image-to-video only; reference-to-video ' +
      '(`reference_images` / `reference_audios`) is capped at "720p".',
    meta: { source: VIDEO_DOCS },
  });
}

function checkExtensionDuration(
  params: VideoExtensionsParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const duration = params.duration;
  if (duration === undefined) return;
  if (
    Number.isInteger(duration) &&
    duration >= EXTENSION_MIN_DURATION &&
    duration <= EXTENSION_MAX_DURATION
  )
    return;
  ctx.report({
    code: "invalid_shape",
    path: ["duration"],
    message: `\`duration\` on /v1/videos/extensions must be an integer between ${EXTENSION_MIN_DURATION} and ${EXTENSION_MAX_DURATION} seconds; got ${duration}.`,
    meta: {
      min: EXTENSION_MIN_DURATION,
      max: EXTENSION_MAX_DURATION,
      value: duration,
      source: VIDEO_REFERENCE,
    },
  });
}

function checkEditInputs(
  params: VideoEditsParams | VideoExtensionsParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  checkMediaInput(params.video, ["video"], ctx);
}

// ---------------------------------------------------------------------------
// Estimation — xAI bills per second of generated video, so the estimate is
// (requested seconds) × the model's published rate. Edits carry no estimate:
// the output length matches the input clip (capped at 8.7 s), which the
// request body does not know.
// ---------------------------------------------------------------------------

/** USD for one generation, or undefined when the model (or its rate) is unknown. */
export function videoPriceUSD(model: string | undefined, durationSeconds: number): number | undefined {
  if (model === undefined) return undefined;
  const rate = (videoModels as Record<string, ModelInfo>)[model]?.cost?.perVideoSecond;
  return rate === undefined ? undefined : rate * durationSeconds;
}

function estimateGeneration(
  params: VideoGenerationsParams,
  _info: ModelInfo | undefined,
  _ctx: PipelineContext,
) {
  const costUSD = videoPriceUSD(params.model, params.duration ?? DEFAULT_VIDEO_DURATION);
  return costUSD === undefined ? {} : { costUSD };
}

function estimateExtension(
  params: VideoExtensionsParams,
  _info: ModelInfo | undefined,
  _ctx: PipelineContext,
) {
  const costUSD = videoPriceUSD(params.model, params.duration ?? DEFAULT_EXTENSION_DURATION);
  return costUSD === undefined ? {} : { costUSD };
}

// ---------------------------------------------------------------------------
// Finalize — the whole params object is the wire body.
// ---------------------------------------------------------------------------

/**
 * Written as a `type` kept in lockstep with the object literal in each
 * `finalize` (see `SdkFormatters` in core/request.ts). xAI ships no official
 * JS SDK (the `xai` npm package is a placeholder), so `.toSdk("xai")` returns
 * the body unchanged.
 */
type XaiVideoSdkTargets<B> = { xai: () => B };

function finalizeTo(url: string) {
  return (params: object): unknown => {
    const body = { ...params };
    return toValidated(
      body,
      { url, method: "POST", headers: JSON_HEADERS },
      { sdk: { xai: () => body } },
    );
  };
}

interface XaiVideoValidator<P extends { model?: string }> {
  <T extends P>(params: T & ExactKeys<T, P>, options?: ValidateOptions<T>): Validated<
    T,
    XaiVideoSdkTargets<T>
  >;
  safe<T extends P>(
    params: T & ExactKeys<T, P>,
    options?: ValidateOptions<T>,
  ): ValidateResult<Validated<T, XaiVideoSdkTargets<T>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
}

const generationsValidator = createValidator<VideoGenerationsParams, unknown>({
  endpoint: "xai.video",
  schema: generationsSchema,
  modelId: (params) => params.model,
  catalog: videoModels,
  checks: [checkModelEnum, checkGenerationInputs, checkGenerationDuration, checkGenerationResolution],
  estimate: estimateGeneration,
  promptPath: ["prompt"],
  finalize: finalizeTo(VIDEO_GENERATIONS_URL),
});

const editsValidator = createValidator<VideoEditsParams, unknown>({
  endpoint: "xai.videoEdit",
  schema: editsSchema,
  modelId: (params) => params.model,
  catalog: videoModels,
  checks: [checkModelEnum, checkEditInputs],
  promptPath: ["prompt"],
  finalize: finalizeTo(VIDEO_EDITS_URL),
});

const extensionsValidator = createValidator<VideoExtensionsParams, unknown>({
  endpoint: "xai.videoExtend",
  schema: extensionsSchema,
  modelId: (params) => params.model,
  catalog: videoModels,
  checks: [checkModelEnum, checkEditInputs, checkExtensionDuration],
  estimate: estimateExtension,
  promptPath: ["prompt"],
  finalize: finalizeTo(VIDEO_EXTENSIONS_URL),
});

/**
 * Validates raw wire params for xAI `POST /v1/videos/generations` (Grok
 * Imagine text-, image- and reference-to-video).
 *
 * The returned object's enumerable props are the exact fetch JSON body; xAI
 * ships no official JS SDK for this API, so `.toSdk("xai")` returns it
 * unchanged. The call is asynchronous: the response is `{request_id}`, which
 * you poll with `videoStatusUrl(requestId)` until `status` is "done" (the MP4
 * is at `video.url`), "failed" or "expired". Auth is your job: add
 * `authorization: Bearer <XAI_API_KEY>` when fetching.
 *
 * Cost is the published per-second rate × the requested duration (default
 * 8 s), e.g. grok-imagine-video-1.5 at $0.080/s × 8 = $0.64.
 *
 * ```ts
 * const params = xai.video({
 *   model: "grok-imagine-video-1.5",
 *   prompt: "Make the water crash down and slowly pan out the camera",
 *   image: { url: "https://cdn.example/waterfall-still.png" },
 *   duration: 12,
 *   resolution: "720p",
 * });
 * ```
 */
export const video = generationsValidator as unknown as XaiVideoValidator<VideoGenerationsParams>;

/**
 * Validates raw wire params for xAI `POST /v1/videos/edits` — restyle or
 * change an existing clip (MP4 `video` + `prompt`). Same async flow as
 * {@link video}. No duration field and no cost estimate: the output matches
 * the input clip's length (capped at 8.7 s), which the request cannot know.
 */
export const videoEdit = editsValidator as unknown as XaiVideoValidator<VideoEditsParams>;

/**
 * Validates raw wire params for xAI `POST /v1/videos/extensions` — append
 * 2–10 seconds (default 6) of new footage to an existing clip. Same async
 * flow as {@link video}; cost is rate × the requested extension seconds.
 */
export const videoExtend = extensionsValidator as unknown as XaiVideoValidator<VideoExtensionsParams>;
