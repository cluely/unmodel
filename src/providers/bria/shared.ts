/**
 * Wire vocabulary shared by Bria's v2 image routes.
 *
 * Ground truth: https://docs.bria.ai/_bundle/image-generation.yaml and
 * https://docs.bria.ai/_bundle/image-editing.yaml (the bundled OpenAPI
 * documents Bria's docs site serves). Verified 2026-08-13.
 */

import type { PipelineContext } from "../../core/pipeline";

export const BRIA_API_BASE_URL = "https://engine.prod.bria-api.com/v2";

export const BRIA_GENERATION_SPEC_URL = "https://docs.bria.ai/_bundle/image-generation.yaml";
export const BRIA_EDITING_SPEC_URL = "https://docs.bria.ai/_bundle/image-editing.yaml";

/** `aspect_ratio` enum — identical on the generate and generate/lite routes. */
export const BRIA_ASPECT_RATIOS = [
  "1:1",
  "2:3",
  "3:2",
  "3:4",
  "4:3",
  "4:5",
  "5:4",
  "9:16",
  "16:9",
] as const;
export type BriaAspectRatio = (typeof BRIA_ASPECT_RATIOS)[number];

/** `resolution` enum — full generate route only. */
export const BRIA_RESOLUTIONS = ["1MP", "4MP"] as const;
export type BriaResolution = (typeof BRIA_RESOLUTIONS)[number];

/** `output_type` enum — every v2 image route. */
export const BRIA_OUTPUT_TYPES = ["png", "jpeg"] as const;
export type BriaOutputType = (typeof BRIA_OUTPUT_TYPES)[number];

/** Input image formats — "Supported formats: JPEG, JPG, PNG, WEBP." */
export const BRIA_INPUT_IMAGE_FORMATS = ["jpeg", "jpg", "png", "webp"] as const;

/** Flags shared by every v2 route (async/moderation plumbing). */
export interface BriaCommonParams {
  /** Reproducibility seed; random when omitted. */
  seed?: number;
  /** `true` holds the connection and returns the result; `false` (default) returns a `status_url` to poll. */
  sync?: boolean;
  /** URL POSTed with the result when an async job completes. */
  webhook_url?: string;
  /**
   * Output format. Default "png". CLOSED enum — the OpenAPI `output_type` enum
   * has exactly these two values on every v2 image route.
   */
  output_type?: BriaOutputType;
  /** Warn about potential IP content in the prompt. Default false. */
  ip_signal?: boolean;
  /** 422 on prompt moderation failure. Default true. */
  prompt_content_moderation?: boolean;
  /** 422 on visual input moderation failure. Default true. */
  visual_input_content_moderation?: boolean;
  /** 422 on visual output moderation failure. Default true. */
  visual_output_content_moderation?: boolean;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function checkBriaEnum(
  ctx: PipelineContext,
  path: Array<string | number>,
  value: unknown,
  allowed: readonly string[],
  source: string,
  note = "",
): void {
  if (value == null) return;
  if (typeof value !== "string" || !allowed.includes(value)) {
    ctx.report({
      code: "invalid_enum_value",
      path,
      message: `\`${path.join(".")}\` must be one of ${allowed.map((v) => JSON.stringify(v)).join(", ")}; got ${JSON.stringify(value)}.${note}`,
      meta: { allowed: [...allowed], value, source },
    });
  }
}

/** Reports an integer parameter outside its documented inclusive range. */
export function checkBriaIntegerRange(
  ctx: PipelineContext,
  path: Array<string | number>,
  value: unknown,
  min: number,
  max: number,
  source: string,
  note = "",
): void {
  if (value == null) return;
  const label = path.join(".");
  if (typeof value !== "number" || !Number.isInteger(value)) {
    ctx.report({
      code: "invalid_shape",
      path,
      message: `\`${label}\` must be an integer between ${min} and ${max}; got ${JSON.stringify(value)}.${note}`,
      meta: { min, max, source },
    });
    return;
  }
  if (value < min || value > max) {
    ctx.report({
      code: "invalid_shape",
      path,
      message: `\`${label}\` must be between ${min} and ${max}; got ${value}.${note}`,
      meta: { min, max, value, source },
    });
  }
}

/** Reports a `webhook_url` that is not an absolute http(s) URL. */
export function checkBriaWebhook(ctx: PipelineContext, value: unknown, source: string): void {
  if (value == null) return;
  if (typeof value !== "string" || !/^https?:\/\//.test(value)) {
    ctx.report({
      code: "invalid_shape",
      path: ["webhook_url"],
      message: `\`webhook_url\` must be an absolute URL (format: uri); got ${JSON.stringify(value)}.`,
      meta: { value, source },
    });
  }
}

/**
 * `structured_prompt` / `structured_instruction` travel as JSON **strings**
 * ("A string containing the structured prompt in JSON format"), which is easy
 * to get wrong when the value came back as an object from a previous response.
 */
export function checkStructuredJsonString(
  ctx: PipelineContext,
  param: "structured_prompt" | "structured_instruction",
  value: unknown,
  source: string,
): void {
  if (value == null) return;
  if (typeof value !== "string") {
    ctx.report({
      code: "invalid_shape",
      path: [param],
      message: `\`${param}\` must be a STRING containing JSON, not an object — \`JSON.stringify()\` the structured prompt from the previous response before sending it.`,
      meta: { source },
    });
    return;
  }
  try {
    JSON.parse(value);
  } catch {
    ctx.report({
      code: "invalid_shape",
      path: [param],
      message: `\`${param}\` must contain valid JSON; this string does not parse.`,
      meta: { source },
    });
  }
}

/**
 * `images` is an array of URLs or base64 strings. The generate routes declare
 * `maxItems: 1` ("Currently supports a single image"), so an omitted or empty
 * array is fine there; the edit route requires the field and "must contain
 * exactly one item".
 */
export function checkBriaImages(
  ctx: PipelineContext,
  value: unknown,
  source: string,
  cardinality: "at-most-one" | "exactly-one",
): void {
  if (value == null) return;
  if (!Array.isArray(value)) {
    ctx.report({
      code: "invalid_shape",
      path: ["images"],
      message: "`images` must be an array of image strings (publicly available URL or base64).",
      meta: { source },
    });
    return;
  }
  const tooMany = value.length > 1;
  const tooFew = cardinality === "exactly-one" && value.length === 0;
  if (tooMany || tooFew) {
    ctx.report({
      code: "invalid_shape",
      path: ["images"],
      message:
        cardinality === "exactly-one"
          ? `\`images\` must contain exactly one item; got ${value.length} entries.`
          : `\`images\` currently supports a single image; got ${value.length} entries.`,
      meta: { limit: 1, count: value.length, source },
    });
  }
  value.forEach((image, i) => {
    if (typeof image !== "string" || image.length === 0) {
      ctx.report({
        code: "invalid_shape",
        path: ["images", i],
        message:
          "each `images` entry must be a non-empty string — a publicly available URL or a Base64-encoded image (JPEG, JPG, PNG or WEBP).",
        meta: { source },
      });
    }
  });
}
