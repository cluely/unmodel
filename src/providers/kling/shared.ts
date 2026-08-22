/**
 * Shared wire pieces for the Kling AI API, transcribed from the endpoint
 * definitions behind https://kling.ai/document-api (the API-reference pages
 * render from Kling's own OpenAPI data) — verified 2026-08-13.
 *
 * TWO ROUTE FAMILIES. The corroborated one is `POST /v1/videos/text2video` /
 * `/v1/videos/image2video` with `model_name` in the BODY (`kling.video`
 * / `kling.videoFromImage`); the path-addressed one (`POST /text-to-video/
 * {model}`, `/omni-video/{model}`) was recovered from the doc site's JS bundle
 * and is corroborated by nothing, so it ships EXPERIMENTAL as
 * `kling.videoV3` / `kling.videoV3FromImage` / `kling.videoOmni`. The
 * constants below marked "current routes" belong to that experimental family;
 * ./models.ts records the full provenance of both.
 *
 * Base URL: "The API endpoint has been changed from https://api.klingai.com to
 * https://api-singapore.klingai.com" (docs/api/get-started/authentication);
 * the mainland endpoint is https://api-beijing.klingai.com, which the docs use
 * in their zh examples.
 *
 * Auth is `Authorization: Bearer <API key>` — the key may be a raw API key or
 * a JWT you sign from your access/secret pair. unmodel never touches
 * credentials; add the header yourself when fetching.
 *
 * Every generation route is asynchronous: it responds with a task object and
 * you poll `GET /v1/videos/{route}/{task_id}` (the corroborated family) or
 * `GET /tasks` (the experimental path-addressed family — unverified, like the
 * routes it serves), or set `options.callback_url`.
 */

import { z } from "zod";
import type { PipelineContext } from "../../core/pipeline";
import type { ModelInfo } from "../../core/catalog-types";
import { JSON_HEADERS } from "../../core/request";

/** Default (international) base URL. */
export const KLING_BASE_URL = "https://api-singapore.klingai.com";

/** Mainland-China base URL, used by the docs' zh examples. */
export const KLING_CN_BASE_URL = "https://api-beijing.klingai.com";

export const KLING_HEADERS: Record<string, string> = JSON_HEADERS;

export const DOCS_BASE = "https://kling.ai/document-api";

/** `settings.aspect_ratio` — the same three values on every current route. */
export const KLING_ASPECT_RATIOS = ["16:9", "9:16", "1:1"] as const;
export type KlingAspectRatio = (typeof KLING_ASPECT_RATIOS)[number];

/** `settings.resolution` values across the current routes. */
export const KLING_RESOLUTIONS = ["720p", "1080p", "4k"] as const;
/**
 * `settings.resolution` — autocomplete over the union of every current route's
 * tiers; the per-route rule tables narrow it per model ("4k" is Kling 3.0 /
 * 3.0 Omni only).
 */
export type KlingResolution = (typeof KLING_RESOLUTIONS)[number];

/**
 * `settings.audio` modes across the current routes: "native" (generate audio),
 * "original" (keep the input video's audio, omni-video only) and "off".
 */
export const KLING_AUDIO_MODES = ["native", "original", "off"] as const;
/**
 * `settings.audio` — autocomplete over every documented mode; each route's
 * rule table narrows it per model (text-to-video and image-to-video offer
 * "native" / "off", omni-video adds "original", and O1 has no "native").
 */
export type KlingAudio = (typeof KLING_AUDIO_MODES)[number];

/** `mode` values on `/v1/videos/*`: std = 720P, pro = 1080P, 4k = 4K. */
export const KLING_MODES = ["std", "pro", "4k"] as const;
export type KlingMode = (typeof KLING_MODES)[number];

/** `sound` switch on `/v1/videos/*`. */
export const KLING_SOUND = ["on", "off"] as const;

/** Documented `prompt` ceiling on the current routes (recommended ≤ 2500). */
export const PROMPT_MAX_CHARS = 3072;
/** Documented `prompt` / `negative_prompt` ceiling on `/v1/videos/*`. */
export const V1_PROMPT_MAX_CHARS = 2500;
/** Documented per-shot prompt ceiling in `multi_prompt` / multi-shot prompts. */
export const SHOT_PROMPT_MAX_CHARS = 512;
/** Documented maximum number of shots in a multi-shot generation. */
export const MAX_SHOTS = 6;

// ---------------------------------------------------------------------------
// `options` — identical on every current route.
// ---------------------------------------------------------------------------

export interface KlingWatermarkInfo {
  /** Also produce a watermarked result. Defaults to false. */
  enabled?: boolean;
}

export interface KlingOptions {
  /** POSTed the task object whenever the task's status changes. */
  callback_url?: string;
  /** Your own task id; unique per account, does not replace the system id. */
  external_task_id?: string;
  watermark_info?: KlingWatermarkInfo;
}

export const optionsSchema = z.looseObject({
  callback_url: z.string().optional(),
  external_task_id: z.string().optional(),
  watermark_info: z.looseObject({ enabled: z.boolean().optional() }).optional(),
});

// ---------------------------------------------------------------------------
// `contents` — the input collection on image-to-video and omni-video.
// ---------------------------------------------------------------------------

/** Every documented `contents[].type` across the current routes. */
export const KLING_CONTENT_TYPES = [
  "prompt",
  "first_frame",
  "last_frame",
  "refer_image",
  "feature_video",
  "base_video",
  "element",
  "voice",
] as const;

export type KlingContentType = (typeof KLING_CONTENT_TYPES)[number];

/**
 * One input. `prompt` carries `text`; the frame/image/video types carry a
 * `url` (an HTTPS URL or base64); `element` carries `element_id` plus an `id`
 * you reference from the prompt. The schema stays loose because the per-type
 * field sets differ and Kling keeps adding types.
 */
export interface KlingContent {
  type: KlingContentType | (string & {});
  text?: string;
  url?: string;
  element_id?: string;
  id?: string;
}

export const contentSchema = z.looseObject({
  type: z.string(),
  text: z.string().optional(),
  url: z.string().optional(),
  element_id: z.string().optional(),
  id: z.string().optional(),
});

/** Image inputs: .jpg/.jpeg/.png, ≤50MB, ≥300px per side, ratio 1:2.5–2.5:1. */
export const IMAGE_MAX_BYTES = 50 * 1024 * 1024;
export const IMAGE_MIN_DIMENSION = 300;
export const IMAGE_FORMATS = ["jpg", "jpeg", "png"] as const;
/** Up to 3 Elements can be specified per task. */
export const MAX_ELEMENTS = 3;

// ---------------------------------------------------------------------------
// Per-model route rules for the current (path-addressed) routes.
// ---------------------------------------------------------------------------

export interface RouteModelRules {
  readonly resolutions: readonly string[];
  /** Omitted on routes with no `aspect_ratio` (image-to-video, where the image sets it). */
  readonly aspectRatios?: readonly string[];
  readonly durations: readonly number[];
  /** Allowed `settings.audio` values; omitted when the model has no audio switch. */
  readonly audio?: readonly string[];
  /** Whether `settings.multi_shot` exists for this model. */
  readonly multiShot?: boolean;
  /** Allowed `contents[].type` values; omitted on text-to-video. */
  readonly contentTypes?: readonly string[];
}

export type RouteRules = Readonly<Record<string, RouteModelRules>>;

/** 3–15 and 3–10, the two documented duration ranges on the current routes. */
export const DURATIONS_3_15 = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] as const;
export const DURATIONS_3_10 = [3, 4, 5, 6, 7, 8, 9, 10] as const;
export const DURATIONS_5_10 = [5, 10] as const;

/**
 * `settings.duration` in seconds — autocomplete over the widest documented
 * range (3–15s), of which `DURATIONS_3_10` and `DURATIONS_5_10` are subsets.
 * Each route's rule table narrows it per model at runtime (2.6 / 2.5-turbo
 * take only 5 or 10, kling-o1 tops out at 10).
 */
export type KlingDuration = (typeof DURATIONS_3_15)[number];

interface CurrentRouteParams {
  model: string;
  settings?: {
    multi_shot?: boolean;
    audio?: string;
    resolution?: string;
    aspect_ratio?: string;
    duration?: number;
  };
  contents?: readonly KlingContent[];
}

function reportEnum(
  ctx: PipelineContext,
  path: Array<string | number>,
  model: string,
  field: string,
  allowed: readonly (string | number)[],
  value: string | number,
  source: string,
): void {
  ctx.report({
    code: "invalid_enum_value",
    path,
    model,
    message: `\`${field}\` must be one of ${allowed.map((v) => JSON.stringify(v)).join(", ")} for "${model}"; got ${JSON.stringify(value)}.`,
    meta: { allowed: [...allowed], value, source },
  });
}

/**
 * Enforces a route's per-model `settings` rules: which resolutions, aspect
 * ratios and durations the model offers, and whether it has an audio or
 * multi-shot switch at all.
 */
export function checkSettings<P extends CurrentRouteParams>(
  route: string,
  table: RouteRules,
  source: string,
): (params: P, info: ModelInfo | undefined, ctx: PipelineContext) => void {
  const supported = Object.keys(table);
  return (params, info, ctx) => {
    if (info === undefined) return;
    const rules = table[params.model];
    if (rules === undefined) {
      ctx.report({
        code: "unsupported_capability",
        path: ["model"],
        model: params.model,
        message: `Model "${params.model}" has no ${route} route — that route accepts ${supported.join(", ")}.`,
        meta: { source, supported },
      });
      return;
    }
    const settings = params.settings;
    if (settings === undefined) return;

    if (settings.resolution != null && !rules.resolutions.includes(settings.resolution)) {
      reportEnum(
        ctx,
        ["settings", "resolution"],
        params.model,
        "settings.resolution",
        rules.resolutions,
        settings.resolution,
        source,
      );
    }
    if (settings.aspect_ratio != null) {
      if (rules.aspectRatios === undefined) {
        ctx.report({
          code: "unsupported_param",
          path: ["settings", "aspect_ratio"],
          model: params.model,
          message: `\`settings.aspect_ratio\` is not a field of the ${route} route — the input image sets the frame.`,
          meta: { source },
        });
      } else if (!rules.aspectRatios.includes(settings.aspect_ratio)) {
        reportEnum(
          ctx,
          ["settings", "aspect_ratio"],
          params.model,
          "settings.aspect_ratio",
          rules.aspectRatios,
          settings.aspect_ratio,
          source,
        );
      }
    }
    if (settings.duration != null && !rules.durations.includes(settings.duration)) {
      reportEnum(
        ctx,
        ["settings", "duration"],
        params.model,
        "settings.duration",
        rules.durations,
        settings.duration,
        source,
      );
    }
    if (settings.audio != null) {
      if (rules.audio === undefined) {
        ctx.report({
          code: "unsupported_param",
          path: ["settings", "audio"],
          model: params.model,
          message: `\`settings.audio\` is not supported by "${params.model}" on ${route}.`,
          meta: { source },
        });
      } else if (!rules.audio.includes(settings.audio)) {
        reportEnum(
          ctx,
          ["settings", "audio"],
          params.model,
          "settings.audio",
          rules.audio,
          settings.audio,
          source,
        );
      }
    }
    if (settings.multi_shot != null && rules.multiShot !== true) {
      ctx.report({
        code: "unsupported_param",
        path: ["settings", "multi_shot"],
        model: params.model,
        message: `\`settings.multi_shot\` is not supported by "${params.model}" on ${route}.`,
        meta: { source },
      });
    }
  };
}

/**
 * Enforces a route's `contents` rules: which entry types the model accepts,
 * that a first frame is present when the route needs one, and the Element cap.
 */
export function checkContents<P extends CurrentRouteParams>(
  route: string,
  table: RouteRules,
  source: string,
  options: { requireFirstFrame?: boolean } = {},
): (params: P, info: ModelInfo | undefined, ctx: PipelineContext) => void {
  return (params, info, ctx) => {
    if (info === undefined) return;
    const rules = table[params.model];
    if (rules?.contentTypes === undefined) return;
    const contents = params.contents;
    if (!Array.isArray(contents)) return;

    let elements = 0;
    let hasFirstFrame = false;
    let hasLastFrame = false;
    contents.forEach((item, index) => {
      if (typeof item !== "object" || item === null) return;
      const { type } = item;
      if (type === "element") elements += 1;
      if (type === "first_frame") hasFirstFrame = true;
      if (type === "last_frame") hasLastFrame = true;
      if (typeof type !== "string" || rules.contentTypes!.includes(type)) return;
      reportEnum(
        ctx,
        ["contents", index, "type"],
        params.model,
        "contents[].type",
        rules.contentTypes!,
        type,
        source,
      );
    });

    if (elements > MAX_ELEMENTS) {
      ctx.report({
        code: "invalid_shape",
        path: ["contents"],
        model: params.model,
        message: `Up to ${MAX_ELEMENTS} Elements can be specified per task; got ${elements}.`,
        meta: { max: MAX_ELEMENTS, count: elements, source },
      });
    }

    if (options.requireFirstFrame === true && !hasFirstFrame) {
      ctx.report({
        code: "invalid_shape",
        path: ["contents"],
        model: params.model,
        message: hasLastFrame
          ? "`first_frame` is required on the image-to-video route — last-frame-only generation is not supported."
          : "`contents` must include a `first_frame` entry on the image-to-video route.",
        meta: { source },
      });
    }
  };
}

/** `model_name` values this route accepts. */
export const TEXT2VIDEO_MODELS = [
  "kling-v1",
  "kling-v1-6",
  "kling-v2-master",
  "kling-v2-1-master",
  "kling-v2-5-turbo",
  "kling-v2-6",
  "kling-v3",
] as const;

/** Documented `aspect_ratio` values on the image routes. */
export const KLING_IMAGE_ASPECT_RATIOS = [
  "16:9",
  "9:16",
  "1:1",
  "4:3",
  "3:4",
  "3:2",
  "2:3",
  "21:9",
] as const;

/** Documented `resolution` values on this route. */
export const KLING_IMAGE_RESOLUTIONS = ["1k", "2k"] as const;

/** `image_reference` — what the reference image is being used for. */
export const KLING_IMAGE_REFERENCES = ["subject", "face"] as const;

/** `resolution` values on this route — it adds a 4K tier. */
export const OMNI_IMAGE_RESOLUTIONS = ["1k", "2k", "4k"] as const;

/** `result_type`: a single image or a consistent series. */
export const OMNI_RESULT_TYPES = ["single", "series"] as const;

/** `series_amount`: 2–9, or "auto". */
export const OMNI_SERIES_AMOUNTS = ["2", "3", "4", "5", "6", "7", "8", "9", "auto"] as const;
