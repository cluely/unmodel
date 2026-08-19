/**
 * Shared wire pieces for the Vidu API (`https://api.vidu.com/ent/v2/...`),
 * transcribed from the request-body tables on
 * https://platform.vidu.com/docs/text-to-video,
 * /docs/image-to-video, /docs/start-end-to-video, /docs/reference-to-video and
 * /docs/reference-to-image — verified 2026-08-13.
 *
 * Every route is asynchronous: it responds with a task object
 * (`{ task_id, state, ... }`); polling the Get Generation API or handling
 * `callback_url` is out of unmodel's scope.
 *
 * Auth is `Authorization: Token <VIDU_API_KEY>` (the literal scheme word is
 * `Token`, not `Bearer`) — unmodel never touches keys; add the header
 * yourself when fetching.
 */

import { z } from "zod";
import type { PipelineContext } from "../../core/pipeline";
import type { ModelInfo } from "../../core/catalog-types";
import { JSON_HEADERS } from "../../core/request";

export const VIDU_BASE_URL = "https://api.vidu.com/ent/v2";

export const VIDU_HEADERS: Record<string, string> = JSON_HEADERS;

export const DOCS_BASE = "https://platform.vidu.com/docs";

/** Every documented `resolution` value across the video routes. */
export const VIDU_RESOLUTIONS = ["360p", "540p", "720p", "1080p"] as const;
export type ViduResolution = (typeof VIDU_RESOLUTIONS)[number];

/** Every documented `aspect_ratio` value. */
export const VIDU_ASPECT_RATIOS = ["16:9", "9:16", "3:4", "4:3", "1:1"] as const;
export type ViduAspectRatio = (typeof VIDU_ASPECT_RATIOS)[number];

export const VIDU_MOVEMENT_AMPLITUDES = ["auto", "small", "medium", "large"] as const;
export type ViduMovementAmplitude = (typeof VIDU_MOVEMENT_AMPLITUDES)[number];

export const VIDU_AUDIO_TYPES = ["all", "speech_only", "sound-effect_only"] as const;
export type ViduAudioType = (typeof VIDU_AUDIO_TYPES)[number];

/** `style`, text2video only. Not effective on the q2 / q3 models. */
export const VIDU_STYLES = ["general", "anime"] as const;
export type ViduStyle = (typeof VIDU_STYLES)[number];

/** Documented `prompt` ceiling on the video routes. */
export const PROMPT_MAX_CHARS = 5000;
/** Documented `prompt` ceiling on imageFromReference. */
export const IMAGE_PROMPT_MAX_CHARS = 2000;
/** Documented `payload` ceiling. */
export const PAYLOAD_MAX_CHARS = 1_048_576;

/** An image or video reference: a public URL or a base64 data URI. */
export const assetSchema = z.string().min(1);

export const promptSchema = z.string().max(PROMPT_MAX_CHARS);
export const payloadSchema = z.string().max(PAYLOAD_MAX_CHARS);

// ---------------------------------------------------------------------------
// Per-route model support — resolutions and durations differ per model AND per
// route (viduq3-turbo takes 1–16s on text2video but 3–16s on reference2video),
// so each endpoint hands its own table to the checkers below.
// ---------------------------------------------------------------------------

export interface ModelRouteSupport {
  /** Allowed `resolution` values for this model on this route. */
  readonly resolutions: readonly string[];
  /** Inclusive `duration` bounds in seconds. */
  readonly duration: { readonly min: number; readonly max: number };
  /** When set, `duration` must be exactly one of these values. */
  readonly durations?: readonly number[];
}

export type RouteSupport = Readonly<Record<string, ModelRouteSupport>>;

interface SupportedParams {
  model: string;
  resolution?: string;
  duration?: number;
}

/**
 * Reports models that have no arm on this route, then enforces the model's
 * documented `resolution` values and `duration` bounds. Unknown models are
 * skipped (the catalog already warned).
 */
export function checkRouteSupport<P extends SupportedParams>(
  route: string,
  table: RouteSupport,
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
        message: `Model "${params.model}" has no ${route} arm — that route accepts ${supported.join(", ")}.`,
        meta: { source, supported },
      });
      return;
    }
    if (params.resolution != null && !rules.resolutions.includes(params.resolution)) {
      ctx.report({
        code: "invalid_enum_value",
        path: ["resolution"],
        model: params.model,
        message: `\`resolution\` must be one of ${rules.resolutions.map((v) => JSON.stringify(v)).join(", ")} for "${params.model}" on ${route}; got ${JSON.stringify(params.resolution)}.`,
        meta: { allowed: [...rules.resolutions], value: params.resolution, source },
      });
    }
    const { duration } = params;
    if (duration == null) return;
    if (rules.durations !== undefined) {
      if (!rules.durations.includes(duration)) {
        ctx.report({
          code: "invalid_enum_value",
          path: ["duration"],
          model: params.model,
          message: `\`duration\` must be ${rules.durations.join(" or ")} seconds for "${params.model}" on ${route}; got ${duration}.`,
          meta: { allowed: [...rules.durations], value: duration, source },
        });
      }
      return;
    }
    if (duration < rules.duration.min || duration > rules.duration.max) {
      ctx.report({
        code: "invalid_enum_value",
        path: ["duration"],
        model: params.model,
        message: `\`duration\` must be between ${rules.duration.min} and ${rules.duration.max} seconds for "${params.model}" on ${route}; got ${duration}.`,
        meta: { min: rules.duration.min, max: rules.duration.max, value: duration, source },
      });
    }
  };
}

/** Enforces an array-length band on a param, e.g. `images` 1–7. */
export function checkArrayLength<P>(
  field: string,
  bounds: Readonly<Record<string, { min: number; max: number }>>,
  source: string,
): (params: P, info: ModelInfo | undefined, ctx: PipelineContext) => void {
  return (params, info, ctx) => {
    if (info === undefined) return;
    const record = params as Record<string, unknown>;
    const value = record[field];
    if (!Array.isArray(value)) return;
    const model = String(record["model"] ?? "");
    const limit = bounds[model];
    if (limit === undefined) return;
    if (value.length < limit.min || value.length > limit.max) {
      ctx.report({
        code: "invalid_shape",
        path: [field],
        model,
        message: `\`${field}\` accepts ${limit.min}–${limit.max} item${limit.max === 1 ? "" : "s"} for "${model}"; got ${value.length}.`,
        meta: { min: limit.min, max: limit.max, count: value.length, source },
      });
    }
  };
}
