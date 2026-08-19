/**
 * Shared wire pieces for the PixVerse OpenAPI v2 routes
 * (`https://app-api.pixverse.ai/openapi/v2/...`), transcribed from the API
 * reference schemas on
 * https://docs.platform.pixverse.ai/text-to-video-generation-13016634e0 and
 * /image-to-video-generation-13016633e0, plus the per-model matrices on
 * /v6-2056814m0 and /capability-matrix-2144288m0 — verified 2026-08-13.
 *
 * Headers: every request needs `API-KEY` (your key) and `Ai-trace-id` (a fresh
 * UUID per request) alongside `Content-Type`. Neither can live in
 * `.request.headers`: the first is a credential, which unmodel never touches,
 * and the second must be unique per call, so both are yours to add.
 *
 * Every generation route is asynchronous: it responds
 * `{ ErrCode, ErrMsg, Resp: { video_id } }`, and you poll
 * `GET /openapi/v2/video/result/{video_id}`.
 */

import { z } from "zod";
import type { PipelineContext } from "../../core/pipeline";
import type { ModelInfo } from "../../core/catalog-types";
import { JSON_HEADERS } from "../../core/request";

export const PIXVERSE_BASE_URL = "https://app-api.pixverse.ai/openapi/v2";

export const PIXVERSE_HEADERS: Record<string, string> = JSON_HEADERS;

/** `GET /openapi/v2/video/result/{video_id}` — poll a submitted generation. */
export function videoResultUrl(videoId: number | string): string {
  return `${PIXVERSE_BASE_URL}/video/result/${videoId}`;
}

/** `POST /openapi/v2/image/upload` — multipart upload returning an `img_id`. */
export const IMAGE_UPLOAD_URL = `${PIXVERSE_BASE_URL}/image/upload`;

export const DOCS_BASE = "https://docs.platform.pixverse.ai";

/** Documented `quality` values. */
export const PIXVERSE_QUALITIES = ["360p", "540p", "720p", "1080p"] as const;
export type PixverseQualityValue = (typeof PIXVERSE_QUALITIES)[number];

/** `aspect_ratio` values the pre-v6 models accept. */
export const LEGACY_ASPECT_RATIOS = ["16:9", "4:3", "1:1", "3:4", "9:16"] as const;

/** `aspect_ratio` values v6 and c1 add on top of the legacy set. */
export const WIDE_ASPECT_RATIOS = [
  "16:9",
  "4:3",
  "1:1",
  "3:4",
  "9:16",
  "2:3",
  "3:2",
  "21:9",
] as const;

export type PixverseAspectRatio = (typeof WIDE_ASPECT_RATIOS)[number];

/**
 * `motion_mode`. The field is absent from the JSON schema tables but is sent
 * uncommented in the official image-to-video request example and priced as a
 * column of the v4.5/v4/v3.5 credit table
 * (https://docs.platform.pixverse.ai/pricing-796039m0), so it is typed here
 * rather than left to pass through as an unknown param.
 */
export const PIXVERSE_MOTION_MODES = ["normal", "fast"] as const;
export type PixverseMotionMode = (typeof PIXVERSE_MOTION_MODES)[number];

/** Documented `prompt` ceiling. */
export const PROMPT_MAX_CHARS = 5000;

/** Documented `seed` range. */
export const SEED_MIN = 0;
export const SEED_MAX = 2_147_483_647;

export const seedSchema = z.number().int().min(SEED_MIN).max(SEED_MAX);
export const promptSchema = z.string().max(PROMPT_MAX_CHARS);

/** Models that bill (and are documented) per second, with 1–15s durations. */
export const PER_SECOND_MODELS = ["v6", "c1"] as const;

/** Models that accept `generate_audio_switch`. */
export const AUDIO_SWITCH_MODELS = ["v5.5", "v5.6", "v6", "c1"] as const;

/** Models that accept `generate_multi_clip_switch`. */
export const MULTI_CLIP_MODELS = ["v5.5", "v6"] as const;

/** Models that accept the sound-effect and lip-sync TTS fields ("v5 and below"). */
export const LEGACY_AUDIO_MODELS = ["v5", "v4.5", "v4", "v3.5"] as const;

/**
 * Allowed `duration` values per model.
 *
 * "v3.5/v4/v4.5 : 5/8 (v3.5 1080p cannot use 8); v5 : 5/8; v5.5/v5.6 : 5/8/10
 * (1080p cannot use 10); v6/c1 : 1~15" — the schema's own `duration`
 * description. v6/c1 take any integer in the range, so they are expressed as
 * bounds instead of a value list.
 */
export const DURATIONS: Readonly<Record<string, readonly number[]>> = {
  "v3.5": [5, 8],
  v4: [5, 8],
  "v4.5": [5, 8],
  v5: [5, 8],
  "v5.5": [5, 8, 10],
  "v5.6": [5, 8, 10],
};

export const PER_SECOND_DURATION = { min: 1, max: 15 } as const;

/** Quality × duration combinations the docs call out as unavailable. */
const QUALITY_DURATION_EXCLUSIONS: ReadonlyArray<{
  models: readonly string[];
  quality: string;
  duration: number;
  reason: string;
}> = [
  {
    models: ["v3.5"],
    quality: "1080p",
    duration: 8,
    reason: "v3.5 at 1080p cannot use an 8-second duration",
  },
  {
    models: ["v5.5", "v5.6"],
    quality: "1080p",
    duration: 10,
    reason: "v5.5 and v5.6 at 1080p cannot use a 10-second duration",
  },
];

interface DurationParams {
  model: string;
  duration?: number;
  quality?: string;
}

/** Enforces the per-model duration list/bounds and the quality exclusions. */
export function checkDuration<P extends DurationParams>(
  source: string,
): (params: P, info: ModelInfo | undefined, ctx: PipelineContext) => void {
  return (params, info, ctx) => {
    if (info === undefined) return;
    const { duration, model } = params;
    if (duration == null) return;
    if ((PER_SECOND_MODELS as readonly string[]).includes(model)) {
      if (duration < PER_SECOND_DURATION.min || duration > PER_SECOND_DURATION.max) {
        ctx.report({
          code: "invalid_enum_value",
          path: ["duration"],
          model,
          message: `\`duration\` must be between ${PER_SECOND_DURATION.min} and ${PER_SECOND_DURATION.max} seconds for "${model}"; got ${duration}.`,
          meta: { min: PER_SECOND_DURATION.min, max: PER_SECOND_DURATION.max, value: duration, source },
        });
      }
    } else {
      const allowed = DURATIONS[model];
      if (allowed !== undefined && !allowed.includes(duration)) {
        ctx.report({
          code: "invalid_enum_value",
          path: ["duration"],
          model,
          message: `\`duration\` must be one of ${allowed.join(", ")} seconds for "${model}"; got ${duration}.`,
          meta: { allowed: [...allowed], value: duration, source },
        });
      }
    }
    for (const rule of QUALITY_DURATION_EXCLUSIONS) {
      if (!rule.models.includes(model)) continue;
      if (params.quality !== rule.quality || duration !== rule.duration) continue;
      ctx.report({
        code: "invalid_enum_value",
        path: ["duration"],
        model,
        message: `${rule.reason}; got ${duration} at ${rule.quality}.`,
        meta: { value: duration, quality: rule.quality, source },
      });
    }
  };
}

/** Enforces which models accept each version-gated switch. */
export function checkModelGatedFields<P extends { model: string }>(
  source: string,
): (params: P, info: ModelInfo | undefined, ctx: PipelineContext) => void {
  const gates: ReadonlyArray<{ fields: readonly string[]; models: readonly string[]; label: string }> = [
    {
      fields: ["generate_audio_switch"],
      models: AUDIO_SWITCH_MODELS,
      label: "inline audio generation",
    },
    {
      fields: ["generate_multi_clip_switch"],
      models: MULTI_CLIP_MODELS,
      label: "inline multi-clip generation",
    },
    {
      fields: [
        "sound_effect_switch",
        "sound_effect_content",
        "lip_sync_tts_switch",
        "lip_sync_tts_content",
        "lip_sync_tts_speaker_id",
      ],
      models: LEGACY_AUDIO_MODELS,
      label: "the v5-and-below sound-effect / lip-sync TTS fields",
    },
  ];
  return (params, info, ctx) => {
    if (info === undefined) return;
    const record = params as Record<string, unknown>;
    for (const gate of gates) {
      if (gate.models.includes(params.model)) continue;
      for (const field of gate.fields) {
        if (record[field] == null) continue;
        ctx.report({
          code: "unsupported_param",
          path: [field],
          model: params.model,
          message: `\`${field}\` is not supported by "${params.model}" — ${gate.label} is available on ${gate.models.join(", ")}.`,
          meta: { source, supported: [...gate.models] },
        });
      }
    }
  };
}
