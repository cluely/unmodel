/**
 * Shared wire pieces for Kling's `POST /v1/videos/*` routes, transcribed from
 * https://kling.ai/document-api/apiReference/model/textToVideo and
 * /apiReference/model/imageToVideo, with the per-model support columns taken
 * from https://kling.ai/document-api/guides/capability-map/video — verified
 * 2026-08-13.
 *
 * These routes take the model as a `model_name` BODY field (`kling-v3`,
 * `kling-v2-6`, …) and are the corroborated ones, so they back the PRIMARY
 * `kling.textToVideo` / `kling.imageToVideo` validators. "v1" here is the
 * route version (`/v1/videos/…`), not a quality judgement: the uncorroborated
 * path-addressed family in ./text-to-video.ts is the EXPERIMENTAL one.
 */

import { z } from "zod";
import type { PipelineContext } from "../../core/pipeline";
import type { ModelInfo } from "../../core/catalog-types";
import { DOCS_BASE, V1_PROMPT_MAX_CHARS, SHOT_PROMPT_MAX_CHARS, MAX_SHOTS } from "./shared";

export const CAPABILITY_MAP_SOURCE = `${DOCS_BASE}/guides/capability-map/video`;

/** Server-side default when `model_name` is omitted. */
export const DEFAULT_V1_MODEL = "kling-v1";

/** `shot_type`, required when `multi_shot` is true. */
export const KLING_SHOT_TYPES = ["customize", "intelligence"] as const;
export type KlingShotType = (typeof KLING_SHOT_TYPES)[number];

/** `camera_control.type`. Only `simple` takes a `config`. */
export const KLING_CAMERA_TYPES = [
  "simple",
  "down_back",
  "forward_up",
  "right_turn_forward",
  "left_turn_forward",
] as const;
export type KlingCameraType = (typeof KLING_CAMERA_TYPES)[number];

/** The six `camera_control.config` axes; each is −10…10 and only one may be non-zero. */
export const KLING_CAMERA_AXES = [
  "horizontal",
  "vertical",
  "pan",
  "tilt",
  "roll",
  "zoom",
] as const;

export const CAMERA_AXIS_MIN = -10;
export const CAMERA_AXIS_MAX = 10;

export interface KlingCameraConfig {
  /** −10…10; negative pans left, positive pans right. */
  horizontal?: number;
  /** −10…10; negative moves down, positive moves up. */
  vertical?: number;
  /** −10…10; rotation around the y-axis. */
  pan?: number;
  /** −10…10; rotation around the x-axis. */
  tilt?: number;
  /** −10…10; rotation around the z-axis. */
  roll?: number;
  /** −10…10; negative is a longer focal length, positive a wider field. */
  zoom?: number;
}

export interface KlingCameraControl {
  type?: KlingCameraType;
  /** Required when `type` is "simple"; must be omitted for the presets. */
  config?: KlingCameraConfig;
}

const axisSchema = z.number().min(CAMERA_AXIS_MIN).max(CAMERA_AXIS_MAX);

export const cameraControlSchema = z.looseObject({
  type: z.enum(KLING_CAMERA_TYPES).optional(),
  config: z
    .looseObject({
      horizontal: axisSchema.optional(),
      vertical: axisSchema.optional(),
      pan: axisSchema.optional(),
      tilt: axisSchema.optional(),
      roll: axisSchema.optional(),
      zoom: axisSchema.optional(),
    })
    .optional(),
});

/** One storyboard shot in `multi_prompt`. */
export interface KlingShot {
  index: number;
  /** Up to 512 characters. */
  prompt: string;
  /** Seconds, as a string on this API. At least 1; the shots must sum to `duration`. */
  duration: string;
}

export const multiPromptSchema = z.array(
  z.looseObject({
    index: z.number().int(),
    prompt: z.string().max(SHOT_PROMPT_MAX_CHARS),
    duration: z.string(),
  }),
);

export const v1PromptSchema = z.string().max(V1_PROMPT_MAX_CHARS);

export const watermarkInfoSchema = z.looseObject({ enabled: z.boolean().optional() });

export const elementListSchema = z.array(z.looseObject({ element_id: z.union([z.string(), z.number()]) }));

// ---------------------------------------------------------------------------
// Per-model support on the `/v1/videos/*` routes.
// ---------------------------------------------------------------------------

export interface V1ModelRules {
  /** Allowed `mode` values (std = 720P, pro = 1080P, 4k = 4K). */
  readonly modes: readonly string[];
  /** Allowed `duration` values, as the strings this API takes. */
  readonly durations: readonly string[];
  /** Whether the model supports native audio (`sound: "on"`). */
  readonly sound?: boolean;
  /** Whether the model supports `cfg_scale`. */
  readonly cfgScale?: boolean;
  /** Whether the model supports `camera_control`. */
  readonly cameraControl?: boolean;
  /** Whether the model supports multi-shot generation. */
  readonly multiShot?: boolean;
}

const FIVE_TEN = ["5", "10"] as const;
const THREE_TO_FIFTEEN = [
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "11",
  "12",
  "13",
  "14",
  "15",
] as const;
const THREE_TO_TEN = ["3", "4", "5", "6", "7", "8", "9", "10"] as const;

/**
 * `duration` on the `/v1/videos/*` routes — SECONDS AS A STRING. The union is
 * the widest documented range (kling-v3's 3–15s), of which the other two
 * documented ranges ("5"/"10" and 3–10s) are subsets, so it is autocomplete
 * over a space each model narrows further: `V1_MODEL_RULES` rejects at runtime
 * what a given `model_name` does not offer (most models take only "5" or "10").
 */
export type KlingV1Duration = (typeof THREE_TO_FIFTEEN)[number];

/**
 * Support per `model_name`, from the capability map's Generation Range /
 * Resolution columns and its Native Audio / Camera Control / Multi-shot rows.
 *
 * Note one documented discrepancy: the capability map gives `kling-v2-6` a
 * "3~10s" generation range while the current `POST /text-to-video/kling-2.6`
 * route offers only 5s and 10s. Each route is checked against its own source,
 * so the wider range applies here and the narrower one in ./text-to-video.ts.
 */
export const V1_MODEL_RULES: Readonly<Record<string, V1ModelRules>> = {
  "kling-v3": {
    modes: ["std", "pro", "4k"],
    durations: THREE_TO_FIFTEEN,
    sound: true,
    multiShot: true,
  },
  "kling-v2-6": { modes: ["std", "pro"], durations: THREE_TO_TEN, sound: true },
  "kling-v2-5-turbo": { modes: ["std", "pro"], durations: FIVE_TEN },
  // Master models are 1080P-only on the capability map.
  "kling-v2-1-master": { modes: ["pro"], durations: FIVE_TEN },
  "kling-v2-1": { modes: ["std", "pro"], durations: FIVE_TEN },
  "kling-v2-master": { modes: ["pro"], durations: FIVE_TEN },
  "kling-v1-6": { modes: ["std", "pro"], durations: FIVE_TEN, cfgScale: true },
  "kling-v1-5": { modes: ["std", "pro"], durations: FIVE_TEN, cfgScale: true },
  "kling-v1": {
    modes: ["std", "pro"],
    durations: FIVE_TEN,
    cfgScale: true,
    // "Only supports 720P and 5s duration" — the capability map's tooltip.
    cameraControl: true,
  },
};

interface V1Params {
  model_name?: string;
  mode?: string;
  duration?: string;
  sound?: string;
  cfg_scale?: number;
  camera_control?: KlingCameraControl;
  multi_shot?: boolean;
  shot_type?: string;
  multi_prompt?: readonly unknown[];
  prompt?: string;
}

/**
 * Enforces the per-model support table: route membership, `mode` and
 * `duration` values, and the four capability switches
 * (`sound`, `cfg_scale`, `camera_control`, `multi_shot`).
 */
export function checkV1Support<P extends V1Params>(
  route: string,
  supported: readonly string[],
  source: string,
): (params: P, info: ModelInfo | undefined, ctx: PipelineContext) => void {
  return (params, info, ctx) => {
    if (info === undefined) return;
    const model = params.model_name ?? DEFAULT_V1_MODEL;
    if (!supported.includes(model)) {
      ctx.report({
        code: "unsupported_capability",
        path: ["model_name"],
        model,
        message: `Model "${model}" has no ${route} arm — that route accepts ${supported.join(", ")}.`,
        meta: { source, supported: [...supported] },
      });
      return;
    }
    const rules = V1_MODEL_RULES[model];
    if (rules === undefined) return;

    if (params.mode != null && !rules.modes.includes(params.mode)) {
      ctx.report({
        code: "invalid_enum_value",
        path: ["mode"],
        model,
        message: `\`mode\` must be one of ${rules.modes.map((v) => JSON.stringify(v)).join(", ")} for "${model}"; got ${JSON.stringify(params.mode)}.`,
        meta: { allowed: [...rules.modes], value: params.mode, source: CAPABILITY_MAP_SOURCE },
      });
    }
    if (params.duration != null && !rules.durations.includes(params.duration)) {
      ctx.report({
        code: "invalid_enum_value",
        path: ["duration"],
        model,
        message: `\`duration\` must be one of ${rules.durations.map((v) => JSON.stringify(v)).join(", ")} for "${model}"; got ${JSON.stringify(params.duration)}.`,
        meta: {
          allowed: [...rules.durations],
          value: params.duration,
          source: CAPABILITY_MAP_SOURCE,
        },
      });
    }

    const switches: ReadonlyArray<[keyof V1ModelRules, string, unknown, string]> = [
      ["sound", "sound", params.sound === "on" ? true : undefined, "native audio"],
      ["cfgScale", "cfg_scale", params.cfg_scale, "`cfg_scale`"],
      ["cameraControl", "camera_control", params.camera_control, "camera control"],
      ["multiShot", "multi_shot", params.multi_shot === true ? true : undefined, "multi-shot generation"],
    ];
    for (const [key, field, value, label] of switches) {
      if (value == null || rules[key] === true) continue;
      ctx.report({
        code: "unsupported_capability",
        path: [field],
        model,
        message: `${label} is not supported by "${model}" — see the capability map.`,
        meta: { source: CAPABILITY_MAP_SOURCE },
      });
    }
  };
}

/**
 * Enforces the `multi_shot` / `shot_type` / `multi_prompt` / `prompt` pairing
 * rules and the camera-control shape rules, which are wire-level and
 * model-independent.
 */
export function checkV1Shape<P extends V1Params>(
  source: string,
): (params: P, info: ModelInfo | undefined, ctx: PipelineContext) => void {
  return (params, _info, ctx) => {
    const multiShot = params.multi_shot === true;
    if (multiShot && params.shot_type == null) {
      ctx.report({
        code: "invalid_shape",
        path: ["shot_type"],
        message: "`shot_type` is required when `multi_shot` is true.",
        meta: { source },
      });
    }
    if (multiShot && params.shot_type === "customize" && params.multi_prompt == null) {
      ctx.report({
        code: "invalid_shape",
        path: ["multi_prompt"],
        message: "`multi_prompt` is required when `multi_shot` is true and `shot_type` is customize.",
        meta: { source },
      });
    }
    if (
      (!multiShot || params.shot_type === "intelligence") &&
      (params.prompt == null || params.prompt === "")
    ) {
      ctx.report({
        code: "invalid_shape",
        path: ["prompt"],
        message:
          "`prompt` must not be empty when `multi_shot` is false or `shot_type` is intelligence.",
        meta: { source },
      });
    }
    if (Array.isArray(params.multi_prompt) && params.multi_prompt.length > MAX_SHOTS) {
      ctx.report({
        code: "invalid_shape",
        path: ["multi_prompt"],
        message: `\`multi_prompt\` supports up to ${MAX_SHOTS} storyboards; got ${params.multi_prompt.length}.`,
        meta: { max: MAX_SHOTS, count: params.multi_prompt.length, source },
      });
    }

    const camera = params.camera_control;
    if (camera == null) return;
    if (camera.type === "simple") {
      if (camera.config == null) {
        ctx.report({
          code: "invalid_shape",
          path: ["camera_control", "config"],
          message: "`camera_control.config` is required when `camera_control.type` is simple.",
          meta: { source },
        });
        return;
      }
      const nonZero = KLING_CAMERA_AXES.filter((axis) => {
        const value = camera.config?.[axis];
        return typeof value === "number" && value !== 0;
      });
      if (nonZero.length > 1) {
        ctx.report({
          code: "invalid_shape",
          path: ["camera_control", "config"],
          message: `exactly one \`camera_control.config\` axis may be non-zero; got ${nonZero.join(", ")}.`,
          meta: { axes: nonZero, source },
        });
      }
      return;
    }
    if (camera.type != null && camera.config != null) {
      ctx.report({
        code: "unsupported_param",
        path: ["camera_control", "config"],
        message: `\`camera_control.config\` must be omitted when \`camera_control.type\` is "${camera.type}".`,
        meta: { source },
      });
    }
  };
}
