/**
 * Ideogram 4.0 generate — POST https://api.ideogram.ai/v1/ideogram-v4/generate
 *
 * Wire notes (verified against the authoritative OpenAPI spec at
 * https://developer.ideogram.ai/openapi.json on 2026-08-13):
 * - multipart/form-data, like the 3.0 routes: the validated output's
 *   enumerable props are the validated params, and the raw-fetch path is
 *   `.request.url` + `toFormData(params)` as the body. `.request.headers` is
 *   empty so fetch derives the multipart boundary. Auth is an `Api-Key`
 *   header — unmodel never touches keys.
 * - 4.0 is NOT 3.0 with a version bump. Its param surface is deliberately
 *   small and mostly disjoint:
 *     * `prompt` is gone. You send `text_prompt` (magic-prompt on) XOR
 *       `json_prompt` (a structured V4JsonPrompt; magic-prompt off, the
 *       diffusion model consumes the contract directly).
 *     * sizing is `resolution` only, from a DIFFERENT enum (ResolutionV4 —
 *       1K/2K sizes up to 3328x1248); there is no `aspect_ratio`, no
 *       `style_type`, no `style_preset`, no `style_codes`, no
 *       `color_palette`, no reference-image arrays, no `num_images`,
 *       no `seed`, no `negative_prompt`, no `magic_prompt`.
 *     * `rendering_speed=FLASH` is rejected with a 400 today ("coming soon"
 *       per the spec), so unmodel reports it rather than pricing a request
 *       the API refuses.
 * - Pricing (https://ideogram.ai/api-pricing/): 4.0 Turbo $0.03, 4.0 Default
 *   $0.06, 4.0 Quality $0.10 per image. There is no `num_images` on this
 *   route, so the estimate is one image per request.
 * - Ideogram publishes no official JS SDK; `.toSdk("ideogram")` returns the validated
 *   params unchanged.
 */

import { z } from "zod";
import { createValidator, type PipelineContext } from "../../core/pipeline";
import { toValidated, type ExactKeys, type Validated } from "../../core/request";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";
import type { ModelInfo } from "../../core/catalog-types";
import type { EndpointConstraints } from "../../core/constraint-types";
import { models, RENDERING_SPEED_TO_V4_MODEL_ID } from "./models";
import { RENDERING_SPEEDS, type IdeogramRenderingSpeed } from "./image";

export const IDEOGRAM_V4_GENERATE_URL = "https://api.ideogram.ai/v1/ideogram-v4/generate";

const OPENAPI_URL = "https://developer.ideogram.ai/openapi.json";

/**
 * The 1K and 2K resolutions supported by Ideogram 4.0 (OpenAPI
 * `ResolutionV4`). Deliberately a separate list from the 3.0 `RESOLUTIONS`
 * enum — the two barely overlap.
 */
export const RESOLUTIONS_V4 = [
  "2048x2048",
  "1440x2880",
  "2880x1440",
  "1664x2496",
  "2496x1664",
  "1792x2240",
  "2240x1792",
  "1440x2560",
  "2560x1440",
  "1600x2560",
  "2560x1600",
  "1728x2304",
  "2304x1728",
  "1296x3168",
  "3168x1296",
  "1152x2944",
  "2944x1152",
  "1248x3328",
  "3328x1248",
  "1280x3072",
  "3072x1280",
  "1024x3072",
  "3072x1024",
  "1024x1024",
  "896x1120",
  "1120x896",
  "864x1152",
  "1152x864",
  "832x1248",
  "1248x832",
  "800x1280",
  "1280x800",
  "720x1280",
  "1280x720",
  "720x1440",
  "1440x720",
  "512x1536",
  "1536x512",
] as const;
export type IdeogramResolutionV4 = (typeof RESOLUTIONS_V4)[number];

/** Rendering speeds the 4.0 routes actually accept — FLASH returns 400. */
export const V4_RENDERING_SPEEDS = ["TURBO", "DEFAULT", "QUALITY"] as const;
export type IdeogramV4RenderingSpeed = (typeof V4_RENDERING_SPEEDS)[number];

// ---------------------------------------------------------------------------
// Wire types — V4JsonPrompt and friends, mirroring the OpenAPI components.
// ---------------------------------------------------------------------------

export interface V4StyleDescription {
  /** Aesthetic notes (mood, vibe, references). */
  aesthetics?: string;
  /** Art-style hint (e.g. illustration, oil painting). */
  art_style?: string;
  /** Lighting description. */
  lighting?: string;
  /** Medium description (e.g. photograph, digital art). */
  medium?: string;
  /** Photographic style notes (e.g. lens, film stock). */
  photo?: string;
  /** Hex color strings biasing the output palette (a soft bias, not a lock). */
  color_palette?: string[];
}

export interface V4PromptElement {
  [key: string]: unknown;
}

export interface V4CompositionalDeconstruction {
  /** Description of the background of the scene. REQUIRED. */
  background: string;
  /** Ordered list of elements (objects and text) composing the scene. REQUIRED. */
  elements: V4PromptElement[];
}

export interface V4JsonPrompt {
  /** One- or two-sentence overall description of the desired image. REQUIRED. */
  high_level_description: string;
  /** Optional style description supplied alongside the JSON prompt. */
  style_description?: V4StyleDescription;
  /** Background plus the ordered element list. REQUIRED. */
  compositional_deconstruction: V4CompositionalDeconstruction;
}

export interface GenerateV4Params {
  /**
   * Natural-language prompt; enables magic-prompt automatically. Mutually
   * exclusive with `json_prompt` — exactly one of the two is required.
   */
  text_prompt?: string;
  /**
   * Structured Ideogram 4.0 prompt; disables magic-prompt. Mutually exclusive
   * with `text_prompt`.
   */
  json_prompt?: V4JsonPrompt;
  /** Output resolution, from the 4.0-specific ResolutionV4 enum. */
  resolution?: IdeogramResolutionV4;
  /** Latency/fidelity tier; also selects the per-image price. FLASH is rejected. */
  rendering_speed?: IdeogramV4RenderingSpeed;
  /** Opt into post-generation copyright detection (adds latency). */
  enable_copyright_detection?: boolean | null;
}

// ---------------------------------------------------------------------------
// Schema (loose: unknown keys pass through with a warning). Enum-ish fields
// stay z.string() so a bad value reports invalid_enum_value from the checks.
// ---------------------------------------------------------------------------

const generateV4Schema = z.looseObject({
  text_prompt: z.string().optional(),
  json_prompt: z.looseObject({}).optional(),
  resolution: z.string().optional(),
  rendering_speed: z.string().optional(),
  enable_copyright_detection: z.boolean().nullable().optional(),
});

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

/** `text_prompt` XOR `json_prompt` — "mutually exclusive" per the spec. */
function checkPromptExclusivity(
  params: GenerateV4Params,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const hasText = params.text_prompt != null;
  const hasJson = params.json_prompt != null;
  if (hasText === hasJson) {
    ctx.report({
      code: "invalid_shape",
      path: ["text_prompt"],
      message:
        "Ideogram 4.0 takes EITHER `text_prompt` OR `json_prompt` — exactly one of the two.",
      meta: { source: `${OPENAPI_URL}#/paths/~1v1~1ideogram-v4~1generate` },
    });
  }
}

/** `json_prompt` requires high_level_description + compositional_deconstruction. */
function checkJsonPrompt(
  params: GenerateV4Params,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const prompt = params.json_prompt as Record<string, unknown> | null | undefined;
  if (prompt == null) return;
  if (typeof prompt.high_level_description !== "string") {
    ctx.report({
      code: "invalid_shape",
      path: ["json_prompt", "high_level_description"],
      message: "`json_prompt.high_level_description` is required and must be a string.",
      meta: { source: `${OPENAPI_URL}#/components/schemas/V4JsonPrompt` },
    });
  }
  const composition = prompt.compositional_deconstruction as Record<string, unknown> | undefined;
  if (composition == null || typeof composition !== "object") {
    ctx.report({
      code: "invalid_shape",
      path: ["json_prompt", "compositional_deconstruction"],
      message:
        "`json_prompt.compositional_deconstruction` is required and must be a { background, elements } object.",
      meta: { source: `${OPENAPI_URL}#/components/schemas/V4CompositionalDeconstruction` },
    });
    return;
  }
  if (typeof composition.background !== "string") {
    ctx.report({
      code: "invalid_shape",
      path: ["json_prompt", "compositional_deconstruction", "background"],
      message: "`compositional_deconstruction.background` is required and must be a string.",
      meta: { source: `${OPENAPI_URL}#/components/schemas/V4CompositionalDeconstruction` },
    });
  }
  if (!Array.isArray(composition.elements)) {
    ctx.report({
      code: "invalid_shape",
      path: ["json_prompt", "compositional_deconstruction", "elements"],
      message: "`compositional_deconstruction.elements` is required and must be an array.",
      meta: { source: `${OPENAPI_URL}#/components/schemas/V4CompositionalDeconstruction` },
    });
  }
}

function checkV4Enums(
  params: GenerateV4Params,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const resolution = params.resolution;
  if (resolution != null && !(RESOLUTIONS_V4 as readonly string[]).includes(resolution)) {
    ctx.report({
      code: "invalid_enum_value",
      path: ["resolution"],
      message: `\`resolution\` must be one of ${RESOLUTIONS_V4.slice(0, 8).map((v) => JSON.stringify(v)).join(", ")}, … (${RESOLUTIONS_V4.length} values; see meta.allowed); got ${JSON.stringify(resolution)}. Ideogram 4.0 uses its own resolution list — the 3.0 values are not accepted.`,
      meta: {
        allowed: [...RESOLUTIONS_V4],
        value: resolution,
        source: `${OPENAPI_URL}#/components/schemas/ResolutionV4`,
      },
    });
  }

  const speed = params.rendering_speed;
  if (speed == null) return;
  if ((V4_RENDERING_SPEEDS as readonly string[]).includes(speed)) return;
  if ((RENDERING_SPEEDS as readonly string[]).includes(speed)) {
    // FLASH is a valid RenderingSpeed, just not on the 4.0 routes yet.
    ctx.report({
      code: "unsupported_param",
      path: ["rendering_speed"],
      message:
        '`rendering_speed: "FLASH"` is not supported by Ideogram 4.0 yet — the API returns 400 ("coming soon"). Use "TURBO", "DEFAULT" or "QUALITY".',
      meta: {
        allowed: [...V4_RENDERING_SPEEDS],
        value: speed,
        source: `${OPENAPI_URL}#/paths/~1v1~1ideogram-v4~1generate`,
      },
    });
    return;
  }
  ctx.report({
    code: "invalid_enum_value",
    path: ["rendering_speed"],
    message: `\`rendering_speed\` must be one of ${V4_RENDERING_SPEEDS.map((v) => JSON.stringify(v)).join(", ")}; got ${JSON.stringify(speed)}.`,
    meta: {
      allowed: [...V4_RENDERING_SPEEDS],
      value: speed,
      source: `${OPENAPI_URL}#/components/schemas/RenderingSpeed`,
    },
  });
}

// ---------------------------------------------------------------------------
// Estimation — one image per request (the 4.0 generate route has no
// `num_images`), priced by rendering speed.
// ---------------------------------------------------------------------------

function estimate(_params: GenerateV4Params, info: ModelInfo | undefined) {
  const perImage = info?.cost?.perImage;
  return perImage === undefined ? {} : { costUSD: perImage };
}

/**
 * The one `.toSdk("ideogram")` target for this endpoint — Ideogram publishes
 * no official JS SDK, so this is the multipart source. Derived from the
 * `sdk` literal in `finalize`; it must stay an object type with no index
 * signature, or `toSdk` would accept any string.
 */
type IdeogramSdkTargets<B> = { ideogram: () => B };

function finalize(params: GenerateV4Params): unknown {
  const body = { ...params };
  return toValidated(body, {
    url: IDEOGRAM_V4_GENERATE_URL,
    method: "POST",
    // Deliberately NOT application/json: multipart endpoint — fetch derives
    // the boundary from the FormData body.
    headers: {},
  }, {
    sdk: { ideogram: () => body },
  });
}

const validator = createValidator<GenerateV4Params, unknown>({
  endpoint: "ideogram.imageV4",
  schema: generateV4Schema,
  // No model wire param: the billable tier is rendering_speed (default
  // DEFAULT), mapped to a per-speed catalog pseudo-model for pricing. FLASH
  // resolves to no model — checkV4Enums reports it.
  modelId: (params) => RENDERING_SPEED_TO_V4_MODEL_ID[params.rendering_speed ?? "DEFAULT"],
  catalog: models,
  checks: [checkPromptExclusivity, checkJsonPrompt, checkV4Enums],
  estimate,
  finalize,
});

/**
 * Validates params for Ideogram `POST /v1/ideogram-v4/generate` (Ideogram 4.0
 * image generation).
 *
 * Multipart endpoint: the validated output's enumerable props are the
 * validated params, and the raw-fetch path is `.request.url` +
 * `ideogram.toFormData(validated)` as the body — never `JSON.stringify`.
 * `.toSdk("ideogram")` returns the params unchanged (Ideogram publishes no official JS
 * SDK). Auth is your job: add an `Api-Key` header when fetching.
 *
 * ```ts
 * const params = ideogram.imageV4({
 *   text_prompt: "a neon-lit ramen bar in the rain",
 *   resolution: "2048x2048",
 *   rendering_speed: "QUALITY",
 * });
 * ```
 */
export const imageV4 = validator as unknown as {
  <T extends GenerateV4Params>(
    params: T & ExactKeys<T, GenerateV4Params>,
    options?: ValidateOptions<T>,
  ): Validated<T, IdeogramSdkTargets<T>>;
  safe<T extends GenerateV4Params>(
    params: T & ExactKeys<T, GenerateV4Params>,
    options?: ValidateOptions<T>,
  ): ValidateResult<Validated<T, IdeogramSdkTargets<T>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};

export type { IdeogramRenderingSpeed };
