/**
 * Topaz generative upscale — POST https://api.topazlabs.com/image/v1/enhance-gen/async
 *
 * The Wonder and Bloom families: nine diffusion models that ADD detail rather
 * than recovering it, steered by a prompt and a creativity dial. The classic
 * half lives one route over at {@link ./upscale}, and the split is Topaz's own
 * — two paths, two disjoint model enums, two different sets of dials. That is a
 * wire route fork, so it is a second address (`topaz.upscaleGenerative`) rather
 * than a parameter on the first.
 *
 * The two routes share an envelope and nothing else. `strength` and
 * `fixCompression` exist only on the classic one; `prompt`, `autoprompt`,
 * `creativity`, `texture`, `detail` and `detailStrength` only here. A caller
 * who moves a request from one to the other by changing `model` has to change
 * the dials too, which is exactly what two addresses say and one address with a
 * union would hide.
 *
 * Wire notes (verified against the published OpenAPI 3.1.2 document and the
 * per-model pages under /image-models/wonder and /image-models/bloom on
 * 2026-08-25):
 *
 * - **multipart/form-data, always** — see `./upscale.ts`. Build the body with
 *   `toFormData` and let `fetch` derive the boundary.
 * - Exactly one of `image`, `source_id`, `source_url`.
 * - `prompt` is up to 1024 characters and Topaz asks for it DESCRIPTIVE rather
 *   than imperative: "girl with red hair and blue eyes", not "change the girl's
 *   hair to red". `autoprompt: true` writes one for you and ignores whatever
 *   `prompt` said.
 * - `creativity` is an integer 1–9 (1–4 on `Bloom Realism`, which narrows a
 *   shared dial), `texture` 1–5.
 * - The MP ceilings here are much tighter than on the classic route — 128 MP at
 *   `Wonder`, 256 at `Redefine` — and `checkOutputMegapixels` knows them.
 * - Headers: add `X-API-Key: <TOPAZ_API_KEY>` yourself.
 */

import { z } from "zod";
import { createValidator, type PipelineContext } from "../../core/pipeline";
import { toValidated, type ExactKeys, type ValidatedForm } from "../../core/request";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";
import type { ModelInfo } from "../../core/catalog-types";
import type { EndpointConstraints } from "../../core/constraint-types";
import { models } from "./models";
import {
  DOCS_BASE,
  ENHANCE_GEN_URL,
  PROMPT_MAX_CHARS,
  TOPAZ_ENHANCEMENT_STRENGTHS,
  TOPAZ_ENHANCE_GEN_MODELS,
  TOPAZ_GRAIN_MODELS,
  TOPAZ_SUBJECT_DETECTION,
  checkConditionalStrengths,
  checkModelSettings,
  checkOutputMegapixels,
  checkSource,
  envelopeSchema,
  faceSettingsSchema,
  type TopazEnhanceGenModel,
  type TopazEnhanceGenSettings,
  type TopazEnhancementStrength,
  type TopazGrainModel,
  type TopazOutputFormat,
  type TopazSubjectDetection,
} from "./shared";
import { topazCostUSD } from "./pricing";

export { ENHANCE_GEN_URL } from "./shared";

const SOURCE = `${DOCS_BASE}/image-models/wonder`;

/** Every setting this route documents, in one list for the model-gate check. */
const ENHANCE_GEN_SETTINGS = [
  "faceEnhancement",
  "faceEnhancementStrength",
  "faceEnhancementCreativity",
  "subjectDetection",
  "prompt",
  "autoprompt",
  "creativity",
  "texture",
  "sharpen",
  "denoise",
  "detail",
  "detailStrength",
  "enhancementStrength",
  "grain",
  "grainDensity",
  "grainModel",
  "grainSize",
  "grainStrength",
  "inputWidth",
  "inputHeight",
  "outputWidth",
  "outputHeight",
  "colorPreservation",
  "seed",
] as const;

export interface TopazUpscaleGenerativeParams extends TopazEnhanceGenSettings {
  /** The picture, as the multipart file part. One of this, `source_id` or `source_url`. */
  image?: Blob;
  /** A source Topaz already holds. */
  source_id?: string;
  /** A URL Topaz fetches. The spelling `unmodel/upscale` compiles to. */
  source_url?: string;
  /** One of the nine generative models. Defaults to `"Redefine"` server-side. */
  model?: TopazEnhanceGenModel | (string & {});
  /** 1–32000. */
  output_height?: number;
  /** 1–32000. */
  output_width?: number;
  /** Crop rather than letterbox. Default false. */
  crop_to_fill?: boolean;
  /** Default `"jpeg"`. */
  output_format?: TopazOutputFormat;
  /** JSON callback on every status change. */
  webhook_url?: string;
  /** `Wonder 3`, `Wonder 3.5`. Coarser than `creativity`. */
  enhancementStrength?: TopazEnhancementStrength;
  /** `Wonder 3.5`, `Bloom 2`. Film-grain simulation. */
  grain?: boolean;
  grainDensity?: number;
  grainModel?: TopazGrainModel;
  grainSize?: number;
  grainStrength?: number;
  /** `Wonder 3.5`, `Bloom 2`. Declare the input's pixel dimensions. */
  inputWidth?: number;
  inputHeight?: number;
  /**
   * `Wonder 3.5`, `Bloom 2`. A SECOND, camelCased spelling of the output size
   * that those two pages document alongside the envelope's own
   * `output_width` / `output_height`. Topaz states no precedence between them;
   * both are typed and neither is preferred, because guessing which wins would
   * be a guess about billing.
   */
  outputWidth?: number;
  outputHeight?: number;
  /** `Bloom 2`. Keep the source's colours while new detail is added. */
  colorPreservation?: boolean;
  /** `Bloom 2` (default 2), `Bloom Realism` (1–2000, default 1). */
  seed?: number;
}

const unitInterval = z.number().min(0).max(1);

const upscaleGenSchema = z.looseObject({
  ...envelopeSchema,
  ...faceSettingsSchema,
  model: z.string().optional(),
  prompt: z.string().max(PROMPT_MAX_CHARS).optional(),
  autoprompt: z.boolean().optional(),
  creativity: z.number().int().min(1).max(9).optional(),
  texture: z.number().int().min(1).max(5).optional(),
  sharpen: unitInterval.optional(),
  denoise: unitInterval.optional(),
  detail: z.boolean().optional(),
  detailStrength: z.number().min(0).max(10).optional(),
  enhancementStrength: z.enum(TOPAZ_ENHANCEMENT_STRENGTHS).optional(),
  grain: z.boolean().optional(),
  grainDensity: z.number().optional(),
  grainModel: z.enum(TOPAZ_GRAIN_MODELS).optional(),
  grainSize: z.number().optional(),
  grainStrength: z.number().optional(),
  inputWidth: z.number().int().optional(),
  inputHeight: z.number().int().optional(),
  outputWidth: z.number().int().optional(),
  outputHeight: z.number().int().optional(),
  colorPreservation: z.boolean().optional(),
  seed: z.number().int().optional(),
});

const SUBJECT_ENUM = { subjectDetection: TOPAZ_SUBJECT_DETECTION } as Readonly<
  Record<string, readonly TopazSubjectDetection[]>
>;

const STRENGTH_ENUM = {
  subjectDetection: TOPAZ_SUBJECT_DETECTION,
  enhancementStrength: TOPAZ_ENHANCEMENT_STRENGTHS,
} as Readonly<Record<string, readonly string[]>>;

export const upscaleGenerativeConstraints = {
  Redefine: { enums: SUBJECT_ENUM },
  Wonder: { enums: SUBJECT_ENUM },
  "Wonder 2": { enums: SUBJECT_ENUM },
  "Wonder 3": { enums: STRENGTH_ENUM },
  "Wonder 3.5": { enums: STRENGTH_ENUM },
  "Standard MAX": { enums: SUBJECT_ENUM },
  "Recover 3": { enums: SUBJECT_ENUM },
  "Bloom 2": { enums: SUBJECT_ENUM },
  // The one per-model narrowing of a SHARED dial in this provider: the
  // endpoint's own block documents `creativity` as 1–9 and Bloom Realism's page
  // documents it as 1–4. `EndpointConstraints.enums` takes a closed list, and a
  // range of integers is one when it is four long.
  "Bloom Realism": { enums: { ...SUBJECT_ENUM, creativity: [1, 2, 3, 4] } },
} as const satisfies Readonly<Partial<Record<string, EndpointConstraints>>>;

/** The server-side default, so an omitted `model` still resolves a catalog row. */
export const DEFAULT_ENHANCE_GEN_MODEL: TopazEnhanceGenModel = "Redefine";

function estimate(
  params: TopazUpscaleGenerativeParams,
  info: ModelInfo | undefined,
  _ctx: PipelineContext,
) {
  if (info === undefined) return {};
  // The camelCased pair is a second spelling of the same size on two models;
  // either one states the output, so either one makes the estimate exact.
  const width = params.output_width ?? params.outputWidth;
  const height = params.output_height ?? params.outputHeight;
  const costUSD = topazCostUSD({
    model: info.id,
    ...(width !== undefined && { outputWidth: width }),
    ...(height !== undefined && { outputHeight: height }),
  });
  return costUSD === undefined ? {} : { costUSD };
}

/** See `./upscale.ts` — Topaz ships no JavaScript SDK; this is the same object. */
type TopazSdkTargets<B> = { topaz: () => B };

function finalize(params: TopazUpscaleGenerativeParams): unknown {
  const body = { ...params };
  return toValidated(
    body,
    { url: ENHANCE_GEN_URL, method: "POST", headers: {}, body: "form" },
    { sdk: { topaz: () => body } },
  );
}

const validator = createValidator<TopazUpscaleGenerativeParams, unknown>({
  endpoint: "topaz.upscaleGenerative",
  schema: upscaleGenSchema,
  modelId: (params) => params.model ?? DEFAULT_ENHANCE_GEN_MODEL,
  catalog: models,
  constraints: upscaleGenerativeConstraints,
  checks: [
    checkSource(SOURCE),
    checkConditionalStrengths(SOURCE),
    checkModelSettings(SOURCE, ENHANCE_GEN_SETTINGS),
    checkOutputMegapixels(SOURCE),
  ],
  estimate,
  finalize,
});

/**
 * Validates raw wire params for Topaz `POST /image/v1/enhance-gen/async`.
 *
 * The returned object's enumerable props are the form fields — post
 * `toFormData(params)`, never `JSON.stringify`. Auth is yours to add:
 * `X-API-Key: <TOPAZ_API_KEY>`.
 *
 * ```ts
 * const params = topaz.upscaleGenerative({
 *   source_url: "https://example.com/faded-negative.jpg",
 *   model: "Redefine",
 *   prompt: "a wooden sailing boat at anchor in calm water",
 *   creativity: 4,
 *   output_width: 6000,
 *   output_height: 4000,
 * });
 * ```
 *
 * `creativity` is the dial to reach for first and the one that costs: it decides
 * how much of the result is recovered and how much is invented. Topaz's own
 * advice is `texture: 1` at low creativity and `3` at high. Poll and download
 * exactly as for the classic route.
 */
export const upscaleGenerative = validator as unknown as {
  <T extends TopazUpscaleGenerativeParams>(
    params: T & ExactKeys<T, TopazUpscaleGenerativeParams>,
    options?: ValidateOptions<T>,
  ): ValidatedForm<T, TopazSdkTargets<T>>;
  safe<T extends TopazUpscaleGenerativeParams>(
    params: T & ExactKeys<T, TopazUpscaleGenerativeParams>,
    options?: ValidateOptions<T>,
  ): ValidateResult<ValidatedForm<T, TopazSdkTargets<T>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};

/** Every model this address serves, for the adapter's route fork. */
export const ENHANCE_GEN_MODELS = TOPAZ_ENHANCE_GEN_MODELS;
