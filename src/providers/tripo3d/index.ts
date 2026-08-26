/**
 * unmodel/tripo3d — Tripo's v3 3D generation API.
 *
 * `https://openapi.tripo3d.ai/v3`, flat JSON bodies, one endpoint per
 * operation, `Authorization: Bearer <TRIPO_API_KEY>`.
 *
 * ## What is here
 *
 * Both generation routes: `threeD` (`POST /v3/generation/text-to-model`) and
 * `threeDFromImage` (`POST /v3/generation/image-to-model`), across four models —
 * `v3.1-20260211`, `v3.0-20250812`, `v2.5-20250123` and the low-poly
 * `P1-20260311`. Tripo's mesh-processing surface (texture, convert, segment,
 * decimate, rig, retarget) takes a MESH and returns one, which no unmodel verb
 * describes; its text-to-image routes resell seedream, gemini and gpt-image,
 * which unmodel already carries from the vendors themselves.
 *
 * ## Three things worth knowing before your first call
 *
 * **`texture` and `pbr` both default to TRUE**, and `pbr: true` forces
 * `texture` true whatever else the body says. A bare mesh needs both set false,
 * explicitly — and costs half as much.
 *
 * **Seven parameters are gated on the model version.** `texture_quality`,
 * `geometry_quality`, `auto_size`, `quad`, `smart_low_poly`, `generate_parts`
 * and `compress` are v3.0-and-up; `v2.5-20250123` takes none of them and P1
 * takes three. Sending one to a model that does not take it is a 4xx, and
 * `checkVersionGatedParams` names which models do.
 *
 * **The POST answers a TASK, and `code` carries the error.** A submit returns
 * `{ code: 0, data: { task_id } }`; poll `GET /v3/tasks/{task_id}` until
 * `status` is `success` or `failed`. A non-zero `code` is a failure even when
 * the HTTP status is 200, and an auth failure is 401 AND `code: 2` — so read
 * the body, not just the status. The `model_url` on a finished task is
 * short-lived: fetch the mesh, do not store the link.
 */

export { threeD, TEXT_TO_MODEL_URL, threeDConstraints } from "./three-d";
export type { TextToModelParams } from "./three-d";

export { threeDFromImage, IMAGE_TO_MODEL_URL } from "./three-d-from-image";
export type { ImageToModelParams } from "./three-d-from-image";

export {
  BALANCE_URL,
  COMPRESSIONS,
  DOCS_BASE,
  FACE_LIMITS,
  FILES_URL,
  GATED_PARAMS_BY_MODEL,
  GEOMETRY_QUALITIES,
  NEGATIVE_PROMPT_MAX_CHARS,
  ORIENTATIONS,
  PROMPT_MAX_CHARS,
  QUAD_FACE_LIMIT,
  SMART_LOW_POLY_FACE_LIMIT,
  SMART_LOW_POLY_QUAD_FACE_LIMIT,
  TEXTURE_ALIGNMENTS,
  TEXTURE_QUALITIES,
  TRIPO3D_BASE_URL,
  TRIPO3D_MODELS,
  TRIPO3D_TASK_STATUSES,
  VERSION_GATED_PARAMS,
  taskUrl,
} from "./shared";
export type {
  Tripo3dCompression,
  Tripo3dGeometryQuality,
  Tripo3dModelId,
  Tripo3dOrientation,
  Tripo3dTaskStatus,
  Tripo3dTextureAlignment,
  Tripo3dTextureQuality,
} from "./shared";

export { ADD_ON_CREDITS, BASE_CREDITS, tripo3dCostUSD, tripo3dCredits } from "./pricing";
export type { Tripo3dCostInputs, Tripo3dTaskType } from "./pricing";

export { CREDIT_USD, models, provider } from "./models";
export type { Tripo3dCatalogModelId } from "./models";

// Declaration-portability carriers. One type-only line; see
// src/core/carriers.ts for why a consumer that emits its own `.d.ts` cannot
// name this entry's inferred result types without it (TS2742 / TS2883).
export type * from "../../core/carriers";
