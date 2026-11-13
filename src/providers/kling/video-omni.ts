/**
 * Kling Omni Video (path-addressed family) —
 * POST https://api-singapore.klingai.com/omni-video/{model}
 *
 * Exported as `kling.videoOmni`, a sibling of `kling.videoV3` /
 * `kling.videoV3FromImage`, and unmodel's whole omni-video coverage. The
 * `POST /v1/videos/*` family has an omni route too —
 * `POST /v1/videos/omni-video`, `model_name` `enum:["kling-video-o1",
 * "kling-v3-omni"]`
 * (https://kling.ai/document-api/api/video/3-0-omni/video-omni/legacy,
 * 2026-11-12) — which is documented but not validated here.
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
 *
 * Wire notes (transcribed from those bundle definitions, cross-read against
 * https://kling.ai/document-api/api/video/3-0-omni/video-omni and
 * /api/video/o1/video-omni on 2026-08-13):
 * - The omni route is the multimodal one: `contents` accepts text, first/last
 *   frames, reference images, a base video to edit and a feature video to
 *   drive it, plus Elements — `{ prompt, first_frame, last_frame,
 *   refer_image, feature_video, base_video, element }`.
 * - The model is a URL PATH segment: `kling-3.0-omni`, `kling-o1`,
 *   `kling-4.0` or `kling-4.0-flash`. 3.0 Omni adds a 4K tier, `multi_shot`,
 *   and a "native" audio mode; O1 tops out at 1080p, 10 seconds, and
 *   `audio: "original" | "off"`.
 * - Kling 4.0 / 4.0 Flash (https://kling.ai/document-api/api/video/4-0/video-omni
 *   and /4-0-flash/video-omni, read 2026-11-12) run 3–30s / 3–20s, take
 *   `21:9` and `adaptive` shapes, `audio: "native" | "original"` with no
 *   "off", and up to 7 Elements. 4.0 takes `middle_frame` keyframes and
 *   `voice` entries (`{ type: "voice", voice_id, id }`); Flash takes neither,
 *   nor `last_frame`.
 * - A request that carries a VIDEO input (`base_video` / `feature_video`) is
 *   billed at the "With Video Input" tier, which the cost estimate accounts
 *   for. On Kling 4.0 / 4.0 Flash that tier bills a TOTAL duration (output × 2,
 *   or input + output when the input is longer) and a video-character Element
 *   counts as video input too — neither input length nor Element kind is in
 *   the request, so those estimates are a floor (see ./pricing.ts).
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
  DURATIONS_3_20,
  DURATIONS_3_30,
  KLING_4_MAX_ELEMENTS,
  KLING_4_OMNI_ASPECT_RATIOS,
  KLING_4_PROMPT_BUDGET,
  KLING_ASPECT_RATIOS,
  KLING_BASE_URL,
  KLING_HEADERS,
  OMNI_MAX_ELEMENTS,
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
  type KlingSettingsAspectRatio,
  type RouteRules,
} from "./shared";
import { videoCostUSD } from "./pricing";

const SOURCE = `${DOCS_BASE}/api/video/3-0-omni/video-omni`;

/** EXPERIMENTAL. `POST /omni-video/{model}` for a given model. */
export function omniVideoUrl(model: string, baseUrl: string = KLING_BASE_URL): string {
  return `${baseUrl}/omni-video/${encodeURIComponent(model)}`;
}

/** The models with an omni-video route. */
export const OMNI_VIDEO_MODELS = [
  "kling-3.0-omni",
  "kling-o1",
  "kling-4.0",
  "kling-4.0-flash",
] as const;
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
    maxElements: OMNI_MAX_ELEMENTS,
  },
  "kling-o1": {
    resolutions: ["720p", "1080p"],
    aspectRatios: KLING_ASPECT_RATIOS,
    durations: DURATIONS_3_10,
    audio: ["original", "off"],
    contentTypes: OMNI_CONTENT_TYPES,
    maxElements: OMNI_MAX_ELEMENTS,
  },
  // https://kling.ai/document-api/api/video/4-0/video-omni (2026-11-12):
  // `i({resolutions:["720p","1080p"],defaultResolution:"1080p",maxDuration:30,
  // includeOmniAudio:!0,aspectRatio:{enum:["21:9","16:9","9:16","1:1","adaptive"]`;
  // audio `enum:["native","original"]`; "Input type. Supports: prompt, images,
  // videos, Element and voice".
  "kling-4.0": {
    resolutions: ["720p", "1080p"],
    aspectRatios: KLING_4_OMNI_ASPECT_RATIOS,
    durations: DURATIONS_3_30,
    audio: ["native", "original"],
    contentTypes: [
      "prompt",
      "first_frame",
      "middle_frame",
      "last_frame",
      "refer_image",
      "feature_video",
      "base_video",
      "element",
      "voice",
    ],
    maxElements: KLING_4_MAX_ELEMENTS,
    prompt: KLING_4_PROMPT_BUDGET,
  },
  // https://kling.ai/document-api/api/video/4-0-flash/video-omni (2026-11-12):
  // `i({resolutions:["720p"],defaultResolution:"720p",maxDuration:20,
  // includeOmniAudio:!0,aspectRatio:{enum:["21:9","16:9","9:16","1:1","adaptive"]`;
  // "Input type. Supports: prompt, reference images, reference videos, Element"
  // with images `r(["first_frame","refer_image"]`.
  "kling-4.0-flash": {
    resolutions: ["720p"],
    aspectRatios: KLING_4_OMNI_ASPECT_RATIOS,
    durations: DURATIONS_3_20,
    audio: ["native", "original"],
    contentTypes: ["prompt", "first_frame", "refer_image", "feature_video", "base_video", "element"],
    maxElements: KLING_4_MAX_ELEMENTS,
    prompt: KLING_4_PROMPT_BUDGET,
  },
};

/** `contents[].type` values that make a request "With Video Input" for billing. */
export const VIDEO_INPUT_TYPES = ["feature_video", "base_video"] as const;

export interface OmniVideoSettings {
  /** Kling 3.0 Omni only. Defaults to true. */
  multi_shot?: boolean;
  /**
   * "native" | "original" | "off" (3.0 Omni), "original" | "off" (O1) or
   * "native" | "original" (4.0 / 4.0 Flash, default "native") —
   * OMNI_VIDEO_RULES narrows the union per model at runtime.
   */
  audio?: KlingAudio;
  /**
   * Defaults to "720p" ("1080p" on Kling 4.0). "4k" is 3.0 Omni only —
   * narrowed per model at runtime.
   */
  resolution?: KlingResolution;
  /**
   * Defaults to "16:9" ("adaptive" on Kling 4.0 / 4.0 Flash, the only models
   * with "21:9" and "adaptive" — checked at runtime).
   */
  aspect_ratio?: KlingSettingsAspectRatio;
  /**
   * Seconds. Defaults to 5 — on Kling 4.0 / 4.0 Flash to a duration the
   * prompt states, else `base_video`'s rounded length, else 10. kling-o1 tops
   * out at 10 (checked at runtime).
   */
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
    checkPrompt("omni-video", OMNI_VIDEO_RULES, SOURCE),
  ],
  estimate,
  finalize,
});

/**
 * Validates raw wire params for Kling `POST /omni-video/{model}`.
 *
 * EXPERIMENTAL — see the module header. The returned
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
    options?: ValidateOptions<T>,
  ): Validated<Omit<T, "model">, KlingSdkTargets<Omit<T, "model">>>;
  safe<T extends OmniVideoParams>(
    params: T & ExactKeys<T, OmniVideoParams>,
    options?: ValidateOptions<T>,
  ): ValidateResult<Validated<Omit<T, "model">, KlingSdkTargets<Omit<T, "model">>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
