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

/**
 * `aspect_ratio` on `/v1/videos/text2video`, and `settings.aspect_ratio` on
 * every path-addressed route before Kling 4.0 — the same three values.
 */
export const KLING_ASPECT_RATIOS = ["16:9", "9:16", "1:1"] as const;
export type KlingAspectRatio = (typeof KLING_ASPECT_RATIOS)[number];

/**
 * `settings.aspect_ratio` on Kling 4.0 / 4.0 Flash text-to-video: `21:9` joins
 * the three. https://kling.ai/document-api/api/video/4-0/text-to-video
 * (2026-11-12): `aspectRatio:{enum:["21:9","16:9","9:16","1:1"],default:"16:9"}`.
 */
export const KLING_4_ASPECT_RATIOS = ["21:9", "16:9", "9:16", "1:1"] as const;

/**
 * `settings.aspect_ratio` on Kling 4.0 / 4.0 Flash omni-video, which adds
 * `adaptive` (read the shape off the prompt or the inputs).
 * https://kling.ai/document-api/api/video/4-0/video-omni (2026-11-12):
 * `aspectRatio:{enum:["21:9","16:9","9:16","1:1","adaptive"],default:"adaptive"`.
 */
export const KLING_4_OMNI_ASPECT_RATIOS = ["21:9", "16:9", "9:16", "1:1", "adaptive"] as const;

/**
 * `settings.aspect_ratio` on the path-addressed routes — autocomplete over
 * every value any of them documents; each route's rule table narrows it per
 * model (`21:9` is Kling 4.0's, `adaptive` is 4.0's omni route's).
 */
export type KlingSettingsAspectRatio = (typeof KLING_4_OMNI_ASPECT_RATIOS)[number];

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

/**
 * Every documented `contents[].type` across the current routes. `middle_frame`
 * is Kling 4.0's: https://kling.ai/document-api/api/video/4-0/image-to-video
 * (2026-11-12) — "Supports video generation from multiple keyframes, including
 * first frame, middle frame and last frame, with up to 10 images per request."
 */
export const KLING_CONTENT_TYPES = [
  "prompt",
  "first_frame",
  "middle_frame",
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
 * `url` (an HTTPS URL or base64); `element` carries `element_id` and `voice`
 * carries `voice_id`, each plus an `id` you reference from the prompt. The
 * schema stays loose because the per-type field sets differ and Kling keeps
 * adding types.
 */
export interface KlingContent {
  type: KlingContentType | (string & {});
  text?: string;
  url?: string;
  element_id?: string;
  /**
   * The voice on a `voice` entry — returned by the Custom Voice API, or a
   * system preset. https://kling.ai/document-api/api/video/4-0/video-omni
   * (2026-11-12): `"voice_id": "string", // Voice ID, generated by the system,
   * is returned through custom voice API; required`.
   */
  voice_id?: string;
  id?: string;
}

export const contentSchema = z.looseObject({
  type: z.string(),
  text: z.string().optional(),
  url: z.string().optional(),
  element_id: z.string().optional(),
  voice_id: z.string().optional(),
  id: z.string().optional(),
});

/** Image inputs: .jpg/.jpeg/.png, ≤50MB, ≥300px per side, ratio 1:2.5–2.5:1. */
export const IMAGE_MAX_BYTES = 50 * 1024 * 1024;
export const IMAGE_MIN_DIMENSION = 300;
export const IMAGE_FORMATS = ["jpg", "jpeg", "png"] as const;
/** Up to 3 Elements can be specified per task — the cap a rule row inherits unless it states its own. */
export const MAX_ELEMENTS = 3;

/**
 * The Kling 4.0 / 4.0 Flash omni-video Element cap.
 * https://kling.ai/document-api/api/video/4-0/video-omni (2026-11-12): "Up to
 * 7 Elements are supported, including no more than 3 video character
 * Elements." Which Elements are video-character ones is not visible in a
 * request (an `element_id` is opaque), so only the total is checked.
 */
export const KLING_4_MAX_ELEMENTS = 7;

// ---------------------------------------------------------------------------
// `prompt` length budgets.
// ---------------------------------------------------------------------------

/**
 * A `prompt` length budget. Kling 4.0 states its cap per script — "Mixed input
 * must satisfy E / 26000 + N / 11000 <= 1, where E is the number of English
 * characters and N is the number of non-English characters" — and a plain
 * character cap is the same budget with both sides equal.
 */
export interface PromptBudget {
  /** Characters allowed when every character is English. */
  readonly english: number;
  /** Characters allowed when no character is English. */
  readonly nonEnglish: number;
}

/** {@link PROMPT_MAX_CHARS} as a budget — the cap on the pre-4.0 text-to-video rows. */
export const PROMPT_BUDGET_3072: PromptBudget = {
  english: PROMPT_MAX_CHARS,
  nonEnglish: PROMPT_MAX_CHARS,
};

/**
 * Kling 4.0 / 4.0 Flash, on all three routes.
 * https://kling.ai/document-api/api/video/4-0/text-to-video (2026-11-12):
 * "English-only input supports up to 26,000 characters, and non-English-only
 * input supports up to 11,000 characters. Mixed input must satisfy E / 26000 +
 * N / 11000 <= 1".
 */
export const KLING_4_PROMPT_BUDGET: PromptBudget = { english: 26_000, nonEnglish: 11_000 };

/**
 * Letters outside the Latin script: the characters that are non-English under
 * any reading of "English character", which the docs never define. Everything
 * else — Latin letters with or without diacritics, digits, whitespace,
 * punctuation, symbols — counts as English. That is the loosest classification
 * the sentence allows, so the budget cannot refuse a prompt the API would take
 * on a stricter reading.
 */
const NON_ENGLISH_LETTER = /[^\P{L}\p{Script=Latin}]/gu;

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
  /** Whether `contents` must carry a `first_frame` (image-to-video rows). */
  readonly requireFirstFrame?: boolean;
  /** The Element cap; {@link MAX_ELEMENTS} when omitted. */
  readonly maxElements?: number;
  /** The prompt's length budget; omitted where the route states none this table enforces. */
  readonly prompt?: PromptBudget;
}

export type RouteRules = Readonly<Record<string, RouteModelRules>>;

/** 3–15 and 3–10, the two documented duration ranges on the 3.x / 2.x / O1 routes. */
export const DURATIONS_3_15 = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] as const;
export const DURATIONS_3_10 = [3, 4, 5, 6, 7, 8, 9, 10] as const;
export const DURATIONS_5_10 = [5, 10] as const;

/**
 * Kling 4.0 Flash: "Supports video generation from 3 to 20 seconds at 720P
 * resolution." — https://kling.ai/document-api/updates/api (11/04/2026,
 * retrieved 2026-11-12); the routes' `maxDuration:20`.
 */
export const DURATIONS_3_20 = [
  3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
] as const;

/**
 * Kling 4.0: "duration accepts any integer between 3 and 30 seconds." —
 * https://kling.ai/document-api/api/usage-guide/kling-4-0 (2026-11-12); the
 * routes' `maxDuration:30`.
 */
export const DURATIONS_3_30 = [
  3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28,
  29, 30,
] as const;

/**
 * `settings.duration` in seconds — autocomplete over the widest documented
 * range (Kling 4.0's 3–30s), of which every other list here is a subset. Each
 * route's rule table narrows it per model at runtime (2.6 / 2.5-turbo take
 * only 5 or 10, kling-o1 tops out at 10, the 3.0 family at 15, 4.0 Flash at
 * 20).
 */
export type KlingDuration = (typeof DURATIONS_3_30)[number];

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
 * that a first frame is present when the model needs one, and its Element cap.
 */
export function checkContents<P extends CurrentRouteParams>(
  route: string,
  table: RouteRules,
  source: string,
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

    const maxElements = rules.maxElements ?? MAX_ELEMENTS;
    if (elements > maxElements) {
      ctx.report({
        code: "invalid_shape",
        path: ["contents"],
        model: params.model,
        message: `"${params.model}" takes up to ${maxElements} Elements per task on ${route}; got ${elements}.`,
        meta: { max: maxElements, count: elements, source },
      });
    }

    if (rules.requireFirstFrame === true && !hasFirstFrame) {
      ctx.report({
        code: "invalid_shape",
        path: ["contents"],
        model: params.model,
        message: hasLastFrame
          ? `\`first_frame\` is required by "${params.model}" on ${route} — last-frame-only generation is not supported.`
          : `\`contents\` must include a \`first_frame\` entry for "${params.model}" on ${route}.`,
        meta: { source },
      });
    }
  };
}

/**
 * Enforces a model's `prompt` budget — on the top-level `prompt` of
 * text-to-video and on every `{ type: "prompt" }` entry's `text` in
 * `contents`. Characters are counted as code points.
 */
export function checkPrompt<P extends CurrentRouteParams & { prompt?: string }>(
  route: string,
  table: RouteRules,
  source: string,
): (params: P, info: ModelInfo | undefined, ctx: PipelineContext) => void {
  return (params, info, ctx) => {
    if (info === undefined) return;
    const budget = table[params.model]?.prompt;
    if (budget === undefined) return;
    if (typeof params.prompt === "string") {
      reportOverBudget(ctx, ["prompt"], params.model, route, budget, params.prompt, source);
    }
    if (!Array.isArray(params.contents)) return;
    params.contents.forEach((item, index) => {
      if (typeof item !== "object" || item === null || item.type !== "prompt") return;
      if (typeof item.text !== "string") return;
      reportOverBudget(ctx, ["contents", index, "text"], params.model, route, budget, item.text, source);
    });
  };
}

function reportOverBudget(
  ctx: PipelineContext,
  path: Array<string | number>,
  model: string,
  route: string,
  budget: PromptBudget,
  text: string,
  source: string,
): void {
  const total = [...text].length;
  const nonEnglish = text.match(NON_ENGLISH_LETTER)?.length ?? 0;
  const english = total - nonEnglish;
  // E / english + N / nonEnglish <= 1, in integers so no rounding decides it.
  if (english * budget.nonEnglish + nonEnglish * budget.english <= budget.english * budget.nonEnglish) {
    return;
  }
  const message =
    budget.english === budget.nonEnglish
      ? `the prompt is ${total} characters; "${model}" takes up to ${budget.english} on ${route}.`
      : `the prompt is over "${model}"'s length budget on ${route}: up to ${budget.english} ` +
        `English-only or ${budget.nonEnglish} non-English-only characters, and mixed input must ` +
        `satisfy E / ${budget.english} + N / ${budget.nonEnglish} <= 1 — got E = ${english}, ` +
        `N = ${nonEnglish}.`;
  ctx.report({
    code: "invalid_shape",
    path,
    model,
    message,
    meta: { english, nonEnglish, budget: { ...budget }, source },
  });
}

/**
 * `model_name` values `POST /v1/videos/text2video` accepts.
 * https://kling.ai/document-api/api/video/3-0-omni/text-to-video/legacy
 * (2026-11-12): `{name:"model_name",type:"string",required:!0,...,
 * enum:["kling-v2-5-turbo","kling-v2-6","kling-v3"]}`.
 */
export const TEXT2VIDEO_MODELS = ["kling-v2-5-turbo", "kling-v2-6", "kling-v3"] as const;

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
