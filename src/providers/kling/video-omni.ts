/**
 * Kling Omni Video (path-addressed family) —
 * POST https://api-singapore.klingai.com/omni-video/{model}
 *
 * Exported as `kling.videoOmni`, a sibling of `kling.videoV3` /
 * `kling.videoV3FromImage`. It has no corroborated counterpart: the
 * `POST /v1/videos/*` family documents no omni route, so there is nothing to
 * fall back to — this endpoint is the whole of unmodel's omni-video coverage
 * and it rests entirely on the evidence below.
 *
 * EXPERIMENTAL — UNCORROBORATED ROUTE. `POST /omni-video/{model}` was recovered by
 * EVALUATING THE DOC SITE'S OWN JAVASCRIPT BUNDLE (the SPA's navigation/asset
 * chunks under s15-kling.klingai.com/kos/s101/nlav112918/api-doc/assets/), not
 * read off a served documentation page, and nothing independent corroborates
 * it: kling.ai/document-api and app.klingai.com answer HTTP 446 to every
 * non-browser client, and curl with a browser UA returns one byte-identical
 * SPA shell for every path, so no fetch can confirm or refute the route.
 * Searching Kling's own apiReference pages for the same models returns the
 * versioned `POST /v1/videos/*` family instead. Prefer the corroborated
 * `kling.video` (./video.ts) unless you have verified this
 * route against a live account. This export exists so the bundle-derived
 * shape is not lost; it may 404, and the polling route (`GET /tasks`) is
 * unverified too.
 *
 * Wire notes (transcribed from those bundle definitions, cross-read against
 * https://kling.ai/document-api/api/video/3-0-omni/video-omni and
 * /api/video/o1/video-omni on 2026-08-13):
 * - The omni route is the multimodal one: `contents` accepts text, first/last
 *   frames, reference images, a base video to edit and a feature video to
 *   drive it, plus Elements — `{ prompt, first_frame, last_frame,
 *   refer_image, feature_video, base_video, element }`.
 * - The model is a URL PATH segment: `kling-3.0-omni` or `kling-o1`.
 *   3.0 Omni adds a 4K tier, `multi_shot`, and a "native" audio mode; O1 tops
 *   out at 1080p, 10 seconds, and `audio: "original" | "off"`.
 * - A request that carries a VIDEO input (`base_video` / `feature_video`) is
 *   billed at the higher "With Video Input" tier, which the cost estimate
 *   accounts for.
 * - Async: responds with a task object. Auth is `Authorization: Bearer <key>`.
 */

import { z } from "zod";
import { createValidator, type PipelineContext } from "../../core/pipeline";
import { toValidated, type ExactKeys, type Validated } from "../../core/request";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";
import type { ModelInfo } from "../../core/catalog-types";
import type { EndpointConstraints } from "../../core/constraint-types";
import { pathVideoModels } from "./models";
import {
  DOCS_BASE,
  DURATIONS_3_10,
  DURATIONS_3_15,
  KLING_ASPECT_RATIOS,
  KLING_BASE_URL,
  KLING_HEADERS,
  checkContents,
  checkSettings,
  contentSchema,
  optionsSchema,
  type KlingAspectRatio,
  type KlingAudio,
  type KlingContent,
  type KlingDuration,
  type KlingOptions,
  type KlingResolution,
  type RouteRules,
} from "./shared";
import { videoCostUSD } from "./pricing";

const SOURCE = `${DOCS_BASE}/api/video/3-0-omni/video-omni`;

/** EXPERIMENTAL. `POST /omni-video/{model}` for a given model. */
export function omniVideoUrl(model: string, baseUrl: string = KLING_BASE_URL): string {
  return `${baseUrl}/omni-video/${encodeURIComponent(model)}`;
}

/** The two models with an omni-video route. */
export const OMNI_VIDEO_MODELS = ["kling-3.0-omni", "kling-o1"] as const;
export type KlingOmniVideoModelId = (typeof OMNI_VIDEO_MODELS)[number];

const OMNI_CONTENT_TYPES = [
  "prompt",
  "first_frame",
  "last_frame",
  "refer_image",
  "feature_video",
  "base_video",
  "element",
] as const;

export const OMNI_VIDEO_RULES: RouteRules = {
  "kling-3.0-omni": {
    resolutions: ["720p", "1080p", "4k"],
    aspectRatios: KLING_ASPECT_RATIOS,
    durations: DURATIONS_3_15,
    audio: ["native", "original", "off"],
    multiShot: true,
    contentTypes: OMNI_CONTENT_TYPES,
  },
  "kling-o1": {
    resolutions: ["720p", "1080p"],
    aspectRatios: KLING_ASPECT_RATIOS,
    durations: DURATIONS_3_10,
    audio: ["original", "off"],
    contentTypes: OMNI_CONTENT_TYPES,
  },
};

/** `contents[].type` values that make a request "With Video Input" for billing. */
export const VIDEO_INPUT_TYPES = ["feature_video", "base_video"] as const;

export interface OmniVideoSettings {
  /** Kling 3.0 Omni only. Defaults to true. */
  multi_shot?: boolean;
  /**
   * "native" | "original" | "off" (3.0 Omni) or "original" | "off" (O1) —
   * OMNI_VIDEO_RULES narrows the union per model at runtime.
   */
  audio?: KlingAudio;
  /** Defaults to "720p". "4k" is 3.0 Omni only — narrowed per model at runtime. */
  resolution?: KlingResolution;
  /** Defaults to "16:9". */
  aspect_ratio?: KlingAspectRatio;
  /** Seconds. Defaults to 5. kling-o1 tops out at 10 (checked at runtime). */
  duration?: KlingDuration;
}

export interface OmniVideoParams {
  /** URL path segment — stripped from the wire body into `.request.url`. */
  model: KlingOmniVideoModelId | (string & {});
  /** Required: the multimodal input collection. */
  contents: KlingContent[];
  settings?: OmniVideoSettings;
  options?: KlingOptions;
}

const videoOmniSchema = z.looseObject({
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

function hasVideoInput(contents: readonly KlingContent[] | undefined): boolean {
  if (!Array.isArray(contents)) return false;
  return contents.some(
    (item) =>
      typeof item === "object" &&
      item !== null &&
      (VIDEO_INPUT_TYPES as readonly string[]).includes(String(item.type)),
  );
}

function estimate(params: OmniVideoParams, info: ModelInfo | undefined, _ctx: PipelineContext) {
  if (info === undefined) return {};
  const settings = params.settings ?? {};
  const costUSD = videoCostUSD({
    model: params.model,
    ...(settings.resolution !== undefined && { resolution: settings.resolution }),
    ...(settings.duration !== undefined && { duration: settings.duration }),
    ...(settings.audio !== undefined && { audio: settings.audio !== "off" }),
    videoInput: hasVideoInput(params.contents),
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

function finalize(params: OmniVideoParams): unknown {
  const { model, ...body } = params;
  return toValidated(body, {
    url: omniVideoUrl(model),
    method: "POST",
    headers: KLING_HEADERS,
  }, {
    sdk: { kling: () => body },
  });
}

const validator = createValidator<OmniVideoParams, unknown>({
  endpoint: "kling.videoOmni",
  schema: videoOmniSchema,
  modelId: (params) => params.model,
  catalog: pathVideoModels,
  checks: [
    checkSettings("omni-video", OMNI_VIDEO_RULES, SOURCE),
    checkContents("omni-video", OMNI_VIDEO_RULES, SOURCE),
  ],
  estimate,
  finalize,
});

/**
 * Validates raw wire params for Kling `POST /omni-video/{model}`.
 *
 * EXPERIMENTAL and uncorroborated — see the module header. The returned
 * object's enumerable props are the exact fetch JSON body: `model` is
 * STRIPPED into `.request.url`.
 *
 * ```ts
 * const params = kling.videoOmni({
 *   model: "kling-3.0-omni",
 *   contents: [
 *     { type: "prompt", text: "restyle the clip as a rainy night scene" },
 *     { type: "base_video", url: "https://example.com/clip.mp4" },
 *   ],
 *   settings: { resolution: "1080p", duration: 8 },
 * });
 * ```
 */
export const videoOmni = validator as unknown as {
  <T extends OmniVideoParams>(
    params: T & ExactKeys<T, OmniVideoParams>,
    options?: ValidateOptions,
  ): Validated<Omit<T, "model">, KlingSdkTargets<Omit<T, "model">>>;
  safe<T extends OmniVideoParams>(
    params: T & ExactKeys<T, OmniVideoParams>,
    options?: ValidateOptions,
  ): ValidateResult<Validated<Omit<T, "model">, KlingSdkTargets<Omit<T, "model">>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
