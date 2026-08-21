/**
 * Kling Text to Video (path-addressed family) —
 * POST https://api-singapore.klingai.com/text-to-video/{model}
 *
 * Exported as `kling.videoV3`. "V3" names the third-generation ROUTE
 * family — the unversioned `/text-to-video/{model}` paths that arrived with
 * Kling 3.0 — not a single model: the family also serves 2.6 and 2.5-turbo.
 *
 * EXPERIMENTAL — UNCORROBORATED ROUTE. `POST /text-to-video/{model}` was recovered by
 * EVALUATING THE DOC SITE'S OWN JAVASCRIPT BUNDLE (the SPA's navigation/asset
 * chunks under s15-kling.klingai.com/kos/s101/nlav112918/api-doc/assets/), not
 * read off a served documentation page, and nothing independent corroborates
 * it: kling.ai/document-api and app.klingai.com answer HTTP 446 to every
 * non-browser client, and curl with a browser UA returns one byte-identical
 * SPA shell for every path, so no fetch can confirm or refute the route.
 * Searching Kling's own apiReference pages for the same models returns the
 * versioned `POST /v1/videos/*` family instead. Prefer the corroborated
 * `kling.video` (./video.ts) unless you have verified this route against a
 * live account. This export exists so the bundle-derived shape is not lost;
 * it may 404, and the polling route (`GET /tasks`) is unverified too.
 *
 * Wire notes (transcribed from those bundle definitions, cross-read against
 * https://kling.ai/document-api/api/video/3-0-omni/text-to-video and the
 * sibling 3.0-turbo / 2.6 / 2.5-turbo slugs on 2026-08-13):
 * - The model is a URL PATH segment, not a body field: `model` rides in the
 *   params object for ergonomics but is STRIPPED from the wire body and
 *   interpolated into `.request.url`.
 * - `prompt` is the only required body field (≤3072 characters, recommended
 *   ≤2500). Everything else lives under `settings` (output configuration) and
 *   `options` (callback, external id, watermark).
 * - What `settings` offers is per model: only Kling 3.0 has `multi_shot` and
 *   a 4K tier, only 3.0 and 2.6 have `audio`, and 2.6 / 2.5-turbo are limited
 *   to 5s or 10s while the 3.0 family takes 3–15s.
 * - Async: responds with a task object; poll `GET /tasks` or set
 *   `options.callback_url`. Auth is `Authorization: Bearer <key>`.
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
  KLING_ASPECT_RATIOS,
  KLING_BASE_URL,
  KLING_HEADERS,
  PROMPT_MAX_CHARS,
  checkSettings,
  optionsSchema,
  type KlingAspectRatio,
  type KlingAudio,
  type KlingDuration,
  type KlingOptions,
  type KlingResolution,
  type RouteRules,
} from "./shared";
import { videoCostUSD } from "./pricing";

const SOURCE = `${DOCS_BASE}/api/video/3-0-omni/text-to-video`;

/** EXPERIMENTAL. `POST /text-to-video/{model}` for a given model. */
export function textToVideoV3Url(model: string, baseUrl: string = KLING_BASE_URL): string {
  return `${baseUrl}/text-to-video/${encodeURIComponent(model)}`;
}

/** Models with a text-to-video route, and what each model's `settings` offers. */
export const TEXT_TO_VIDEO_V3_RULES: RouteRules = {
  "kling-3.0": {
    resolutions: ["720p", "1080p", "4k"],
    aspectRatios: KLING_ASPECT_RATIOS,
    durations: DURATIONS_3_15,
    audio: ["native", "off"],
    multiShot: true,
  },
  "kling-3.0-turbo": {
    resolutions: ["720p", "1080p"],
    aspectRatios: KLING_ASPECT_RATIOS,
    durations: DURATIONS_3_15,
  },
  "kling-2.6": {
    resolutions: ["720p", "1080p"],
    aspectRatios: KLING_ASPECT_RATIOS,
    durations: DURATIONS_5_10,
    audio: ["native", "off"],
  },
  "kling-2.5-turbo": {
    resolutions: ["720p", "1080p"],
    aspectRatios: KLING_ASPECT_RATIOS,
    durations: DURATIONS_5_10,
  },
};

export interface TextToVideoV3Settings {
  /** Kling 3.0 only. Defaults to true. */
  multi_shot?: boolean;
  /**
   * "native" or "off" on this route ("original" is omni-video only). Defaults
   * to "off"; Kling 3.0 / 2.6 only — TEXT_TO_VIDEO_V3_RULES narrows per model.
   */
  audio?: KlingAudio;
  /** Defaults to "720p". "4k" is Kling 3.0 only — narrowed per model at runtime. */
  resolution?: KlingResolution;
  /** Defaults to "16:9". */
  aspect_ratio?: KlingAspectRatio;
  /** Seconds. Defaults to 5. 2.6 / 2.5-turbo take only 5 or 10 (checked at runtime). */
  duration?: KlingDuration;
}

export interface TextToVideoV3Params {
  /**
   * URL path segment — stripped from the wire body; `.request.url` becomes
   * `<base>/text-to-video/<model>`.
   */
  model: KlingPathVideoModelId | (string & {});
  /** Required. Up to 3072 characters; multi-shot syntax is "shot n, m, words;". */
  prompt: string;
  settings?: TextToVideoV3Settings;
  options?: KlingOptions;
}

const videoV3Schema = z.looseObject({
  model: z.string().min(1),
  prompt: z.string().min(1).max(PROMPT_MAX_CHARS),
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

function estimate(params: TextToVideoV3Params, info: ModelInfo | undefined, _ctx: PipelineContext) {
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

function finalize(params: TextToVideoV3Params): unknown {
  const { model, ...body } = params;
  return toValidated(body, {
    url: textToVideoV3Url(model),
    method: "POST",
    headers: KLING_HEADERS,
  }, {
    sdk: { kling: () => body },
  });
}

const validator = createValidator<TextToVideoV3Params, unknown>({
  endpoint: "kling.videoV3",
  schema: videoV3Schema,
  modelId: (params) => params.model,
  // Route-scoped catalog keyed by path segment; the corroborated
  // `model_name` spellings warn as unknown_model here (use the primary
  // `kling.video` for those).
  catalog: pathVideoModels,
  checks: [checkSettings("text-to-video", TEXT_TO_VIDEO_V3_RULES, SOURCE)],
  estimate,
  finalize,
});

/**
 * Validates raw wire params for Kling `POST /text-to-video/{model}`.
 *
 * EXPERIMENTAL and uncorroborated — see the module header. `kling.video`
 * is the corroborated text-to-video validator.
 *
 * The returned object's enumerable props are the exact fetch JSON body
 * (`model` is stripped into the URL). `.toSdk("kling")` returns that body — Kling's
 * SDKs are wire-shaped. Auth is your job: add
 * `authorization: Bearer <key>` when fetching.
 *
 * ```ts
 * const params = kling.videoV3({
 *   model: "kling-3.0",
 *   prompt: "A girl on a train, watching the fields go by",
 *   settings: { resolution: "1080p", aspect_ratio: "16:9", duration: 10, audio: "native" },
 * });
 * const res = await fetch(params.request.url, {
 *   method: params.request.method,
 *   headers: { ...params.request.headers, authorization: `Bearer ${key}` },
 *   body: JSON.stringify(params),
 * });
 * ```
 */
export const videoV3 = validator as unknown as {
  <T extends TextToVideoV3Params>(
    params: T & ExactKeys<T, TextToVideoV3Params>,
    options?: ValidateOptions<T>,
  ): Validated<Omit<T, "model">, KlingSdkTargets<Omit<T, "model">>>;
  safe<T extends TextToVideoV3Params>(
    params: T & ExactKeys<T, TextToVideoV3Params>,
    options?: ValidateOptions<T>,
  ): ValidateResult<Validated<Omit<T, "model">, KlingSdkTargets<Omit<T, "model">>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
