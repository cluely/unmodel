/**
 * Leonardo.Ai image generation —
 * POST https://cloud.leonardo.ai/api/rest/v2/generations
 *
 * Wire notes (verified 2026-08-13 against the OpenAPI v2 document embedded in
 * https://docs.leonardo.ai/reference/creategeneration-1 — fetch it as
 * `…/creategeneration-1.md` — plus the prose parameter tables on
 * https://docs.leonardo.ai/docs/lucid-origin and
 * https://docs.leonardo.ai/docs/phoenix):
 * - One endpoint, one body: `{ model, parameters, public? }`. `model` is a
 *   real body field (not a route segment) and acts as an OpenAPI discriminator
 *   — each model maps to its own `…GenerationRequest` schema, so `parameters`
 *   differs per model. unmodel keeps `model` in the wire body and validates
 *   `parameters` against the selected model's rule table (model-rules.ts).
 * - The per-model differences are real, not cosmetic: Lucid Origin allows
 *   width ≤ 3840 / height ≤ 3616, Phoenix caps both at 2048 and Lucid Realism
 *   at 2496; Phoenix adds `contrast`, `tiling`, `negative_prompt`, a QUALITY
 *   mode, up to 4 style guidances and the `character` / `image_to_image`
 *   guidance kinds, while the Lucid models accept only `style` and `content`
 *   (one each); every model has its own `style_ids` allowlist.
 * - Image-to-image and style/content/character transfer all ride in
 *   `parameters.guidances` — Leonardo has no separate img2img route on v2.
 *   Each guidance references an already-uploaded image by id (see
 *   https://docs.leonardo.ai/docs/how-to-upload-an-image-using-a-presigned-url),
 *   so there are no bytes for unmodel to inspect.
 * - `mode` (FAST / QUALITY / ULTRA) replaces the legacy `quality` knob: "Use
 *   this instead of `quality` for all proprietary models!". The
 *   artificialanalysis rows "Lucid Origin Ultra/Fast" and "Phoenix 1.0
 *   Ultra/Fast" are this parameter, not separate model ids.
 * - ASYNC-JOB API: the POST returns a generation id; fetch the images with
 *   `GET /v2/generations/{id}` or a webhook callback — transport, out of
 *   unmodel's scope.
 * - No cost estimate: Leonardo publishes no public per-model rate (see
 *   models.ts). The response's `cost` object is authoritative.
 * - Auth is an `Authorization: Bearer …` header — unmodel never touches keys.
 * - Leonardo ships official SDKs, but they take the same JSON body;
 *   `.toSdk("leonardo")` returns it unchanged.
 */

import { z } from "zod";
import { createValidator, type PipelineContext } from "../../core/pipeline";
import { toValidated, JSON_HEADERS, type Validated, type ExactKeys } from "../../core/request";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";
import type { FutureModelId, ModelInfo } from "../../core/catalog-types";
import type { EndpointConstraints } from "../../core/constraint-types";
import { models, type LeonardoModelId } from "./models";
import {
  LEONARDO_DOCS_URL,
  LEONARDO_CONTRASTS,
  LEONARDO_IMAGE_TYPES,
  LEONARDO_KNOWN_PARAMETERS,
  LEONARDO_MAX_STYLE_IDS,
  LEONARDO_MODEL_RULES,
  LEONARDO_PROMPT_ENHANCE,
  LEONARDO_STYLE_LIMIT_DOCS_URL,
  type LeonardoContrast,
  type LeonardoGuidanceStrength,
  type LeonardoImageType,
  type LeonardoModelRule,
  type LeonardoPromptEnhance,
  type LeonardoStyleStrength,
} from "./model-rules";

export const LEONARDO_API_BASE_URL = "https://cloud.leonardo.ai/api/rest/v2";
export const LEONARDO_GENERATIONS_URL = `${LEONARDO_API_BASE_URL}/generations`;

// ---------------------------------------------------------------------------
// Wire types — Tier A: one arm per Leonardo-owned image model, carrying exactly
// the `parameters` that model's schema documents. Params a model rejects are
// typed `never` so they fail at compile time.
// ---------------------------------------------------------------------------

/** A reference to an image already stored in your Leonardo account. */
export interface LeonardoImageReference {
  /** UUID of the uploaded or generated image. */
  id?: string;
  /** Image URL (enriched by the backend when the image is resolved). */
  url?: string;
  type?: LeonardoImageType;
  width?: number;
  height?: number;
}

/** Style-transfer guidance — the only kind with the ULTRA/MAX strength steps. */
export interface LeonardoStyleGuidance {
  image: LeonardoImageReference;
  /** Position of this guidance within the list. */
  order?: number;
  strength: LeonardoStyleStrength;
}

/** Content / character guidance. */
export interface LeonardoContentGuidance {
  image: LeonardoImageReference;
  order?: number;
  strength: LeonardoGuidanceStrength;
}

/** Image-to-image guidance (Phoenix only) — no `order` field. */
export interface LeonardoImageToImageGuidance {
  image: LeonardoImageReference;
  strength: LeonardoGuidanceStrength;
}

interface LeonardoCommonParameters {
  /** Text prompt. REQUIRED. */
  prompt: string;
  /** Reproducibility seed. */
  seed?: number;
  /** Output width in pixels, a multiple of 8 (per-model bounds). */
  width?: number;
  /** Output height in pixels, a multiple of 8 (per-model bounds). */
  height?: number;
  /** Number of images to generate, 1–8. Default 4. */
  quantity?: number;
  /** Preset style UUIDs — one per request, from the model's own allowlist. */
  style_ids?: string[];
  /** Prompt enhancement. Default "AUTO". */
  prompt_enhance?: LeonardoPromptEnhance;
}

/** `parameters` for the Lucid models (style + content guidance only). */
export interface LeonardoLucidParameters extends LeonardoCommonParameters {
  /** Generation mode. Default "FAST". */
  mode?: "FAST" | "ULTRA";
  guidances?: {
    style?: LeonardoStyleGuidance[];
    content?: LeonardoContentGuidance[];
    /** Phoenix only. */
    character?: never;
    /** Phoenix only. */
    image_to_image?: never;
  };
  /** Phoenix only. */
  contrast?: never;
  /** Phoenix only. */
  tiling?: never;
  /** Phoenix only. */
  negative_prompt?: never;
}

/** `parameters` for the Phoenix models. */
export interface LeonardoPhoenixParameters extends LeonardoCommonParameters {
  /** Generation mode — Phoenix adds QUALITY between FAST and ULTRA. */
  mode?: "FAST" | "QUALITY" | "ULTRA";
  /** Output contrast. Default "MEDIUM". */
  contrast?: LeonardoContrast;
  /** Generate a seamlessly tiling image. */
  tiling?: boolean;
  /** Concepts to steer away from; ≤ 1000 characters. */
  negative_prompt?: string;
  guidances?: {
    /** Phoenix accepts up to 4 style references. */
    style?: LeonardoStyleGuidance[];
    content?: LeonardoContentGuidance[];
    character?: LeonardoContentGuidance[];
    /** Starting image for image-to-image. */
    image_to_image?: LeonardoImageToImageGuidance[];
  };
}

interface LeonardoBodyBase {
  /** Show the generated images in the community feed. */
  public?: boolean | null;
}

export interface LucidOriginBody extends LeonardoBodyBase {
  model: "lucid-origin";
  parameters: LeonardoLucidParameters;
}

export interface LucidRealismBody extends LeonardoBodyBase {
  model: "lucid-realism";
  parameters: LeonardoLucidParameters;
}

export interface PhoenixV1Body extends LeonardoBodyBase {
  model: "phoenix-v1.0";
  parameters: LeonardoPhoenixParameters;
}

export interface PhoenixV09Body extends LeonardoBodyBase {
  model: "phoenix-v0.9";
  parameters: LeonardoPhoenixParameters;
}

/**
 * Escape hatch for the third-party and non-image models the same endpoint
 * routes (FLUX, Imagen, Seedream, Kling, Veo, …) — each has its own
 * `parameters` schema, so unmodel passes them through with an unknown_model
 * warning instead of guessing.
 */
export interface UnknownLeonardoModelBody<Model extends string> extends LeonardoBodyBase {
  model: FutureModelId<Model, keyof LeonardoBodyByModel>;
  parameters: Record<string, unknown>;
}

/**
 * Closed over Leonardo-owned models by default. Supply a third-party or future
 * model literal to opt into the loose arm: `GenerationsBody<"flux-dev">`.
 */
export type GenerationsBody<FutureModel extends string = never> =
  | LucidOriginBody
  | LucidRealismBody
  | PhoenixV1Body
  | PhoenixV09Body
  | UnknownLeonardoModelBody<FutureModel>;

export interface LeonardoBodyByModel {
  "lucid-origin": LucidOriginBody;
  "lucid-realism": LucidRealismBody;
  "phoenix-v1.0": PhoenixV1Body;
  "phoenix-v0.9": PhoenixV09Body;
}

/** Resolves a model id literal to its exact Tier-A arm. */
type LeonardoArm<M extends string> = M extends keyof LeonardoBodyByModel
  ? LeonardoBodyByModel[M]
  : UnknownLeonardoModelBody<M>;

/** Runtime implementation type; the public alias stays closed by default. */
type AnyGenerationsBody = GenerationsBody<string>;
type LeonardoModelInput = keyof LeonardoBodyByModel | (string & {});

// ---------------------------------------------------------------------------
// Schema (loose: unknown keys pass through with a warning).
// ---------------------------------------------------------------------------

const generationsSchema = z.looseObject({
  model: z.string(),
  parameters: z.looseObject({}),
  public: z.boolean().nullable().optional(),
});

// ---------------------------------------------------------------------------
// Checks — everything model-dependent lives in LEONARDO_MODEL_RULES.
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function reportEnum(
  ctx: PipelineContext,
  path: Array<string | number>,
  value: unknown,
  allowed: readonly string[],
  model: string,
  note = "",
): void {
  ctx.report({
    code: "invalid_enum_value",
    path,
    model,
    message: `\`${path.join(".")}\` must be one of ${allowed.map((v) => JSON.stringify(v)).join(", ")} for "${model}"; got ${JSON.stringify(value)}.${note}`,
    meta: { allowed: [...allowed], value, source: LEONARDO_DOCS_URL },
  });
}

function checkDimension(
  ctx: PipelineContext,
  model: string,
  rule: LeonardoModelRule,
  axis: "width" | "height",
  value: unknown,
): void {
  if (value == null) return;
  const bounds = rule[axis];
  const path = ["parameters", axis];
  if (typeof value !== "number" || !Number.isInteger(value)) {
    ctx.report({
      code: "invalid_shape",
      path,
      model,
      message: `\`parameters.${axis}\` must be an integer; got ${JSON.stringify(value)}.`,
      meta: { source: LEONARDO_DOCS_URL },
    });
    return;
  }
  if (value < bounds.min || value > bounds.max) {
    ctx.report({
      code: "invalid_shape",
      path,
      model,
      message: `\`parameters.${axis}\` must be between ${bounds.min} and ${bounds.max} for "${model}"; got ${value}.`,
      meta: { min: bounds.min, max: bounds.max, value, source: LEONARDO_DOCS_URL },
    });
  }
  if (value % bounds.multipleOf !== 0) {
    ctx.report({
      code: "invalid_shape",
      path,
      model,
      message: `\`parameters.${axis}\` must be a multiple of ${bounds.multipleOf}; got ${value}.`,
      meta: { multipleOf: bounds.multipleOf, value, source: LEONARDO_DOCS_URL },
    });
  }
}

function checkIntegerRange(
  ctx: PipelineContext,
  model: string,
  path: Array<string | number>,
  value: unknown,
  min: number,
  max: number | undefined,
): void {
  if (value == null) return;
  const label = path.join(".");
  if (typeof value !== "number" || !Number.isInteger(value)) {
    ctx.report({
      code: "invalid_shape",
      path,
      model,
      message: `\`${label}\` must be an integer; got ${JSON.stringify(value)}.`,
      meta: { source: LEONARDO_DOCS_URL },
    });
    return;
  }
  if (value < min || (max !== undefined && value > max)) {
    ctx.report({
      code: "invalid_shape",
      path,
      model,
      message: `\`${label}\` must be between ${min} and ${max ?? "∞"} for "${model}"; got ${value}.`,
      meta: { min, max, value, source: LEONARDO_DOCS_URL },
    });
  }
}

function checkStyleIds(
  ctx: PipelineContext,
  model: string,
  rule: LeonardoModelRule,
  value: unknown,
): void {
  if (value == null) return;
  if (!Array.isArray(value)) {
    ctx.report({
      code: "invalid_shape",
      path: ["parameters", "style_ids"],
      model,
      message: "`parameters.style_ids` must be an array of style UUIDs.",
      meta: { source: LEONARDO_DOCS_URL },
    });
    return;
  }
  if (value.length > LEONARDO_MAX_STYLE_IDS) {
    // Advisory only: the OpenAPI schema puts no `maxItems` on `style_ids`, so
    // the wire accepts this. The 1-style cap lives in the prose docs, which is
    // what meta.source points at. See LEONARDO_MAX_STYLE_IDS.
    ctx.report({
      code: "invalid_shape",
      path: ["parameters", "style_ids"],
      model,
      severity: "warning",
      message: `\`parameters.style_ids\` has ${value.length} entries; the wire schema sets no maxItems so the request is accepted, but the docs limit it to ${LEONARDO_MAX_STYLE_IDS} style ("limited to 1 style") and the behaviour of extra entries is undocumented.`,
      meta: {
        limit: LEONARDO_MAX_STYLE_IDS,
        count: value.length,
        source: LEONARDO_STYLE_LIMIT_DOCS_URL,
      },
    });
  }
  value.forEach((id, i) => {
    if (typeof id !== "string" || rule.styleIds.includes(id)) return;
    ctx.report({
      code: "invalid_enum_value",
      path: ["parameters", "style_ids", i],
      model,
      message: `\`${JSON.stringify(id)}\` is not a style UUID "${model}" accepts (it publishes ${rule.styleIds.length} preset styles; see meta.allowed and the style-id table in the docs).`,
      meta: { allowed: [...rule.styleIds], value: id, source: LEONARDO_DOCS_URL },
    });
  });
}

function checkGuidances(
  ctx: PipelineContext,
  model: string,
  rule: LeonardoModelRule,
  value: unknown,
): void {
  if (value == null) return;
  if (!isRecord(value)) {
    ctx.report({
      code: "invalid_shape",
      path: ["parameters", "guidances"],
      model,
      message: "`parameters.guidances` must be an object keyed by guidance kind.",
      meta: { source: LEONARDO_DOCS_URL },
    });
    return;
  }
  for (const [kind, entries] of Object.entries(value)) {
    const kindRule = rule.guidances[kind];
    if (kindRule === undefined) {
      ctx.report({
        code: "unsupported_param",
        path: ["parameters", "guidances", kind],
        model,
        message: `\`guidances.${kind}\` is not a guidance kind "${model}" supports; it accepts ${Object.keys(rule.guidances).join(", ")}.`,
        meta: { allowed: Object.keys(rule.guidances), source: LEONARDO_DOCS_URL },
      });
      continue;
    }
    if (entries == null) continue;
    if (!Array.isArray(entries)) {
      ctx.report({
        code: "invalid_shape",
        path: ["parameters", "guidances", kind],
        model,
        message: `\`guidances.${kind}\` must be an array of guidance objects.`,
        meta: { source: LEONARDO_DOCS_URL },
      });
      continue;
    }
    if (entries.length > kindRule.maxItems) {
      ctx.report({
        code: "invalid_shape",
        path: ["parameters", "guidances", kind],
        model,
        message: `\`guidances.${kind}\` is limited to ${kindRule.maxItems} reference${kindRule.maxItems === 1 ? "" : "s"} for "${model}"; got ${entries.length}.`,
        meta: { limit: kindRule.maxItems, count: entries.length, source: LEONARDO_DOCS_URL },
      });
    }
    entries.forEach((entry, i) => {
      const path = ["parameters", "guidances", kind, i];
      if (!isRecord(entry)) {
        ctx.report({
          code: "invalid_shape",
          path,
          model,
          message: `each \`guidances.${kind}\` entry must be an object with \`image\` and \`strength\`.`,
          meta: { source: LEONARDO_DOCS_URL },
        });
        return;
      }
      if (!isRecord(entry.image)) {
        ctx.report({
          code: "invalid_shape",
          path: [...path, "image"],
          model,
          message: `each \`guidances.${kind}\` entry requires an \`image\` reference (e.g. { id, type: "UPLOADED" }).`,
          meta: { source: LEONARDO_DOCS_URL },
        });
      } else {
        const imageType = entry.image.type;
        if (
          imageType != null &&
          (typeof imageType !== "string" ||
            !(LEONARDO_IMAGE_TYPES as readonly string[]).includes(imageType))
        ) {
          // The spec's 5-value enum is wider than the prose tables'
          // UPLOADED/GENERATED pair; unmodel enforces the wider one so it never
          // rejects a value the schema accepts.
          reportEnum(ctx, [...path, "image", "type"], imageType, LEONARDO_IMAGE_TYPES, model);
        }
      }
      const strength = entry.strength;
      if (strength === undefined) {
        ctx.report({
          code: "invalid_shape",
          path: [...path, "strength"],
          model,
          message: `each \`guidances.${kind}\` entry requires a \`strength\` (${kindRule.strengths.join(", ")}).`,
          meta: { allowed: [...kindRule.strengths], source: LEONARDO_DOCS_URL },
        });
      } else if (typeof strength !== "string" || !kindRule.strengths.includes(strength)) {
        reportEnum(ctx, [...path, "strength"], strength, kindRule.strengths, model);
      }
    });
  }
}

function checkParameters(
  params: AnyGenerationsBody,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const model = params.model;
  const rule = LEONARDO_MODEL_RULES[model];
  const parameters = params.parameters as unknown;
  if (!isRecord(parameters)) {
    ctx.report({
      code: "invalid_shape",
      path: ["parameters"],
      message: "`parameters` must be an object — Leonardo v2 nests every generation knob inside it.",
      meta: { source: LEONARDO_DOCS_URL },
    });
    return;
  }
  if (rule === undefined) {
    // A third-party or non-image model: `parameters` follows that model's own
    // schema, which unmodel does not table. `prompt` is the one field every
    // documented arm requires.
    if (parameters.prompt === undefined) {
      ctx.report({
        code: "invalid_shape",
        path: ["parameters", "prompt"],
        message: "`parameters.prompt` is required.",
        meta: { source: LEONARDO_DOCS_URL },
      });
    }
    return;
  }

  // Required prompt + per-model length cap.
  const prompt = parameters.prompt;
  if (typeof prompt !== "string" || prompt.length === 0) {
    ctx.report({
      code: "invalid_shape",
      path: ["parameters", "prompt"],
      model,
      message: "`parameters.prompt` is required and must be a non-empty string.",
      meta: { source: LEONARDO_DOCS_URL },
    });
  } else if (prompt.length > rule.promptMaxLength) {
    ctx.report({
      code: "invalid_shape",
      path: ["parameters", "prompt"],
      model,
      message: `\`parameters.prompt\` is ${prompt.length} characters; "${model}" caps it at ${rule.promptMaxLength}.`,
      meta: { length: prompt.length, limit: rule.promptMaxLength, source: LEONARDO_DOCS_URL },
    });
  }

  // Params that belong to a sibling model (or nothing at all).
  for (const key of Object.keys(parameters)) {
    if (rule.parameters.includes(key)) continue;
    if (LEONARDO_KNOWN_PARAMETERS.includes(key)) {
      ctx.report({
        code: "unsupported_param",
        path: ["parameters", key],
        model,
        message: `\`${key}\` is not part of "${model}"'s parameters schema; it belongs to another model on this endpoint (\`contrast\`, \`tiling\` and \`negative_prompt\` are Phoenix-only).`,
        meta: { allowed: [...rule.parameters], source: LEONARDO_DOCS_URL },
      });
    } else {
      ctx.report({
        code: "unknown_param",
        path: ["parameters", key],
        model,
        message: `\`parameters.${key}\` is not a param unmodel knows for "${model}"; it was passed through unvalidated. It may be new — or a typo.`,
        meta: { allowed: [...rule.parameters], source: LEONARDO_DOCS_URL },
      });
    }
  }

  const mode = parameters.mode;
  if (mode != null && (typeof mode !== "string" || !rule.modes.includes(mode))) {
    reportEnum(
      ctx,
      ["parameters", "mode"],
      mode,
      rule.modes,
      model,
      " `mode` replaces the legacy `quality` knob on Leonardo's own models.",
    );
  }

  const enhance = parameters.prompt_enhance;
  if (
    enhance != null &&
    (typeof enhance !== "string" || !(LEONARDO_PROMPT_ENHANCE as readonly string[]).includes(enhance))
  ) {
    reportEnum(ctx, ["parameters", "prompt_enhance"], enhance, LEONARDO_PROMPT_ENHANCE, model);
  }

  const contrast = parameters.contrast;
  if (
    contrast != null &&
    rule.parameters.includes("contrast") &&
    (typeof contrast !== "string" || !(LEONARDO_CONTRASTS as readonly string[]).includes(contrast))
  ) {
    reportEnum(ctx, ["parameters", "contrast"], contrast, LEONARDO_CONTRASTS, model);
  }

  const tiling = parameters.tiling;
  if (tiling != null && rule.parameters.includes("tiling") && typeof tiling !== "boolean") {
    ctx.report({
      code: "invalid_shape",
      path: ["parameters", "tiling"],
      model,
      message: `\`parameters.tiling\` must be a boolean; got ${JSON.stringify(tiling)}.`,
      meta: { source: LEONARDO_DOCS_URL },
    });
  }

  const negativePrompt = parameters.negative_prompt;
  if (
    typeof negativePrompt === "string" &&
    rule.negativePromptMaxLength !== undefined &&
    negativePrompt.length > rule.negativePromptMaxLength
  ) {
    ctx.report({
      code: "invalid_shape",
      path: ["parameters", "negative_prompt"],
      model,
      message: `\`parameters.negative_prompt\` is ${negativePrompt.length} characters; "${model}" caps it at ${rule.negativePromptMaxLength}.`,
      meta: {
        length: negativePrompt.length,
        limit: rule.negativePromptMaxLength,
        source: LEONARDO_DOCS_URL,
      },
    });
  }

  checkDimension(ctx, model, rule, "width", parameters.width);
  checkDimension(ctx, model, rule, "height", parameters.height);
  checkIntegerRange(
    ctx,
    model,
    ["parameters", "quantity"],
    parameters.quantity,
    rule.quantity.min,
    rule.quantity.max,
  );
  checkIntegerRange(ctx, model, ["parameters", "seed"], parameters.seed, rule.seed.min, rule.seed.max);
  checkStyleIds(ctx, model, rule, parameters.style_ids);
  checkGuidances(ctx, model, rule, parameters.guidances);
}

// ---------------------------------------------------------------------------
// Finalize — the body goes out as-is (`model` is a real wire field here).
// ---------------------------------------------------------------------------

/**
 * The one `.toSdk("leonardo")` target for this endpoint — Leonardo's SDK
 * takes wire-shaped params. Derived from the `sdk` literal in `finalize`; it
 * must stay an object type with no index signature, or `toSdk` would accept
 * any string.
 */
type LeonardoSdkTargets<B> = { leonardo: () => B };

function finalize(params: AnyGenerationsBody): unknown {
  const body = { ...params };
  return toValidated(body, {
    url: LEONARDO_GENERATIONS_URL,
    method: "POST",
    headers: JSON_HEADERS,
  }, {
    sdk: { leonardo: () => body },
  });
}

const validator = createValidator<AnyGenerationsBody, unknown>({
  endpoint: "leonardo.image",
  schema: generationsSchema,
  modelId: (params) => params.model,
  catalog: models,
  checks: [checkParameters],
  // No estimate: Leonardo publishes no public per-model rate (see models.ts).
  finalize,
});

/**
 * Validates params for `POST https://cloud.leonardo.ai/api/rest/v2/generations`
 * (Leonardo.Ai image generation).
 *
 * Leonardo's own image models get their exact per-model `parameters` surface at
 * compile time (e.g. `contrast` is a compile error for `lucid-origin`, and
 * `mode: "QUALITY"` only type-checks on Phoenix); the third-party models the
 * same endpoint routes fall back to a loose arm with a runtime unknown_model
 * warning.
 *
 * The returned object's enumerable props are the exact fetch JSON body. The
 * POST returns a generation id — fetch the images with
 * `GET /v2/generations/{id}` or a webhook (transport, out of unmodel's scope).
 * Auth is your job: add an `Authorization: Bearer …` header when fetching.
 *
 * ```ts
 * const params = leonardo.image({
 *   model: "lucid-origin",
 *   parameters: {
 *     mode: "ULTRA",
 *     prompt: "a portrait-style photograph of a fox on a navy backdrop",
 *     width: 1200,
 *     height: 1200,
 *     quantity: 4,
 *   },
 *   public: false,
 * });
 * ```
 */
export const image = validator as unknown as {
  <M extends LeonardoModelInput, T extends LeonardoArm<M>>(
    params: T & LeonardoArm<M> & { model: M } & ExactKeys<T, LeonardoArm<M>>,
    options?: ValidateOptions<T>,
  ): Validated<T, LeonardoSdkTargets<T>>;
  safe<M extends LeonardoModelInput, T extends LeonardoArm<M>>(
    params: T & LeonardoArm<M> & { model: M } & ExactKeys<T, LeonardoArm<M>>,
    options?: ValidateOptions<T>,
  ): ValidateResult<Validated<T, LeonardoSdkTargets<T>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};

export type { LeonardoModelId };
