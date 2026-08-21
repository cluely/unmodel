/**
 * Runway Text to Image — POST https://api.dev.runwayml.com/v1/text_to_image
 *
 * Wire notes (verified against https://docs.dev.runwayml.com/openapi.json,
 * spec version 2024-11-06, and @runwayml/sdk on 2026-08-13):
 * - Every request must send the `X-Runway-Version: 2024-11-06` header; it is
 *   included in `.request.headers`.
 * - `promptText` and `ratio` are required by every model's arm;
 *   gen4_image_turbo additionally requires `referenceImages` (1–3 images).
 * - Reference-image sub-fields vary per model (`tag` for the gen4 / gpt_image_2
 *   / gemini arms, `subject` only for the gemini_image3 family, bare `uri` for
 *   the seedream and grok arms). The schema accepts the superset; the
 *   shape-rules table rejects a sub-field the chosen model has no schema for.
 * - `referenceImages` counts are capped per model (3 for gen4/grok/gemini_2.5,
 *   10 for seedream5_pro, 14 for the gemini_image3 family and seedream5_lite,
 *   16 for gpt_image_2), as is `promptText` (1000–32000 chars).
 * - The endpoint only starts a task and responds `{ id }`; polling
 *   GET /v1/tasks/{id} is out of unmodel's scope.
 * - Auth is `Authorization: Bearer <RUNWAYML_API_SECRET>` — unmodel never
 *   touches keys; add it yourself when fetching.
 */

import { z } from "zod";
import { createValidator, type PipelineContext } from "../../core/pipeline";
import { toValidated, type ExactKeys, type Validated } from "../../core/request";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";
import type { ModelInfo } from "../../core/catalog-types";
import type { EndpointConstraints } from "../../core/constraint-types";
import { imageModels, type RunwayImageModelId } from "./models";
import {
  imageConstraints,
  imageRequired,
  imageShapeRules,
  TEXT_TO_IMAGE_SOURCE,
  type RunwayImageRatio,
  type RunwayImageQuality,
  type RunwayImageOutputFormat,
} from "./constraints";
import {
  RUNWAY_BASE_URL,
  RUNWAY_HEADERS,
  checkRequiredParams,
  checkShapeRules,
  imageUriSchema,
  seedSchema,
  contentModerationSchema,
  type RunwayContentModeration,
} from "./shared";
import { imageCostUSD } from "./pricing";

export const TEXT_TO_IMAGE_URL = `${RUNWAY_BASE_URL}/v1/text_to_image`;

// ---------------------------------------------------------------------------
// Wire types — mirror the raw JSON body exactly (camelCase on this API).
// Which fields a given model accepts/requires is per-model; the constraint
// tables enforce it at runtime (see ./constraints.ts).
// ---------------------------------------------------------------------------

/**
 * Superset of the per-model reference-image shapes: `tag` (gen4 / gemini
 * family), `subject` (gemini_image3 family). Seedream models take bare
 * `uri` objects.
 */
export interface RunwayReferenceImage {
  uri: string;
  /** 3–16 chars, letter first, letters/digits/underscores only. */
  tag?: string;
  /** gemini_image3 family only. */
  subject?: "object" | "human";
}

export interface TextToImageParams {
  model: RunwayImageModelId | (string & {});
  /** Required by every model; length caps vary (1000–32000 chars). */
  promptText: string;
  /**
   * Output ratio "W:H" (or auto/auto_1k/auto_2k where supported). The union
   * spans every model's documented list; each model accepts only its own
   * slice, narrowed at runtime by `imageConstraints`.
   */
  ratio: RunwayImageRatio;
  /** gen4_image / gen4_image_turbo only. Integer 0–4294967295. */
  seed?: number;
  /** gpt_image_2 ("low" … "auto") / grok_imagine_image_2 ("low" | "medium") only. */
  quality?: RunwayImageQuality;
  /** gpt_image_2 only ("transparent" is not supported). */
  background?: "opaque" | "auto";
  /** Number of output images; supported range varies per model. */
  outputCount?: number;
  /** seedream5_pro / seedream5_lite only. */
  outputFormat?: RunwayImageOutputFormat;
  /** seedream5_pro / seedream5_lite only: live web-search grounding. */
  grounding?: boolean;
  /** grok_imagine_image_2 only. */
  edit?: boolean;
  /** Reference images; count limits vary per model (3–16). */
  referenceImages?: RunwayReferenceImage[];
  /** gen4_image / gen4_image_turbo only. */
  contentModeration?: RunwayContentModeration;
}

/**
 * `tag`: "minLength": 3, "maxLength": 16, "pattern": "^[a-z][a-z0-9_]+$"
 * (openapi.json) — lowercase only, and every arm that has `tag` shares the
 * same rule, so it is enforced schema-wide rather than per model.
 */
export const REFERENCE_IMAGE_TAG_PATTERN = /^[a-z][a-z0-9_]+$/;

const referenceImageSchema = z.looseObject({
  uri: imageUriSchema,
  tag: z
    .string()
    .min(3)
    .max(16)
    .regex(
      REFERENCE_IMAGE_TAG_PATTERN,
      "referenceImages `tag` must start with a lowercase letter and use only lowercase letters, digits and underscores",
    )
    .optional(),
  subject: z.enum(["object", "human"]).optional(),
});

const imageSchema = z.looseObject({
  model: z.string(),
  promptText: z.string().min(1, "promptText must be a non-empty string"),
  ratio: z.string(),
  seed: seedSchema.optional(),
  quality: z.string().optional(),
  background: z.enum(["opaque", "auto"]).optional(),
  outputCount: z.number().int().optional(),
  outputFormat: z.string().optional(),
  grounding: z.boolean().optional(),
  edit: z.boolean().optional(),
  referenceImages: z.array(referenceImageSchema).optional(),
  contentModeration: contentModerationSchema.optional(),
});

// ---------------------------------------------------------------------------
// Estimation — credits × $0.01 for the whole request (all output images);
// see ./pricing.ts for tier tables and worst-case rules.
// ---------------------------------------------------------------------------

function estimate(params: TextToImageParams, info: ModelInfo | undefined, _ctx: PipelineContext) {
  if (info === undefined) return {};
  const costUSD = imageCostUSD({
    model: params.model,
    ratio: params.ratio,
    quality: params.quality,
    outputCount: params.outputCount,
    referenceCount: params.referenceImages?.length ?? 0,
  });
  return costUSD === undefined ? {} : { costUSD };
}

/**
 * The one `.toSdk("runway")` target for this endpoint — the `@runwayml/sdk`
 * client takes wire-shaped params. Derived from the `sdk` literal in
 * `finalize`; it must stay an object type with no index signature, or
 * `toSdk` would accept any string.
 */
type RunwaySdkTargets<B> = { runway: () => B };

function finalize(params: TextToImageParams): unknown {
  const body = { ...params };
  return toValidated(body, {
    url: TEXT_TO_IMAGE_URL,
    method: "POST",
    headers: RUNWAY_HEADERS,
  }, {
    sdk: { runway: () => body },
  });
}

const validator = createValidator<TextToImageParams, unknown>({
  endpoint: "runway.image",
  schema: imageSchema,
  modelId: (params) => params.model,
  // Route-scoped catalog: video models are not valid here and warn as
  // unknown_model.
  catalog: imageModels,
  constraints: imageConstraints,
  checks: [
    checkRequiredParams(imageRequired, TEXT_TO_IMAGE_SOURCE),
    checkShapeRules(imageShapeRules, TEXT_TO_IMAGE_SOURCE),
  ],
  estimate,
  finalize,
});

/**
 * Validates raw wire params for Runway `POST /v1/text_to_image`.
 *
 * The returned object's enumerable props are the exact fetch JSON body.
 * `.request.headers` carries the required `X-Runway-Version` header (plus
 * content-type). `.toSdk("runway")` returns the body unchanged in shape —
 * `@runwayml/sdk`'s `client.textToImage.create(body)` params are
 * wire-shaped. Auth is your job: add
 * `authorization: Bearer <RUNWAYML_API_SECRET>` when fetching.
 *
 * ```ts
 * const params = runway.image({
 *   model: "gen4_image",
 *   promptText: "A watercolor lighthouse at dawn",
 *   ratio: "1920:1080",
 * });
 * ```
 */
export const image = validator as unknown as {
  <T extends TextToImageParams>(
    params: T & ExactKeys<T, TextToImageParams>,
    options?: ValidateOptions<T>,
  ): Validated<T, RunwaySdkTargets<T>>;
  safe<T extends TextToImageParams>(
    params: T & ExactKeys<T, TextToImageParams>,
    options?: ValidateOptions<T>,
  ): ValidateResult<Validated<T, RunwaySdkTargets<T>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
