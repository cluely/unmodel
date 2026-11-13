/**
 * Shared wire pieces for the LTX API, transcribed from
 * https://docs.ltx.io/openapi.json (OpenAPI 3.1, server https://api.ltx.io)
 * plus the published support matrices on https://docs.ltx.io/models/ltx-2-5.md
 * and https://docs.ltx.io/models/ltx-2-3.md — verified 2026-11-12.
 */

import { z } from "zod";
import type { PipelineContext } from "../../core/pipeline";
import type { ModelInfo } from "../../core/catalog-types";
import { JSON_HEADERS } from "../../core/request";
import {
  LTX_RESOLUTIONS,
  LTX_RESOLUTION_GRID,
  resolutionTier,
  type LtxResolutionShape,
  type LtxResolutionTier,
} from "./pricing";

/** OpenAPI `servers[0].url`. Note: the docs live on docs.ltx.io. */
export const LTX_BASE_URL = "https://api.ltx.io";

export const LTX_HEADERS: Record<string, string> = JSON_HEADERS;

export const MODELS_SOURCE = "https://docs.ltx.io/models";
export const OPENAPI_SOURCE = "https://docs.ltx.io/openapi.json";

/**
 * The generation route for an endpoint: the async job API (`POST
 * /v2/<endpoint>` returns `{ id }`; poll `GET /v2/<endpoint>/{id}`). It is the
 * only generation API LTX serves — "The V1 video generation endpoints listed
 * below were retired on October 26, 2026 and return an error. Use the V2
 * endpoints instead." (https://docs.ltx.io/migrate-v1-to-v2.md, 2026-11-12).
 * Only the media upload route stays on `/v1/upload`.
 */
export function ltxUrl(endpoint: string): string {
  return `${LTX_BASE_URL}/v2/${endpoint}`;
}

/** Models with a text-to-video and an image-to-video arm (models.md). */
export const GENERATION_MODELS = [
  "ltx-2-5-fast",
  "ltx-2-5-pro",
  "ltx-2-3-fast",
  "ltx-2-3-pro",
] as const;

/** Models with an audio-to-video arm — `ltx-2-3-fast` has none. */
export const AUDIO_TO_VIDEO_MODELS = ["ltx-2-5-fast", "ltx-2-5-pro", "ltx-2-3-pro"] as const;

/** `camera_motion` enum, shared by text-, image- and audio-to-video. */
export const LTX_CAMERA_MOTIONS = [
  "dolly_in",
  "dolly_out",
  "dolly_left",
  "dolly_right",
  "jib_up",
  "jib_down",
  "static",
  "focus_shift",
] as const;

export type LtxCameraMotion = (typeof LTX_CAMERA_MOTIONS)[number];

/** Documented `resolution` values (`WIDTHxHEIGHT`). */
export { LTX_RESOLUTIONS };

/**
 * A `resolution`. The named presets are every value in the published tier
 * tables (720p/1080p/1440p/4k × 16:9, 9:16, 1:1, 3:2, 2:3) — what a given
 * model accepts is narrower still and is enforced by `checkSupportMatrix`. The
 * `${number}x${number}` tail is deliberate: a model id newer than
 * `SUPPORT_MATRIX` is not matrix-checked, so a closed union would over-narrow
 * it — but non-size strings are still a compile error.
 */
export type LtxResolution = (typeof LTX_RESOLUTIONS)[number] | (`${number}x${number}` & {});

/** Default frame rate when `fps` is omitted (OpenAPI `default: 24`). */
export const DEFAULT_FPS = 24;

/** Every `fps` value the published support matrices list. */
export const LTX_FPS_VALUES = [24, 25, 48, 50] as const;

/**
 * A frame rate. The named presets are the four values the support matrices
 * publish; which of them a model offers at a given resolution is enforced by
 * `checkSupportMatrix`. The `(number & {})` tail keeps model ids newer than
 * `SUPPORT_MATRIX` legal.
 */
export type LtxFps = (typeof LTX_FPS_VALUES)[number] | (number & {});

// ---------------------------------------------------------------------------
// Support matrix — resolution × fps × duration, per model.
//
// The OpenAPI schema types `resolution` as a bare string and `duration`/`fps`
// as bare integers; what a given model actually accepts is published only as
// the tables on the model pages, so it rides here and is enforced by
// `checkSupportMatrix`.
// ---------------------------------------------------------------------------

export interface MatrixRow {
  readonly tiers: readonly LtxResolutionTier[];
  readonly fps: readonly number[];
  readonly durations: readonly number[];
}

/** Long-form durations, available at 24/25fps on the "fast" variants. */
export const LONG_DURATIONS = [6, 8, 10, 12, 14, 16, 18, 20] as const;
/** The short window every model offers — a subset of {@link LONG_DURATIONS}. */
const SHORT_DURATIONS = [6, 8, 10] as const;

/**
 * A `duration` in seconds. The named presets are every value the published
 * matrices list (`LONG_DURATIONS`; `SHORT_DURATIONS` is a subset of it), and
 * which ones a model offers at a given resolution × fps is enforced by
 * `checkSupportMatrix`. The `(number & {})` tail keeps model ids newer than
 * `SUPPORT_MATRIX` legal.
 */
export type LtxDuration = (typeof LONG_DURATIONS)[number] | (number & {});

const FAST_MATRIX: readonly MatrixRow[] = [
  { tiers: ["720p", "1080p"], fps: [24, 25], durations: LONG_DURATIONS },
  { tiers: ["720p", "1080p"], fps: [48, 50], durations: SHORT_DURATIONS },
  { tiers: ["1440p", "4k"], fps: [24, 25, 48, 50], durations: SHORT_DURATIONS },
];

/** The pro row: every tier, every frame rate, the short window. */
const PRO_MATRIX: readonly MatrixRow[] = [
  { tiers: ["720p", "1080p", "1440p", "4k"], fps: [24, 25, 48, 50], durations: SHORT_DURATIONS },
];

/**
 * Per-model support matrices — https://docs.ltx.io/models/ltx-2-5.md and
 * https://docs.ltx.io/models/ltx-2-3.md. Every documented model id is keyed
 * here; a model absent from the table (an id newer than this file) is not
 * matrix-checked.
 */
export const SUPPORT_MATRIX: Readonly<Record<string, readonly MatrixRow[]>> = {
  "ltx-2-5-fast": FAST_MATRIX,
  "ltx-2-3-fast": FAST_MATRIX,
  // models/ltx-2-5.md, 2026-11-12: "| **ltx-2-5-pro** | 720p | 24, 25, 48, 50
  // | 6, 8, 10 |", and the same fps and durations at 1080p, 1440p and 4K.
  "ltx-2-5-pro": PRO_MATRIX,
  "ltx-2-3-pro": PRO_MATRIX,
};

const WIDESCREEN: readonly LtxResolutionShape[] = ["16:9", "9:16"];
const EVERY_SHAPE: readonly LtxResolutionShape[] = ["16:9", "9:16", "1:1", "3:2", "2:3"];

/**
 * The `resolution` shapes each model renders, at every tier it reaches. LTX-2.5
 * takes all five: "`ltx-2-5-fast` and `ltx-2-5-pro` now generate 1:1, 3:2, and
 * 2:3 video at every resolution from 720p to 4K, on text-to-video,
 * image-to-video, and audio-to-video." (https://docs.ltx.io/api-changelog/2026/10/12.md,
 * 2026-11-12). LTX-2.3's resolution table has only the "16:9 (landscape) |
 * 9:16 (portrait)" columns (https://docs.ltx.io/models/ltx-2-3.md).
 */
export const RESOLUTION_SHAPES: Readonly<Record<string, readonly LtxResolutionShape[]>> = {
  "ltx-2-5-fast": EVERY_SHAPE,
  "ltx-2-5-pro": EVERY_SHAPE,
  "ltx-2-3-fast": WIDESCREEN,
  "ltx-2-3-pro": WIDESCREEN,
};

/** Models whose `duration` may be `null` ("automatic duration"). */
export const AUTOMATIC_DURATION_MODELS = ["ltx-2-5-fast", "ltx-2-5-pro"] as const;

interface MatrixParams {
  model: string;
  resolution?: string;
  /**
   * Names the resolution in fps/duration issues when `resolution` only stands
   * in for its tier (a server default the request cannot pin down). When set,
   * issue `meta` carries `tier` in place of `resolution`.
   */
  resolutionLabel?: string;
  fps?: number;
  duration?: number | null;
}

function unique(values: readonly number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

/**
 * Enforces the published resolution × fps × duration matrix for a model, and
 * the shapes it renders at those tiers. Unknown models and models with no
 * published matrix are skipped.
 */
export function checkSupportMatrix<P extends MatrixParams>(
  params: P,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (info === undefined) return;
  const rows = SUPPORT_MATRIX[params.model];
  const shapes = RESOLUTION_SHAPES[params.model];
  if (rows === undefined || shapes === undefined) return;
  const model = params.model;
  const source = MODELS_SOURCE;

  const { resolution } = params;
  if (resolution === undefined) return;
  const tier = resolutionTier(resolution);
  const tiers = [...new Set(rows.flatMap((row) => row.tiers))];
  const allowedResolutions: string[] = tiers.flatMap((t) =>
    shapes.map((shape) => LTX_RESOLUTION_GRID[t][shape]),
  );
  if (tier === undefined || !allowedResolutions.includes(resolution)) {
    ctx.report({
      code: "invalid_enum_value",
      path: ["resolution"],
      model,
      message: `\`resolution\` must be one of ${allowedResolutions.map((v) => JSON.stringify(v)).join(", ")} for "${model}"; got ${JSON.stringify(resolution)}.`,
      meta: { allowed: allowedResolutions, value: resolution, source },
    });
    return;
  }

  const tierRows = rows.filter((row) => row.tiers.includes(tier));
  const resolutionText = params.resolutionLabel ?? resolution;
  const resolutionMeta = params.resolutionLabel === undefined ? { resolution } : { tier };
  const fps = params.fps ?? DEFAULT_FPS;
  const allowedFps = unique(tierRows.flatMap((row) => [...row.fps]));
  if (!allowedFps.includes(fps)) {
    ctx.report({
      code: "invalid_enum_value",
      path: ["fps"],
      model,
      message: `\`fps\` must be one of ${allowedFps.join(", ")} at ${resolutionText} for "${model}"; got ${fps}.`,
      meta: { allowed: allowedFps, value: fps, ...resolutionMeta, source },
    });
    return;
  }

  const { duration } = params;
  if (duration === null) {
    if (!(AUTOMATIC_DURATION_MODELS as readonly string[]).includes(model)) {
      ctx.report({
        code: "unsupported_capability",
        path: ["duration"],
        model,
        message: `\`duration: null\` (automatic duration) is only available on ${AUTOMATIC_DURATION_MODELS.join(", ")}; "${model}" needs an explicit duration.`,
        meta: { source: "https://docs.ltx.io/models/ltx-2-5#automatic-duration" },
      });
    }
    return;
  }
  if (duration === undefined) return;
  const allowedDurations = unique(
    tierRows.filter((row) => row.fps.includes(fps)).flatMap((row) => [...row.durations]),
  );
  if (!allowedDurations.includes(duration)) {
    ctx.report({
      code: "invalid_enum_value",
      path: ["duration"],
      model,
      message: `\`duration\` must be one of ${allowedDurations.join(", ")} seconds at ${resolutionText}/${fps}fps for "${model}"; got ${duration}.`,
      meta: {
        allowed: allowedDurations,
        value: duration,
        ...resolutionMeta,
        fps,
        source,
      },
    });
  }
}

/**
 * Reports models that have no arm on this route. The catalog is provider-wide
 * (a model is "known"), but audio-to-video, retake, extend and reframe accept
 * only a subset.
 */
export function checkRouteSupport<P extends { model?: string }>(
  route: string,
  supported: readonly string[],
  hint: string,
): (params: P, info: ModelInfo | undefined, ctx: PipelineContext) => void {
  return (params, info, ctx) => {
    if (info === undefined || params.model === undefined) return;
    if (supported.includes(params.model)) return;
    ctx.report({
      code: "unsupported_capability",
      path: ["model"],
      model: params.model,
      message: `Model "${params.model}" has no ${route} arm in the LTX API — ${hint}`,
      meta: { source: MODELS_SOURCE, supported: [...supported] },
    });
  };
}

/**
 * An `image_uri` / `video_uri` / `audio_uri`: an HTTPS URL, a base64 data URI,
 * or a `storage_uri` returned by `POST /v1/upload`
 * (https://docs.ltx.io/input-formats.md). The spec types them as bare
 * strings, so unmodel only rejects the empty string.
 */
export const uriSchema = z.string().min(1);
