/**
 * Topaz precision upscale — POST https://api.topazlabs.com/image/v1/enhance/async
 *
 * The Gigapixel family: six classic (GAN) models that enlarge a picture without
 * inventing anything that was not in it. The generative half lives one route
 * over at {@link ./upscale-generative}, with its own model enum and its own
 * dials, which is why the two are separate addresses.
 *
 * Wire notes (verified against the published OpenAPI 3.1.2 document and the
 * per-model pages under https://developer.topazlabs.com/image-models/gigapixel
 * on 2026-08-25):
 *
 * - **multipart/form-data, always.** The path declares no JSON arm, so even a
 *   `source_url`-only request is form-encoded. Build the body with
 *   {@link toFormData} and let `fetch` derive the boundary —
 *   `.request.headers` is empty on purpose.
 * - **Nothing is `required` in the schema**, and a request still needs a
 *   picture: exactly one of `image`, `source_id` or `source_url`.
 *   {@link checkSource} is the guard.
 * - `output_width` / `output_height` are 1–32000; naming one scales the other
 *   proportionally. Naming NEITHER lets Topaz choose, which is also the case
 *   where the cost estimate declines.
 * - The tuning dials (`faceEnhancement`, `sharpen`, `denoise`, `strength`, …)
 *   are NOT in the OpenAPI schema — it types the whole space as
 *   `additionalProperties: { type: string }`. They are transcribed per model in
 *   `./shared.ts`, and Topaz IGNORES one a model does not read rather than
 *   refusing it.
 * - Async: `{ process_id, source_id, eta }`, then `GET /status/{process_id}`
 *   until `Completed`, then `GET /download/{process_id}` for a presigned URL
 *   that expires in an hour. `webhook_url` replaces the polling.
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
  ENHANCE_URL,
  TOPAZ_ENHANCE_MODELS,
  TOPAZ_SUBJECT_DETECTION,
  checkConditionalStrengths,
  checkModelSettings,
  checkOutputMegapixels,
  checkSource,
  envelopeSchema,
  faceSettingsSchema,
  type TopazEnhanceModel,
  type TopazEnhanceSettings,
  type TopazOutputFormat,
  type TopazSubjectDetection,
} from "./shared";
import { topazCostUSD } from "./pricing";

export { ENHANCE_URL, toFormData } from "./shared";

const SOURCE = `${DOCS_BASE}/image-models/gigapixel`;

/** Every setting this route documents, in one list for the model-gate check. */
const ENHANCE_SETTINGS = [
  "faceEnhancement",
  "faceEnhancementStrength",
  "faceEnhancementCreativity",
  "subjectDetection",
  "sharpen",
  "denoise",
  "fixCompression",
  "strength",
  "recoveryStrength",
  "opacity",
  "deblurStrength",
  "denoiseStrength",
  "decompressionStrength",
] as const;

export interface TopazUpscaleParams extends TopazEnhanceSettings {
  /**
   * The picture, as the multipart file part. One of this, `source_id` or
   * `source_url` — exactly one.
   *
   * JPEG, PNG or TIFF. A `Blob` here is what makes the request multipart in the
   * strict sense; the other two spellings are still form-encoded, because this
   * path has no JSON arm.
   */
  image?: Blob;
  /** A source Topaz already holds — every submit answers a `source_id`. */
  source_id?: string;
  /** A URL Topaz fetches. The spelling `unmodel/upscale` compiles to. */
  source_url?: string;
  /** One of the six Gigapixel models. Defaults to `"Standard V2"` server-side. */
  model?: TopazEnhanceModel | (string & {});
  /** 1–32000. Omit both dimensions to let Topaz choose (and the estimate decline). */
  output_height?: number;
  /** 1–32000. Naming only one scales the other proportionally. */
  output_width?: number;
  /** Crop rather than letterbox when the target ratio differs. Default false. */
  crop_to_fill?: boolean;
  /** Default `"jpeg"`. */
  output_format?: TopazOutputFormat;
  /** JSON callback on every status change. 5xx retried to a 15-minute cap. */
  webhook_url?: string;
  /** `Upscale High Fidelity V3`. 0–1, default 1.0. */
  recoveryStrength?: number;
  /** `Upscale High Fidelity V3`, `Text Refine`. 0–1, default 1.0. */
  opacity?: number;
  /** `CGI`, `Text Refine`. 0–1, default 0.5. */
  deblurStrength?: number;
  /** `Text Refine`. 0–1, default 0.5. */
  denoiseStrength?: number;
  /** `Text Refine`. 0–1, default 0.5. */
  decompressionStrength?: number;
}

const unitInterval = z.number().min(0).max(1);

const upscaleSchema = z.looseObject({
  ...envelopeSchema,
  ...faceSettingsSchema,
  model: z.string().optional(),
  sharpen: unitInterval.optional(),
  denoise: unitInterval.optional(),
  fixCompression: unitInterval.optional(),
  strength: z.number().min(0.01).max(1).optional(),
  recoveryStrength: unitInterval.optional(),
  opacity: unitInterval.optional(),
  deblurStrength: unitInterval.optional(),
  denoiseStrength: unitInterval.optional(),
  decompressionStrength: unitInterval.optional(),
});

/**
 * `subjectDetection`'s three values, as the one enum this route narrows.
 *
 * `EndpointConstraints.enums` is what a table can express; the per-model
 * SETTING gate is a check, because `deny` names top-level params and the answer
 * a caller needs is "which models do read this", which a deny rule has nowhere
 * to put.
 */
const SUBJECT_ENUM = { subjectDetection: TOPAZ_SUBJECT_DETECTION } as Readonly<
  Record<string, readonly TopazSubjectDetection[]>
>;

export const upscaleConstraints = {
  "Standard V2": { enums: SUBJECT_ENUM },
  "High Fidelity V2": { enums: SUBJECT_ENUM },
  "Upscale High Fidelity V3": { enums: SUBJECT_ENUM },
  "Low Resolution V2": { enums: SUBJECT_ENUM },
  CGI: { enums: SUBJECT_ENUM },
  "Text Refine": { enums: SUBJECT_ENUM },
} as const satisfies Readonly<Partial<Record<string, EndpointConstraints>>>;

/** The server-side default, so an omitted `model` still resolves a catalog row. */
export const DEFAULT_ENHANCE_MODEL: TopazEnhanceModel = "Standard V2";

function estimate(params: TopazUpscaleParams, info: ModelInfo | undefined, _ctx: PipelineContext) {
  if (info === undefined) return {};
  const costUSD = topazCostUSD({
    model: info.id,
    ...(params.output_width !== undefined && { outputWidth: params.output_width }),
    ...(params.output_height !== undefined && { outputHeight: params.output_height }),
  });
  return costUSD === undefined ? {} : { costUSD };
}

/**
 * `.toSdk("topaz")` hands back the same flat object.
 *
 * Topaz ships no JavaScript SDK, so this target exists for the shape the rest
 * of the library has rather than for a client to consume: the object it returns
 * is what {@link toFormData} takes. Derived from the `sdk` literal in
 * `finalize`; it must stay an object type with no index signature, or `toSdk`
 * would accept any string.
 */
type TopazSdkTargets<B> = { topaz: () => B };

function finalize(params: TopazUpscaleParams): unknown {
  const body = { ...params };
  // Empty headers, deliberately: `fetch` derives the multipart boundary from
  // the `FormData` and a hand-set content-type would break the request.
  return toValidated(
    body,
    { url: ENHANCE_URL, method: "POST", headers: {}, body: "form" },
    { sdk: { topaz: () => body } },
  );
}

const validator = createValidator<TopazUpscaleParams, unknown>({
  endpoint: "topaz.upscale",
  schema: upscaleSchema,
  modelId: (params) => params.model ?? DEFAULT_ENHANCE_MODEL,
  catalog: models,
  constraints: upscaleConstraints,
  checks: [
    checkSource(SOURCE),
    checkConditionalStrengths(SOURCE),
    checkModelSettings(SOURCE, ENHANCE_SETTINGS),
    checkOutputMegapixels(SOURCE),
  ],
  estimate,
  finalize,
});

/**
 * Validates raw wire params for Topaz `POST /image/v1/enhance/async`.
 *
 * The returned object's enumerable props are the form fields — post
 * `toFormData(params)`, never `JSON.stringify`. Auth is yours to add:
 * `X-API-Key: <TOPAZ_API_KEY>`.
 *
 * ```ts
 * const params = topaz.upscale({
 *   source_url: "https://example.com/portrait.jpg",
 *   model: "Standard V2",
 *   output_width: 4096,
 *   output_height: 4096,
 *   faceEnhancement: true,
 *   faceEnhancementStrength: 0.6,
 *   faceEnhancementCreativity: 0.2,
 * });
 * const res = await fetch(params.request.url, {
 *   method: params.request.method,
 *   headers: { "X-API-Key": process.env.TOPAZ_API_KEY! },
 *   body: topaz.toFormData(params),
 * });
 * const { process_id, eta } = await res.json();
 * ```
 *
 * Then poll `statusUrl(process_id)` until `status` is `"Completed"` and call
 * `downloadUrl(process_id)` for a presigned link that expires after an hour.
 * `eta` is a Unix timestamp of when Topaz expects to finish, which is what to
 * schedule the first poll against rather than a fixed interval.
 */
export const upscale = validator as unknown as {
  <T extends TopazUpscaleParams>(
    params: T & ExactKeys<T, TopazUpscaleParams>,
    options?: ValidateOptions<T>,
  ): ValidatedForm<T, TopazSdkTargets<T>>;
  safe<T extends TopazUpscaleParams>(
    params: T & ExactKeys<T, TopazUpscaleParams>,
    options?: ValidateOptions<T>,
  ): ValidateResult<ValidatedForm<T, TopazSdkTargets<T>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};

/** Every model this address serves, for the adapter's route fork. */
export const ENHANCE_MODELS = TOPAZ_ENHANCE_MODELS;
