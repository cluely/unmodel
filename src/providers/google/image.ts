/**
 * Imagen image generation — the Gemini API predict route
 * POST https://generativelanguage.googleapis.com/v1beta/models/{model}:predict
 *
 * Which Google image model rides which route (audited 2026-08-13):
 * - Imagen 4 (imagen-4.0-generate-001 / -ultra- / -fast-) → THIS endpoint.
 *   All three are deprecated with an announced 2026-08-17 shutdown, so every
 *   request also gets a deprecated_model warning (see ./imagen-models).
 * - Nano Banana (gemini-3.1-flash-image, gemini-3.1-flash-lite-image,
 *   gemini-3-pro-image, gemini-2.5-flash-image) → NOT here: those generate
 *   images through `generateContent` with responseModalities ["TEXT","IMAGE"]
 *   plus generationConfig.imageConfig / responseFormat.image, which
 *   ./generate-content validates.
 *
 * Wire notes (verified against https://ai.google.dev/gemini-api/docs/imagen
 * and @google/genai@2.17.0's Gemini-API ("mldev") request converter):
 * - Body is `{ instances: [{ prompt }], parameters: {...} }` — exactly ONE
 *   instance; `parameters.sampleCount` controls how many images come back.
 * - PARAMETER NAMES: the guide's prose uses the SDK's names ("Naming
 *   conventions of parameters vary by programming language"), the wire uses
 *   the predict names. The SDK converter is the mapping of record:
 *   numberOfImages → `sampleCount`, imageSize → `sampleImageSize`,
 *   safetyFilterLevel → `safetySetting`, outputMimeType /
 *   outputCompressionQuality → `outputOptions.{mimeType,compressionQuality}`.
 *   `sampleImageSize` in particular is easy to get wrong — it is NOT
 *   `imageSize` on the wire.
 * - Vertex-only knobs have NO Gemini API wire form: @google/genai throws
 *   client-side ("only supported in Gemini Enterprise Agent Platform mode")
 *   on outputGcsUri/storageUri, negativePrompt, seed, addWatermark, labels
 *   and enhancePrompt, and the guide's parameter list omits them — so they
 *   are typed `never` here and denied at runtime.
 * - The response is `{ predictions: [{ bytesBase64Encoded, mimeType }] }`;
 *   every image carries a SynthID watermark unconditionally.
 * - Auth is your job: add an `x-goog-api-key` header (or `?key=`) when fetching.
 */

import { z } from "zod";
import { constraintsFor, createValidator, type PipelineContext } from "../../core/pipeline";
import {
  JSON_HEADERS,
  toValidated,
  type ExactKeys,
  type RequestMeta,
  type Validated,
} from "../../core/request";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";
import type { ModelInfo } from "../../core/catalog-types";
import type { EndpointConstraints } from "../../core/constraint-types";
// `./model-path`, not `./chat`: the two share one six-line normalization, and
// taking it from the chat validator used to pull that module's whole graph —
// the Gemini wire schema, the chat constraint tables, the retarget engine and
// two dialect codecs — into an entry that only generates images.
import { GOOGLE_MODELS_BASE_URL, googleModelUrl, stripModelsPrefix } from "./model-path";
import {
  IMAGEN_DOCS_URL,
  imageConstraints,
  imageFamilyRules,
} from "./constraints";
import { imageModels, type GoogleImagenModelId } from "./imagen-models";

export const GENERATE_IMAGES_BASE_URL = GOOGLE_MODELS_BASE_URL;

// ---------------------------------------------------------------------------
// Wire types — Tier A: one arm per documented model id. The only per-model
// difference the docs state is `sampleImageSize`, which "is only supported for
// the Standard and Ultra models" — so it is `never` on the Fast arm even
// though @google/genai's `GenerateImagesConfig.imageSize` allows it for all
// three.
// ---------------------------------------------------------------------------

/** Aspect ratios Imagen documents. Much narrower than Nano Banana's 14. */
export type GoogleImagenAspectRatio = "1:1" | "3:4" | "4:3" | "9:16" | "16:9";

/** "The supported values are 1K and 2K. Default is 1K." (wire key: sampleImageSize) */
export type GoogleImagenImageSize = "1K" | "2K";

/**
 * Lowercase is the spelling the Imagen guide documents; the SCREAMING_CASE
 * variants are @google/genai's `PersonGeneration` enum, forwarded verbatim to
 * the same wire field.
 */
export type GoogleImagenPersonGeneration =
  | "dont_allow"
  | "allow_adult"
  | "allow_all"
  | "DONT_ALLOW"
  | "ALLOW_ADULT"
  | "ALLOW_ALL";

/** One prompt per request. "Imagen supports English only prompts at this time." */
export interface GoogleImagenInstance {
  prompt: string;
}

/** `parameters.outputOptions` (SDK: outputMimeType / outputCompressionQuality). */
export interface GoogleImagenOutputOptions {
  /** e.g. "image/jpeg", "image/png". */
  mimeType?: string;
  /** JPEG only. */
  compressionQuality?: number;
}

interface GoogleImagenParametersBase {
  /** "The number of images to generate, from 1 to 4 (inclusive). The default is 4." */
  sampleCount?: number;
  aspectRatio?: GoogleImagenAspectRatio;
  personGeneration?: GoogleImagenPersonGeneration;
  /** SDK: safetyFilterLevel. Undocumented in the Imagen guide; passed through. */
  safetySetting?: string;
  includeSafetyAttributes?: boolean;
  includeRaiReason?: boolean;
  /** SDK: ImagePromptLanguage. Undocumented in the guide; passed through. */
  language?: string;
  guidanceScale?: number;
  outputOptions?: GoogleImagenOutputOptions;
  /** Vertex AI-only (SDK outputGcsUri) — no Gemini API wire form. */
  storageUri?: never;
  /** Vertex AI-only — no Gemini API wire form. */
  negativePrompt?: never;
  /** Vertex AI-only — no Gemini API wire form. */
  seed?: never;
  /** Vertex AI-only — Gemini API output is always SynthID-watermarked. */
  addWatermark?: never;
  /** Vertex AI-only — no Gemini API wire form. */
  enhancePrompt?: never;
}

/** Standard/Ultra parameters: `sampleImageSize` is supported. */
export interface GoogleImagenParameters extends GoogleImagenParametersBase {
  /** SDK: imageSize. "Only supported for the Standard and Ultra models." */
  sampleImageSize?: GoogleImagenImageSize;
}

/** Fast parameters: the docs restrict image sizing to Standard/Ultra. */
export interface GoogleImagenFastParameters extends GoogleImagenParametersBase {
  sampleImageSize?: never;
}

interface GenerateImagesBodyBase {
  /** Exactly one instance; use parameters.sampleCount for multiple images. */
  instances: GoogleImagenInstance[];
}

export interface ImagenStandardBody extends GenerateImagesBodyBase {
  model: "imagen-4.0-generate-001";
  parameters?: GoogleImagenParameters;
}

export interface ImagenUltraBody extends GenerateImagesBodyBase {
  model: "imagen-4.0-ultra-generate-001";
  parameters?: GoogleImagenParameters;
}

export interface ImagenFastBody extends GenerateImagesBodyBase {
  model: "imagen-4.0-fast-generate-001";
  parameters?: GoogleImagenFastParameters;
}

/** Escape hatch for models unmodel doesn't know yet (unknown_model warning). */
export interface UnknownImagenBody extends GenerateImagesBodyBase {
  model: string & {};
  parameters?: Record<string, unknown>;
}

export type GenerateImagesBody =
  | ImagenStandardBody
  | ImagenUltraBody
  | ImagenFastBody
  | UnknownImagenBody;

interface GenerateImagesBodyByModel {
  "imagen-4.0-generate-001": ImagenStandardBody;
  "imagen-4.0-ultra-generate-001": ImagenUltraBody;
  "imagen-4.0-fast-generate-001": ImagenFastBody;
}

/** Resolves a model id literal to its exact Tier-A arm. */
type ImagenArm<M extends string> = M extends keyof GenerateImagesBodyByModel
  ? GenerateImagesBodyByModel[M]
  : UnknownImagenBody;

// ---------------------------------------------------------------------------
// SDK view — @google/genai's ai.models.generateImages({ model, prompt,
// config }): instances[0].prompt becomes top-level `prompt` and every
// `parameters.*` key becomes its SDK-side name under `config`.
// Caveat: the SDK declares TS enums for personGeneration (PersonGeneration),
// safetyFilterLevel (SafetyFilterLevel) and language (ImagePromptLanguage),
// so those three appear in the config type only when the caller actually
// passed them — requests without them assign to GenerateImagesParameters with
// no cast, and requests with them need the documented cast at the call site
// (same pattern as generateContent's safety enums).
// ---------------------------------------------------------------------------

interface GenerateImagesSdkConfigBase {
  numberOfImages?: number;
  aspectRatio?: string;
  imageSize?: string;
  includeSafetyAttributes?: boolean;
  includeRaiReason?: boolean;
  guidanceScale?: number;
  outputMimeType?: string;
  outputCompressionQuality?: number;
}

type SdkEnumPart<T, K extends string, Out extends string> = T extends {
  parameters: Record<K, infer V>;
}
  ? Record<Out, V>
  : {};

export type GenerateImagesSdkConfig<T extends GenerateImagesBody = GenerateImagesBody> =
  GenerateImagesSdkConfigBase &
    SdkEnumPart<T, "personGeneration", "personGeneration"> &
    SdkEnumPart<T, "safetySetting", "safetyFilterLevel"> &
    SdkEnumPart<T, "language", "language">;

export type GenerateImagesSdkParams<T extends GenerateImagesBody = GenerateImagesBody> = {
  model: T["model"];
  prompt: string;
  config?: GenerateImagesSdkConfig<T>;
};

// ---------------------------------------------------------------------------
// Schema (loose: unknown keys pass through; the pipeline warns on unknown
// top-level keys by introspecting the shape).
// ---------------------------------------------------------------------------

const schema = z.looseObject({
  model: z.string(),
  instances: z
    .array(z.looseObject({ prompt: z.string() }))
    .min(1, "instances must contain exactly one instance")
    .max(
      1,
      "Imagen takes exactly one instance per request; use parameters.sampleCount for multiple images",
    ),
  parameters: z
    .looseObject({
      sampleCount: z.number().int().min(1).optional(),
      aspectRatio: z.string().optional(),
      sampleImageSize: z.string().optional(),
      personGeneration: z.string().optional(),
      safetySetting: z.string().optional(),
      includeSafetyAttributes: z.boolean().optional(),
      includeRaiReason: z.boolean().optional(),
      language: z.string().optional(),
      guidanceScale: z.number().optional(),
      outputOptions: z
        .looseObject({
          mimeType: z.string().optional(),
          compressionQuality: z.number().optional(),
        })
        .optional(),
    })
    .optional(),
});

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

const GENERATE_IMAGES_RULES = {
  constraints: imageConstraints,
  familyRules: imageFamilyRules,
} as const;

/**
 * Applies the deny/enum constraint tables to the nested `parameters` object.
 * The pipeline's generic Layer-3 pass only sees top-level keys, which for this
 * body are model/instances/parameters — so the tables are re-applied here at
 * their real depth (same arrangement as ./video).
 */
function checkImagenParameters(
  params: GenerateImagesBody,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (info === undefined) return;
  const record = (params.parameters ?? {}) as Record<string, unknown>;
  const model = params.model;
  for (const constraints of constraintsFor(GENERATE_IMAGES_RULES, stripModelsPrefix(model))) {
    for (const [param, rule] of Object.entries(constraints.deny ?? {})) {
      if (record[param] != null) {
        ctx.report({
          code: "unsupported_param",
          path: ["parameters", param],
          model,
          message: `\`parameters.${param}\` is not supported by "${model}": ${rule.reason}`,
          meta: { source: rule.source },
        });
      }
    }
    for (const [param, allowed] of Object.entries(constraints.enums ?? {})) {
      const value = record[param];
      if (value != null && !allowed.includes(value as string | number)) {
        ctx.report({
          code: "invalid_enum_value",
          path: ["parameters", param],
          model,
          message: `\`parameters.${param}\` must be one of ${allowed.map((v) => JSON.stringify(v)).join(", ")} for "${model}"; got ${JSON.stringify(value)}.`,
          meta: { allowed: [...allowed], value, source: IMAGEN_DOCS_URL },
        });
      }
    }
  }
}

/** models.{model}:predict (this route) serves image-output models only. */
function checkImageModality(
  params: GenerateImagesBody,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (info === undefined || info.modalities.output.includes("image")) return;
  ctx.report({
    code: "unsupported_capability",
    path: ["model"],
    model: params.model,
    message: `"${params.model}" does not generate images (output modalities: ${info.modalities.output.join(", ")}); models.{model}:predict serves Imagen image models.`,
    meta: { outputModalities: [...info.modalities.output], source: IMAGEN_DOCS_URL },
  });
}

/** "Note: Maximum prompt length is 480 tokens." (rides on `limit.input`). */
function checkPromptLength(
  params: GenerateImagesBody,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const limit = info?.limit.input;
  if (limit === undefined || limit <= 0) return;
  params.instances?.forEach((instance, i) => {
    if (typeof instance?.prompt !== "string") return;
    const tokens = ctx.tokenizer.count(instance.prompt);
    if (tokens <= limit) return;
    ctx.report({
      code: "over_context",
      path: ["instances", i, "prompt"],
      model: params.model,
      message: `~${tokens} estimated prompt tokens exceed the ${limit}-token prompt limit of "${params.model}"; the estimate is heuristic.`,
      meta: { estimated: tokens, limit, source: IMAGEN_DOCS_URL },
    });
  });
}

// ---------------------------------------------------------------------------
// Estimation — Imagen bills a flat rate per generated image; worst case is the
// full requested sampleCount (whose default is 4, not 1).
// Source: https://ai.google.dev/gemini-api/docs/pricing
// ---------------------------------------------------------------------------

/** "The default is 4." — the Imagen guide's numberOfImages description. */
export const IMAGEN_DEFAULT_SAMPLE_COUNT = 4;

function estimate(params: GenerateImagesBody, info: ModelInfo | undefined, _ctx: PipelineContext) {
  const rate = info?.cost?.perImage;
  if (rate === undefined) return {};
  const count =
    (params.parameters as { sampleCount?: number } | undefined)?.sampleCount ??
    IMAGEN_DEFAULT_SAMPLE_COUNT;
  // No inputTokens: the prompt cap is checked directly against `limit.input`,
  // and `limit.context` is 0 so the pipeline's window checks stay out of the way.
  return { costUSD: rate * count };
}

// ---------------------------------------------------------------------------
// Finalize: wire body (model stripped — it lives in the URL) + .toSdk(target) + .request
// ---------------------------------------------------------------------------

/**
 * Endpoint URL for a model id. Accepts both the bare id
 * ("imagen-4.0-generate-001") and the REST-documented "models/…" form — both
 * yield the same URL.
 */
export function generateImagesUrl(model: string): string {
  return googleModelUrl(model, "predict");
}

function buildSdkParams(
  model: string,
  body: Omit<GenerateImagesBody, "model">,
): Record<string, unknown> {
  const parameters = (body.parameters ?? {}) as Record<string, unknown>;
  const outputOptions = parameters["outputOptions"] as GoogleImagenOutputOptions | undefined;
  const config: Record<string, unknown> = {};
  const map: Array<[string, string]> = [
    ["sampleCount", "numberOfImages"],
    ["aspectRatio", "aspectRatio"],
    ["sampleImageSize", "imageSize"],
    ["personGeneration", "personGeneration"],
    ["safetySetting", "safetyFilterLevel"],
    ["includeSafetyAttributes", "includeSafetyAttributes"],
    ["includeRaiReason", "includeRaiReason"],
    ["language", "language"],
    ["guidanceScale", "guidanceScale"],
  ];
  for (const [wire, sdk] of map) {
    if (parameters[wire] !== undefined) config[sdk] = parameters[wire];
  }
  if (outputOptions?.mimeType !== undefined) config["outputMimeType"] = outputOptions.mimeType;
  if (outputOptions?.compressionQuality !== undefined) {
    config["outputCompressionQuality"] = outputOptions.compressionQuality;
  }

  const sdk: Record<string, unknown> = { model, prompt: body.instances[0]?.prompt ?? "" };
  if (Object.keys(config).length > 0) sdk["config"] = config;
  return sdk;
}

/**
 * The SDK targets this endpoint declares: `@google/genai`'s
 * `ai.models.generateImages()`. No `.toApi` — media retargeting is not
 * derivable from the catalog (design-translate §4), so `Avail` stays `never`
 * and `.toApi` does not exist on the result at all.
 */
export type ImageSdkTargets<T extends GenerateImagesBody = GenerateImagesBody> = {
  google: () => GenerateImagesSdkParams<T>;
};

function finalize(params: GenerateImagesBody): unknown {
  const { model, ...body } = params;
  const request: RequestMeta = {
    url: generateImagesUrl(model),
    method: "POST",
    headers: JSON_HEADERS,
  };
  return toValidated(body, request, { sdk: { google: () => buildSdkParams(model, body) } });
}

const validator = createValidator<GenerateImagesBody, unknown>({
  endpoint: "google.image",
  schema,
  modelId: (params) => stripModelsPrefix(params.model),
  catalog: imageModels,
  constraints: imageConstraints,
  familyRules: imageFamilyRules,
  checks: [checkImageModality, checkImagenParameters, checkPromptLength],
  estimate,
  finalize,
});

/**
 * Validates raw wire params for Gemini `models.{model}:predict` (Imagen image
 * generation).
 *
 * The returned object's enumerable props are the exact fetch JSON body —
 * `model` is stripped, because on the wire it lives only in the URL
 * (`.request.url` already has it interpolated). `.toSdk("google")` re-shapes
 * the body for `@google/genai`'s `ai.models.generateImages()`. Auth is your job: add an
 * `x-goog-api-key` header (or `?key=`) when fetching.
 *
 * ```ts
 * const params = google.image({
 *   model: "imagen-4.0-generate-001",
 *   instances: [{ prompt: "Robot holding a red skateboard" }],
 *   parameters: { sampleCount: 4, aspectRatio: "16:9" },
 * });
 * const { predictions } = await fetch(params.request.url, {
 *   method: params.request.method,
 *   headers: { ...params.request.headers, "x-goog-api-key": process.env.GEMINI_API_KEY! },
 *   body: JSON.stringify(params),
 * }).then((r) => r.json());
 * ```
 */
export const image = validator as unknown as {
  <M extends GenerateImagesBody["model"], T extends ImagenArm<M>>(
    params: T & ImagenArm<M> & { model: M } & ExactKeys<T, ImagenArm<M>>,
    options?: ValidateOptions,
  ): Validated<Omit<T, "model">, ImageSdkTargets<T>>;
  safe<M extends GenerateImagesBody["model"], T extends ImagenArm<M>>(
    params: T & ImagenArm<M> & { model: M } & ExactKeys<T, ImagenArm<M>>,
    options?: ValidateOptions,
  ): ValidateResult<Validated<Omit<T, "model">, ImageSdkTargets<T>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};

export type { GoogleImagenModelId };
