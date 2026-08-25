/**
 * Alibaba Cloud Model Studio (DashScope) video generation —
 * POST {base}/api/v1/services/aigc/video-generation/video-synthesis
 *
 * Wire notes (transcribed from the international API references on
 * 2026-08-24 — the wan3 / text-to-video / image-to-video-general /
 * happyhorse-* pages listed in ./models.ts):
 * - ASYNC ONLY: the `X-DashScope-Async: enable` header is mandatory (its
 *   absence returns "current user api does not support synchronous calls"),
 *   so it ships as a static header on `.request.headers`. The response is
 *   `{output: {task_id, task_status}}`; poll `GET {base}/api/v1/tasks/{task_id}`
 *   (videoTaskUrl) at ~15s intervals until `task_status` is "SUCCEEDED", then
 *   read `output.video_url`. Task ids and video URLs expire after 24 hours.
 * - BASE URL: the legacy international domain
 *   `https://dashscope-intl.aliyuncs.com` (still functional) is the default
 *   here; Alibaba's docs now recommend workspace-scoped hosts —
 *   `https://{WorkspaceId}.ap-southeast-1.maas.aliyuncs.com` (Singapore) and
 *   regional variants (`eu-central-1`, `us-east-1`/`dashscope-us.aliyuncs.com`,
 *   `ap-northeast-1`, `cn-hongkong`) — so both URL helpers take an optional
 *   base, and `core/request.ts`'s `reroute()` re-targets a validated request.
 *   Model, endpoint region and API key must match.
 * - ONE ROUTE, FOUR PROTOCOLS, and `model` picks one (VIDEO_MODEL_RULES):
 *   wan3.0 (a typed `media` array + `resolution`/`ratio`/`duration`/`audio`),
 *   wan2.7 t2v (`resolution` + `ratio`), wan2.7 i2v (a `media` array of
 *   first_frame/last_frame/driving_audio/first_clip), the legacy wan2.6-and-
 *   earlier protocol (`size` strings like "1920*1080"), and HappyHorse
 *   (`resolution` + `ratio`, `media` on the i2v/r2v/edit routes).
 * - PRICING: USD per second of output video, per resolution tier, from the
 *   Singapore tables of the model-pricing page (VIDEO_PRICE_PER_SECOND_USD).
 *   wan3.0-video publishes no international rate and produces no estimate;
 *   happyhorse-1.0-video-edit bills input+output duration the request does
 *   not carry, so it produces no estimate either.
 * - Auth is `Authorization: Bearer <DASHSCOPE_API_KEY>` — unmodel never
 *   touches keys; add the header yourself when fetching.
 */

import { z } from "zod";
import { createValidator, type PipelineContext } from "../../core/pipeline";
import { JSON_HEADERS, toValidated, type ExactKeys, type Validated } from "../../core/request";
import type { ValidateOptions } from "../../core/options";
import type { ValidateEstimate, ValidateResult } from "../../core/result";
import type { ModelInfo } from "../../core/catalog-types";
import type { EndpointConstraints } from "../../core/constraint-types";
import { videoModels, VIDEO_MODEL_IDS, type AlibabaVideoGenerationModelId } from "./models";

/**
 * Legacy international domain — the documented default before the
 * workspace-host migration, and still functional. Override per workspace via
 * the `baseUrl` argument of {@link videoSynthesisUrl} / {@link videoTaskUrl},
 * or `reroute()` from `unmodel` on a validated request.
 */
export const DEFAULT_BASE_URL = "https://dashscope-intl.aliyuncs.com";

/** Route path shared by every video model. */
export const VIDEO_SYNTHESIS_PATH = "/api/v1/services/aigc/video-generation/video-synthesis";

/** POST target on the default (legacy intl) base. */
export const VIDEO_SYNTHESIS_URL = `${DEFAULT_BASE_URL}${VIDEO_SYNTHESIS_PATH}`;

/** POST target for a caller-chosen base (workspace-scoped host, region, …). */
export function videoSynthesisUrl(baseUrl: string = DEFAULT_BASE_URL): string {
  return `${baseUrl.replace(/\/$/, "")}${VIDEO_SYNTHESIS_PATH}`;
}

/** Polling URL for a submitted task id (same base as the submit call). */
export function videoTaskUrl(taskId: string, baseUrl: string = DEFAULT_BASE_URL): string {
  return `${baseUrl.replace(/\/$/, "")}/api/v1/tasks/${encodeURIComponent(taskId)}`;
}

/** The mandatory async header + JSON content type. */
export const VIDEO_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  ...JSON_HEADERS,
  "x-dashscope-async": "enable",
});

const T2V_DOCS = "https://www.alibabacloud.com/help/en/model-studio/text-to-video-api-reference";
const I2V_DOCS =
  "https://www.alibabacloud.com/help/en/model-studio/image-to-video-general-api-reference";
const WAN3_DOCS =
  "https://www.alibabacloud.com/help/en/model-studio/wan3-video-generation-api-reference";
const HH_T2V_DOCS =
  "https://www.alibabacloud.com/help/en/model-studio/happyhorse-text-to-video-api-reference";
const HH_I2V_DOCS =
  "https://www.alibabacloud.com/help/en/model-studio/happyhorse-image-to-video-api-reference";
const HH_R2V_DOCS =
  "https://www.alibabacloud.com/help/en/model-studio/happyhorse-reference-to-video-api-reference";
const HH_EDIT_DOCS =
  "https://www.alibabacloud.com/help/en/model-studio/happyhorse-video-edit-api-reference";
const PRICING_DOCS = "https://www.alibabacloud.com/help/en/model-studio/model-pricing";

// ---------------------------------------------------------------------------
// Documented enums
// ---------------------------------------------------------------------------

/** `parameters.resolution` values across the resolution-tier protocols. */
export const VIDEO_RESOLUTIONS = ["480P", "720P", "1080P"] as const;
export type AlibabaVideoResolution = (typeof VIDEO_RESOLUTIONS)[number];

/** Legacy `parameters.size` values, by tier (the docs' own lists). */
export const SIZES_480P = ["832*480", "480*832", "624*624"] as const;
export const SIZES_720P = ["1280*720", "720*1280", "960*960", "1088*832", "832*1088"] as const;
export const SIZES_1080P = [
  "1920*1080",
  "1080*1920",
  "1440*1440",
  "1632*1248",
  "1248*1632",
] as const;

/** Every legacy size → its billing tier. */
export const SIZE_TIER: Readonly<Record<string, AlibabaVideoResolution>> = Object.freeze({
  ...Object.fromEntries(SIZES_480P.map((s) => [s, "480P"])),
  ...Object.fromEntries(SIZES_720P.map((s) => [s, "720P"])),
  ...Object.fromEntries(SIZES_1080P.map((s) => [s, "1080P"])),
} as Record<string, AlibabaVideoResolution>);

/** `input.media[].type` values across all protocols. */
export const VIDEO_MEDIA_TYPES = [
  "first_frame",
  "last_frame",
  "reference_image",
  "reference_video",
  "reference_audio",
  "driving_audio",
  "first_clip",
  "video",
  "file",
  "link",
] as const;
export type AlibabaVideoMediaType = (typeof VIDEO_MEDIA_TYPES)[number];

/** "Elements to exclude", max 500 characters (wan protocols). */
export const NEGATIVE_PROMPT_MAX_CHARACTERS = 500;

/** Server default when `parameters.duration` is omitted (every priced model). */
export const DEFAULT_VIDEO_DURATION = 5;

const range = (from: number, to: number): readonly number[] =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i);

/** wan3.0's `duration` range, plus `-1` ("Smart duration mode"). */
export const WAN3_DURATIONS = range(2, 30);
export const WAN27_DURATIONS = range(2, 15);
export const HAPPYHORSE_DURATIONS = range(3, 15);

// ---------------------------------------------------------------------------
// Per-model rules — transcribed from each model's own doc page.
// ---------------------------------------------------------------------------

export interface AlibabaVideoModelRule {
  /** Docs page this row was transcribed from. */
  docs: string;
  /** `input.prompt` cap, in characters (Chinese text halves the cap — see checkInput). */
  promptMaxCharacters: number;
  /** The route has no visual input, so a prompt is the whole request. */
  promptRequired: boolean;
  /** Accepts `input.negative_prompt` (≤500 chars). */
  negativePrompt: boolean;
  /** Accepts `input.audio_url` (custom soundtrack; wan2.7/2.6/2.5 t2v). */
  audioUrl: boolean;
  /** Allowed `input.media` types → max count. Absent: the model takes no media. */
  media?: Readonly<Partial<Record<AlibabaVideoMediaType, number>>>;
  /** `input.media` must be present (i2v / r2v / edit routes). */
  mediaRequired?: boolean;
  /** `parameters.resolution` enum + default (tier protocols). */
  resolutions?: readonly AlibabaVideoResolution[];
  defaultResolution?: AlibabaVideoResolution;
  /** `parameters.size` enum + default (legacy protocol). */
  sizes?: readonly string[];
  defaultSize?: string;
  /** `parameters.ratio` enum + default. */
  ratios?: readonly string[];
  defaultRatio?: string;
  /** `parameters.duration` allowed values; absent → the model has no duration param. */
  durations?: readonly number[];
  defaultDuration?: number;
  /** wan3 only: `duration: -1` selects "Smart duration mode". */
  smartDuration?: boolean;
  /** Accepts `parameters.prompt_extend` (wan protocols). */
  promptExtend: boolean;
  /** Accepts `parameters.shot_type` (wan2.6-t2v only). */
  shotType?: boolean;
  /** Accepts `parameters.audio` (wan3 only: soundtrack on/off, default true). */
  audioFlag?: boolean;
  /** Accepts `parameters.audio_setting` (video-edit only: "auto" | "origin"). */
  audioSetting?: boolean;
}

const WAN27_T2V_RULE: AlibabaVideoModelRule = {
  docs: T2V_DOCS,
  promptMaxCharacters: 5000,
  promptRequired: true,
  negativePrompt: true,
  audioUrl: true,
  resolutions: ["720P", "1080P"],
  defaultResolution: "1080P",
  ratios: ["16:9", "9:16", "1:1", "4:3", "3:4"],
  defaultRatio: "16:9",
  durations: WAN27_DURATIONS,
  defaultDuration: 5,
  promptExtend: true,
};

const WAN27_I2V_RULE: AlibabaVideoModelRule = {
  docs: I2V_DOCS,
  promptMaxCharacters: 5000,
  promptRequired: false,
  negativePrompt: true,
  audioUrl: false,
  media: { first_frame: 1, last_frame: 1, driving_audio: 1, first_clip: 1 },
  mediaRequired: true,
  resolutions: ["720P", "1080P"],
  defaultResolution: "1080P",
  durations: WAN27_DURATIONS,
  defaultDuration: 5,
  promptExtend: true,
};

const WAN26_T2V_RULE: AlibabaVideoModelRule = {
  docs: T2V_DOCS,
  promptMaxCharacters: 1500,
  promptRequired: true,
  negativePrompt: true,
  audioUrl: true,
  sizes: [...SIZES_720P, ...SIZES_1080P],
  defaultSize: "1920*1080",
  durations: range(2, 15),
  defaultDuration: 5,
  promptExtend: true,
  shotType: true,
};

const HH_T2V_RULE: AlibabaVideoModelRule = {
  docs: HH_T2V_DOCS,
  promptMaxCharacters: 5000,
  promptRequired: true,
  negativePrompt: false,
  audioUrl: false,
  resolutions: ["720P", "1080P"],
  defaultResolution: "1080P",
  ratios: ["16:9", "9:16", "1:1", "4:3", "3:4", "4:5", "5:4", "9:21", "21:9"],
  defaultRatio: "16:9",
  durations: HAPPYHORSE_DURATIONS,
  defaultDuration: 5,
  promptExtend: false,
};

const HH_I2V_RULE: AlibabaVideoModelRule = {
  docs: HH_I2V_DOCS,
  promptMaxCharacters: 5000,
  promptRequired: false,
  negativePrompt: false,
  audioUrl: false,
  media: { first_frame: 1 },
  mediaRequired: true,
  resolutions: ["720P", "1080P"],
  defaultResolution: "1080P",
  durations: HAPPYHORSE_DURATIONS,
  defaultDuration: 5,
  promptExtend: false,
};

const HH_R2V_RULE: AlibabaVideoModelRule = {
  docs: HH_R2V_DOCS,
  promptMaxCharacters: 5000,
  promptRequired: true,
  negativePrompt: false,
  audioUrl: false,
  media: { reference_image: 9 },
  mediaRequired: true,
  resolutions: ["720P", "1080P"],
  defaultResolution: "1080P",
  ratios: ["16:9", "9:16", "1:1", "4:3", "3:4", "4:5", "5:4", "9:21", "21:9"],
  defaultRatio: "16:9",
  durations: HAPPYHORSE_DURATIONS,
  defaultDuration: 5,
  promptExtend: false,
};

/**
 * Every video model's protocol surface, from its own doc page. Missing key =
 * the model does not take that field, and the checks below say so.
 */
export const VIDEO_MODEL_RULES: Readonly<Record<string, AlibabaVideoModelRule>> = {
  "wan3.0-video": {
    docs: WAN3_DOCS,
    promptMaxCharacters: 20000,
    // "either `prompt` OR `media` required" — checkInput enforces the pair.
    promptRequired: false,
    negativePrompt: false,
    audioUrl: false,
    media: {
      first_frame: 1,
      last_frame: 1,
      reference_image: 10,
      reference_video: 5,
      reference_audio: 5,
      file: 1,
      link: 1,
    },
    resolutions: ["480P", "720P", "1080P"],
    defaultResolution: "1080P",
    // "adaptive" (the default) follows the input media.
    ratios: ["adaptive", "16:9", "4:3", "1:1", "3:4", "9:16"],
    defaultRatio: "adaptive",
    durations: WAN3_DURATIONS,
    defaultDuration: 5,
    smartDuration: true,
    promptExtend: false,
    audioFlag: true,
  },
  "wan2.7-t2v": WAN27_T2V_RULE,
  "wan2.7-t2v-2026-06-12": WAN27_T2V_RULE,
  "wan2.7-t2v-2026-04-25": WAN27_T2V_RULE,
  "wan2.7-i2v-2026-04-25": WAN27_I2V_RULE,
  "wan2.7-i2v": WAN27_I2V_RULE,
  "wan2.6-t2v": WAN26_T2V_RULE,
  // Same wan2.6 protocol; only 5s/10s durations ("Only values 5 and 10").
  // `shot_type` stays allowed: the docs gate it to "the wan2.6 series".
  "wan2.6-t2v-us": {
    ...WAN26_T2V_RULE,
    durations: [5, 10],
  },
  "wan2.5-t2v-preview": {
    ...WAN26_T2V_RULE,
    sizes: [...SIZES_480P, ...SIZES_720P, ...SIZES_1080P],
    durations: [5, 10],
    shotType: false,
  },
  "wan2.2-t2v-plus": {
    ...WAN26_T2V_RULE,
    promptMaxCharacters: 800,
    audioUrl: false,
    sizes: [...SIZES_480P, ...SIZES_1080P],
    durations: [5],
    shotType: false,
  },
  "wan2.1-t2v-turbo": {
    ...WAN26_T2V_RULE,
    promptMaxCharacters: 800,
    audioUrl: false,
    sizes: [...SIZES_480P, ...SIZES_720P],
    defaultSize: "1280*720",
    durations: [5],
    shotType: false,
  },
  "wan2.1-t2v-plus": {
    ...WAN26_T2V_RULE,
    promptMaxCharacters: 800,
    audioUrl: false,
    sizes: [...SIZES_720P],
    defaultSize: "1280*720",
    durations: [5],
    shotType: false,
  },
  "happyhorse-1.1-t2v": HH_T2V_RULE,
  "happyhorse-1.0-t2v": HH_T2V_RULE,
  "happyhorse-1.1-i2v": HH_I2V_RULE,
  "happyhorse-1.0-i2v": HH_I2V_RULE,
  "happyhorse-1.1-r2v": HH_R2V_RULE,
  "happyhorse-1.0-r2v": HH_R2V_RULE,
  "happyhorse-1.0-video-edit": {
    docs: HH_EDIT_DOCS,
    promptMaxCharacters: 5000,
    promptRequired: true,
    negativePrompt: false,
    audioUrl: false,
    media: { video: 1, reference_image: 5 },
    mediaRequired: true,
    resolutions: ["720P", "1080P"],
    defaultResolution: "1080P",
    // No duration param: the output length follows the input clip (3–15s out).
    promptExtend: false,
    audioSetting: true,
  },
};

// ---------------------------------------------------------------------------
// Pricing — USD per second of output video, Singapore tables of the pricing
// page (2026-08-24). wan3.0-video has no international row and is absent.
// ---------------------------------------------------------------------------

const WAN27_PRICE = { "720P": 0.1, "1080P": 0.15 } as const;
const HH_11_PRICE = { "720P": 0.14, "1080P": 0.18 } as const;
const HH_10_PRICE = { "720P": 0.14, "1080P": 0.24 } as const;

export const VIDEO_PRICE_PER_SECOND_USD: Readonly<
  Record<string, Readonly<Partial<Record<AlibabaVideoResolution, number>>>>
> = {
  "wan2.7-t2v": WAN27_PRICE,
  "wan2.7-t2v-2026-06-12": WAN27_PRICE,
  "wan2.7-t2v-2026-04-25": WAN27_PRICE,
  "wan2.7-i2v-2026-04-25": WAN27_PRICE,
  "wan2.7-i2v": WAN27_PRICE,
  "wan2.6-t2v": WAN27_PRICE,
  "wan2.6-t2v-us": WAN27_PRICE,
  "wan2.5-t2v-preview": { "480P": 0.05, "720P": 0.1, "1080P": 0.15 },
  "wan2.2-t2v-plus": { "480P": 0.02, "1080P": 0.1 },
  "wan2.1-t2v-turbo": { "480P": 0.036, "720P": 0.036 },
  "wan2.1-t2v-plus": { "720P": 0.1 },
  "happyhorse-1.1-t2v": HH_11_PRICE,
  "happyhorse-1.0-t2v": HH_10_PRICE,
  "happyhorse-1.1-i2v": HH_11_PRICE,
  "happyhorse-1.0-i2v": HH_10_PRICE,
  "happyhorse-1.1-r2v": HH_11_PRICE,
  "happyhorse-1.0-r2v": HH_10_PRICE,
  // Output rate only; the edit route also bills the INPUT clip's duration,
  // which the request does not carry — so estimates stay absent for it.
  "happyhorse-1.0-video-edit": HH_10_PRICE,
};

// ---------------------------------------------------------------------------
// Wire types — mirror the raw JSON body exactly (snake_case).
// ---------------------------------------------------------------------------

/** One `input.media` entry: a typed public URL or Base64 data URI. */
export interface AlibabaVideoMedia {
  type: AlibabaVideoMediaType | (string & {});
  /** Public URL or `data:{MIME};base64,{data}`. */
  url: string;
}

export interface AlibabaVideoInput {
  /** Text description. Caps vary per model (VIDEO_MODEL_RULES). */
  prompt?: string;
  /** Elements to exclude; ≤500 characters (wan protocols only). */
  negative_prompt?: string;
  /** Custom soundtrack URL, WAV/MP3 (wan2.7/2.6/2.5 t2v only). */
  audio_url?: string;
  /** Typed media inputs (wan3 / wan2.7-i2v / happyhorse i2v-r2v-edit). */
  media?: AlibabaVideoMedia[];
}

export interface AlibabaVideoParameters {
  /** Resolution tier (tier protocols); affects the per-second price. */
  resolution?: AlibabaVideoResolution;
  /** Exact frame size like "1920*1080" (legacy wan2.6-and-earlier protocol). */
  size?: string;
  /** Aspect ratio (wan3 / wan2.7 t2v / happyhorse t2v & r2v). */
  ratio?: string;
  /** Output length in seconds; wan3 also takes -1 (smart duration). */
  duration?: number;
  /** LLM prompt rewriting; default true (wan protocols). */
  prompt_extend?: boolean;
  /** "single" | "multi" storyboard mode (wan2.6-t2v, with prompt_extend). */
  shot_type?: "single" | "multi";
  /** Soundtrack on/off; default true (wan3.0-video only). */
  audio?: boolean;
  /** "auto" (generate) | "origin" (keep source audio) — video-edit only. */
  audio_setting?: "auto" | "origin";
  /** Adds the provider watermark. Default false on wan, TRUE on HappyHorse. */
  watermark?: boolean;
  /** [0, 2147483647]; improves reproducibility. */
  seed?: number;
}

export interface VideoSynthesisParams {
  /** Model id. Required. */
  model: AlibabaVideoGenerationModelId | (string & {});
  input: AlibabaVideoInput;
  parameters?: AlibabaVideoParameters;
}

// ---------------------------------------------------------------------------
// Schema (loose: unknown keys pass through with a warning).
// ---------------------------------------------------------------------------

const videoSchema = z.looseObject({
  model: z.string().min(1, "model is required"),
  input: z.looseObject({
    prompt: z.string().optional(),
    negative_prompt: z
      .string()
      .max(
        NEGATIVE_PROMPT_MAX_CHARACTERS,
        `negative_prompt allows at most ${NEGATIVE_PROMPT_MAX_CHARACTERS} characters`,
      )
      .optional(),
    audio_url: z.string().optional(),
    media: z.array(z.looseObject({ type: z.string(), url: z.string() })).optional(),
  }),
  parameters: z
    .looseObject({
      resolution: z.enum(VIDEO_RESOLUTIONS).optional(),
      size: z.string().optional(),
      ratio: z.string().optional(),
      duration: z.number().int().optional(),
      prompt_extend: z.boolean().optional(),
      shot_type: z.enum(["single", "multi"]).optional(),
      audio: z.boolean().optional(),
      audio_setting: z.enum(["auto", "origin"]).optional(),
      watermark: z.boolean().optional(),
      seed: z.number().int().min(0).max(2147483647).optional(),
    })
    .optional(),
});

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

const VIDEO_MODEL_ID_SET = new Set<string>(VIDEO_MODEL_IDS);

function checkModelEnum(
  params: VideoSynthesisParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (VIDEO_MODEL_ID_SET.has(params.model)) return;
  ctx.report({
    code: "invalid_enum_value",
    path: ["model"],
    model: params.model,
    message: `\`model\` must be one of ${VIDEO_MODEL_IDS.map((v) => JSON.stringify(v)).join(", ")}; got ${JSON.stringify(params.model)}.`,
    meta: { allowed: [...VIDEO_MODEL_IDS], value: params.model, source: T2V_DOCS },
  });
}

/** `input`: prompt presence/length, negative prompt, audio_url, media table. */
function checkInput(
  params: VideoSynthesisParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const rule = VIDEO_MODEL_RULES[params.model];
  if (rule === undefined) return; // unknown model: already reported
  const model = params.model;
  const input = params.input ?? {};

  const prompt = input.prompt ?? "";
  if (prompt.length > rule.promptMaxCharacters) {
    ctx.report({
      code: "over_output_limit",
      path: ["input", "prompt"],
      model,
      message: `\`input.prompt\` is ${prompt.length} characters, over the ${rule.promptMaxCharacters}-character cap "${model}" documents (Chinese text halves the cap on the HappyHorse routes).`,
      meta: {
        limitCharacters: rule.promptMaxCharacters,
        actualCharacters: prompt.length,
        source: rule.docs,
      },
    });
  }

  const media = input.media;
  if (rule.media === undefined) {
    if (media !== undefined) {
      ctx.report({
        code: "unsupported_param",
        path: ["input", "media"],
        model,
        message: `"${model}" is a text-to-video model and takes no \`input.media\`; the wan3.0/i2v/r2v/edit routes do.`,
        meta: { source: rule.docs },
      });
    }
  } else {
    const counts = new Map<string, number>();
    for (const [index, entry] of (media ?? []).entries()) {
      const type = entry?.type;
      counts.set(type, (counts.get(type) ?? 0) + 1);
      if (!Object.hasOwn(rule.media, type)) {
        ctx.report({
          code: "invalid_enum_value",
          path: ["input", "media", index, "type"],
          model,
          message: `\`input.media[${index}].type\` must be one of ${Object.keys(rule.media)
            .map((v) => JSON.stringify(v))
            .join(", ")} for "${model}"; got ${JSON.stringify(type)}.`,
          meta: { allowed: Object.keys(rule.media), value: type, source: rule.docs },
        });
      }
    }
    for (const [type, max] of Object.entries(rule.media)) {
      const count = counts.get(type) ?? 0;
      if (max !== undefined && count > max) {
        ctx.report({
          code: "invalid_shape",
          path: ["input", "media"],
          model,
          message: `"${model}" accepts at most ${max} ${JSON.stringify(type)} media ${max === 1 ? "entry" : "entries"}; got ${count}.`,
          meta: { type, max, count, source: rule.docs },
        });
      }
    }
    if (rule.mediaRequired === true && (media === undefined || media.length === 0)) {
      ctx.report({
        code: "invalid_shape",
        path: ["input", "media"],
        model,
        message: `"${model}" requires \`input.media\` (${Object.keys(rule.media)
          .map((v) => JSON.stringify(v))
          .join(", ")}).`,
        meta: { source: rule.docs },
      });
    }
    // Route-specific pairings.
    if (model === "happyhorse-1.0-video-edit" && media !== undefined && media.length > 0) {
      if ((counts.get("video") ?? 0) !== 1) {
        ctx.report({
          code: "invalid_shape",
          path: ["input", "media"],
          model,
          message: `The video-edit route takes exactly one \`type: "video"\` entry (plus 0–5 reference images); got ${counts.get("video") ?? 0}.`,
          meta: { source: rule.docs },
        });
      }
    }
    if (model.startsWith("wan2.7-i2v") && media !== undefined && media.length > 0) {
      const hasFirst = (counts.get("first_frame") ?? 0) > 0;
      const hasClip = (counts.get("first_clip") ?? 0) > 0;
      if (!hasFirst && !hasClip) {
        ctx.report({
          code: "invalid_shape",
          path: ["input", "media"],
          model,
          message: `"${model}" requires a \`first_frame\` or \`first_clip\` media entry (the documented combinations all start from one).`,
          meta: { source: rule.docs },
        });
      }
      if ((counts.get("driving_audio") ?? 0) > 0 && !hasFirst) {
        ctx.report({
          code: "invalid_shape",
          path: ["input", "media"],
          model,
          message: "`driving_audio` is only documented alongside `first_frame` (with or without `last_frame`), not with `first_clip`.",
          meta: { source: rule.docs },
        });
      }
    }
  }

  // wan3: "either `prompt` OR `media` required"; every promptRequired model
  // needs a non-empty prompt outright.
  const hasMedia = (media?.length ?? 0) > 0;
  if (rule.promptRequired && prompt === "") {
    ctx.report({
      code: "invalid_shape",
      path: ["input", "prompt"],
      model,
      message: `\`input.prompt\` is required for "${model}".`,
      meta: { source: rule.docs },
    });
  } else if (!rule.promptRequired && prompt === "" && !hasMedia && rule.media !== undefined) {
    ctx.report({
      code: "invalid_shape",
      path: ["input"],
      model,
      message: `"${model}" requires \`input.prompt\` or \`input.media\` (or both).`,
      meta: { source: rule.docs },
    });
  }

  if (input.negative_prompt !== undefined && !rule.negativePrompt) {
    ctx.report({
      code: "unsupported_param",
      path: ["input", "negative_prompt"],
      model,
      message: `\`input.negative_prompt\` is a wan t2v/i2v field; "${model}" does not document it.`,
      meta: { source: rule.docs },
    });
  }
  if (input.audio_url !== undefined && !rule.audioUrl) {
    ctx.report({
      code: "unsupported_param",
      path: ["input", "audio_url"],
      model,
      message: `\`input.audio_url\` is supported by the wan2.7/wan2.6/wan2.5 t2v models only; "${model}" does not accept it.`,
      meta: { source: rule.docs },
    });
  }
}

/** `parameters`: resolution/size/ratio/duration enums, per-protocol fields. */
function checkParameters(
  params: VideoSynthesisParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const rule = VIDEO_MODEL_RULES[params.model];
  if (rule === undefined) return;
  const model = params.model;
  const p = params.parameters ?? {};

  if (p.resolution !== undefined) {
    if (rule.resolutions === undefined) {
      ctx.report({
        code: "unsupported_param",
        path: ["parameters", "resolution"],
        model,
        message: `"${model}" uses the legacy \`size\` protocol ("1920*1080"-style strings), not \`resolution\`.`,
        meta: { source: rule.docs },
      });
    } else if (!rule.resolutions.includes(p.resolution)) {
      ctx.report({
        code: "invalid_enum_value",
        path: ["parameters", "resolution"],
        model,
        message: `\`parameters.resolution\` must be one of ${rule.resolutions.map((v) => JSON.stringify(v)).join(", ")} for "${model}"; got ${JSON.stringify(p.resolution)}.`,
        meta: { allowed: [...rule.resolutions], value: p.resolution, source: rule.docs },
      });
    }
  }

  if (p.size !== undefined) {
    if (rule.sizes === undefined) {
      ctx.report({
        code: "unsupported_param",
        path: ["parameters", "size"],
        model,
        message: `"${model}" takes \`resolution\` (a tier), not the legacy \`size\` strings.`,
        meta: { source: rule.docs },
      });
    } else if (!rule.sizes.includes(p.size)) {
      ctx.report({
        code: "invalid_enum_value",
        path: ["parameters", "size"],
        model,
        message: `\`parameters.size\` must be one of ${rule.sizes.map((v) => JSON.stringify(v)).join(", ")} for "${model}"; got ${JSON.stringify(p.size)}.`,
        meta: { allowed: [...rule.sizes], value: p.size, source: rule.docs },
      });
    }
  }

  if (p.ratio !== undefined) {
    if (rule.ratios === undefined) {
      ctx.report({
        code: "unsupported_param",
        path: ["parameters", "ratio"],
        model,
        message: `"${model}" has no \`ratio\` param — the frame follows the input media${rule.sizes !== undefined ? " or the `size` string" : ""}.`,
        meta: { source: rule.docs },
      });
    } else if (!rule.ratios.includes(p.ratio)) {
      ctx.report({
        code: "invalid_enum_value",
        path: ["parameters", "ratio"],
        model,
        message: `\`parameters.ratio\` must be one of ${rule.ratios.map((v) => JSON.stringify(v)).join(", ")} for "${model}"; got ${JSON.stringify(p.ratio)}.`,
        meta: { allowed: [...rule.ratios], value: p.ratio, source: rule.docs },
      });
    }
  }

  if (p.duration !== undefined) {
    if (rule.durations === undefined) {
      ctx.report({
        code: "unsupported_param",
        path: ["parameters", "duration"],
        model,
        message: `"${model}" has no \`duration\` param — the output length follows the input clip.`,
        meta: { source: rule.docs },
      });
    } else if (
      !rule.durations.includes(p.duration) &&
      !(rule.smartDuration === true && p.duration === -1)
    ) {
      const [min, max] = [rule.durations[0], rule.durations[rule.durations.length - 1]];
      ctx.report({
        code: "invalid_enum_value",
        path: ["parameters", "duration"],
        model,
        message:
          rule.durations.length > 2
            ? `\`parameters.duration\` must be ${min}–${max} seconds for "${model}"${rule.smartDuration === true ? " (or -1 for smart duration)" : ""}; got ${p.duration}.`
            : `\`parameters.duration\` must be ${rule.durations.join(" or ")} seconds for "${model}"; got ${p.duration}.`,
        meta: { allowed: [...rule.durations], value: p.duration, source: rule.docs },
      });
    }
  }

  const gates: ReadonlyArray<[keyof AlibabaVideoParameters, boolean, string]> = [
    ["prompt_extend", rule.promptExtend, "the wan t2v/i2v models"],
    ["shot_type", rule.shotType === true, '"wan2.6-t2v" (with `prompt_extend: true`)'],
    ["audio", rule.audioFlag === true, '"wan3.0-video"'],
    ["audio_setting", rule.audioSetting === true, '"happyhorse-1.0-video-edit"'],
  ];
  for (const [field, allowed, takers] of gates) {
    if (p[field] !== undefined && !allowed) {
      ctx.report({
        code: "unsupported_param",
        path: ["parameters", field],
        model,
        message: `\`parameters.${field}\` is only documented for ${takers}; "${model}" does not accept it.`,
        meta: { source: rule.docs },
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Estimation — USD/second × requested (or default) duration, at the requested
// (or default) resolution tier. Exact for every priced model; absent for
// wan3.0-video (no published rate) and video-edit (input duration unknown).
// ---------------------------------------------------------------------------

/** The billing tier a request resolves to, or undefined off-protocol. */
export function videoBillingTier(
  model: string,
  parameters?: Pick<AlibabaVideoParameters, "resolution" | "size">,
): AlibabaVideoResolution | undefined {
  const rule = VIDEO_MODEL_RULES[model];
  if (rule === undefined) return undefined;
  if (rule.sizes !== undefined) {
    const size = parameters?.size ?? rule.defaultSize;
    return size === undefined ? undefined : SIZE_TIER[size];
  }
  return parameters?.resolution ?? rule.defaultResolution;
}

/** USD estimate for one request, or undefined when Alibaba publishes no rate. */
export function videoPriceUSD(
  model: string,
  parameters?: Pick<AlibabaVideoParameters, "resolution" | "size" | "duration">,
): number | undefined {
  const rule = VIDEO_MODEL_RULES[model];
  if (rule === undefined) return undefined;
  // The edit route bills input+output duration and the request carries
  // neither; a number here would be a guess.
  if (rule.durations === undefined) return undefined;
  const tier = videoBillingTier(model, parameters);
  if (tier === undefined) return undefined;
  const rate = VIDEO_PRICE_PER_SECOND_USD[model]?.[tier];
  if (rate === undefined) return undefined;
  const duration = parameters?.duration ?? rule.defaultDuration ?? DEFAULT_VIDEO_DURATION;
  if (duration <= 0) return undefined; // -1 (smart duration) prices at run time
  return rate * duration;
}

function estimate(
  params: VideoSynthesisParams,
  _info: ModelInfo | undefined,
  _ctx: PipelineContext,
): ValidateEstimate {
  const costUSD = videoPriceUSD(params.model, params.parameters);
  return costUSD === undefined ? {} : { costUSD };
}

// ---------------------------------------------------------------------------
// Finalize — the whole params object is the wire body.
// ---------------------------------------------------------------------------

/**
 * Written as a `type` kept in lockstep with the object literal in `finalize`:
 * an `interface extends Record<string, …>` would inherit a string index
 * signature and collapse `keyof` to `string`. See `SdkFormatters` in
 * core/request.ts.
 */
type AlibabaSdkTargets<B> = { alibaba: () => B };

function finalize(params: VideoSynthesisParams): unknown {
  const body = { ...params };
  return toValidated(
    body,
    { url: VIDEO_SYNTHESIS_URL, method: "POST", headers: { ...VIDEO_HEADERS } },
    { sdk: { alibaba: () => body } },
  );
}

const validator = createValidator<VideoSynthesisParams, unknown>({
  endpoint: "alibaba.video",
  schema: videoSchema,
  modelId: (params) => params.model,
  catalog: videoModels,
  checks: [checkModelEnum, checkInput, checkParameters],
  estimate,
  finalize,
});

/**
 * Validates raw wire params for DashScope
 * `POST /api/v1/services/aigc/video-generation/video-synthesis` — the Wan
 * (3.0 / 2.7 / 2.6 / 2.5 / 2.2 / 2.1) and HappyHorse video models on the
 * international platform.
 *
 * The returned object's enumerable props are the exact fetch JSON body;
 * Alibaba ships no official JS SDK for DashScope, so `.toSdk("alibaba")`
 * returns it unchanged. The call is asynchronous: `.request.headers` carries
 * the mandatory `x-dashscope-async: enable`, the response is
 * `{output: {task_id}}`, and you poll `videoTaskUrl(taskId)` until
 * `task_status` is "SUCCEEDED". Auth is your job: add
 * `authorization: Bearer <DASHSCOPE_API_KEY>` when fetching. The default URL
 * is the legacy intl domain; use `reroute(params, videoSynthesisUrl(base))`
 * for a workspace-scoped host.
 *
 * Cost is USD/second × duration at the requested resolution tier (e.g.
 * happyhorse-1.1-t2v at 1080P/5s = $0.90); wan3.0-video publishes no
 * international rate and the video-edit route bills an input duration the
 * request does not carry, so neither produces an estimate.
 *
 * ```ts
 * const params = alibaba.video({
 *   model: "wan2.7-t2v",
 *   input: { prompt: "A corgi runs on a beach at sunset" },
 *   parameters: { resolution: "1080P", duration: 5 },
 * });
 * const res = await fetch(params.request.url, {
 *   method: params.request.method,
 *   headers: {
 *     ...params.request.headers,
 *     authorization: `Bearer ${process.env.DASHSCOPE_API_KEY}`,
 *   },
 *   body: JSON.stringify(params),
 * });
 * const { output } = await res.json(); // { task_id, task_status: "PENDING" }
 * ```
 */
export const video = validator as unknown as {
  <T extends VideoSynthesisParams>(
    params: T & ExactKeys<T, VideoSynthesisParams>,
    options?: ValidateOptions<T>,
  ): Validated<T, AlibabaSdkTargets<T>>;
  safe<T extends VideoSynthesisParams>(
    params: T & ExactKeys<T, VideoSynthesisParams>,
    options?: ValidateOptions<T>,
  ): ValidateResult<Validated<T, AlibabaSdkTargets<T>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
