import type { ExactKeys, Validated } from "../../core/request";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";
import type { EndpointConstraints } from "../../core/constraint-types";
import { withApiTarget } from "../../core/translate/media-retarget";
import type { MediaApiMember } from "../../retarget/types";
import {
  image as imageBase,
  type BflSdkTargets,
  type Flux2Arm,
  type Flux2Body,
  type Flux2ModelInput,
} from "./image";
import {
  imageFlux1 as imageFlux1Base,
  type Flux1Arm,
  type Flux1Body,
  type Flux1ModelInput,
} from "./image-flux1";
import {
  bflImageFlux1ToFal,
  bflImageToFal,
  type AnyFlux1,
  type AnyFlux2,
  type BflImageFalOverlap,
  type BflImageFlux1FalOverlap,
} from "./fal-target";

/**
 * `blackForestLabs.image` (FLUX.2), with `.toApi("fal")` attached.
 *
 * Wired here rather than in `./image.ts` so `unmodel/image` — which reaches
 * this provider through `./unified-image.ts` → `./image` — pays nothing for a
 * seam it cannot call. See `core/translate/media-retarget.ts`.
 */
export const image = withApiTarget(
  imageBase as unknown as Parameters<typeof withApiTarget<AnyFlux2, object>>[0],
  bflImageToFal,
) as unknown as {
  <M extends Flux2ModelInput, T extends Flux2Arm<M>>(
    params: T & Flux2Arm<M> & { model: M } & ExactKeys<T, Flux2Arm<M>>,
    options?: ValidateOptions<T>,
  ): Validated<Omit<T, "model">, BflSdkTargets<Omit<T, "model">>> &
    MediaApiMember<BflImageFalOverlap, M>;
  safe<M extends Flux2ModelInput, T extends Flux2Arm<M>>(
    params: T & Flux2Arm<M> & { model: M } & ExactKeys<T, Flux2Arm<M>>,
    options?: ValidateOptions<T>,
  ): ValidateResult<
    Validated<Omit<T, "model">, BflSdkTargets<Omit<T, "model">>> &
      MediaApiMember<BflImageFalOverlap, M>
  >;
  constraintsFor(modelId: string): EndpointConstraints[];
};

/** `blackForestLabs.imageFlux1` (FLUX.1), with `.toApi("fal")`. See {@link image}. */
export const imageFlux1 = withApiTarget(
  imageFlux1Base as unknown as Parameters<typeof withApiTarget<AnyFlux1, object>>[0],
  bflImageFlux1ToFal,
) as unknown as {
  <M extends Flux1ModelInput, T extends Flux1Arm<M>>(
    params: T & Flux1Arm<M> & { model: M } & ExactKeys<T, Flux1Arm<M>>,
    options?: ValidateOptions<T>,
  ): Validated<Omit<T, "model">, BflSdkTargets<Omit<T, "model">>> &
    MediaApiMember<BflImageFlux1FalOverlap, M>;
  safe<M extends Flux1ModelInput, T extends Flux1Arm<M>>(
    params: T & Flux1Arm<M> & { model: M } & ExactKeys<T, Flux1Arm<M>>,
    options?: ValidateOptions<T>,
  ): ValidateResult<
    Validated<Omit<T, "model">, BflSdkTargets<Omit<T, "model">>> &
      MediaApiMember<BflImageFlux1FalOverlap, M>
  >;
  constraintsFor(modelId: string): EndpointConstraints[];
};

export {
  BFL_IMAGE_FAL_OVERLAP,
  BFL_IMAGE_FAL_REFUSALS,
  BFL_IMAGE_FLUX1_FAL_OVERLAP,
  BFL_IMAGE_FLUX1_FAL_REFUSALS,
} from "./fal-target";

export {
  bflModelUrl,
  BFL_API_BASE_URL,
  BFL_GET_RESULT_URL,
  BFL_OUTPUT_FORMATS,
} from "./image";
export type {
  Flux2Body,
  Flux2ProBody,
  Flux2MaxBody,
  Flux2ProPreviewBody,
  Flux2FlexBody,
  Flux2Klein9bBody,
  Flux2Klein9bPreviewBody,
  Flux2Klein4bBody,
  UnknownFlux2ModelBody,
  BflOutputFormat,
} from "./image";

export { imageEdit } from "./image-edit";
export type { FluxKontextParams } from "./image-edit";

export type { BflAspectRatio } from "./aspect";

export {
  FLUX1_DIMENSION_MULTIPLE,
  FLUX1_MIN_DIMENSION,
  FLUX1_MAX_DIMENSION,
} from "./image-flux1";
export type {
  Flux1Body,
  FluxPro11Body,
  FluxDevBody,
  FluxUltraBody,
  FluxUltraFinetunedBody,
  UnknownFlux1ModelBody,
} from "./image-flux1";

export { imageEditFill, imageEditExpand, DEFAULT_EXPAND_MODEL_ID, FLUX_EXPAND_MAX_PIXELS } from "./image-edit-flux1";
export type {
  FluxFillParams,
  FluxFillBody,
  FluxFillFinetunedBody,
  UnknownFluxFillBody,
  FluxExpandParams,
} from "./image-edit-flux1";

export {
  imageEditOutpainting,
  imageEditErase,
  imageEditDeblur,
  imageEditVto,
  FLUX_OUTPAINTING_URL,
  FLUX_ERASE_URL,
  FLUX_DEBLUR_URL,
  FLUX_OUTPAINTING_MODEL_ID,
  FLUX_ERASE_MODEL_ID,
  FLUX_DEBLUR_MODEL_ID,
  DEFAULT_VTO_MODEL_ID,
  FLUX_OUTPAINTING_MODES,
  FLUX_ERASE_MAX_DILATE_PIXELS,
  FLUX_TOOLS_MIN_DIMENSION,
} from "./image-edit-tools";
export type {
  FluxOutpaintingParams,
  FluxOutpaintingMode,
  FluxEraseParams,
  FluxDeblurParams,
  FluxVtoParams,
} from "./image-edit-tools";

export { imageConstraints, imageFlux1Constraints } from "./constraints";

// No response checker: the submit POST returns an async job envelope
// ({ id, polling_url }), and polling GET /v1/get_result is transport —
// out of unmodel's scope.

export { models, provider } from "./models";
export type {
  BflModelId,
  BflFlux2ModelId,
  BflKontextModelId,
  BflFlux1ModelId,
  BflFlux1EditModelId,
  BflFluxToolsModelId,
} from "./models";
