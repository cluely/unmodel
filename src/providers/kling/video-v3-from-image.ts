/**
 * Kling Image to Video (path-addressed family) —
 * POST https://api-singapore.klingai.com/image-to-video/{model}
 *
 * Exported as `kling.videoV3FromImage`. "V3" names the third-generation ROUTE
 * family — the unversioned `/image-to-video/{model}` paths that arrived with
 * Kling 3.0 — not a single model: the family also serves 2.6 and 2.5-turbo.
 *
 * EXPERIMENTAL — UNCORROBORATED ROUTE. `POST /image-to-video/{model}` was recovered by
 * EVALUATING THE DOC SITE'S OWN JAVASCRIPT BUNDLE (the SPA's navigation/asset
 * chunks under s15-kling.klingai.com/kos/s101/nlav112918/api-doc/assets/), not
 * read off a served documentation page, and nothing independent corroborates
 * it: kling.ai/document-api and app.klingai.com answer HTTP 446 to every
 * non-browser client, and curl with a browser UA returns one byte-identical
 * SPA shell for every path, so no fetch can confirm or refute the route.
 * Searching Kling's own apiReference pages for the same models returns the
 * versioned `POST /v1/videos/*` family instead. Prefer the corroborated
 * `kling.videoFromImage` (./video-from-image.ts) unless you have verified this
 * route against a live account. This export exists so the bundle-derived
 * shape is not lost; it may 404, and the polling route (`GET /tasks`) is
 * unverified too.
 *
 * Wire notes (transcribed from those bundle definitions, cross-read against
 * https://kling.ai/document-api/api/video/3-0-omni/image-to-video and the
 * sibling 3.0-turbo / 2.6 / 2.5-turbo slugs on 2026-08-13):
 * - The model is a URL PATH segment: `model` is stripped from the wire body
 *   and interpolated into `.request.url`.
 * - Inputs ride in one `contents` array of tagged entries —
 *   `{ type: "prompt", text }`, `{ type: "first_frame" | "last_frame", url }`,
 *   `{ type: "element", element_id, id }` and, on Kling 2.6, `voice`. Which
 *   types a model accepts is per model. `first_frame` is required:
 *   "last-frame-only video generation is not supported".
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
  DURATIONS_5_10,
  KLING_BASE_URL,
  KLING_HEADERS,
  checkContents,
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
  },
  "kling-3.0-turbo": {
    resolutions: ["720p", "1080p"],
    durations: DURATIONS_3_15,
    contentTypes: ["prompt", "first_frame"],
  },
  "kling-2.6": {
    resolutions: ["720p", "1080p"],
    durations: DURATIONS_5_10,
    audio: ["native", "off"],
    contentTypes: ["prompt", "first_frame", "last_frame", "voice"],
  },
  "kling-2.5-turbo": {
    resolutions: ["720p", "1080p"],
    durations: DURATIONS_5_10,
    contentTypes: ["prompt", "first_frame", "last_frame"],
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
  /** Defaults to "720p". "4k" is Kling 3.0 only — narrowed per model at runtime. */
  resolution?: KlingResolution;
  /** Seconds. Defaults to 5. 2.6 / 2.5-turbo take only 5 or 10 (checked at runtime). */
  duration?: KlingDuration;
}

export interface ImageToVideoV3Params {
  /** URL path segment — stripped from the wire body into `.request.url`. */
  model: KlingPathVideoModelId | (string & {});
  /** Required. Must include a `first_frame` entry. */
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
    checkContents("image-to-video", IMAGE_TO_VIDEO_V3_RULES, SOURCE, { requireFirstFrame: true }),
  ],
  estimate,
  finalize,
});

/**
 * Validates raw wire params for Kling `POST /image-to-video/{model}`.
 *
 * EXPERIMENTAL and uncorroborated — see the module header.
 * `kling.videoFromImage` is the corroborated image-to-video validator.
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
    options?: ValidateOptions,
  ): Validated<Omit<T, "model">, KlingSdkTargets<Omit<T, "model">>>;
  safe<T extends ImageToVideoV3Params>(
    params: T & ExactKeys<T, ImageToVideoV3Params>,
    options?: ValidateOptions,
  ): ValidateResult<Validated<Omit<T, "model">, KlingSdkTargets<Omit<T, "model">>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
