/**
 * Tripo Text to 3D — POST https://openapi.tripo3d.ai/v3/generation/text-to-model
 *
 * Wire notes (verified against the H-series and P-series request schemas on
 * https://developers.tripo3d.ai/en/docs/generation-text-to-model/standard and
 * /p on 2026-08-25):
 * - `prompt` (≤1024 chars) and `model` are the only required fields.
 * - Three seeds, and they pin three different stages: `model_seed` the geometry,
 *   `image_seed` the internal text-to-image step this route runs first, and
 *   `texture_seed` the texturing. Same geometry with different textures = keep
 *   `model_seed`, vary `texture_seed`.
 * - `texture` and `pbr` both DEFAULT TO TRUE, and `pbr: true` forces `texture`
 *   true. A bare mesh needs both set false, explicitly.
 * - Seven parameters are gated on the model version, and `v2.5-20250123` takes
 *   none of them. See `./shared.ts`.
 * - Async: responds `{ code: 0, data: { task_id } }`; poll
 *   `GET /v3/tasks/{task_id}`. `code` carries the error, not the HTTP status.
 * - Headers: add `Authorization: Bearer <TRIPO_API_KEY>` yourself — unmodel
 *   never touches credentials.
 */

import { z } from "zod";
import { createValidator, type PipelineContext } from "../../core/pipeline";
import { toValidated, type ExactKeys, type Validated } from "../../core/request";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";
import type { ModelInfo } from "../../core/catalog-types";
import type { EndpointConstraints } from "../../core/constraint-types";
import { models } from "./models";
import {
  DOCS_BASE,
  TEXT_TO_MODEL_URL,
  TRIPO3D_HEADERS,
  checkFaceLimit,
  checkGenerateParts,
  checkPbrForcesTexture,
  checkVersionGatedParams,
  generationCommonSchema,
  negativePromptSchema,
  promptSchema,
  seedSchema,
  type Tripo3dCompression,
  type Tripo3dGeometryQuality,
  type Tripo3dModelId,
  type Tripo3dTextureQuality,
} from "./shared";
import { tripo3dCostUSD } from "./pricing";

export { TEXT_TO_MODEL_URL } from "./shared";

const SOURCE = `${DOCS_BASE}/generation-text-to-model/standard`;

export interface TextToModelParams {
  /** Required; up to 1024 characters. Describe shape, material, style and scale. */
  prompt: string;
  /** Required. The dated model id — see `TRIPO3D_MODELS` on the alias conflict. */
  model: Tripo3dModelId | (string & {});
  /** Up to 255 characters. */
  negative_prompt?: string;
  /** Pins the GEOMETRY. This is the seed `unmodel/3d`'s canonical `seed` maps to. */
  model_seed?: number;
  /** Pins the internal text-to-image stage that runs before 3D conversion. */
  image_seed?: number;
  /** Pins texturing. Vary this with `model_seed` fixed for a re-skin. */
  texture_seed?: number;
  /** Polycount ceiling. Adaptive when omitted; the range depends on the model. */
  face_limit?: number;
  /** Defaults to **true**. */
  texture?: boolean;
  /** Defaults to **true**, and forces `texture` true. */
  pbr?: boolean;
  /** v3.0+ and P1. `extreme` is 8K and costs extra credits. */
  texture_quality?: Tripo3dTextureQuality;
  /** v3.0+ only — `detailed` is Ultra mode. Must NOT be sent with v2.5. */
  geometry_quality?: Tripo3dGeometryQuality;
  /** v3.0+ and P1. Scales the model to real-world metres. */
  auto_size?: boolean;
  /** v3.0+ only. Forces the output format to FBX; default face count 10,000. */
  quad?: boolean;
  /** v3.0+ only. Hand-crafted low-poly topology. */
  smart_low_poly?: boolean;
  /** v3.0+ only. Editable segmented parts; requires texture/pbr/quad all false. */
  generate_parts?: boolean;
  /** v3.0+ and P1. `"geometry"` is meshopt compression. */
  compress?: Tripo3dCompression;
  /** Defaults to true. False is faster and smaller; UVs are done at texturing. */
  export_uv?: boolean;
}

const textToModelSchema = z.looseObject({
  prompt: promptSchema,
  negative_prompt: negativePromptSchema.optional(),
  image_seed: seedSchema.optional(),
  ...generationCommonSchema,
});

/**
 * Per-model narrowing for the version gate.
 *
 * Declared as `enums` on the two quality fields rather than as a list of
 * forbidden keys, because that is what `EndpointConstraints` can express; the
 * key-level refusal is `checkVersionGatedParams`, which produces the message
 * that names which models DO take the parameter.
 */
export const threeDConstraints = {
  "v3.1-20260211": {},
  "v3.0-20250812": {},
  "v2.5-20250123": {},
  "P1-20260311": {},
} as const satisfies Readonly<Partial<Record<string, EndpointConstraints>>>;

function estimate(params: TextToModelParams, info: ModelInfo | undefined, _ctx: PipelineContext) {
  if (info === undefined) return {};
  const costUSD = tripo3dCostUSD({
    task: "text_to_model",
    model: params.model,
    ...(params.texture !== undefined && { texture: params.texture }),
    ...(params.pbr !== undefined && { pbr: params.pbr }),
    ...(params.texture_quality !== undefined && { textureQuality: params.texture_quality }),
    ...(params.geometry_quality !== undefined && { geometryQuality: params.geometry_quality }),
    ...(params.quad !== undefined && { quad: params.quad }),
    ...(params.smart_low_poly !== undefined && { smartLowPoly: params.smart_low_poly }),
    ...(params.generate_parts !== undefined && { generateParts: params.generate_parts }),
  });
  return costUSD === undefined ? {} : { costUSD };
}

/**
 * The one `.toSdk("tripo3d")` target — Tripo ships a JavaScript SDK, but its
 * generation call takes the same flat body, so this is it. Derived from the
 * `sdk` literal in `finalize`; it must stay an object type with no index
 * signature, or `toSdk` would accept any string.
 */
type Tripo3dSdkTargets<B> = { tripo3d: () => B };

function finalize(params: TextToModelParams): unknown {
  const body = { ...params };
  return toValidated(
    body,
    { url: TEXT_TO_MODEL_URL, method: "POST", headers: TRIPO3D_HEADERS },
    { sdk: { tripo3d: () => body } },
  );
}

const validator = createValidator<TextToModelParams, unknown>({
  endpoint: "tripo3d.threeD",
  schema: textToModelSchema,
  modelId: (params) => params.model,
  catalog: models,
  constraints: threeDConstraints,
  checks: [
    checkVersionGatedParams(SOURCE),
    checkGenerateParts(SOURCE),
    checkPbrForcesTexture(SOURCE),
    checkFaceLimit(SOURCE),
  ],
  estimate,
  finalize,
});

/**
 * Validates raw wire params for Tripo `POST /v3/generation/text-to-model`.
 *
 * The returned object's enumerable props are the exact fetch JSON body.
 * `.toSdk("tripo3d")` returns it unchanged. Auth is yours to add:
 * `Authorization: Bearer <TRIPO_API_KEY>`.
 *
 * ```ts
 * const params = tripo3d.threeD({
 *   model: "v3.1-20260211",
 *   prompt: "a brass astrolabe on a walnut stand",
 *   texture_quality: "detailed",
 * });
 * const res = await fetch(params.request.url, {
 *   method: params.request.method,
 *   headers: { ...params.request.headers, authorization: `Bearer ${process.env.TRIPO_API_KEY!}` },
 *   body: JSON.stringify(params),
 * });
 * const { code, data } = await res.json();   // { code: 0, data: { task_id } }
 * ```
 *
 * The POST answers a TASK rather than a mesh: poll `GET /v3/tasks/{task_id}`
 * until `status` is `success`, then read `data.output.model_url` — which is
 * short-lived, so fetch it rather than storing it. `code` carries the error and
 * the HTTP status does not always: an auth failure is 401 AND `code: 2`, and
 * some failures answer 200.
 */
export const threeD = validator as unknown as {
  <T extends TextToModelParams>(
    params: T & ExactKeys<T, TextToModelParams>,
    options?: ValidateOptions<T>,
  ): Validated<T, Tripo3dSdkTargets<T>>;
  safe<T extends TextToModelParams>(
    params: T & ExactKeys<T, TextToModelParams>,
    options?: ValidateOptions<T>,
  ): ValidateResult<Validated<T, Tripo3dSdkTargets<T>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
