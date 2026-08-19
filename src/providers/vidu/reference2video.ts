/**
 * Vidu Reference to Video — POST https://api.vidu.com/ent/v2/reference2video
 *
 * Wire notes (verified against https://platform.vidu.com/docs/reference-to-video
 * on 2026-08-13):
 * - The page documents TWO request-body forms on this one endpoint:
 *   "Subjects-Reference to Video" (a `subjects` list of named
 *   `{ name, images }` entries, addressable from the prompt as `@name`, plus
 *   `auto_subjects`) and plain "Reference to Video" (a flat `images` array,
 *   or `videos` on `viduq2-pro`). Both ride the same params type here; a
 *   check requires at least one of the three and rejects the combinations the
 *   docs rule out.
 * - `subjects` is not available on `viduq3-mix` ("viduq3-mix does not support
 *   the use of entities for the time being"); `videos` is `viduq2-pro`-only.
 * - `images` takes 1–7 references (1–4 on `viduq2-pro` when a video is also
 *   uploaded); each subject in `subjects` takes up to 3 images and the whole
 *   list is capped at 7 entries (4 on `viduq2-pro`).
 * - `audio` defaults to true on `viduq3` / `viduq3-turbo` and false elsewhere;
 *   `bgm` is unsupported on q3; `movement_amplitude` does not take effect on
 *   q2/q3.
 * - `aspect_ratio` is left as the union of both forms' lists. The two forms
 *   contradict each other — the subjects form prints "16:9 9:16 1:1" plus
 *   "q2、q3 model supports any aspect ratio", while the images form prints all
 *   five with "3:4 & 4:3 only support q2 model" — so unmodel does not narrow
 *   per model here rather than reject a documented value.
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
  DOCS_BASE,
  VIDU_ASPECT_RATIOS,
  VIDU_AUDIO_TYPES,
  VIDU_BASE_URL,
  VIDU_HEADERS,
  VIDU_MOVEMENT_AMPLITUDES,
  assetSchema,
  checkRouteSupport,
  payloadSchema,
  promptSchema,
  type RouteSupport,
  type ViduAspectRatio,
  type ViduAudioType,
  type ViduMovementAmplitude,
  type ViduResolution,
} from "./shared";
import { videoCostUSD } from "./pricing";

export const REFERENCE2VIDEO_URL = `${VIDU_BASE_URL}/reference2video`;

const SOURCE = `${DOCS_BASE}/reference-to-video`;

/** Models with a reference2video arm (union of both documented forms). */
export const REFERENCE2VIDEO_SUPPORT: RouteSupport = {
  "viduq3-mix": { resolutions: ["720p", "1080p"], duration: { min: 1, max: 16 } },
  "viduq3-turbo": { resolutions: ["540p", "720p", "1080p"], duration: { min: 3, max: 16 } },
  viduq3: { resolutions: ["540p", "720p", "1080p"], duration: { min: 3, max: 16 } },
  // 0 means "automatic duration" on viduq2-pro.
  "viduq2-pro": { resolutions: ["540p", "720p", "1080p"], duration: { min: 0, max: 10 } },
  viduq2: { resolutions: ["540p", "720p", "1080p"], duration: { min: 1, max: 10 } },
  viduq1: { resolutions: ["1080p"], duration: { min: 5, max: 5 }, durations: [5] },
  "vidu2.0": { resolutions: ["360p", "720p"], duration: { min: 4, max: 4 }, durations: [4] },
};

/** Models that accept the `subjects` (named-entity) form. */
export const SUBJECTS_MODELS = ["viduq3-turbo", "viduq3", "viduq2", "viduq1", "vidu2.0"] as const;

/** The only model that accepts `videos` references. */
export const VIDEO_REFERENCE_MODEL = "viduq2-pro";

/** A named subject: up to 3 images, addressable in the prompt as `@name`. */
export interface ViduSubject {
  name: string;
  images: string[];
  /** Voice character for this subject. Not effective on the Q3 series. */
  voice_id?: string;
}

export interface Reference2VideoParams {
  model: ViduModelId | (string & {});
  /** Required; up to 5000 characters. Reference subjects as `@name`. */
  prompt: string;
  /** Named subjects form. Not available on `viduq3-mix`. */
  subjects?: ViduSubject[];
  /** Use Vidu's intelligent entity library. Default false. */
  auto_subjects?: boolean;
  /** Flat reference images: 1–7 (1–4 on viduq2-pro alongside `videos`). */
  images?: string[];
  /** Video references — `viduq2-pro` only; 1×8s or 2×5s. */
  videos?: string[];
  /** Voice character; not effective on the Q3 series. */
  voice_id?: string;
  /** Seconds; bounds vary per model (default 5, or 4 on vidu2.0). */
  duration?: number;
  seed?: number;
  /** Default "16:9". */
  aspect_ratio?: ViduAspectRatio;
  /**
   * Default "720p" (viduq1: "1080p"; vidu2.0: "360p"). Autocomplete over every
   * documented value; `REFERENCE2VIDEO_SUPPORT` narrows it per model at runtime.
   */
  resolution?: ViduResolution;
  /** Default "auto". Not effective on q2 / q3. */
  movement_amplitude?: ViduMovementAmplitude;
  /** Background music. Default false; unsupported on q3. */
  bgm?: boolean;
  /** Audio-video output. Defaults to true on viduq3 / viduq3-turbo. */
  audio?: boolean;
  /** Required when `audio` is true; defaults to "all". */
  audio_type?: ViduAudioType;
  payload?: string;
  off_peak?: boolean;
  callback_url?: string;
}

const subjectSchema = z.looseObject({
  name: z.string().min(1),
  images: z.array(assetSchema),
  voice_id: z.string().optional(),
});

const reference2videoSchema = z.looseObject({
  model: z.string(),
  prompt: promptSchema,
  subjects: z.array(subjectSchema).optional(),
  auto_subjects: z.boolean().optional(),
  images: z.array(assetSchema).optional(),
  videos: z.array(assetSchema).optional(),
  voice_id: z.string().optional(),
  duration: z.number().int().optional(),
  seed: z.number().int().optional(),
  aspect_ratio: z.enum(VIDU_ASPECT_RATIOS).optional(),
  resolution: z.string().optional(),
  movement_amplitude: z.enum(VIDU_MOVEMENT_AMPLITUDES).optional(),
  bgm: z.boolean().optional(),
  audio: z.boolean().optional(),
  audio_type: z.enum(VIDU_AUDIO_TYPES).optional(),
  payload: payloadSchema.optional(),
  off_peak: z.boolean().optional(),
  callback_url: z.string().optional(),
});

/** Max reference count per model: 7, or 4 on viduq2-pro when a video rides along. */
function maxReferences(model: string, hasVideos: boolean): number {
  return model === VIDEO_REFERENCE_MODEL && hasVideos ? 4 : 7;
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
  if (hasSubjects) {
    if (params.subjects!.length > max) {
      ctx.report({
        code: "invalid_shape",
        path: ["subjects"],
        model,
        message: `\`subjects\` accepts at most ${max} entries for "${model}"; got ${params.subjects!.length}.`,
        meta: { max, count: params.subjects!.length, source: SOURCE },
      });
    }
    params.subjects!.forEach((subject, index) => {
      if (Array.isArray(subject.images) && subject.images.length > 3) {
        ctx.report({
          code: "invalid_shape",
          path: ["subjects", index, "images"],
          model,
          message: `each subject supports up to 3 images; got ${subject.images.length}.`,
          meta: { max: 3, count: subject.images.length, source: SOURCE },
        });
      }
    });
  }
}

export const reference2videoConstraints = {
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
  endpoint: "vidu.reference2video",
  schema: reference2videoSchema,
  modelId: (params) => params.model,
  catalog: videoModels,
  constraints: reference2videoConstraints,
  checks: [checkRouteSupport("reference2video", REFERENCE2VIDEO_SUPPORT, SOURCE), checkReferences],
  estimate,
  finalize,
});

/**
 * Validates raw wire params for Vidu `POST /ent/v2/reference2video`.
 *
 * ```ts
 * const params = vidu.reference2video({
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
export const reference2video = validator as unknown as {
  <T extends Reference2VideoParams>(
    params: T & ExactKeys<T, Reference2VideoParams>,
    options?: ValidateOptions,
  ): Validated<T, ViduSdkTargets<T>>;
  safe<T extends Reference2VideoParams>(
    params: T & ExactKeys<T, Reference2VideoParams>,
    options?: ValidateOptions,
  ): ValidateResult<Validated<T, ViduSdkTargets<T>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
