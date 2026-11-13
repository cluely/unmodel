/**
 * Vidu Reference to Video — POST https://api.vidu.com/ent/v2/reference2video
 *
 * Wire notes (verified 2026-08-13; the route is documented per family at
 * https://platform.vidu.com/docs/api-reference/video-models/{vidu-q4-preview,vidu-q3,vidu-q2,vidu-q1}/reference-to-video,
 * and facts re-read there cite their own date):
 * - The page documents TWO request-body forms on this one endpoint:
 *   "Subjects-Reference to Video" (a `subjects` list of named entries —
 *   temporary `images` / `videos`, a saved `server_id`, or a bare `name` text
 *   subject — addressable from the prompt as `@name`, plus `auto_subjects`)
 *   and plain "Reference to Video" (a flat `images` array,
 *   or `videos` on `viduq2-pro`). Both ride the same params type here; a
 *   check requires at least one of the three and rejects the combinations the
 *   docs rule out.
 * - `subjects` is not available on `viduq3-mix` ("viduq3-mix does not support
 *   the use of entities for the time being"), `viduq3-ad` (no subjects form)
 *   or `viduq4-preview` ("viduq4-preview does not support the subject
 *   invocation method for the time being." —
 *   https://platform.vidu.com/docs/api-reference/video-models/vidu-q4-preview/reference-to-video,
 *   2026-11-12); `videos` is `viduq2-pro`-only.
 * - `images` takes 1–7 references (1–15 on `viduq4-preview`; 1–4 on
 *   `viduq2-pro` when a video is also uploaded); each subject in `subjects`
 *   takes up to 3 images and the list is capped at 7 image or text subjects
 *   (4 on `viduq2-pro`, which also takes up to 2 video subjects, 1 of them
 *   temporary).
 * - `sounds` (mp3 audio references, up to 3) is documented on `viduq3-mix`,
 *   `viduq3-ad`, `viduq3-drama` and `viduq4-preview` only.
 * - `audio` defaults to true on `viduq3` / `viduq3-turbo`, `viduq4-preview`
 *   and viduq3-drama's images form, and false elsewhere;
 *   `bgm` is unsupported on q3; `movement_amplitude` does not take effect on
 *   q2/q3.
 * - `aspect_ratio` takes the five fixed ratios plus `auto` ("Defaults to
 *   `16:9`. Accepted values: 1:1, 9:16, 16:9, 3:4, 4:3 auto: Automatically
 *   recommended based on the input image or video." —
 *   https://platform.vidu.com/docs/api-reference/video-models/vidu-q3/reference-to-video,
 *   2026-11-12), and is not narrowed per model: the forms of one model list
 *   different sets (viduq3-drama's images form prints only `9:16` `16:9`
 *   `auto`, its subjects form all six) and viduq4-preview's page omits
 *   `auto`, so a per-model enum would reject a documented value.
 * - Auth is `Authorization: Token <VIDU_API_KEY>`.
 */

import { z } from "zod";
import { createValidator, type PipelineContext } from "../../core/pipeline";
import { toValidated, type ExactKeys, type Validated } from "../../core/request";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";
import type { ModelInfo } from "../../core/catalog-types";
import type { EndpointConstraints } from "../../core/constraint-types";
import { videoModels, type ViduModelId } from "./models";
import {
  VIDEO_DOCS,
  VIDU_ASPECT_RATIOS,
  VIDU_AUDIO_TYPES,
  VIDU_BASE_URL,
  VIDU_HEADERS,
  VIDU_MOVEMENT_AMPLITUDES,
  assetSchema,
  checkArrayLength,
  checkPromptCap,
  checkRouteSupport,
  payloadSchema,
  promptSchema,
  watermarkShape,
  type RouteSupport,
  type ViduAspectRatio,
  type ViduAudioType,
  type ViduMovementAmplitude,
  type ViduResolution,
  type ViduWatermarkParams,
} from "./shared";
import { videoCostUSD } from "./pricing";

export const REFERENCE2VIDEO_URL = `${VIDU_BASE_URL}/reference2video`;

const SOURCE = `${VIDEO_DOCS}/reference-to-video`;

/** Models with a reference2video arm (union of both documented forms). */
export const REFERENCE2VIDEO_SUPPORT: RouteSupport = {
  // "Resolution parameter；Default: `720p`；Allowed values: `540p` / `720p` /
  // `1080p` / `2K` / `4K`" and "Video duration parameter；Default: `5`；Allowed
  // values: `3 - 16`" —
  // https://platform.vidu.com/docs/api-reference/video-models/vidu-q4-preview/reference-to-video,
  // 2026-11-12.
  "viduq4-preview": {
    resolutions: ["540p", "720p", "1080p", "2K", "4K"],
    duration: { min: 3, max: 16 },
  },
  // The two drama forms disagree on length — the images form prints
  // "`viduq3-drama`: Default is 8s, available options: 2-15s.", the subjects
  // form "`viduq3-drama`: Default is 8s, available options: 2-16s." — so the
  // union is kept and neither is refused. "`viduq3-drama` (2-15s): Default is
  // 1080p, available options: 720p and 1080p." —
  // https://platform.vidu.com/docs/api-reference/video-models/vidu-q3/reference-to-video,
  // 2026-11-12.
  "viduq3-drama": { resolutions: ["720p", "1080p"], duration: { min: 2, max: 16 } },
  // "`viduq3-ad`: Default is 5 seconds, available options: 3-15" and
  // "`viduq3-ad` (3-15 seconds): Default is 720p, available options: 720p and
  // 1080p" — same page, 2026-11-12.
  "viduq3-ad": { resolutions: ["720p", "1080p"], duration: { min: 3, max: 15 } },
  "viduq3-mix": { resolutions: ["720p", "1080p"], duration: { min: 1, max: 16 } },
  "viduq3-turbo": { resolutions: ["540p", "720p", "1080p"], duration: { min: 3, max: 16 } },
  viduq3: { resolutions: ["540p", "720p", "1080p"], duration: { min: 3, max: 16 } },
  // 0 means "automatic duration" on viduq2-pro.
  "viduq2-pro": { resolutions: ["540p", "720p", "1080p"], duration: { min: 0, max: 10 } },
  viduq2: { resolutions: ["540p", "720p", "1080p"], duration: { min: 1, max: 10 } },
  viduq1: { resolutions: ["1080p"], duration: { min: 5, max: 5 }, durations: [5] },
  "vidu2.0": { resolutions: ["360p", "720p"], duration: { min: 4, max: 4 }, durations: [4] },
};

/**
 * Models that accept the `subjects` (named-entity) form. viduq3-drama's
 * section carries one ("| `subjects` | `array` | Required |" under "## Q3
 * Drama Create Task"), and viduq2-pro is named by the form's own `subjects`
 * row: "When using the q2-pro model, video subjects, text subjects, and image
 * subjects can be used. The number of image or text subjects should not
 * exceed 4. The number of video subjects should not exceed 2 (or 1 for
 * temporary video subjects)." — both
 * https://platform.vidu.com/docs/api-reference/video-models/vidu-q3/reference-to-video,
 * 2026-11-12.
 */
export const SUBJECTS_MODELS = [
  "viduq3-turbo",
  "viduq3",
  "viduq3-drama",
  "viduq2",
  "viduq2-pro",
  "viduq1",
  "vidu2.0",
] as const;

/** The only model that accepts `videos` references. */
export const VIDEO_REFERENCE_MODEL = "viduq2-pro";

/**
 * Flat `images` caps that differ from the default 7: "Note 1:
 * `viduq4-preview` model supports uploading 1 to 15 images;" —
 * https://platform.vidu.com/docs/api-reference/video-models/vidu-q4-preview/reference-to-video,
 * 2026-11-12.
 */
const IMAGE_CAPS: Readonly<Record<string, number>> = { "viduq4-preview": 15 };

/**
 * The models whose pages document `sounds`, and how many each takes: "Audio
 * references support uploading 1 to 3 audio files." on the viduq3-mix,
 * viduq3-ad and viduq3-drama sections of
 * https://platform.vidu.com/docs/api-reference/video-models/vidu-q3/reference-to-video,
 * and "Up to 0 to 3 audio files are supported for upload" on
 * https://platform.vidu.com/docs/api-reference/video-models/vidu-q4-preview/reference-to-video,
 * both 2026-11-12. The CN mirror prints "支持上传 0～3 个音频" for the q3
 * sections, so an empty list is not refused.
 */
const SOUND_COUNTS: Readonly<Record<string, { min: number; max: number }>> = {
  "viduq4-preview": { min: 0, max: 3 },
  "viduq3-mix": { min: 0, max: 3 },
  "viduq3-ad": { min: 0, max: 3 },
  "viduq3-drama": { min: 0, max: 3 },
};

/**
 * A named subject, addressable in the prompt as `@name`: temporary `images`,
 * a temporary `videos` clip (viduq2-pro), a saved `server_id`, or `name` alone
 * for a text subject.
 */
export interface ViduSubject {
  name: string;
  /** Temporary subject images, up to 3. */
  images?: string[];
  /** Temporary subject video — viduq2-pro only; one clip of up to 5 seconds. */
  videos?: string[];
  /** A subject saved through the Create Subject API; without it the subject is temporary. */
  server_id?: string;
  /** Voice character for this subject. Not effective on the Q3 series. */
  voice_id?: string;
}

export interface Reference2VideoParams extends ViduWatermarkParams {
  model: ViduModelId | (string & {});
  /**
   * Required; up to 20000 characters on q3 / q4, 5000 on q2 / q1 / vidu2.0.
   * Reference subjects as `@name`.
   */
  prompt: string;
  /** Named subjects form. Not available on `viduq3-mix`, `viduq3-ad` or `viduq4-preview`. */
  subjects?: ViduSubject[];
  /** Use Vidu's intelligent entity library. Default false. */
  auto_subjects?: boolean;
  /**
   * Flat reference images: 1–7 (1–15 on viduq4-preview; 1–4 on viduq2-pro
   * alongside `videos`).
   */
  images?: string[];
  /** Video references — `viduq2-pro` only; 1×8s or 2×5s. */
  videos?: string[];
  /**
   * Audio references: up to 3 mp3 files, each 3–12s and ≤50MB (URL or
   * base64 data URI). Documented on viduq3-mix, viduq3-ad, viduq3-drama and
   * viduq4-preview.
   */
  sounds?: string[];
  /** Voice character; not effective on the Q3 series. */
  voice_id?: string;
  /** Seconds; bounds vary per model (default 5, or 4 on vidu2.0). */
  duration?: number;
  seed?: number;
  /**
   * Default "16:9". `auto` lets the model pick from the references;
   * viduq4-preview's page lists the five fixed ratios only.
   */
  aspect_ratio?: ViduAspectRatio | "auto";
  /**
   * Default "720p" (viduq1 / viduq3-drama: "1080p"; vidu2.0: "360p").
   * Autocomplete over every documented value (`2K` / `4K` are
   * viduq4-preview's); `REFERENCE2VIDEO_SUPPORT` narrows it per model at runtime.
   */
  resolution?: ViduResolution;
  /** Default "auto". Not effective on q2 / q3. */
  movement_amplitude?: ViduMovementAmplitude;
  /** Background music. Default false; unsupported on q3. */
  bgm?: boolean;
  /**
   * Audio-video output. Defaults to true on viduq3 / viduq3-turbo,
   * viduq4-preview and viduq3-drama's images form.
   */
  audio?: boolean;
  /** Required when `audio` is true; defaults to "all". */
  audio_type?: ViduAudioType;
  payload?: string;
  off_peak?: boolean;
  callback_url?: string;
}

const subjectSchema = z.looseObject({
  name: z.string().min(1),
  images: z.array(assetSchema).optional(),
  videos: z.array(assetSchema).optional(),
  server_id: z.string().optional(),
  voice_id: z.string().optional(),
});

const videoFromReferenceSchema = z.looseObject({
  model: z.string(),
  prompt: promptSchema,
  subjects: z.array(subjectSchema).optional(),
  auto_subjects: z.boolean().optional(),
  images: z.array(assetSchema).optional(),
  videos: z.array(assetSchema).optional(),
  sounds: z.array(assetSchema).optional(),
  voice_id: z.string().optional(),
  duration: z.number().int().optional(),
  seed: z.number().int().optional(),
  aspect_ratio: z.enum([...VIDU_ASPECT_RATIOS, "auto"]).optional(),
  resolution: z.string().optional(),
  movement_amplitude: z.enum(VIDU_MOVEMENT_AMPLITUDES).optional(),
  bgm: z.boolean().optional(),
  audio: z.boolean().optional(),
  audio_type: z.enum(VIDU_AUDIO_TYPES).optional(),
  payload: payloadSchema.optional(),
  off_peak: z.boolean().optional(),
  ...watermarkShape,
  callback_url: z.string().optional(),
});

/**
 * Max reference count per model: 7 unless {@link IMAGE_CAPS} says otherwise,
 * or 4 on viduq2-pro when a video rides along.
 */
function maxReferences(model: string, hasVideos: boolean): number {
  if (model === VIDEO_REFERENCE_MODEL && hasVideos) return 4;
  return IMAGE_CAPS[model] ?? 7;
}

function checkReferences(
  params: Reference2VideoParams,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (info === undefined) return;
  const model = params.model;
  const hasSubjects = Array.isArray(params.subjects) && params.subjects.length > 0;
  const hasImages = Array.isArray(params.images) && params.images.length > 0;
  const hasVideos = Array.isArray(params.videos) && params.videos.length > 0;

  if (!hasSubjects && !hasImages && !hasVideos && params.auto_subjects !== true) {
    ctx.report({
      code: "invalid_shape",
      path: ["images"],
      model,
      message:
        "reference2video needs references: pass `subjects`, `images`, `videos` (viduq2-pro), or `auto_subjects: true`.",
      meta: { source: SOURCE },
    });
  }

  if (hasSubjects && !(SUBJECTS_MODELS as readonly string[]).includes(model)) {
    ctx.report({
      code: "unsupported_param",
      path: ["subjects"],
      model,
      message: `\`subjects\` (named entities) is not supported by "${model}"; it accepts ${SUBJECTS_MODELS.join(", ")}.`,
      meta: { source: SOURCE, supported: [...SUBJECTS_MODELS] },
    });
  }

  if (hasVideos && model !== VIDEO_REFERENCE_MODEL) {
    ctx.report({
      code: "unsupported_param",
      path: ["videos"],
      model,
      message: `\`videos\` references are only supported by "${VIDEO_REFERENCE_MODEL}"; got "${model}".`,
      meta: { source: SOURCE },
    });
  }
  if (hasVideos && params.videos!.length > 2) {
    ctx.report({
      code: "invalid_shape",
      path: ["videos"],
      model,
      message: `\`videos\` accepts at most 1 video of 8s or 2 videos of 5s; got ${params.videos!.length}.`,
      meta: { max: 2, count: params.videos!.length, source: SOURCE },
    });
  }

  const max = maxReferences(model, hasVideos);
  if (hasImages && params.images!.length > max) {
    ctx.report({
      code: "invalid_shape",
      path: ["images"],
      model,
      message: `\`images\` accepts at most ${max} reference images for "${model}"${hasVideos ? " when `videos` is also uploaded" : ""}; got ${params.images!.length}.`,
      meta: { max, count: params.images!.length, source: SOURCE },
    });
  }
  if (hasSubjects) checkSubjects(model, params.subjects!, ctx);
}

/**
 * The subjects caps quoted on {@link SUBJECTS_MODELS}: 7 image or text
 * subjects (4 on viduq2-pro), up to 3 images each, and — on viduq2-pro, the
 * one model with video subjects ("Note 1: Only the viduq2-pro Reference to
 * Video model supports video subjects.") — at most 2 video subjects, 1 of them
 * temporary, each one clip ("Supports uploading at most one 5-second video").
 *
 * A saved subject is referenced by id alone — "The subject ID obtained through
 * the Create Subject API. Note: When server_id is not passed, it is treated as
 * a temporary subject and will not be saved by the system." (the `server_id`
 * row; the request example passes `{ "name": "2", "server_id": "321321" }`) —
 * so whether it is an image or a video subject lives on the server. On
 * viduq2-pro such a subject counts toward neither cap, only toward their sum
 * of 6; on every other model it can only be an image subject and counts
 * toward the 7. Same page as {@link SUBJECTS_MODELS}, re-read 2026-11-13.
 */
function checkSubjects(model: string, subjects: readonly ViduSubject[], ctx: PipelineContext): void {
  const q2Pro = model === VIDEO_REFERENCE_MODEL;
  const videoSubjects = q2Pro
    ? subjects.filter((subject) => Array.isArray(subject.videos) && subject.videos.length > 0)
    : [];
  const saved = q2Pro
    ? subjects.filter(
        (subject) =>
          subject.server_id !== undefined &&
          !(Array.isArray(subject.images) && subject.images.length > 0) &&
          !(Array.isArray(subject.videos) && subject.videos.length > 0),
      )
    : [];
  const max = q2Pro ? 4 : 7;
  const imageOrText = subjects.length - videoSubjects.length - saved.length;
  if (imageOrText > max) {
    ctx.report({
      code: "invalid_shape",
      path: ["subjects"],
      model,
      message: `\`subjects\` accepts at most ${max} image or text subjects for "${model}"; got ${imageOrText}.`,
      meta: { max, count: imageOrText, source: SOURCE },
    });
  }
  // Without saved subjects the two caps already bound the total; with them,
  // the total is the only bound a kind-less subject has.
  if (saved.length > 0 && subjects.length > 6) {
    ctx.report({
      code: "invalid_shape",
      path: ["subjects"],
      model,
      message: `\`subjects\` accepts at most 6 subjects for "${model}" (4 image or text + 2 video); got ${subjects.length}.`,
      meta: { max: 6, count: subjects.length, source: SOURCE },
    });
  }
  const temporary = videoSubjects.filter((subject) => subject.server_id === undefined).length;
  if (videoSubjects.length > 2 || temporary > 1) {
    ctx.report({
      code: "invalid_shape",
      path: ["subjects"],
      model,
      message: `\`subjects\` accepts at most 2 video subjects for "${model}", at most 1 of them temporary (no \`server_id\`); got ${videoSubjects.length} (${temporary} temporary).`,
      meta: { max: 2, maxTemporary: 1, count: videoSubjects.length, temporary, source: SOURCE },
    });
  }
  subjects.forEach((subject, index) => {
    if (Array.isArray(subject.images) && subject.images.length > 3) {
      ctx.report({
        code: "invalid_shape",
        path: ["subjects", index, "images"],
        model,
        message: `each subject supports up to 3 images; got ${subject.images.length}.`,
        meta: { max: 3, count: subject.images.length, source: SOURCE },
      });
    }
    const clips = subject.videos;
    if (!q2Pro && Array.isArray(clips) && clips.length > 0) {
      ctx.report({
        code: "unsupported_param",
        path: ["subjects", index, "videos"],
        model,
        message: `video subjects (\`subjects[].videos\`) are only supported by "${VIDEO_REFERENCE_MODEL}"; got "${model}".`,
        meta: { source: SOURCE, supported: [VIDEO_REFERENCE_MODEL] },
      });
    }
    if (q2Pro && Array.isArray(clips) && clips.length > 1) {
      ctx.report({
        code: "invalid_shape",
        path: ["subjects", index, "videos"],
        model,
        message: `a video subject takes one clip of up to 5 seconds; got ${clips.length}.`,
        meta: { max: 1, count: clips.length, source: SOURCE },
      });
    }
  });
}

export const videoFromReferenceConstraints = {
  "viduq3-drama": q3Ignored(),
  "viduq3-ad": q3Ignored(),
  "viduq3-mix": q3Ignored(),
  "viduq3-turbo": q3Ignored(),
  viduq3: q3Ignored(),
  viduq2: q2Ignored(),
  "viduq2-pro": q2Ignored(),
} as const satisfies Readonly<Partial<Record<string, EndpointConstraints>>>;

function q3Ignored(): EndpointConstraints {
  return {
    deny: {
      bgm: { reason: "the q3 models do not support BGM.", source: SOURCE, ignored: true },
      voice_id: {
        reason: "`voice_id` is not effective on the Q3 series.",
        source: SOURCE,
        ignored: true,
      },
      movement_amplitude: {
        reason: "`movement_amplitude` does not take effect on the q3 models.",
        source: SOURCE,
        ignored: true,
      },
    },
  };
}

function q2Ignored(): EndpointConstraints {
  return {
    deny: {
      movement_amplitude: {
        reason: "`movement_amplitude` does not take effect on the q2 models.",
        source: SOURCE,
        ignored: true,
      },
    },
  };
}

function estimate(
  params: Reference2VideoParams,
  info: ModelInfo | undefined,
  _ctx: PipelineContext,
) {
  if (info === undefined) return {};
  const costUSD = videoCostUSD({
    model: params.model,
    route: "reference2video",
    ...(params.resolution !== undefined && { resolution: params.resolution }),
    ...(params.duration !== undefined && { duration: params.duration }),
    ...(params.off_peak !== undefined && { off_peak: params.off_peak }),
  });
  return costUSD === undefined ? {} : { costUSD };
}

/**
 * The one `.toSdk("vidu")` target for this endpoint — Vidu ships no
 * first-party SDK, so this is the wire body. Derived from the `sdk` literal
 * in `finalize`; it must stay an object type with no index signature, or
 * `toSdk` would accept any string.
 */
type ViduSdkTargets<B> = { vidu: () => B };

function finalize(params: Reference2VideoParams): unknown {
  const body = { ...params };
  return toValidated(body, {
    url: REFERENCE2VIDEO_URL,
    method: "POST",
    headers: VIDU_HEADERS,
  }, {
    sdk: { vidu: () => body },
  });
}

const validator = createValidator<Reference2VideoParams, unknown>({
  endpoint: "vidu.videoFromReference",
  schema: videoFromReferenceSchema,
  modelId: (params) => params.model,
  catalog: videoModels,
  constraints: videoFromReferenceConstraints,
  checks: [
    checkRouteSupport("reference2video", REFERENCE2VIDEO_SUPPORT, SOURCE),
    checkReferences,
    checkArrayLength("sounds", SOUND_COUNTS, SOURCE),
    checkPromptCap(SOURCE),
  ],
  estimate,
  finalize,
});

/**
 * Validates raw wire params for Vidu `POST /ent/v2/reference2video`.
 *
 * ```ts
 * const params = vidu.videoFromReference({
 *   model: "viduq3",
 *   prompt: "@chef and @sous are cooking together",
 *   subjects: [
 *     { name: "chef", images: ["https://example.com/chef.png"] },
 *     { name: "sous", images: ["https://example.com/sous.png"] },
 *   ],
 *   duration: 8,
 * });
 * ```
 */
export const videoFromReference = validator as unknown as {
  <T extends Reference2VideoParams>(
    params: T & ExactKeys<T, Reference2VideoParams>,
    options?: ValidateOptions<T>,
  ): Validated<T, ViduSdkTargets<T>>;
  safe<T extends Reference2VideoParams>(
    params: T & ExactKeys<T, Reference2VideoParams>,
    options?: ValidateOptions<T>,
  ): ValidateResult<Validated<T, ViduSdkTargets<T>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
