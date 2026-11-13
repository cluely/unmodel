/**
 * Kling Image to Video (path-addressed family) —
 * POST https://api-singapore.klingai.com/image-to-video/{model}
 *
 * Exported as `kling.videoV3FromImage`. "V3" names the third-generation ROUTE
 * family — the unversioned `/image-to-video/{model}` paths that arrived with
 * Kling 3.0 — not a single model: the family also serves 2.6, 2.5-turbo and
 * Kling 4.0 / 4.0 Flash.
 *
 * EXPERIMENTAL. The route shapes were transcribed from the doc site's own
 * JavaScript chunks (the SPA under s15-kling.klingai.com/kos/s101/nlav112918/
 * api-doc/assets/; kling.ai/document-api serves one shell for every path).
 * The API host corroborates the FAMILY: without credentials,
 * `POST /text-to-video/kling-4.0`, `/omni-video/kling-4.0` and `GET /tasks`
 * answer HTTP 401 `{"code":1002,"message":"Authentication error. The current
 * API does not support AK/SK; ..."}` — the API-key-only new API's gate —
 * where an unknown path answers 404 (api-singapore.klingai.com, 2026-11-12).
 * The gate fires for any model segment (`/text-to-video/kling-9.9` answers
 * 1002 too), so whether a given model's path exists stays doc-only until
 * verified against a live account.
 * Kling 4.0 / 4.0 Flash exist on this family alone; for the earlier models
 * `kling.videoFromImage` (./video-from-image.ts) is the
 * `model_name`-in-the-body alternative.
 *
 * Wire notes (transcribed from those bundle definitions, cross-read against
 * https://kling.ai/document-api/api/video/3-0-omni/image-to-video and the
 * sibling 3.0-turbo / 2.6 / 2.5-turbo slugs on 2026-08-13):
 * - The model is a URL PATH segment: `model` is stripped from the wire body
 *   and interpolated into `.request.url`.
 * - Inputs ride in one `contents` array of tagged entries —
 *   `{ type: "prompt", text }`, `{ type: "first_frame" | "last_frame", url }`,
 *   `{ type: "element", element_id, id }`, on Kling 2.6 `voice` and on
 *   Kling 4.0 `middle_frame`. Which types a model accepts is per model.
 *   `first_frame` is required everywhere but Kling 4.0: "last-frame-only video
 *   generation is not supported", while 4.0 takes "first frame, last frame,
 *   first-and-last frames, or intermediate frames"
 *   (https://kling.ai/document-api/api/usage-guide/kling-4-0, 2026-11-12).
 * - There is NO `settings.aspect_ratio` on this route — the input image sets
 *   the frame.
 * - Images: .jpg/.jpeg/.png, ≤50MB, ≥300px per side, aspect ratio within
 *   1:2.5–2.5:1. Up to 3 Elements per task.
 * - Async: responds with a task object. Auth is `Authorization: Bearer <key>`.
 */

import { z } from "zod";
import { createValidator, type PipelineContext } from "../../core/pipeline";
import { toValidated, type ExactKeys, type Validated } from "../../core/request";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";
import type { ModelInfo } from "../../core/catalog-types";
import type { EndpointConstraints } from "../../core/constraint-types";
import { pathVideoModels, type KlingPathVideoModelId } from "./models";
import {
  DOCS_BASE,
  DURATIONS_3_15,
  DURATIONS_3_20,
  DURATIONS_3_30,
  DURATIONS_5_10,
  KLING_4_PROMPT_BUDGET,
  KLING_BASE_URL,
  KLING_HEADERS,
  checkContents,
  checkPrompt,
  checkSettings,
  contentSchema,
  optionsSchema,
  type KlingAudio,
  type KlingContent,
  type KlingDuration,
  type KlingOptions,
  type KlingResolution,
  type RouteRules,
} from "./shared";
import { videoCostUSD } from "./pricing";

const SOURCE = `${DOCS_BASE}/api/video/3-0-omni/image-to-video`;

/** EXPERIMENTAL. `POST /image-to-video/{model}` for a given model. */
export function imageToVideoV3Url(model: string, baseUrl: string = KLING_BASE_URL): string {
  return `${baseUrl}/image-to-video/${encodeURIComponent(model)}`;
}

/** EXPERIMENTAL. Models with a path-addressed image-to-video route. */
export const IMAGE_TO_VIDEO_V3_RULES: RouteRules = {
  "kling-3.0": {
    resolutions: ["720p", "1080p", "4k"],
    durations: DURATIONS_3_15,
    audio: ["native", "off"],
    multiShot: true,
    contentTypes: ["prompt", "first_frame", "last_frame", "element"],
    requireFirstFrame: true,
  },
  "kling-3.0-turbo": {
    resolutions: ["720p", "1080p"],
    durations: DURATIONS_3_15,
    contentTypes: ["prompt", "first_frame"],
    requireFirstFrame: true,
  },
  "kling-2.6": {
    resolutions: ["720p", "1080p"],
    durations: DURATIONS_5_10,
    audio: ["native", "off"],
    contentTypes: ["prompt", "first_frame", "last_frame", "voice"],
    requireFirstFrame: true,
  },
  "kling-2.5-turbo": {
    resolutions: ["720p", "1080p"],
    durations: DURATIONS_5_10,
    contentTypes: ["prompt", "first_frame", "last_frame"],
    requireFirstFrame: true,
  },
  // https://kling.ai/document-api/api/video/4-0/image-to-video (2026-11-12):
  // "Input type. Supports: prompt, first frame, middle frame and last frame";
  // `a({resolutions:["720p","1080p"],defaultResolution:"1080p",maxDuration:30`.
  // No `first_frame` requirement — the usage guide lists "first frame, last
  // frame, first-and-last frames, or intermediate frames".
  "kling-4.0": {
    resolutions: ["720p", "1080p"],
    durations: DURATIONS_3_30,
    contentTypes: ["prompt", "first_frame", "middle_frame", "last_frame"],
    prompt: KLING_4_PROMPT_BUDGET,
  },
  // https://kling.ai/document-api/api/video/4-0-flash/image-to-video
  // (2026-11-12): "Input type. Supports: prompt, first frame" — "Only
  // first-frame-to-video generation is supported." —
  // `a({resolutions:["720p"],defaultResolution:"720p",maxDuration:20`.
  "kling-4.0-flash": {
    resolutions: ["720p"],
    durations: DURATIONS_3_20,
    contentTypes: ["prompt", "first_frame"],
    requireFirstFrame: true,
    prompt: KLING_4_PROMPT_BUDGET,
  },
};

export interface ImageToVideoV3Settings {
  /** Kling 3.0 only. Defaults to true. */
  multi_shot?: boolean;
  /**
   * "native" or "off" on this route ("original" is omni-video only). Defaults
   * to "off"; Kling 3.0 / 2.6 only — IMAGE_TO_VIDEO_V3_RULES narrows per model.
   */
  audio?: KlingAudio;
  /**
   * Defaults to "720p" ("1080p" on Kling 4.0). "4k" is Kling 3.0 only —
   * narrowed per model at runtime.
   */
  resolution?: KlingResolution;
  /**
   * Seconds. Defaults to 5 — on Kling 4.0 / 4.0 Flash to a duration the
   * prompt states, else 10. 2.6 / 2.5-turbo take only 5 or 10 (checked at
   * runtime).
   */
  duration?: KlingDuration;
}

export interface ImageToVideoV3Params {
  /** URL path segment — stripped from the wire body into `.request.url`. */
  model: KlingPathVideoModelId | (string & {});
  /** Required. Must include a `first_frame` entry on every model but Kling 4.0. */
  contents: KlingContent[];
  settings?: ImageToVideoV3Settings;
  options?: KlingOptions;
}

const videoV3FromImageSchema = z.looseObject({
  model: z.string().min(1),
  contents: z.array(contentSchema).min(1),
  settings: z
    .looseObject({
      multi_shot: z.boolean().optional(),
      audio: z.string().optional(),
      resolution: z.string().optional(),
      aspect_ratio: z.string().optional(),
      duration: z.number().int().optional(),
    })
    .optional(),
  options: optionsSchema.optional(),
});

function estimate(
  params: ImageToVideoV3Params,
  info: ModelInfo | undefined,
  _ctx: PipelineContext,
) {
  if (info === undefined) return {};
  const settings = params.settings ?? {};
  const costUSD = videoCostUSD({
    model: params.model,
    ...(settings.resolution !== undefined && { resolution: settings.resolution }),
    ...(settings.duration !== undefined && { duration: settings.duration }),
    ...(settings.audio !== undefined && { audio: settings.audio !== "off" }),
  });
  return costUSD === undefined ? {} : { costUSD };
}

/**
 * The one `.toSdk("kling")` target for this endpoint — Kling ships no
 * official JS SDK, so this is the wire body. Derived from the `sdk` literal
 * in `finalize`; it must stay an object type with no index signature, or
 * `toSdk` would accept any string.
 */
type KlingSdkTargets<B> = { kling: () => B };

function finalize(params: ImageToVideoV3Params): unknown {
  const { model, ...body } = params;
  return toValidated(body, {
    url: imageToVideoV3Url(model),
    method: "POST",
    headers: KLING_HEADERS,
  }, {
    sdk: { kling: () => body },
  });
}

const validator = createValidator<ImageToVideoV3Params, unknown>({
  endpoint: "kling.videoV3FromImage",
  schema: videoV3FromImageSchema,
  modelId: (params) => params.model,
  catalog: pathVideoModels,
  checks: [
    checkSettings("image-to-video", IMAGE_TO_VIDEO_V3_RULES, SOURCE),
    checkContents("image-to-video", IMAGE_TO_VIDEO_V3_RULES, SOURCE),
    checkPrompt("image-to-video", IMAGE_TO_VIDEO_V3_RULES, SOURCE),
  ],
  estimate,
  finalize,
});

/**
 * Validates raw wire params for Kling `POST /image-to-video/{model}`.
 *
 * EXPERIMENTAL — see the module header. `kling.videoFromImage` is the
 * `model_name`-in-the-body image-to-video validator.
 *
 * ```ts
 * const params = kling.videoV3FromImage({
 *   model: "kling-2.6",
 *   contents: [
 *     { type: "prompt", text: "she turns to the window as the train moves" },
 *     { type: "first_frame", url: "https://example.com/frame.png" },
 *   ],
 *   settings: { resolution: "1080p", duration: 10 },
 * });
 * ```
 */
export const videoV3FromImage = validator as unknown as {
  <T extends ImageToVideoV3Params>(
    params: T & ExactKeys<T, ImageToVideoV3Params>,
    options?: ValidateOptions<T>,
  ): Validated<Omit<T, "model">, KlingSdkTargets<Omit<T, "model">>>;
  safe<T extends ImageToVideoV3Params>(
    params: T & ExactKeys<T, ImageToVideoV3Params>,
    options?: ValidateOptions<T>,
  ): ValidateResult<Validated<Omit<T, "model">, KlingSdkTargets<Omit<T, "model">>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
