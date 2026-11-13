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
 * - `prompt` is required for text-to-video only: "`prompt` is optional for
 *   any request that includes `image`, `reference_images`, `last_frame`, or
 *   `keyframes`; it is required only for text-to-video." (generation guide,
 *   2026-11-12). The REST reference still reads "Required for text-to-video
 *   (T2V) and reference-to-video (R2V)" and the OpenAPI schema has no
 *   `required` list, so a reference-only request is not refused for it.
 * - `image` (i2v first frame, JPEG/PNG/WebP), `reference_images` (R2V),
 *   `last_frame` and each `keyframes[].image` are `{url}` or `{file_id}`
 *   objects, where `url` is a public URL or a base64 data URL.
 *   grok-imagine-video cannot combine `image` with references; on
 *   grok-imagine-video-1.5 `image` is the pinned first frame of a
 *   reference-to-video clip ({@link checkGenerationInputs}).
 * - `reference_audios`: up to 3 voices ({url} of a ≤15s clip, or a preset
 *   {voice_id} from the TTS roster), referenced in the prompt as <AUDIO_0>…
 * - `duration` 1–15 s (default 8); edits have NO duration field (output
 *   matches the input, capped at 8.7 s); extensions take 2–10 s (default 6).
 * - `resolution` 480p/720p/1080p — 1080p is grok-imagine-video-1.5 / -lite
 *   only, text-to-video and image-to-video only, and reference-to-video is
 *   capped at 720p.
 * - grok-imagine-video-1.5-lite is text-to-video and image-to-video only
 *   ({@link VIDEO_TEXT_IMAGE_ONLY_MODELS}). Voice references and pinned
 *   frames are grok-imagine-video-1.5's alone
 *   ({@link VIDEO_VOICE_AND_FRAME_MODELS}), and the edit and extension routes
 *   grok-imagine-video's alone ({@link SOURCE_CLIP_MODELS}).
 * - `model` is optional on the wire and xAI documents no server-side default,
 *   so an omitted model skips model-dependent checks and produces no estimate.
 *   Documented aliases (`VIDEO_MODEL_ALIASES` in ./models.ts) validate and
 *   price as the row they serve.
 * - Billing is per second of generated video by resolution, plus a per-image
 *   fee for input images (see ./models.ts).
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
import {
  videoModels,
  VIDEO_INPUT_IMAGE_USD,
  VIDEO_MODEL_ALIASES,
  VIDEO_MODEL_IDS,
  VIDEO_RATES,
  type XaiVideoGenerationModelId,
} from "./models";
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
const DEFAULT_VIDEO_RESOLUTION: XaiVideoResolution = "480p";

/**
 * Documented `aspect_ratio` values. Default is "16:9". "* `aspect_ratio`
 * ("1:1" | "16:9" | "9:16" | "4:3" | "3:4" | "3:2" | "2:3" | "21:9" | "5:2")"
 * — https://docs.x.ai/developers/rest-api-reference/inference/videos
 * (2026-11-12); the OpenAPI `VideoAspectRatio` enum is the same nine.
 */
export const VIDEO_ASPECT_RATIOS = [
  "1:1",
  "16:9",
  "9:16",
  "4:3",
  "3:4",
  "3:2",
  "2:3",
  "21:9",
  "5:2",
] as const;
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

/**
 * "At most 4 keyframes per request." — the reference-to-video page's
 * Keyframes table (2026-11-12); the OpenAPI `keyframes` has `"maxItems": 4`.
 */
export const VIDEO_MAX_KEYFRAMES = 4;

const VIDEO_OVERVIEW = "https://docs.x.ai/developers/model-capabilities/video/overview";
const VIDEO_R2V_DOCS = "https://docs.x.ai/developers/model-capabilities/video/reference-to-video";

/**
 * Models that serve text-to-video and image-to-video and nothing else — in
 * particular no reference-to-video (`reference_images`). The capability matrix
 * on https://docs.x.ai/developers/model-capabilities/video/overview (columns
 * grok-imagine-video-1.5 | grok-imagine-video-1.5-lite | grok-imagine-video,
 * 2026-11-12):
 * "| Reference images | Yes: Up to 14 images, 15 s, 720p | Not supported | Yes: Up to 7 images, 10 s, 720p |".
 * The inputs and routes narrower than that have their own lists:
 * {@link VIDEO_VOICE_AND_FRAME_MODELS} and {@link SOURCE_CLIP_MODELS}.
 */
export const VIDEO_TEXT_IMAGE_ONLY_MODELS = ["grok-imagine-video-1.5-lite"] as const;

/**
 * Models that take voice references and pinned frames — `reference_audios`,
 * `last_frame` and `keyframes`. The same matrix (1.5 | lite | classic,
 * 2026-11-12):
 * "| Voice references | Yes: Up to 3 voices | Not supported | Not supported |",
 * "| First & last frame | Yes | Not supported | Not supported |",
 * "| Keyframes | Yes: Up to 4 mid-video frames | Not supported | Not supported |";
 * the reference-to-video page: "Up to **3** per request on
 * `grok-imagine-video-1.5`" (voices); and the generation guide: "Classic
 * `grok-imagine-video` still rejects `last_frame` and `keyframes`".
 */
export const VIDEO_VOICE_AND_FRAME_MODELS = ["grok-imagine-video-1.5"] as const;

/**
 * The models POST /v1/videos/edits and /v1/videos/extensions serve. The
 * editing and extension pages each read "| Model | `grok-imagine-video` |"
 * (https://docs.x.ai/developers/model-capabilities/video/editing and
 * .../video/extension), and the matrix agrees (1.5 | lite | classic,
 * 2026-11-12):
 * "| Video editing | Not supported | Not supported | Yes: Source up to 8.7 s |",
 * "| Video extension | Not supported | Not supported | Yes: Adds 2–10 s |".
 */
const SOURCE_CLIP_MODELS: readonly string[] = ["grok-imagine-video"];

/**
 * Reference-to-video caps per catalog row — the reference-to-video page's
 * limits table (https://docs.x.ai/developers/model-capabilities/video/reference-to-video,
 * 2026-11-12): "Up to **14** per request on `grok-imagine-video-1.5`; up to
 * **7** on `grok-imagine-video`" (reference images) and "Up to **15 seconds**
 * on `grok-imagine-video-1.5`; up to **10 seconds** on `grok-imagine-video`"
 * (duration). grok-imagine-video-1.5-lite has no reference-to-video mode.
 */
export const VIDEO_REFERENCE_LIMITS = {
  "grok-imagine-video-1.5": { images: 14, seconds: 15 },
  "grok-imagine-video": { images: 7, seconds: 10 },
} as const satisfies Partial<
  Record<XaiVideoGenerationModelId, { images: number; seconds: number }>
>;

// ---------------------------------------------------------------------------
// Wire types — mirror the raw JSON body exactly (snake_case).
// ---------------------------------------------------------------------------

/**
 * An input asset: a public URL or a base64 data URL ("Public URL or
 * base64-encoded data URL of the image (JPEG, PNG, or WebP)" — OpenAPI
 * `ImageUrl.url`), or a handle from xAI's Files API.
 */
export interface XaiMediaInput {
  url?: string;
  file_id?: string;
}

/**
 * A mid-video pin — mirrors the OpenAPI `VideoKeyframe` exactly
 * (https://docs.x.ai/openapi.json, 2026-11-12): both fields required.
 */
export interface XaiVideoKeyframe {
  /** The image the clip passes through at `timestamp_s`. */
  image: XaiMediaInput;
  /**
   * "Anchor time in seconds, strictly inside the clip (0 < t < duration)."
   * Anchors snap to a 1/3-second grid, and two that round to the same slot
   * are rejected.
   */
  timestamp_s: number;
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
   * Required for text-to-video; optional once `image` or reference inputs
   * are present, where it describes the animation.
   */
  prompt?: string;
  /** Optional on the wire; xAI documents no default, so name one explicitly. */
  model?: XaiVideoGenerationModelId | (string & {});
  /** First frame for image-to-video (JPEG, PNG, WebP). */
  image?: XaiMediaInput;
  /**
   * Reference-to-video subject images. grok-imagine-video cannot combine them
   * with `image`; grok-imagine-video-1.5 pins `image` as the first frame.
   */
  reference_images?: XaiMediaInput[];
  /**
   * Up to 3 reference voices, addressed in the prompt as <AUDIO_0>…<AUDIO_2>.
   * grok-imagine-video-1.5 only.
   */
  reference_audios?: XaiReferenceAudio[];
  /**
   * The pinned last frame. grok-imagine-video-1.5 only: "On
   * `grok-imagine-video-1.5`, `last_frame` pins the exact last frame of the
   * clip." — mirrors the reference-to-video page's REST examples exactly
   * (`"last_frame": {"url": "<LAST_FRAME_URL>"}`, 2026-11-12).
   */
  last_frame?: XaiMediaInput;
  /**
   * Up to 4 mid-video pins. grok-imagine-video-1.5 only — mirrors the OpenAPI
   * `GenerateVideoRequest.keyframes` exactly ("at most 4 entries").
   */
  keyframes?: XaiVideoKeyframe[];
  /**
   * `false` requests a silent video; the default is an audio track. "Pass
   * `generate_audio=False` to request a silent video" — mirrors the
   * generation guide's REST example (`"generate_audio": false`, 2026-11-12).
   */
  generate_audio?: boolean;
  /**
   * Seconds, 1–15. Default 8. The wire also "Accepts both number (8) and
   * string ("8") values" (OpenAPI), and the validator admits a digit string
   * for untyped callers; the type names the number.
   */
  duration?: number;
  /** Default "16:9". */
  aspect_ratio?: XaiVideoAspectRatio;
  /**
   * Default "480p". 1080p is grok-imagine-video-1.5 / -lite only, and
   * text-to-video / image-to-video only.
   */
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
  public_url: z
    .union([z.boolean(), z.looseObject({ expires_after: z.number().int().optional() })])
    .optional(),
});

const keyframeSchema = z.looseObject({ image: mediaInputSchema, timestamp_s: z.number() });

const generationsSchema = z.looseObject({
  // Required for text-to-video only — checkGenerationPrompt answers that.
  prompt: z.string().min(1, "prompt must not be empty").optional(),
  model: z.string().optional(),
  image: mediaInputSchema.optional(),
  reference_images: z.array(mediaInputSchema).optional(),
  reference_audios: z.array(referenceAudioSchema).optional(),
  last_frame: mediaInputSchema.optional(),
  keyframes: z.array(keyframeSchema).optional(),
  generate_audio: z.boolean().optional(),
  // "Accepts both number (8) and string ("8") values." — OpenAPI
  // GenerateVideoRequest.duration and
  // https://docs.x.ai/developers/rest-api-reference/inference/videos
  // (2026-11-12). /extensions documents no string form, so it keeps the number.
  duration: z.union([z.number().int(), z.string().regex(/^\d+$/)]).optional(),
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

/** Every `model` value the video routes accept: the catalog ids and their documented aliases. */
const ACCEPTED_VIDEO_MODELS: readonly string[] = [
  ...VIDEO_MODEL_IDS,
  ...Object.keys(VIDEO_MODEL_ALIASES),
];
const ACCEPTED_VIDEO_MODEL_SET = new Set<string>(ACCEPTED_VIDEO_MODELS);

/**
 * The catalog row a request's `model` names: the id itself, or the row a
 * documented alias serves.
 */
function resolveVideoModel(model: string | undefined): string | undefined {
  return model !== undefined && Object.hasOwn(VIDEO_MODEL_ALIASES, model)
    ? VIDEO_MODEL_ALIASES[model as keyof typeof VIDEO_MODEL_ALIASES]
    : model;
}

function checkModelEnum(
  params: { model?: string },
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (params.model === undefined || ACCEPTED_VIDEO_MODEL_SET.has(params.model)) return;
  ctx.report({
    code: "invalid_enum_value",
    path: ["model"],
    model: params.model,
    message: `\`model\` must be one of ${ACCEPTED_VIDEO_MODELS.map((v) => JSON.stringify(v)).join(", ")}; got ${JSON.stringify(params.model)}.`,
    meta: { allowed: [...ACCEPTED_VIDEO_MODELS], value: params.model, source: VIDEO_DOCS },
  });
}

/** The inputs whose presence makes `prompt` optional on /v1/videos/generations. */
const PROMPT_OPTIONAL_WITH = [
  "image",
  "reference_images",
  "reference_audios",
  "last_frame",
  "keyframes",
] as const;

/**
 * "`prompt` is optional for any request that includes `image`,
 * `reference_images`, `last_frame`, or `keyframes`; it is required only for
 * text-to-video." — https://docs.x.ai/developers/model-capabilities/video/generation
 * (2026-11-12). `reference_audios` counts as a reference input too.
 */
function checkGenerationPrompt(
  params: VideoGenerationsParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (params.prompt !== undefined) return;
  if (PROMPT_OPTIONAL_WITH.some((key) => params[key] !== undefined)) return;
  ctx.report({
    code: "invalid_shape",
    path: ["prompt"],
    message:
      "`prompt` is required for text-to-video; it may be omitted only when one of " +
      `${PROMPT_OPTIONAL_WITH.map((key) => `\`${key}\``).join(", ")} is present.`,
    meta: { source: VIDEO_DOCS },
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

/**
 * The one model that refuses `image` beside reference inputs: "Classic
 * `grok-imagine-video` still rejects `last_frame` and `keyframes` and rejects
 * combining `image` with reference inputs." Elsewhere the pair is valid: "On
 * `grok-imagine-video-1.5`, `image` combined with `reference_images`,
 * `reference_audios`, `last_frame`, or `keyframes` is reference-to-video with
 * a pinned first frame." (https://docs.x.ai/developers/model-capabilities/video/generation,
 * 2026-11-12)
 */
const NO_PINNED_FRAME_MODEL = "grok-imagine-video";

/**
 * The one model capped at 720p on every mode: "`grok-imagine-video` supports
 * up to 720p." (https://docs.x.ai/developers/model-capabilities/video/generation,
 * 2026-11-12), and the matrix's "| Resolution | Yes: 480p, 720p, 1080p | Yes:
 * 480p, 720p, 1080p | Yes: 480p, 720p |" (1.5 | lite | classic).
 */
const MAX_720P_MODEL = "grok-imagine-video";

/**
 * `duration` as seconds, defaulted. The schema admits a digit string beside
 * the number ("Accepts both number (8) and string ("8") values"), so `Number`
 * is exact here.
 */
function requestedSeconds(params: VideoGenerationsParams): number {
  const duration: number | string = params.duration ?? DEFAULT_VIDEO_DURATION;
  return typeof duration === "string" ? Number(duration) : duration;
}

function checkGenerationInputs(
  params: VideoGenerationsParams,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  checkMediaInput(params.image, ["image"], ctx);
  for (const [index, ref] of (params.reference_images ?? []).entries()) {
    checkMediaInput(ref, ["reference_images", index], ctx);
  }
  checkMediaInput(params.last_frame, ["last_frame"], ctx);
  checkKeyframes(params, ctx);

  if (
    info?.id === NO_PINNED_FRAME_MODEL &&
    params.image !== undefined &&
    params.reference_images !== undefined
  ) {
    ctx.report({
      code: "invalid_shape",
      path: ["reference_images"],
      model: info.id,
      message:
        `${JSON.stringify(NO_PINNED_FRAME_MODEL)} cannot combine \`image\` (image-to-video) with ` +
        "`reference_images` (reference-to-video); send one or the other, or use " +
        "grok-imagine-video-1.5, which pins `image` as the first frame of a reference-to-video clip.",
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

/**
 * The reference-to-video page's Keyframes table (2026-11-12): "At most 4
 * keyframes per request." and "`timestamp_s` must fall strictly inside the
 * clip: greater than 0 and less than `duration`." (OpenAPI `VideoKeyframe`:
 * "0 < t < duration"). The 1/3-second snapping collision is the API's to
 * report.
 */
function checkKeyframes(params: VideoGenerationsParams, ctx: PipelineContext): void {
  const keyframes = params.keyframes;
  if (keyframes === undefined) return;
  if (keyframes.length > VIDEO_MAX_KEYFRAMES) {
    ctx.report({
      code: "invalid_shape",
      path: ["keyframes"],
      message: `\`keyframes\` accepts up to ${VIDEO_MAX_KEYFRAMES} entries per request; got ${keyframes.length}.`,
      meta: { max: VIDEO_MAX_KEYFRAMES, count: keyframes.length, source: VIDEO_R2V_DOCS },
    });
  }
  const seconds = requestedSeconds(params);
  for (const [index, keyframe] of keyframes.entries()) {
    checkMediaInput(keyframe.image, ["keyframes", index, "image"], ctx);
    const at = keyframe.timestamp_s;
    if (at > 0 && at < seconds) continue;
    ctx.report({
      code: "invalid_shape",
      path: ["keyframes", index, "timestamp_s"],
      message:
        `\`keyframes[${index}].timestamp_s\` must fall strictly inside the clip — greater than 0 ` +
        `and less than \`duration\` (${seconds} s); got ${at}.`,
      meta: { min: 0, max: seconds, value: at, source: VIDEO_R2V_DOCS },
    });
  }
}

const TEXT_IMAGE_ONLY_SET = new Set<string>(VIDEO_TEXT_IMAGE_ONLY_MODELS);

/** Reference images on a model with no reference-to-video mode. */
function checkReferenceSupport(
  params: VideoGenerationsParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const model = params.model;
  if (model === undefined || !TEXT_IMAGE_ONLY_SET.has(model)) return;
  if (params.reference_images !== undefined) {
    ctx.report({
      code: "unsupported_capability",
      path: ["reference_images"],
      model,
      message:
        `${JSON.stringify(model)} serves text-to-video and image-to-video only; reference-to-video ` +
        "(`reference_images`) is served by grok-imagine-video-1.5 (up to 14 images) and " +
        "grok-imagine-video (up to 7).",
      meta: { source: VIDEO_OVERVIEW },
    });
  }
}

const VOICE_AND_FRAME_SET = new Set<string>(VIDEO_VOICE_AND_FRAME_MODELS);

/** What each {@link VIDEO_VOICE_AND_FRAME_MODELS} input's refusal says after the model id. */
const VOICE_AND_FRAME_INPUTS = {
  reference_audios:
    "takes no voice references; `reference_audios` is served by grok-imagine-video-1.5 (up to 3 voices).",
  last_frame: "cannot pin a last frame; `last_frame` is served by grok-imagine-video-1.5.",
  keyframes:
    "cannot pin mid-video keyframes; `keyframes` is served by grok-imagine-video-1.5 (up to 4).",
} as const satisfies Partial<Record<keyof VideoGenerationsParams, string>>;

/**
 * Voice references and pinned frames on a catalogued model other than
 * grok-imagine-video-1.5. Keyed on the resolved row, so the documented 1.5
 * aliases pass; an omitted or unknown model is never gated.
 */
function checkVoiceAndFrameSupport(
  params: VideoGenerationsParams,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (info === undefined || VOICE_AND_FRAME_SET.has(info.id)) return;
  for (const [key, refusal] of Object.entries(VOICE_AND_FRAME_INPUTS)) {
    if (params[key as keyof typeof VOICE_AND_FRAME_INPUTS] === undefined) continue;
    ctx.report({
      code: "unsupported_capability",
      path: [key],
      model: params.model,
      message: `${JSON.stringify(params.model)} ${refusal}`,
      meta: { source: VIDEO_OVERVIEW },
    });
  }
}

/**
 * {@link VIDEO_REFERENCE_LIMITS}: the image count and the clip length of a
 * reference-to-video request, per resolved row. Only `reference_images`
 * count — the page lists the pinned `image` separately. A duration already
 * outside 1–15 is {@link checkGenerationDuration}'s to report.
 */
function checkReferenceLimits(
  params: VideoGenerationsParams,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const references = params.reference_images;
  if (info === undefined || references === undefined) return;
  if (!Object.hasOwn(VIDEO_REFERENCE_LIMITS, info.id)) return;
  const limits = VIDEO_REFERENCE_LIMITS[info.id as keyof typeof VIDEO_REFERENCE_LIMITS];
  if (references.length > limits.images) {
    ctx.report({
      code: "invalid_shape",
      path: ["reference_images"],
      model: params.model,
      message:
        `${JSON.stringify(params.model)} takes up to ${limits.images} reference images per ` +
        `request; got ${references.length}.`,
      meta: { max: limits.images, count: references.length, source: VIDEO_R2V_DOCS },
    });
  }
  if (params.duration === undefined) return;
  const seconds = requestedSeconds(params);
  if (seconds > VIDEO_MAX_DURATION || seconds <= limits.seconds) return;
  ctx.report({
    code: "invalid_shape",
    path: ["duration"],
    model: params.model,
    message:
      `Reference-to-video on ${JSON.stringify(params.model)} runs up to ${limits.seconds} ` +
      `seconds; got ${seconds}.`,
    meta: { max: limits.seconds, value: seconds, source: VIDEO_R2V_DOCS },
  });
}

const SOURCE_CLIP_SET = new Set<string>(SOURCE_CLIP_MODELS);

/**
 * /v1/videos/edits and /v1/videos/extensions on a catalogued model that
 * serves neither. Keyed on the resolved row, so the 1.5 aliases are refused
 * with it; an omitted or unknown model is never gated.
 */
function sourceClipModelCheck(
  route: "/v1/videos/edits" | "/v1/videos/extensions",
): (params: { model?: string }, info: ModelInfo | undefined, ctx: PipelineContext) => void {
  return function checkSourceClipModel(params, info, ctx) {
    if (info === undefined || SOURCE_CLIP_SET.has(info.id)) return;
    ctx.report({
      code: "unsupported_capability",
      path: ["model"],
      model: params.model,
      message:
        `${JSON.stringify(params.model)} is not served on POST ${route} (the capability matrix ` +
        `marks it "Not supported"); the route is served by ` +
        `${SOURCE_CLIP_MODELS.map((id) => JSON.stringify(id)).join(", ")}.`,
      meta: { source: VIDEO_OVERVIEW },
    });
  };
}

function checkGenerationDuration(
  params: VideoGenerationsParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (params.duration === undefined) return;
  const duration = requestedSeconds(params);
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
 * Two 1080p ceilings. The model's: grok-imagine-video renders up to 720p on
 * every mode ({@link MAX_720P_MODEL}). The mode's: "1080p is text-to-video /
 * image-to-video only" and "reference-to-video: resolution capped at 720p" —
 * the same fact from both directions. The model's is reported alone, since it
 * holds whatever the inputs are.
 */
function checkGenerationResolution(
  params: VideoGenerationsParams,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (params.resolution !== "1080p") return;
  if (info?.id === MAX_720P_MODEL) {
    ctx.report({
      code: "unsupported_capability",
      path: ["resolution"],
      model: info.id,
      message:
        `${JSON.stringify(MAX_720P_MODEL)} supports up to "720p"; "1080p" is served by ` +
        "grok-imagine-video-1.5 (native) and grok-imagine-video-1.5-lite (upscaled from 720p), " +
        "for text-to-video and image-to-video.",
      meta: { source: VIDEO_DOCS },
    });
    return;
  }
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
// Estimation — xAI bills per second of generated video at the requested
// resolution, plus a fee per input image (./models.ts VIDEO_RATES,
// VIDEO_INPUT_IMAGE_USD). Edits and extensions carry no estimate: both take a
// source clip whose length the request body does not carry — an edit's
// output matches it (capped at 8.7 s), and grok-imagine-video bills the input
// clip itself at "$0.01 / sec".
// ---------------------------------------------------------------------------

/** What besides the model and the duration moves the price of one generation. */
export interface XaiVideoPriceOptions {
  /** Default "480p", the wire default. */
  resolution?: XaiVideoResolution | (string & {});
  /**
   * Input images: `image` plus each `reference_images` entry. Default 0. The
   * pricing pages do not say whether `last_frame` and `keyframes` images bill
   * the per-image fee, so the request estimate counts neither.
   */
  inputImages?: number;
}

/**
 * USD for one generation, or undefined when the model is unknown or has no
 * published rate at that resolution (grok-imagine-video at "1080p").
 * Documented aliases price as the row they serve.
 */
export function videoPriceUSD(
  model: string | undefined,
  durationSeconds: number,
  options: XaiVideoPriceOptions = {},
): number | undefined {
  const id = resolveVideoModel(model);
  if (id === undefined || !Object.hasOwn(VIDEO_RATES, id)) return undefined;
  const known = id as XaiVideoGenerationModelId;
  const rates: Readonly<Partial<Record<string, number>>> = VIDEO_RATES[known];
  const rate = rates[options.resolution ?? DEFAULT_VIDEO_RESOLUTION];
  if (rate === undefined) return undefined;
  return rate * durationSeconds + VIDEO_INPUT_IMAGE_USD[known] * (options.inputImages ?? 0);
}

function estimateGeneration(
  params: VideoGenerationsParams,
  _info: ModelInfo | undefined,
  _ctx: PipelineContext,
) {
  const costUSD = videoPriceUSD(params.model, requestedSeconds(params), {
    resolution: params.resolution ?? DEFAULT_VIDEO_RESOLUTION,
    inputImages: (params.image === undefined ? 0 : 1) + (params.reference_images?.length ?? 0),
  });
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
  modelId: (params) => resolveVideoModel(params.model),
  catalog: videoModels,
  checks: [
    checkModelEnum,
    checkGenerationPrompt,
    checkGenerationInputs,
    checkReferenceSupport,
    checkVoiceAndFrameSupport,
    checkReferenceLimits,
    checkGenerationDuration,
    checkGenerationResolution,
  ],
  estimate: estimateGeneration,
  promptPath: ["prompt"],
  finalize: finalizeTo(VIDEO_GENERATIONS_URL),
});

const editsValidator = createValidator<VideoEditsParams, unknown>({
  endpoint: "xai.videoEdit",
  schema: editsSchema,
  modelId: (params) => resolveVideoModel(params.model),
  catalog: videoModels,
  checks: [checkModelEnum, sourceClipModelCheck("/v1/videos/edits"), checkEditInputs],
  promptPath: ["prompt"],
  finalize: finalizeTo(VIDEO_EDITS_URL),
});

const extensionsValidator = createValidator<VideoExtensionsParams, unknown>({
  endpoint: "xai.videoExtend",
  schema: extensionsSchema,
  modelId: (params) => resolveVideoModel(params.model),
  catalog: videoModels,
  checks: [
    checkModelEnum,
    sourceClipModelCheck("/v1/videos/extensions"),
    checkEditInputs,
    checkExtensionDuration,
  ],
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
 * Cost is the published per-second rate at the requested resolution (default
 * 480p) × the requested duration (default 8 s), plus the per-image fee for
 * each input image — e.g. grok-imagine-video-1.5 at 720p: $0.14/s × 12 +
 * $0.01 for the first frame = $1.69.
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
 * flow as {@link video}. No cost estimate: grok-imagine-video bills the input
 * clip per second ("$0.01 / sec") on top of the new footage, and the clip's
 * length is not in the request.
 */
export const videoExtend = extensionsValidator as unknown as XaiVideoValidator<VideoExtensionsParams>;
