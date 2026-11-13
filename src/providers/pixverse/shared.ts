/**
 * Shared wire pieces for the PixVerse OpenAPI v2 routes
 * (`https://app-api.pixverse.ai/openapi/v2/...`), transcribed from the API
 * reference schemas on
 * https://docs.platform.pixverse.ai/text-to-video-13016634e0 and
 * /image-to-video-and-video-templates-13016633e0, plus the per-model columns
 * of /model-capability-map-2394982m0 — verified 2026-11-12.
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

/**
 * `aspect_ratio` values v6-max, v6 and c1 add on top of the legacy set. V6 Max:
 * the capability map's "Aspect Ratios" row reads "16:9 / 9:16 / 4:3 / 3:4 /
 * 1:1 / 2:3 / 3:2 / 21:9" in its column —
 * https://docs.platform.pixverse.ai/model-capability-map-2394982m0 (2026-11-12).
 */
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
 * `motion_mode`. Neither route's schema lists the field, but the API still
 * reads it: the error-details page documents "`MOTION_MODE_MODEL_UNSUPPORTED`
 * | The selected model does not support this motion mode."
 * (https://docs.platform.pixverse.ai/error-details-2490131m0, 2026-11-12). So
 * it is typed here rather than left to pass through as an unknown param.
 */
export const PIXVERSE_MOTION_MODES = ["normal", "fast"] as const;
export type PixverseMotionMode = (typeof PIXVERSE_MOTION_MODES)[number];

/** Documented text-to-video `prompt` ceiling: "prompt: type: string maxLength: 5000". */
export const PROMPT_MAX_CHARS = 5000;

/**
 * Documented image-to-video `prompt` ceiling: "prompt: type: string
 * description: Generation prompt. maxLength: 2048"
 * (https://docs.platform.pixverse.ai/image-to-video-and-video-templates-13016633e0,
 * 2026-11-12).
 */
export const IMAGE_PROMPT_MAX_CHARS = 2048;

/** Documented `seed` range. */
export const SEED_MIN = 0;
export const SEED_MAX = 2_147_483_647;

export const seedSchema = z.number().int().min(SEED_MIN).max(SEED_MAX);
export const promptSchema = z.string().max(PROMPT_MAX_CHARS);
export const imagePromptSchema = z.string().max(IMAGE_PROMPT_MAX_CHARS);

/**
 * Models that bill (and are documented) per second, with 1–15s durations.
 * V6 Max: the capability map's "Video Duration" row reads "1-15 seconds" in its
 * column (https://docs.platform.pixverse.ai/model-capability-map-2394982m0,
 * 2026-11-12), and the pricing page bills it in "Credits/s".
 */
export const PER_SECOND_MODELS = ["v6", "c1", "v6-max"] as const;

/**
 * Models that accept `generate_audio_switch`. V6 Max: the capability map
 * describes it as "Text-to-video and image-to-video with optional native
 * audio" and the pricing page prices "| V6 Max | On |" (both verified
 * 2026-11-12); the image-to-video field description names only "V5.5,
 * V5.6, V6, or C1", while its own `image_v6_minimum` example sends
 * `generate_audio_switch` with `model: v6-max`.
 */
export const AUDIO_SWITCH_MODELS = ["v5.5", "v5.6", "v6", "c1", "v6-max"] as const;

/**
 * Models that accept `generate_multi_clip_switch`. V6 Max is absent on the
 * strength of the image-to-video schema's `allOf` (the switch is `false` unless
 * `model` is `v5.5` or `v6`) and the text-to-video error example ("supported in
 * model v5.5, v6 only") — although that page's `text_v6_complete` example sends
 * the switch with `model: v6-max` (all verified 2026-11-12).
 */
export const MULTI_CLIP_MODELS = ["v5.5", "v6"] as const;

/**
 * Models that refuse `template_id`. The capability map's "Video Templates" row
 * reads "Not supported" for V6 Max and "Determined by the template" for C1,
 * V6, V5.6 and V5 (https://docs.platform.pixverse.ai/model-capability-map-2394982m0),
 * and the pricing page adds "V6 MAX (v6-max) Only support
 * text-to-video/image-to-video now"
 * (https://docs.platform.pixverse.ai/pixverse-api-pricing-2394995m0) — both
 * verified 2026-11-12. A deny list, because templates are the rule and V6 Max
 * is the exception.
 */
export const NO_TEMPLATE_MODELS = ["v6-max"] as const;

/** The models the capability map lists as template-capable, named by the refusal. */
const TEMPLATE_MODELS = ["c1", "v6", "v5.6", "v5"] as const;

/**
 * Models that accept the sound-effect and lip-sync fields ("v5 and below").
 * `lip_sync_switch` joins them on image-to-video: that schema declares it as a
 * "Legacy Lipsync option; applicable only when supported", and its 2026-05-14
 * archive read "Set to true if you want to enable this feature. Default is
 * false. (v3.5/v4/v4.5/v5)"
 * (https://web.archive.org/web/20260514194912/https://docs.platform.pixverse.ai/image-to-video-generation-13016633e0).
 *
 * On image-to-video a `template_id` lifts this gate, because the template, not
 * the model, decides what it accepts: the live schema reads "Legacy
 * sound-effect option; use only with a supporting model/template" and "Template
 * metadata determines supported model, duration, and quality; do not assume
 * every template accepts the same combination" (2026-11-12), and the same
 * 2026-05-14 archive read "only in v5 above or with template_id" for
 * `sound_effect_switch`. Text-to-video keeps the plain model gate: its
 * 2026-09-20 archive gives each field only "Supported in v5 models and below"
 * (https://web.archive.org/web/20260920044218/https://docs.platform.pixverse.ai/text-to-video-generation-13016634e0).
 */
export const LEGACY_AUDIO_MODELS = ["v5", "v4.5", "v4", "v3.5"] as const;

/**
 * Allowed `duration` values per model.
 *
 * "C1/V6: 1-15; V5.5/V5.6: 5, 8, or 10; older models: 5 or 8. Do not use
 * unsupported duration/quality combinations." — the image-to-video schema's
 * own `duration` description (2026-11-12); the capability map gives V6 Max
 * "1-15 seconds" too. v6-max/v6/c1 take any integer in the range, so they are
 * expressed as bounds instead of a value list.
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

/**
 * Quality × duration combinations the docs call out as unavailable. The live
 * image-to-video schema's `anyOf` carries `not` arms for `duration: 10` and
 * `duration: 8` at `quality: 1080p`, but neither names a model (2026-11-12), so
 * the model scoping comes from elsewhere. v5.5/v5.6: the pricing page marks
 * their "10 seconds" rows "Not supported" at 1080p (2026-11-12). v3.5: the
 * archived duration description reads "v.3.5/v4/v4.5 : 5/8 (v3.5 1080p cannot
 * use 8)"
 * (https://web.archive.org/web/20260514194912/https://docs.platform.pixverse.ai/image-to-video-generation-13016633e0;
 * the same text is in
 * https://web.archive.org/web/20260920044218/https://docs.platform.pixverse.ai/text-to-video-generation-13016634e0).
 */
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

/**
 * Enforces which models accept each version-gated switch.
 * `templateLiftsLegacyAudio` exempts a template task from the
 * {@link LEGACY_AUDIO_MODELS} gate — image-to-video's rule, sourced there.
 */
export function checkModelGatedFields<P extends { model: string }>(
  source: string,
  { templateLiftsLegacyAudio = false }: { templateLiftsLegacyAudio?: boolean } = {},
): (params: P, info: ModelInfo | undefined, ctx: PipelineContext) => void {
  const gates: ReadonlyArray<{
    fields: readonly string[];
    models: readonly string[];
    label: string;
    liftedByTemplate?: boolean;
  }> = [
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
        "lip_sync_switch",
        "lip_sync_tts_switch",
        "lip_sync_tts_content",
        "lip_sync_tts_speaker_id",
      ],
      models: LEGACY_AUDIO_MODELS,
      label: "the v5-and-below sound-effect / lip-sync fields",
      liftedByTemplate: templateLiftsLegacyAudio,
    },
  ];
  return (params, info, ctx) => {
    if (info === undefined) return;
    const record = params as Record<string, unknown>;
    for (const gate of gates) {
      if (gate.models.includes(params.model)) continue;
      if (gate.liftedByTemplate === true && record.template_id != null) continue;
      const available = gate.liftedByTemplate === true
        ? `${gate.models.join(", ")}, or with a \`template_id\``
        : gate.models.join(", ");
      for (const field of gate.fields) {
        // A switch sent as `false` is its documented default, so every model
        // takes it: the image-to-video `allOf` admits
        // `generate_multi_clip_switch: enum: [false]` with no model condition,
        // text-to-video declares both switches `default: false` (2026-11-12),
        // and the archives cited on LEGACY_AUDIO_MODELS read "Default is false"
        // for the legacy switches.
        if (record[field] == null || record[field] === false) continue;
        ctx.report({
          code: "unsupported_param",
          path: [field],
          model: params.model,
          message: `\`${field}\` is not supported by "${params.model}" — ${gate.label} is available on ${available}.`,
          meta: { source, supported: [...gate.models] },
        });
      }
    }
    const noTemplates: readonly string[] = NO_TEMPLATE_MODELS;
    if (record.template_id != null && noTemplates.includes(params.model)) {
      ctx.report({
        code: "unsupported_param",
        path: ["template_id"],
        model: params.model,
        message: `\`template_id\` is not supported by "${params.model}", which PixVerse serves for text-to-video and image-to-video only — video templates run on ${TEMPLATE_MODELS.join(", ")}.`,
        meta: { source },
      });
    }
  };
}
