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
 * support reference mode allow omitting it. Which positions a given model
 * accepts — and whether `position` is required at all — is narrowed per model
 * by the shape-rules tables in ./constraints.ts.
 */
export interface RunwayPromptImage {
  uri: string;
  position?: "first" | "last";
}

/** An audio reference (HTTPS URL, Runway upload URI, or data URI, ≤16MB). */
export interface RunwayAudioReference {
  type: "audio";
  uri: string;
}

/** A video reference (HTTPS URL, Runway upload URI, or data URI, ≤16MB). */
export interface RunwayVideoReference {
  type: "video";
  uri: string;
}

/** An image reference for text_to_video `references` arrays. */
export interface RunwayImageReference {
  uri: string;
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
      position: z.enum(["first", "last"]).optional(),
    }),
  ),
]);

export const audioReferenceArraySchema = z.array(
  z.looseObject({ type: z.literal("audio"), uri: audioUriSchema }),
);

export const videoReferenceArraySchema = z.array(
  z.looseObject({ type: z.literal("video"), uri: videoUriSchema }),
);

export const imageReferenceArraySchema = z.array(z.looseObject({ uri: imageUriSchema }));

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

export interface ModelShapeRules {
  /** Documented `promptText` minLength/maxLength for this model's arm. */
  readonly promptText?: { readonly min: number; readonly max: number };
  /** minItems/maxItems per array-valued param. */
  readonly arrays?: Readonly<Record<string, ArrayLimit>>;
  /** Allowed `position` values on promptImage items; omitted = unconstrained. */
  readonly promptImagePositions?: readonly string[];
  /** Whether promptImage items must carry a `position`. */
  readonly promptImagePositionRequired?: boolean;
  /** Sub-fields a `referenceImages` item may set beyond `uri`. */
  readonly referenceImageFields?: readonly string[];
}

function arrayLength(value: unknown): number | undefined {
  if (Array.isArray(value)) return value.length;
  // promptImage accepts a bare URI string, which is exactly one image.
  if (typeof value === "string") return 1;
  return undefined;
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
        const allowed = rules.promptImagePositions;
        if (allowed !== undefined && !allowed.includes(position as string)) {
          ctx.report({
            code: "invalid_enum_value",
            path: ["promptImage", index, "position"],
            model,
            message: `promptImage \`position\` must be one of ${allowed.map((v) => JSON.stringify(v)).join(", ")} for "${model}"; got ${JSON.stringify(position)}.`,
            meta: { allowed: [...allowed], value: position, source },
          });
        }
      });
    }

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
