/**
 * Shared wire vocabulary for the Reve image API (https://api.reve.com/console/docs).
 *
 * Everything here is documented on the API console's Documentation Overview
 * page and reused by more than one route: the two aspect-ratio sets (v1's
 * legacy subset vs v2's full list), the `postprocessing` operation shapes, the
 * `test_time_scaling` bounds, the credit→USD conversion, and the input-image
 * limits ("A single image may be at most 40 MB and 33,554,432 pixels (for
 * example 8192x4096), with neither dimension exceeding 8192 pixels. A single
 * call may include at most 50,331,648 pixels and 100 MB of image data (after
 * base64 decoding) across all images.").
 *
 * Verified 2026-08-13 against https://api.reve.com/console/docs (Documentation
 * Overview, Create, Edit, Remix, v2 Create) and
 * https://api.reve.com/console/pricing.
 */

import type { PipelineContext } from "../../core/pipeline";
import { toBytes } from "../../core/media/bytes";
import { sniffImage } from "../../core/media/image";

export const REVE_API_BASE_URL = "https://api.reve.com";

export const REVE_DOCS_URL = "https://api.reve.com/console/docs";

/**
 * Aspect ratios the v1 routes accept — "The v1 endpoints intentionally
 * document and accept only the smaller legacy subset."
 */
export const REVE_V1_ASPECT_RATIOS = ["16:9", "3:2", "4:3", "1:1", "3:4", "2:3", "9:16"] as const;
export type ReveV1AspectRatio = (typeof REVE_V1_ASPECT_RATIOS)[number];

/**
 * Aspect ratios the v2 image and layout endpoints accept — the full
 * unified-model set, including `auto` ("the model picks an appropriate aspect
 * ratio for the request").
 */
export const REVE_V2_ASPECT_RATIOS = [
  "4:1",
  "3:1",
  "21:9",
  "2:1",
  "17:9",
  "16:9",
  "3:2",
  "4:3",
  "5:4",
  "1:1",
  "4:5",
  "3:4",
  "2:3",
  "9:16",
  "1:2",
  "1:3",
  "1:4",
  "auto",
] as const;
export type ReveV2AspectRatio = (typeof REVE_V2_ASPECT_RATIOS)[number];

/** `test_time_scaling` bounds — "Values between 1 and 15 are accepted." */
export const REVE_TEST_TIME_SCALING_MIN = 1;
export const REVE_TEST_TIME_SCALING_MAX = 15;

/** Documented upscale factors — "Supported upscale factors are 2, 3, and 4." */
export const REVE_UPSCALE_FACTORS = [2, 3, 4] as const;
export type ReveUpscaleFactor = (typeof REVE_UPSCALE_FACTORS)[number];

/** "The maximum value for each parameter is 4096." (fit_image) */
export const REVE_FIT_IMAGE_MAX_DIM = 4096;

/** Postprocessing `process` discriminators. */
export const REVE_POSTPROCESSING_PROCESSES = [
  "upscale",
  "remove_background",
  "fit_image",
  "effect",
] as const;
export type ReveProcess = (typeof REVE_POSTPROCESSING_PROCESSES)[number];

/** `[{ "process": "upscale", "upscale_factor": 2 }]` */
export interface ReveUpscaleOperation {
  process: "upscale";
  upscale_factor: ReveUpscaleFactor;
}

/** `[{ "process": "remove_background" }]` */
export interface ReveRemoveBackgroundOperation {
  process: "remove_background";
}

/**
 * `[{ "process": "fit_image", "max_dim": 512 }]` — at least one of
 * `max_dim` / `max_width` / `max_height`, each at most 4096. Free of charge.
 */
export interface ReveFitImageOperation {
  process: "fit_image";
  max_dim?: number;
  max_width?: number;
  max_height?: number;
}

/**
 * `[{ "process": "effect", "effect_name": "cmyk_halftone" }]` — names come
 * from `GET https://api.reve.com/v1/image/effect`, so unmodel cannot validate
 * them offline.
 */
export interface ReveEffectOperation {
  process: "effect";
  effect_name: string;
  /** Overrides in `{ filterId: { uniformId: value } }` form. */
  effect_parameters?: Record<string, unknown>;
}

export type RevePostprocessingOperation =
  | ReveUpscaleOperation
  | ReveRemoveBackgroundOperation
  | ReveFitImageOperation
  | ReveEffectOperation;

/**
 * Credit→USD conversion, documented on https://api.reve.com/console/pricing:
 * "The minimum purchase is $10 of credits (7,500 credits)". Every per-route
 * dollar figure the pricing page quotes follows from this rate (v1 Create 18
 * credits ≈ $0.024, Edit/Remix 30 ≈ $0.04, v2 Create 150 ≈ $0.20).
 */
export const REVE_USD_PER_CREDIT = 10 / 7500;

/** Converts a documented credit price to USD at the published top-up rate. */
export function reveCreditsToUSD(credits: number): number {
  return credits * REVE_USD_PER_CREDIT;
}

// ---------------------------------------------------------------------------
// Input-image limits (Documentation Overview → "Supported input image formats")
// ---------------------------------------------------------------------------

/** "A single image may be at most 40 MB" (binary MB, the safer reading). */
export const REVE_MAX_IMAGE_BYTES = 40 * 1024 * 1024;
/** "…and 33,554,432 pixels (for example 8192x4096)". */
export const REVE_MAX_IMAGE_PIXELS = 33_554_432;
/** "…with neither dimension exceeding 8192 pixels." */
export const REVE_MAX_IMAGE_DIMENSION = 8192;
/** "A single call may include at most 50,331,648 pixels … across all images." */
export const REVE_MAX_REQUEST_PIXELS = 50_331_648;
/** "…and 100 MB of image data (after base64 decoding) across all images." */
export const REVE_MAX_REQUEST_BYTES = 100 * 1024 * 1024;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Enforces Reve's per-image and per-request image limits against every inline
 * base64 image found in the params. Images passed as `ref` strings, URLs or
 * unsniffable formats (TIFF/AVIF) contribute nothing — nothing is guessed.
 */
export function checkImageBudget(
  ctx: PipelineContext,
  images: ReadonlyArray<{ path: Array<string | number>; data: unknown }>,
): void {
  let totalBytes = 0;
  let totalPixels = 0;

  for (const { path, data } of images) {
    if (typeof data !== "string") continue;
    const bytes = toBytes(data);
    if (bytes === undefined) continue;
    totalBytes += bytes.length;
    if (bytes.length > REVE_MAX_IMAGE_BYTES) {
      ctx.report({
        code: "media_too_large",
        path,
        message: `image is ${bytes.length} bytes after base64 decoding; Reve caps a single image at ${REVE_MAX_IMAGE_BYTES} bytes (40 MB).`,
        meta: { bytes: bytes.length, limit: REVE_MAX_IMAGE_BYTES, source: REVE_DOCS_URL },
      });
    }
    const sniffed = sniffImage(bytes);
    if (sniffed === undefined) continue;
    totalPixels += sniffed.width * sniffed.height;
    if (sniffed.width > REVE_MAX_IMAGE_DIMENSION || sniffed.height > REVE_MAX_IMAGE_DIMENSION) {
      ctx.report({
        code: "media_dimensions_exceeded",
        path,
        message: `image is ${sniffed.width}x${sniffed.height}; Reve caps each dimension at ${REVE_MAX_IMAGE_DIMENSION} pixels.`,
        meta: {
          width: sniffed.width,
          height: sniffed.height,
          maxWidth: REVE_MAX_IMAGE_DIMENSION,
          maxHeight: REVE_MAX_IMAGE_DIMENSION,
          source: REVE_DOCS_URL,
        },
      });
    }
    if (sniffed.width * sniffed.height > REVE_MAX_IMAGE_PIXELS) {
      ctx.report({
        code: "media_dimensions_exceeded",
        path,
        message: `image is ${sniffed.width}x${sniffed.height} (${sniffed.width * sniffed.height} pixels); Reve caps a single image at ${REVE_MAX_IMAGE_PIXELS} pixels.`,
        meta: {
          pixels: sniffed.width * sniffed.height,
          limit: REVE_MAX_IMAGE_PIXELS,
          source: REVE_DOCS_URL,
        },
      });
    }
  }

  if (totalBytes > REVE_MAX_REQUEST_BYTES) {
    ctx.report({
      code: "media_too_large",
      message: `the request carries ${totalBytes} bytes of image data after base64 decoding; Reve caps a single call at ${REVE_MAX_REQUEST_BYTES} bytes (100 MB) across all images.`,
      meta: { bytes: totalBytes, limit: REVE_MAX_REQUEST_BYTES, source: REVE_DOCS_URL },
    });
  }
  if (totalPixels > REVE_MAX_REQUEST_PIXELS) {
    ctx.report({
      code: "media_dimensions_exceeded",
      message: `the request carries ${totalPixels} image pixels; Reve caps a single call at ${REVE_MAX_REQUEST_PIXELS} pixels across all images.`,
      meta: { pixels: totalPixels, limit: REVE_MAX_REQUEST_PIXELS, source: REVE_DOCS_URL },
    });
  }
}

// ---------------------------------------------------------------------------
// Shared param checks
// ---------------------------------------------------------------------------

export function checkAspectRatio(
  ctx: PipelineContext,
  value: unknown,
  allowed: readonly string[],
  note = "",
): void {
  if (value == null) return;
  if (typeof value !== "string" || !allowed.includes(value)) {
    ctx.report({
      code: "invalid_enum_value",
      path: ["aspect_ratio"],
      message: `\`aspect_ratio\` must be one of ${allowed.map((v) => JSON.stringify(v)).join(", ")}; got ${JSON.stringify(value)}.${note}`,
      meta: { allowed: [...allowed], value, source: REVE_DOCS_URL },
    });
  }
}

export function checkVersion(
  ctx: PipelineContext,
  value: unknown,
  allowed: readonly string[],
): void {
  if (value == null) return;
  if (typeof value !== "string" || !allowed.includes(value)) {
    ctx.report({
      code: "invalid_enum_value",
      path: ["version"],
      message: `\`version\` must be one of ${allowed.map((v) => JSON.stringify(v)).join(", ")}; got ${JSON.stringify(value)}.`,
      meta: { allowed: [...allowed], value, source: REVE_DOCS_URL },
    });
  }
}

export function checkPromptLength(
  ctx: PipelineContext,
  path: Array<string | number>,
  value: unknown,
  maxLength: number,
): void {
  if (typeof value !== "string") return;
  if (value.length > maxLength) {
    ctx.report({
      code: "invalid_shape",
      path,
      message: `\`${path.join(".")}\` is ${value.length} characters; the maximum length is ${maxLength} (the API answers with error_code PROMPT_TOO_LONG).`,
      meta: { length: value.length, limit: maxLength, source: REVE_DOCS_URL },
    });
  }
}

/**
 * `test_time_scaling` is clamped server-side ("Values above 15 will be clamped
 * to 15. Values below 1 will be clamped to 1."), so an out-of-range value is a
 * warning — the request still succeeds, just not at the requested scaling.
 */
export function checkTestTimeScaling(ctx: PipelineContext, value: unknown): void {
  if (value == null) return;
  if (typeof value !== "number" || Number.isNaN(value)) {
    ctx.report({
      code: "invalid_shape",
      path: ["test_time_scaling"],
      message: `\`test_time_scaling\` must be a number between ${REVE_TEST_TIME_SCALING_MIN} and ${REVE_TEST_TIME_SCALING_MAX}; got ${JSON.stringify(value)}.`,
      meta: { source: REVE_DOCS_URL },
    });
    return;
  }
  if (value < REVE_TEST_TIME_SCALING_MIN || value > REVE_TEST_TIME_SCALING_MAX) {
    ctx.report({
      code: "invalid_shape",
      severity: "warning",
      path: ["test_time_scaling"],
      message: `\`test_time_scaling\` accepts ${REVE_TEST_TIME_SCALING_MIN}–${REVE_TEST_TIME_SCALING_MAX}; ${value} is clamped to ${value < REVE_TEST_TIME_SCALING_MIN ? REVE_TEST_TIME_SCALING_MIN : REVE_TEST_TIME_SCALING_MAX} by the API.`,
      meta: {
        min: REVE_TEST_TIME_SCALING_MIN,
        max: REVE_TEST_TIME_SCALING_MAX,
        value,
        source: REVE_DOCS_URL,
      },
    });
  }
}

/** Validates the `postprocessing` array's operation shapes. */
export function checkPostprocessing(ctx: PipelineContext, value: unknown): void {
  if (value == null) return;
  if (!Array.isArray(value)) {
    ctx.report({
      code: "invalid_shape",
      path: ["postprocessing"],
      message: "`postprocessing` must be an array of operation objects.",
      meta: { source: REVE_DOCS_URL },
    });
    return;
  }
  value.forEach((operation, i) => {
    const path = ["postprocessing", i];
    if (!isRecord(operation)) {
      ctx.report({
        code: "invalid_shape",
        path,
        message: "each `postprocessing` entry must be an object with a `process` field.",
        meta: { source: REVE_DOCS_URL },
      });
      return;
    }
    const process = operation.process;
    if (
      typeof process !== "string" ||
      !(REVE_POSTPROCESSING_PROCESSES as readonly string[]).includes(process)
    ) {
      ctx.report({
        code: "invalid_enum_value",
        path: [...path, "process"],
        message: `\`process\` must be one of ${REVE_POSTPROCESSING_PROCESSES.map((v) => JSON.stringify(v)).join(", ")}; got ${JSON.stringify(process)}.`,
        meta: { allowed: [...REVE_POSTPROCESSING_PROCESSES], value: process, source: REVE_DOCS_URL },
      });
      return;
    }
    if (process === "upscale") {
      const factor = operation.upscale_factor;
      if (typeof factor !== "number" || !(REVE_UPSCALE_FACTORS as readonly number[]).includes(factor)) {
        ctx.report({
          code: "invalid_enum_value",
          path: [...path, "upscale_factor"],
          message: `\`upscale_factor\` must be one of ${REVE_UPSCALE_FACTORS.join(", ")}; got ${JSON.stringify(factor)}.`,
          meta: { allowed: [...REVE_UPSCALE_FACTORS], value: factor, source: REVE_DOCS_URL },
        });
      }
      return;
    }
    if (process === "fit_image") {
      const dims = ["max_dim", "max_width", "max_height"] as const;
      const provided = dims.filter((d) => operation[d] != null);
      if (provided.length === 0) {
        ctx.report({
          code: "invalid_shape",
          path,
          message:
            "`fit_image` requires at least one of `max_dim`, `max_width` or `max_height`.",
          meta: { source: REVE_DOCS_URL },
        });
      }
      for (const dim of provided) {
        const size = operation[dim];
        if (typeof size !== "number" || size < 1 || size > REVE_FIT_IMAGE_MAX_DIM) {
          ctx.report({
            code: "invalid_shape",
            path: [...path, dim],
            message: `\`${dim}\` must be between 1 and ${REVE_FIT_IMAGE_MAX_DIM}; got ${JSON.stringify(size)}.`,
            meta: { max: REVE_FIT_IMAGE_MAX_DIM, value: size, source: REVE_DOCS_URL },
          });
        }
      }
      return;
    }
    if (process === "effect" && typeof operation.effect_name !== "string") {
      ctx.report({
        code: "invalid_shape",
        path: [...path, "effect_name"],
        message:
          "`effect` requires an `effect_name` — list the names available to your project with GET https://api.reve.com/v1/image/effect.",
        meta: { source: REVE_DOCS_URL },
      });
    }
  });
}

/**
 * Worst-case cost for a Reve request: the route's documented credit price,
 * scaled by `test_time_scaling` ("Any value above 1 will add additional API
 * credits cost to the request in proportion to the scaling").
 *
 * Postprocessing surcharges are deliberately NOT included: upscale and
 * remove_background are billed per megapixel of the *output* ("variable (2 and
 * up)", ~$0.002/MP) which is unknowable before generation, and `fit_image` is
 * free. The response's `credits_used` field is authoritative either way.
 */
export function reveEstimateUSD(perImage: number | undefined, testTimeScaling: unknown): number | undefined {
  if (perImage === undefined) return undefined;
  const scaling =
    typeof testTimeScaling === "number" && Number.isFinite(testTimeScaling)
      ? Math.min(Math.max(testTimeScaling, REVE_TEST_TIME_SCALING_MIN), REVE_TEST_TIME_SCALING_MAX)
      : 1;
  return perImage * scaling;
}
