/**
 * Shared wire pieces for the LTX API, transcribed from
 * https://docs.ltx.io/openapi.json (OpenAPI 3.1, server https://api.ltx.io)
 * plus the published support matrices on https://docs.ltx.io/models/ltx-2-5.md,
 * https://docs.ltx.io/models/ltx-2-3.md and, for the deprecated LTX-2 pair,
 * https://docs.ltx.io/ltx-2-deprecation.md — verified 2026-08-13.
 */

import { z } from "zod";
import type { PipelineContext } from "../../core/pipeline";
import type { ModelInfo } from "../../core/catalog-types";
import { JSON_HEADERS } from "../../core/request";
import {
  LTX_RESOLUTIONS,
  LTX_RESOLUTION_TIERS,
  resolutionTier,
  type LtxResolutionTier,
} from "./pricing";

/** OpenAPI `servers[0].url`. Note: the docs live on docs.ltx.io. */
export const LTX_BASE_URL = "https://api.ltx.io";

export const LTX_HEADERS: Record<string, string> = JSON_HEADERS;

export const MODELS_SOURCE = "https://docs.ltx.io/models";
export const OPENAPI_SOURCE = "https://docs.ltx.io/openapi.json";

/**
 * The two API generations. `v2` is the async job API (`POST /v2/<endpoint>`
 * returns `{ id }`; poll `GET /v2/<endpoint>/{id}`); `v1` is the synchronous
 * one. The request bodies are identical — only the path prefix differs — so
 * `api_version` is not a wire field: it is stripped from the body and only
 * selects `.request.url`.
 */
export const LTX_API_VERSIONS = ["v1", "v2"] as const;
export type LtxApiVersion = (typeof LTX_API_VERSIONS)[number];

export const DEFAULT_API_VERSION: LtxApiVersion = "v2";

export function ltxUrl(endpoint: string, apiVersion: LtxApiVersion = DEFAULT_API_VERSION): string {
  return `${LTX_BASE_URL}/${apiVersion}/${endpoint}`;
}

/** Models with a text-to-video and an image-to-video arm (models.md). */
export const GENERATION_MODELS = [
  "ltx-2-5-fast",
  "ltx-2-5-pro",
  "ltx-2-3-fast",
  "ltx-2-3-pro",
  "ltx-2-fast",
  "ltx-2-pro",
] as const;

/** Models with an audio-to-video arm — `ltx-2-3-fast` has none. */
export const AUDIO_TO_VIDEO_MODELS = [
  "ltx-2-5-fast",
  "ltx-2-5-pro",
  "ltx-2-3-pro",
  "ltx-2-pro",
] as const;

/** `camera_motion` enum, shared by text-to-video and image-to-video. */
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
 * tables (720p/1080p/1440p/4k, landscape and portrait) — what a given model
 * accepts is narrower still and is enforced by `checkSupportMatrix`. The
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

/** ltx-2-3-pro's row: every tier, every frame rate, the short window. */
const PRO_2_3_MATRIX: readonly MatrixRow[] = [
  { tiers: ["720p", "1080p", "1440p", "4k"], fps: [24, 25, 48, 50], durations: SHORT_DURATIONS },
];

/**
 * The deprecated LTX-2 pair. Its matrix is no longer on the models page but IS
 * published on https://docs.ltx.io/ltx-2-deprecation.md ("LTX-2 support
 * matrix … supported by LTX-2 until it is removed"), verified 2026-08-13:
 *
 *   ltx-2-fast  1080p@25 → 6,8,10,12,14,16,18,20 · 1080p@50 → 6,8,10
 *               1440p@25,50 → 6,8,10 · 4K@25,50 → 6,8,10
 *   ltx-2-pro   1080p/1440p/4K @25,50 → 6,8,10
 *   "Aspect ratio: 16:9 (landscape) only."
 *
 * That table is NARROWER than what the API accepts today: the same page states
 * LTX-2 "has been deprecated … Requests that specify an LTX-2 model are now
 * automatically served by LTX-2.3", so 720p and the 24/48fps rates its
 * replacement offers go through as well. Enforcing the LTX-2 table literally
 * would therefore reject requests the API fulfils — most obviously any request
 * that omits `fps` (OpenAPI `default: 24`, absent from the LTX-2 table). So we
 * enforce the UNION, which is exactly the replacement model's matrix
 * (`ltx-2-fast` → `ltx-2-3-fast`, `ltx-2-pro` → `ltx-2-3-pro`, per the
 * migration table on the same page). `duration` is bounded either way, which
 * is the point: before this, a required field on these ids took any number.
 */
const LTX_2_FAST_MATRIX = FAST_MATRIX;
const LTX_2_PRO_MATRIX = PRO_2_3_MATRIX;

/**
 * Per-model support matrices — https://docs.ltx.io/models/ltx-2-5.md,
 * https://docs.ltx.io/models/ltx-2-3.md and, for the deprecated LTX-2 pair,
 * https://docs.ltx.io/ltx-2-deprecation.md. Every documented model id is
 * keyed here; a model absent from the table (an id newer than this file) is
 * not matrix-checked.
 */
export const SUPPORT_MATRIX: Readonly<Record<string, readonly MatrixRow[]>> = {
  "ltx-2-5-fast": FAST_MATRIX,
  "ltx-2-3-fast": FAST_MATRIX,
  // Pro tops out at 10s everywhere; ltx-2-5-pro also tops out at 1080p and
  // does not offer 48fps (its table lists 24, 25, 50).
  "ltx-2-5-pro": [{ tiers: ["720p", "1080p"], fps: [24, 25, 50], durations: SHORT_DURATIONS }],
  "ltx-2-3-pro": PRO_2_3_MATRIX,
  "ltx-2-fast": LTX_2_FAST_MATRIX,
  "ltx-2-pro": LTX_2_PRO_MATRIX,
};

/** Deprecation notice carrying the LTX-2 support matrix. */
export const LTX_2_DEPRECATION_SOURCE = "https://docs.ltx.io/ltx-2-deprecation";

/** Models whose `duration` may be `null` ("automatic duration"). */
export const AUTOMATIC_DURATION_MODELS = ["ltx-2-5-fast", "ltx-2-5-pro"] as const;

interface MatrixParams {
  model: string;
  resolution?: string;
  fps?: number;
  duration?: number | null;
}

function unique(values: readonly number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

/** Page publishing the matrix a model is checked against. */
function matrixSource(model: string): string {
  return model === "ltx-2-fast" || model === "ltx-2-pro" ? LTX_2_DEPRECATION_SOURCE : MODELS_SOURCE;
}

/**
 * Enforces the published resolution × fps × duration matrix for a model.
 * Unknown models and models with no published matrix are skipped.
 */
export function checkSupportMatrix<P extends MatrixParams>(
  params: P,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (info === undefined) return;
  const rows = SUPPORT_MATRIX[params.model];
  if (rows === undefined) return;
  const model = params.model;
  const source = matrixSource(model);

  const { resolution } = params;
  if (resolution === undefined) return;
  const tier = resolutionTier(resolution);
  const allowedResolutions = rows.flatMap((row) =>
    row.tiers.flatMap((t) => [...LTX_RESOLUTION_TIERS[t]]),
  );
  if (tier === undefined || !rows.some((row) => row.tiers.includes(tier))) {
    ctx.report({
      code: "invalid_enum_value",
      path: ["resolution"],
      model,
      message: `\`resolution\` must be one of ${[...new Set(allowedResolutions)].map((v) => JSON.stringify(v)).join(", ")} for "${model}"; got ${JSON.stringify(resolution)}.`,
      meta: { allowed: [...new Set(allowedResolutions)], value: resolution, source },
    });
    return;
  }

  const tierRows = rows.filter((row) => row.tiers.includes(tier));
  const fps = params.fps ?? DEFAULT_FPS;
  const allowedFps = unique(tierRows.flatMap((row) => [...row.fps]));
  if (!allowedFps.includes(fps)) {
    ctx.report({
      code: "invalid_enum_value",
      path: ["fps"],
      model,
      message: `\`fps\` must be one of ${allowedFps.join(", ")} at ${resolution} for "${model}"; got ${fps}.`,
      meta: { allowed: allowedFps, value: fps, resolution, source },
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
      message: `\`duration\` must be one of ${allowedDurations.join(", ")} seconds at ${resolution}/${fps}fps for "${model}"; got ${duration}.`,
      meta: {
        allowed: allowedDurations,
        value: duration,
        resolution,
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
