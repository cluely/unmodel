/**
 * Shared wire pieces for the Runway generation routes. Base URL, required
 * version header, and schema fragments verified against
 * https://docs.dev.runwayml.com/openapi.json (spec version 2024-11-06) and
 * @runwayml/sdk on 2026-08-13.
 */

import { z } from "zod";
import type { PipelineContext } from "../../core/pipeline";
import type { ModelInfo } from "../../core/catalog-types";
import { JSON_HEADERS } from "../../core/request";

export const RUNWAY_BASE_URL = "https://api.dev.runwayml.com";

/**
 * Required `X-Runway-Version` header value. "Every request must include an
 * X-Runway-Version header" — https://docs.dev.runwayml.com/llms.txt; the
 * current version (also the @runwayml/sdk default) is 2024-11-06.
 */
export const RUNWAY_VERSION = "2024-11-06";

/** Frozen so any accidental by-reference mutation fails loudly in dev. */
export const RUNWAY_HEADERS: Record<string, string> = Object.freeze({
  ...JSON_HEADERS,
  "x-runway-version": RUNWAY_VERSION,
});

// ---------------------------------------------------------------------------
// Wire types shared across routes
// ---------------------------------------------------------------------------

/**
 * One prompt image: a HTTPS URL, Runway upload URI, or base64 data URI (up
 * to 5MB). `position` "first"/"last" pins it to a keyframe; models that
 * support reference mode allow omitting it. `"middle"` is `kling_4`'s alone
 * ("an array with exactly one `first` frame, up to 8 `middle` frames in array
 * order, and an optional `last` frame" — assets/inputs.md, 2026-11-12). Which
 * positions a given model accepts — and whether `position` is required at
 * all — is narrowed per model by the shape-rules tables in ./constraints.ts.
 */
export interface RunwayPromptImage {
  uri: string;
  position?: "first" | "middle" | "last";
}

/** An audio reference (HTTPS URL, Runway upload URI, or data URI, ≤16MB). */
export interface RunwayAudioReference {
  type: "audio";
  uri: string;
}

/**
 * A video reference (HTTPS URL, Runway upload URI, or data URI, ≤16MB).
 *
 * `type: "video"` is required by the seedance / hailuo3 / wan3 arms and is
 * not a field at all on the `kling_4_flash` and `gemini_omni_flash_1.x` arms,
 * whose items are a bare `{ uri }` (openapi.json, 2026-11-12) — the
 * shape-rules tables say which.
 */
export interface RunwayVideoReference {
  type?: "video";
  uri: string;
}

/** An image reference for text_to_video `references` arrays. */
export interface RunwayImageReference {
  uri: string;
}

/**
 * An image reference on the Kling O3 arms (image_to_video, video_to_video),
 * whose `references` takes the PromptImages shape: "Use position
 * \"first\"/\"last\" for keyframe mode, or omit position for reference
 * images. The two modes cannot be mixed." (openapi.json, 2026-11-12).
 */
export interface RunwayPositionedReference {
  uri: string;
  position?: "first" | "last";
}

/**
 * Kling 3.0 / O3 multishot settings. `keepOriginalSound` exists only on the
 * Kling O3 video_to_video arm ("`providerSettings.keepOriginalSound` defaults
 * to `true`" — assets/inputs.md, 2026-11-12); every other arm's object is
 * closed (`additionalProperties: false`), so it is refused there.
 */
export interface RunwayProviderSettings {
  /** 1–6 segments; their durations must total 3–15 seconds. */
  multiPrompt?: Array<{ prompt: string; duration: number }>;
  /** Defaults to `"customize"` when `multiPrompt` is provided. */
  shotType?: "intelligence" | "customize";
  /** Kling O3 video_to_video only. Defaults to true. */
  keepOriginalSound?: boolean;
}

export interface RunwayContentModeration {
  /**
   * `low` makes the moderation system less strict about recognizable
   * public figures.
   */
  publicFigureThreshold?: "auto" | "low";
}

// ---------------------------------------------------------------------------
// Media URI schemas
//
// Every `uri`/`videoUri`/`promptVideo`/`promptImage` string in the spec is the
// same three-way union: a HTTPS URL (≤2048 chars), a `runway://` upload URI
// (≤5000), or a `data:<kind>/...` base64 URI, all with minLength 13. The
// data-URI cap is the documented payload ceiling: 5MB for images, 16MB for
// audio and video. Anything else (`gs://`, `s3://`, a bare path) is rejected
// by the API, so unmodel rejects it too.
// https://docs.dev.runwayml.com/openapi.json (spec version 2024-11-06)
// ---------------------------------------------------------------------------

/**
 * Documented data-URI `maxLength` ceilings, in characters — the spec caps the
 * encoded string, which corresponds to its stated 5MB (image) and 16MB
 * (audio/video) payload limits.
 */
export const IMAGE_DATA_URI_MAX_LENGTH = 5_242_880;
export const AV_DATA_URI_MAX_LENGTH = 16_777_216;

const HTTPS_MAX = 2048;
const RUNWAY_URI_MAX = 5000;
const URI_MIN = 13;

function mediaUriSchema(kind: "image" | "audio" | "video", dataMaxLength: number): z.ZodType<string> {
  const label = `a HTTPS URL, a runway:// upload URI, or a data:${kind}/ base64 URI`;
  return z.string().superRefine((value, ctx) => {
    const fail = (message: string): void => {
      ctx.addIssue({ code: "custom", message });
    };
    if (value.length < URI_MIN) {
      fail(`must be ${label} (at least ${URI_MIN} characters)`);
      return;
    }
    if (value.startsWith("https://")) {
      if (value.length > HTTPS_MAX) fail(`HTTPS URIs must be at most ${HTTPS_MAX} characters`);
      return;
    }
    if (value.startsWith("runway://")) {
      if (value.length > RUNWAY_URI_MAX)
        fail(`runway:// URIs must be at most ${RUNWAY_URI_MAX} characters`);
      return;
    }
    if (value.startsWith(`data:${kind}/`)) {
      if (value.length > dataMaxLength)
        fail(`data:${kind}/ URIs must be at most ${dataMaxLength} characters`);
      return;
    }
    fail(`must be ${label}`);
  });
}

export const imageUriSchema = mediaUriSchema("image", IMAGE_DATA_URI_MAX_LENGTH);
export const audioUriSchema = mediaUriSchema("audio", AV_DATA_URI_MAX_LENGTH);
export const videoUriSchema = mediaUriSchema("video", AV_DATA_URI_MAX_LENGTH);

// ---------------------------------------------------------------------------
// Schema fragments (loose: unknown keys pass through with a warning)
// ---------------------------------------------------------------------------

export const promptImageSchema = z.union([
  imageUriSchema,
  z.array(
    z.looseObject({
      uri: imageUriSchema,
      position: z.enum(["first", "middle", "last"]).optional(),
    }),
  ),
]);

export const audioReferenceArraySchema = z.array(
  z.looseObject({ type: z.literal("audio"), uri: audioUriSchema }),
);

/** `type` is per arm (see {@link RunwayVideoReference}); the shape rules enforce it. */
export const videoReferenceArraySchema = z.array(
  z.looseObject({ type: z.literal("video").optional(), uri: videoUriSchema }),
);

export const imageReferenceArraySchema = z.array(z.looseObject({ uri: imageUriSchema }));

/**
 * `references` on image_to_video / video_to_video: the Kling O3 arms take the
 * PromptImages shape (a bare URI, or items with an optional first/last
 * `position`); every other arm takes an array of bare `{ uri }` items. The
 * shape rules (`referencesTakePromptImages`) say which.
 */
export const positionedReferencesSchema = z.union([
  imageUriSchema,
  z.array(
    z.looseObject({ uri: imageUriSchema, position: z.enum(["first", "last"]).optional() }),
  ),
]);

/** One `providerSettings.multiPrompt` segment — openapi.json, 2026-11-12. */
const multiPromptSegmentSchema = z.strictObject({
  prompt: z.string().min(3).max(512),
  duration: z.number().int().min(1).max(15),
});

/**
 * Kling 3.0 / O3 `providerSettings` on image_to_video and text_to_video.
 * Strict, because the spec closes the object (`additionalProperties: false`)
 * and `keepOriginalSound` — the video_to_video-only key — is otherwise the
 * one a caller would plausibly send here.
 */
export const providerSettingsSchema = z.strictObject({
  multiPrompt: z.array(multiPromptSegmentSchema).min(1).max(6).optional(),
  shotType: z.enum(["intelligence", "customize"]).optional(),
});

/** The video_to_video arm of the same object, which adds `keepOriginalSound`. */
export const editProviderSettingsSchema = providerSettingsSchema.extend({
  keepOriginalSound: z.boolean().optional(),
});

/** `cfgScale` (kling2.5_turbo_pro, kling3.0_*): "0-1; default `0.5`" — api.md, 2026-11-12. */
export const cfgScaleSchema = z.number().min(0).max(1);

/**
 * `duration`: an integer on most arms, or the string `"auto"` where the arm
 * declares `anyOf: [integer, const "auto"]` ("Use \"auto\" to let the model
 * choose a duration" — openapi.json, 2026-11-12). Which models take `"auto"`
 * is narrowed by each route's `enums.duration` table.
 */
export const videoDurationSchema = z.union([z.number(), z.literal("auto")]);

export const contentModerationSchema = z.looseObject({
  publicFigureThreshold: z.enum(["auto", "low"]).optional(),
});

export const seedSchema = z.number().int().min(0).max(4294967295);

// ---------------------------------------------------------------------------
// Required-params checker — the spec's per-model arms mark different fields
// required; the loose route schema can't, so a table-driven check does.
// ---------------------------------------------------------------------------

export function checkRequiredParams<P extends { model: string }>(
  table: Readonly<Partial<Record<string, readonly string[]>>>,
  source: string,
): (params: P, info: ModelInfo | undefined, ctx: PipelineContext) => void {
  return (params, info, ctx) => {
    if (info === undefined) return; // unknown model: skip model-dependent checks
    const required = table[params.model];
    if (required === undefined) return;
    const record = params as Record<string, unknown>;
    for (const param of required) {
      if (record[param] == null) {
        ctx.report({
          code: "invalid_shape",
          path: [param],
          model: params.model,
          message: `\`${param}\` is required for "${params.model}" on this endpoint.`,
          meta: { source },
        });
      }
    }
  };
}

/** Number of prompt images (string counts as one). */
export function promptImageCount(promptImage: string | readonly unknown[] | undefined): number {
  if (promptImage === undefined) return 0;
  return typeof promptImage === "string" ? 1 : promptImage.length;
}

// ---------------------------------------------------------------------------
// Per-model shape rules — the spec's arms narrow far more than a param's
// presence: each model caps `promptText` length, caps every reference array,
// fixes which `position` values a prompt image may carry, and (on
// text_to_image) which sub-fields a reference image may set. None of that fits
// `deny`/`enums`, so it rides a table checked here.
// ---------------------------------------------------------------------------

export interface ArrayLimit {
  readonly min?: number;
  readonly max?: number;
}

/**
 * The `position` values every arm but `kling_4` shares — the PromptImage
 * schema's `enum: ["first", "last"]` (openapi.json, 2026-11-12). A model whose
 * rules name no `promptImagePositions` gets these.
 */
const DEFAULT_PROMPT_IMAGE_POSITIONS: readonly string[] = ["first", "last"];

/**
 * One documented cross-field rule: when `if` holds, `then` must. Paths address
 * the wire body (`["providerSettings", "shotType"]`).
 *
 * A param is *present* when it is neither `null`/`undefined` nor an empty
 * array — an empty `references: []` asks for nothing, so it triggers nothing
 * and satisfies "absent".
 */
export interface PairingRule {
  readonly if:
    | { readonly path: readonly string[]; readonly values?: readonly unknown[] }
    /** `promptImage` is an array with at least one positioned (keyframe) entry. */
    | { readonly path: readonly ["promptImage"]; readonly positioned: true };
  readonly then:
    | { readonly path: readonly string[]; readonly absent: true }
    | { readonly path: readonly string[]; readonly present: true }
    /** One of `values`; `default` is the documented value an omission means. */
    | { readonly path: readonly string[]; readonly values: readonly unknown[]; readonly default?: unknown }
    | { readonly path: readonly string[]; readonly minItems: number }
    | { readonly path: readonly string[]; readonly maxItems: number }
    /** No `promptImage` entry may carry this position. */
    | { readonly path: readonly ["promptImage"]; readonly withoutPosition: string };
  /** The documented rule as one sentence — it is the error message. */
  readonly message: string;
  readonly source: string;
}

export interface ModelShapeRules {
  /** Documented `promptText` minLength/maxLength for this model's arm. */
  readonly promptText?: { readonly min: number; readonly max: number };
  /** minItems/maxItems per array-valued param. */
  readonly arrays?: Readonly<Record<string, ArrayLimit>>;
  /**
   * Allowed `position` values on promptImage items; omitted = `"first"` /
   * `"last"`, the PromptImage enum every arm but `kling_4` shares.
   */
  readonly promptImagePositions?: readonly string[];
  /** Whether promptImage items must carry a `position`. */
  readonly promptImagePositionRequired?: boolean;
  /** How many promptImage array entries may carry each position. */
  readonly promptImagePositionCounts?: {
    readonly counts: Readonly<Record<string, ArrayLimit>>;
    readonly source: string;
  };
  /** Keyframe (positioned) and reference (unpositioned) entries cannot be mixed. */
  readonly promptImageModesExclusive?: boolean;
  /**
   * This arm's `references` is the PromptImages shape — a bare URI, or items
   * with an optional first/last `position` (Kling O3). Elsewhere a capped
   * `references` is an array of `{ uri }` items, so a bare URI is refused.
   */
  readonly referencesTakePromptImages?: boolean;
  /**
   * Whether `referenceVideos` items must (`true`) or must not (`false`) carry
   * `type: "video"`; omitted = the arm does not constrain its items.
   */
  readonly referenceVideoTyped?: boolean;
  /** A cap on images counted across several params together (frames + references). */
  readonly imageBudget?: {
    readonly max: number;
    readonly params: readonly string[];
    readonly source: string;
  };
  /** Inclusive numeric bounds narrower than the route schema's (e.g. a 31-bit `seed`). */
  readonly numberRanges?: Readonly<Record<string, { readonly min: number; readonly max: number }>>;
  /** `providerSettings.multiPrompt` segment durations must total within this range. */
  readonly multiPromptSeconds?: { readonly min: number; readonly max: number };
  /** Sub-fields a `referenceImages` item may set beyond `uri`. */
  readonly referenceImageFields?: readonly string[];
  /** Documented cross-field rules. */
  readonly pairings?: readonly PairingRule[];
}

function arrayLength(value: unknown): number | undefined {
  if (Array.isArray(value)) return value.length;
  // promptImage accepts a bare URI string, which is exactly one image.
  if (typeof value === "string") return 1;
  return undefined;
}

function valueAt(record: Record<string, unknown>, path: readonly string[]): unknown {
  let current: unknown = record;
  for (const key of path) {
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function isPresent(value: unknown): boolean {
  return value != null && !(Array.isArray(value) && value.length === 0);
}

function positionOf(item: unknown): unknown {
  return typeof item === "object" && item !== null
    ? (item as Record<string, unknown>)["position"]
    : undefined;
}

export function checkShapeRules<P extends { model: string }>(
  table: Readonly<Partial<Record<string, ModelShapeRules>>>,
  source: string,
): (params: P, info: ModelInfo | undefined, ctx: PipelineContext) => void {
  return (params, info, ctx) => {
    if (info === undefined) return; // unknown model: skip model-dependent checks
    const rules = table[params.model];
    if (rules === undefined) return;
    const record = params as Record<string, unknown>;
    const model = params.model;

    const promptText = record["promptText"];
    if (rules.promptText !== undefined && typeof promptText === "string") {
      const { min, max } = rules.promptText;
      if (promptText.length > max || promptText.length < min) {
        ctx.report({
          code: "invalid_shape",
          path: ["promptText"],
          model,
          message: `\`promptText\` must be ${min}–${max} characters for "${model}"; got ${promptText.length}.`,
          meta: { min, max, length: promptText.length, source },
        });
      }
    }

    for (const [param, limit] of Object.entries(rules.arrays ?? {})) {
      const count = arrayLength(record[param]);
      if (count === undefined) continue;
      if (limit.max !== undefined && count > limit.max) {
        ctx.report({
          code: "invalid_shape",
          path: [param],
          model,
          message: `\`${param}\` accepts at most ${limit.max} item${limit.max === 1 ? "" : "s"} for "${model}"; got ${count}.`,
          meta: { max: limit.max, count, source },
        });
      }
      if (limit.min !== undefined && count < limit.min) {
        ctx.report({
          code: "invalid_shape",
          path: [param],
          model,
          message: `\`${param}\` requires at least ${limit.min} item${limit.min === 1 ? "" : "s"} for "${model}"; got ${count}.`,
          meta: { min: limit.min, count, source },
        });
      }
    }

    const promptImage = record["promptImage"];
    if (Array.isArray(promptImage)) {
      promptImage.forEach((item, index) => {
        if (typeof item !== "object" || item === null) return;
        const position = (item as Record<string, unknown>)["position"];
        if (position == null) {
          if (rules.promptImagePositionRequired === true) {
            ctx.report({
              code: "invalid_shape",
              path: ["promptImage", index, "position"],
              model,
              message: `\`position\` is required on every promptImage entry for "${model}".`,
              meta: { source },
            });
          }
          return;
        }
        const allowed = rules.promptImagePositions ?? DEFAULT_PROMPT_IMAGE_POSITIONS;
        if (!allowed.includes(position as string)) {
          ctx.report({
            code: "invalid_enum_value",
            path: ["promptImage", index, "position"],
            model,
            message: `promptImage \`position\` must be one of ${allowed.map((v) => JSON.stringify(v)).join(", ")} for "${model}"; got ${JSON.stringify(position)}.`,
            meta: { allowed: [...allowed], value: position, source },
          });
        }
      });
      checkPromptImageLayout(promptImage, rules, model, source, ctx);
    }

    checkReferenceForms(record, rules, model, source, ctx);

    if (rules.imageBudget !== undefined) {
      const { max, params: counted, source: budgetSource } = rules.imageBudget;
      const total = counted.reduce((sum, param) => sum + (arrayLength(record[param]) ?? 0), 0);
      if (total > max) {
        ctx.report({
          code: "invalid_shape",
          path: [counted.findLast((param) => isPresent(record[param])) ?? counted[0]!],
          model,
          message: `${counted.map((param) => `\`${param}\``).join(" and ")} together accept at most ${max} images for "${model}"; got ${total}.`,
          meta: { max, count: total, source: budgetSource },
        });
      }
    }

    for (const [param, range] of Object.entries(rules.numberRanges ?? {})) {
      const value = record[param];
      if (typeof value !== "number") continue;
      if (value < range.min || value > range.max) {
        ctx.report({
          code: "invalid_shape",
          path: [param],
          model,
          message: `\`${param}\` must be ${range.min}–${range.max} for "${model}"; got ${value}.`,
          meta: { min: range.min, max: range.max, value, source },
        });
      }
    }

    if (rules.multiPromptSeconds !== undefined) {
      const segments = valueAt(record, ["providerSettings", "multiPrompt"]);
      if (Array.isArray(segments) && segments.length > 0) {
        const total = segments.reduce<number>((sum, segment) => {
          const seconds = valueAt(segment as Record<string, unknown>, ["duration"]);
          return sum + (typeof seconds === "number" ? seconds : 0);
        }, 0);
        const { min, max } = rules.multiPromptSeconds;
        if (total < min || total > max) {
          ctx.report({
            code: "invalid_shape",
            path: ["providerSettings", "multiPrompt"],
            model,
            message: `\`providerSettings.multiPrompt\` segment durations must total ${min}–${max} seconds for "${model}"; got ${total}.`,
            meta: { min, max, total, source },
          });
        }
      }
    }

    for (const rule of rules.pairings ?? []) checkPairing(record, rule, model, ctx);

    const referenceImages = record["referenceImages"];
    if (Array.isArray(referenceImages) && rules.referenceImageFields !== undefined) {
      const allowed = rules.referenceImageFields;
      referenceImages.forEach((item, index) => {
        if (typeof item !== "object" || item === null) return;
        for (const key of Object.keys(item as Record<string, unknown>)) {
          if (key === "uri" || allowed.includes(key)) continue;
          if ((item as Record<string, unknown>)[key] == null) continue;
          ctx.report({
            code: "unsupported_param",
            path: ["referenceImages", index, key],
            model,
            message: `referenceImages \`${key}\` is not a field of "${model}"'s reference-image schema.`,
            meta: { source },
          });
        }
      });
    }
  };
}

/** Per-position counts and keyframe/reference mode mixing on a promptImage array. */
function checkPromptImageLayout(
  promptImage: readonly unknown[],
  rules: ModelShapeRules,
  model: string,
  source: string,
  ctx: PipelineContext,
): void {
  const layout = rules.promptImagePositionCounts;
  if (layout !== undefined) {
    for (const [position, limit] of Object.entries(layout.counts)) {
      const count = promptImage.filter((item) => positionOf(item) === position).length;
      const tooMany = limit.max !== undefined && count > limit.max;
      const tooFew = limit.min !== undefined && count < limit.min;
      if (!tooMany && !tooFew) continue;
      const bound = tooMany
        ? `at most ${limit.max}`
        : `at least ${limit.min}`;
      ctx.report({
        code: "invalid_shape",
        path: ["promptImage"],
        model,
        message: `promptImage takes ${bound} \`position: "${position}"\` entr${(tooMany ? limit.max : limit.min) === 1 ? "y" : "ies"} for "${model}"; got ${count}.`,
        meta: { position, ...limit, count, source: layout.source },
      });
    }
  }
  if (rules.promptImageModesExclusive === true) {
    const positioned = promptImage.filter((item) => positionOf(item) != null).length;
    if (positioned > 0 && positioned < promptImage.length) {
      ctx.report({
        code: "invalid_shape",
        path: ["promptImage"],
        model,
        message: `promptImage entries for "${model}" are either all keyframes (with \`position\`) or all references (without); the two modes cannot be mixed.`,
        meta: { source },
      });
    }
  }
}

/** The per-arm item shapes of `references` and `referenceVideos`. */
function checkReferenceForms(
  record: Record<string, unknown>,
  rules: ModelShapeRules,
  model: string,
  source: string,
  ctx: PipelineContext,
): void {
  const references = record["references"];
  if (
    typeof references === "string" &&
    rules.referencesTakePromptImages !== true &&
    rules.arrays?.["references"] !== undefined
  ) {
    ctx.report({
      code: "invalid_shape",
      path: ["references"],
      model,
      message: `\`references\` must be an array of \`{ uri }\` objects for "${model}"; a bare URI string is accepted only by the Kling O3 arms.`,
      meta: { source },
    });
  }

  const typed = rules.referenceVideoTyped;
  const videos = record["referenceVideos"];
  if (typed === undefined || !Array.isArray(videos)) return;
  videos.forEach((item, index) => {
    if (typeof item !== "object" || item === null) return;
    const type = (item as Record<string, unknown>)["type"];
    if (typed && type == null) {
      ctx.report({
        code: "invalid_shape",
        path: ["referenceVideos", index, "type"],
        model,
        message: `\`type: "video"\` is required on every referenceVideos entry for "${model}".`,
        meta: { source },
      });
    } else if (!typed && type != null) {
      ctx.report({
        code: "unsupported_param",
        path: ["referenceVideos", index, "type"],
        model,
        message: `referenceVideos \`type\` is not a field of "${model}"'s reference-video schema; send \`{ uri }\` alone.`,
        meta: { source },
      });
    }
  });
}

function checkPairing(
  record: Record<string, unknown>,
  rule: PairingRule,
  model: string,
  ctx: PipelineContext,
): void {
  const condition = rule.if;
  const subject = valueAt(record, condition.path);
  const holds =
    "positioned" in condition
      ? Array.isArray(subject) && subject.some((item) => positionOf(item) != null)
      : isPresent(subject) &&
        (condition.values === undefined || condition.values.includes(subject));
  if (!holds) return;

  const then = rule.then;
  const value = valueAt(record, then.path);
  function report(
    issueCode: "invalid_shape" | "invalid_enum_value" | "unsupported_param",
    path: Array<string | number>,
    detail: string,
    meta: Record<string, unknown> = {},
  ): void {
    ctx.report({
      code: issueCode,
      path,
      model,
      message: `${rule.message} for "${model}"${detail}.`,
      meta: { ...meta, source: rule.source },
    });
  }

  if ("absent" in then) {
    if (isPresent(value)) report("unsupported_param", [...then.path], "");
  } else if ("present" in then) {
    if (!isPresent(value)) report("invalid_shape", [...then.path], "");
  } else if ("values" in then) {
    const effective = value ?? then.default;
    if (effective === undefined || !then.values.includes(effective)) {
      report("invalid_enum_value", [...then.path], `; got ${JSON.stringify(effective)}`, {
        allowed: [...then.values],
        value: effective,
      });
    }
  } else if ("minItems" in then) {
    const count = arrayLength(value) ?? 0;
    if (count < then.minItems) {
      report("invalid_shape", [...then.path], `; got ${count}`, { min: then.minItems, count });
    }
  } else if ("maxItems" in then) {
    const count = arrayLength(value) ?? 0;
    if (count > then.maxItems) {
      report("invalid_shape", [...then.path], `; got ${count}`, { max: then.maxItems, count });
    }
  } else if (Array.isArray(value)) {
    value.forEach((item, index) => {
      if (positionOf(item) === then.withoutPosition) {
        report("invalid_shape", ["promptImage", index, "position"], "");
      }
    });
  }
}

/**
 * Reports models that have no arm in this route's request union. The catalog
 * is provider-wide (a model is "known"), but each route only accepts a subset.
 */
export function checkRouteSupport<P extends { model: string }>(
  route: string,
  supported: readonly string[],
  source: string,
  hint: string,
): (params: P, info: ModelInfo | undefined, ctx: PipelineContext) => void {
  return (params, info, ctx) => {
    if (info === undefined || supported.includes(params.model)) return;
    ctx.report({
      code: "unsupported_capability",
      path: ["model"],
      model: params.model,
      message: `Model "${params.model}" has no ${route} arm in the Runway request schema — ${hint}`,
      meta: { source, supported: [...supported] },
    });
  };
}
