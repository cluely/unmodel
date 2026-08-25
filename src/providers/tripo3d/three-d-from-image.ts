/**
 * Tripo Image to 3D — POST https://openapi.tripo3d.ai/v3/generation/image-to-model
 *
 * Wire notes (verified against the H-series and P-series request schemas on
 * https://developers.tripo3d.ai/en/docs/generation-image-to-model/standard and
 * /p on 2026-08-25):
 * - `input` and `model` are the only required fields.
 * - `input` is ONE polymorphic string and the API tells the three cases apart by
 *   PREFIX: a `file_…` token from `POST /v3/files`, a public http(s) URL, or a
 *   `task_…` id from an earlier image-generation task. "Choose exactly one."
 *   PNG / JPEG / WebP, up to 20 MB, at least 256×256 recommended.
 * - No `image_seed` here — that seed pins the text-to-image stage the TEXT route
 *   runs, and this route has no such stage. `model_seed` and `texture_seed` are
 *   both present.
 * - `texture_alignment` and `orientation` are this route's own: whether the
 *   texture should match the picture's colours or the generated geometry, and
 *   whether the mesh should be turned to the photograph's viewpoint.
 * - Async and version-gated exactly as the text route is; see `./three-d.ts`.
 *
 * A separate endpoint from `tripo3d.threeD` rather than an arm of it because
 * the two are separate URLs with different required fields — the same reason
 * `vidu.videoFromImage` and `lightricks.videoFromImage` are their own
 * addresses. `unmodel/3d` hides the fork: its adapter picks the route from
 * whether the caller passed `prompt` or `image`.
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
  IMAGE_TO_MODEL_URL,
  TRIPO3D_HEADERS,
  TEXTURE_ALIGNMENTS,
  ORIENTATIONS,
  checkFaceLimit,
  checkGenerateParts,
  checkImageInput,
  checkPbrForcesTexture,
  checkVersionGatedParams,
  generationCommonSchema,
  type Tripo3dCompression,
  type Tripo3dGeometryQuality,
  type Tripo3dModelId,
  type Tripo3dOrientation,
  type Tripo3dTextureAlignment,
  type Tripo3dTextureQuality,
} from "./shared";
import { tripo3dCostUSD } from "./pricing";

export { IMAGE_TO_MODEL_URL } from "./shared";

const SOURCE = `${DOCS_BASE}/generation-image-to-model/standard`;

export interface ImageToModelParams {
  /**
   * Required. Exactly one of: a `file_…` token from `POST /v3/files`, a public
   * http(s) URL, or a `task_…` id from a prior text-to-image / image-to-image
   * task. The API disambiguates by prefix; there is no separate type field.
   */
  input: string;
  /** Required. The dated model id — see `TRIPO3D_MODELS` on the alias conflict. */
  model: Tripo3dModelId | (string & {});
  /** Enhances a low-resolution or low-quality input before generating. */
  enable_image_autofix?: boolean;
  /** Match the picture's colours, or the generated geometry. */
  texture_alignment?: Tripo3dTextureAlignment;
  /** `align_image` turns the mesh to the photograph's viewpoint. Needs `texture`. */
  orientation?: Tripo3dOrientation;
  /** Pins the GEOMETRY. This is the seed `unmodel/3d`'s canonical `seed` maps to. */
  model_seed?: number;
  /** Pins texturing. */
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

const imageToModelSchema = z.looseObject({
  input: z.string().min(1),
  enable_image_autofix: z.boolean().optional(),
  texture_alignment: z.enum(TEXTURE_ALIGNMENTS).optional(),
  orientation: z.enum(ORIENTATIONS).optional(),
  ...generationCommonSchema,
});

function estimate(params: ImageToModelParams, info: ModelInfo | undefined, _ctx: PipelineContext) {
  if (info === undefined) return {};
  const costUSD = tripo3dCostUSD({
    task: "image_to_model",
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

/** See `./three-d.ts` — Tripo's SDK takes the same flat body. */
type Tripo3dSdkTargets<B> = { tripo3d: () => B };

function finalize(params: ImageToModelParams): unknown {
  const body = { ...params };
  return toValidated(
    body,
    { url: IMAGE_TO_MODEL_URL, method: "POST", headers: TRIPO3D_HEADERS },
    { sdk: { tripo3d: () => body } },
  );
}

const validator = createValidator<ImageToModelParams, unknown>({
  endpoint: "tripo3d.threeDFromImage",
  schema: imageToModelSchema,
  modelId: (params) => params.model,
  catalog: models,
  checks: [
    checkImageInput(SOURCE),
    checkVersionGatedParams(SOURCE),
    checkGenerateParts(SOURCE),
    checkPbrForcesTexture(SOURCE),
    checkFaceLimit(SOURCE),
  ],
  estimate,
  finalize,
});

/**
 * Validates raw wire params for Tripo `POST /v3/generation/image-to-model`.
 *
 * The returned object's enumerable props are the exact fetch JSON body.
 * `.toSdk("tripo3d")` returns it unchanged. Auth is yours to add:
 * `Authorization: Bearer <TRIPO_API_KEY>`.
 *
 * ```ts
 * const params = tripo3d.threeDFromImage({
 *   model: "v3.1-20260211",
 *   input: "https://example.com/chair.png",
 *   texture_alignment: "original_image",
 * });
 * ```
 *
 * As with the text route, the POST answers `{ code: 0, data: { task_id } }` —
 * poll `GET /v3/tasks/{task_id}` and read `data.output.model_url`, which
 * expires.
 */
export const threeDFromImage = validator as unknown as {
  <T extends ImageToModelParams>(
    params: T & ExactKeys<T, ImageToModelParams>,
    options?: ValidateOptions<T>,
  ): Validated<T, Tripo3dSdkTargets<T>>;
  safe<T extends ImageToModelParams>(
    params: T & ExactKeys<T, ImageToModelParams>,
    options?: ValidateOptions<T>,
  ): ValidateResult<Validated<T, Tripo3dSdkTargets<T>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
