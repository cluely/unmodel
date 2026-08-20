export { image, REVE_CREATE_URL, REVE_V1_PROMPT_MAX_LENGTH } from "./image";
export type { CreateParams } from "./image";

export {
  imageEdit,
  imageEditRemix,
  REVE_EDIT_URL,
  REVE_REMIX_URL,
  REVE_REMIX_MIN_REFERENCE_IMAGES,
  REVE_REMIX_MAX_REFERENCE_IMAGES,
} from "./image-edit";
export type { EditParams, RemixParams } from "./image-edit";

export {
  imageV2,
  REVE_V2_CREATE_URL,
  REVE_V2_RESPONSE_URL,
  REVE_V2_PROMPT_MAX_LENGTH,
  REVE_ASYNC_IMAGE_FORMATS,
} from "./image-v2";
export type {
  CreateV2Params,
  ReveAsyncImageFormat,
  ReveAsyncOptions,
  ReveImageInput,
} from "./image-v2";

export {
  reveCreditsToUSD,
  REVE_API_BASE_URL,
  REVE_DOCS_URL,
  REVE_USD_PER_CREDIT,
  REVE_V1_ASPECT_RATIOS,
  REVE_V2_ASPECT_RATIOS,
  REVE_UPSCALE_FACTORS,
  REVE_FIT_IMAGE_MAX_DIM,
  REVE_POSTPROCESSING_PROCESSES,
  REVE_TEST_TIME_SCALING_MIN,
  REVE_TEST_TIME_SCALING_MAX,
  REVE_MAX_IMAGE_BYTES,
  REVE_MAX_IMAGE_PIXELS,
  REVE_MAX_IMAGE_DIMENSION,
  REVE_MAX_REQUEST_BYTES,
  REVE_MAX_REQUEST_PIXELS,
} from "./shared";
export type {
  ReveV1AspectRatio,
  ReveV2AspectRatio,
  ReveProcess,
  ReveUpscaleFactor,
  ReveUpscaleOperation,
  ReveRemoveBackgroundOperation,
  ReveFitImageOperation,
  ReveEffectOperation,
  RevePostprocessingOperation,
} from "./shared";

// No response checker: the v1 routes answer synchronously with the image (or
// raw bytes plus X-Reve-* headers), and the v2 async flow's result polling
// (GET /v2/image/response?request_id=…) is transport — out of unmodel's scope.

export {
  models,
  provider,
  resolveReveVersion,
  REVE_CREATE_VERSIONS,
  REVE_EDIT_VERSIONS,
  REVE_REMIX_VERSIONS,
  REVE_V2_CREATE_VERSIONS,
} from "./models";
export type {
  ReveModelId,
  ReveCreateVersion,
  ReveEditVersion,
  ReveRemixVersion,
  ReveV2CreateVersion,
} from "./models";
