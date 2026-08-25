/**
 * unmodel/fal — fal.ai's inference queue.
 *
 * fal is a generative-media cloud with ~1,500 live endpoints across image,
 * video, speech, music and a long tail of media transforms. unmodel serves a
 * curated slice of it: the endpoints listed in `data/fal/curation.json`, whose
 * request types, schemas and catalog rows are GENERATED from fal's own
 * published OpenAPI documents by `scripts/codegen-fal.ts`. It is the first
 * provider here where "types from docs, never SDKs" has a machine-readable
 * source.
 *
 * ## The wire
 *
 * `POST https://queue.fal.run/{endpoint_id}`, flat JSON body,
 * `Authorization: Key <FAL_KEY>`. The endpoint id IS the URL path, so unmodel
 * routes fal with an `endpoint` pseudo-param rather than a `model` field —
 * `model` is a real body field on several fal endpoints and cannot also be the
 * router. See `./urls.ts` for the queue contract, including the two traps
 * worth knowing before you poll: there is no `FAILED` status, and
 * `metadata.model_url` is the SYNC host, not the submit URL.
 *
 * ## What is here
 *
 * Five of the nine validators — `image` (28 text-to-image endpoints),
 * `imageEdit` (17 editing), `video` (30 generation and editing routes),
 * `lipsync` (8) and `avatar` (8) — plus the transport surface and the merged
 * catalog. `upscale`, `tts`, `stt` and `music` land in the following waves, on
 * top of generated files that are already in `./gen/`.
 *
 * ## Two things worth knowing before your first call
 *
 * The route is a parameter called `endpoint`, not `model` — `model` is a real
 * body field on several fal endpoints and cannot also be the router. And the
 * POST answers a queue ENVELOPE rather than an image: follow the
 * `response_url` it hands back, and do not read `status: "COMPLETED"` as
 * success. `./urls.ts` documents both, including the fact that fal's queue
 * declares no failure state at all.
 */

export {
  FAL_QUEUE_BASE_URL,
  FAL_SYNC_BASE_URL,
  falCancelUrl,
  falQueueUrl,
  falResultUrl,
  falStatusUrl,
  falSyncUrl,
} from "./urls";

export type { FalQueueStatus, FalQueueSubmitResponse } from "./urls";

export type {
  FalDimensionSpec,
  FalEndpointShape,
  FalMediaKind,
  FalParamShape,
  FalPropSpec,
  FalPropType,
  FalShapeClass,
  FalSizeSpec,
} from "./shape-types";

export { image } from "./image";
export { imageEdit } from "./image-edit";
export { video } from "./video";
export { lipsync } from "./lipsync";
export { avatar } from "./avatar";

export type {
  FalImageArm,
  FalImageBodyById,
  FalImageEndpointId,
  FalImageParams,
  FalImageResultById,
} from "./image";
export type {
  FalImageEditArm,
  FalImageEditBodyById,
  FalImageEditEndpointId,
  FalImageEditParams,
  FalImageEditResultById,
} from "./image-edit";
export type {
  FalVideoArm,
  FalVideoBodyById,
  FalVideoEndpointId,
  FalVideoParams,
  FalVideoResultById,
} from "./video";
export type {
  FalLipsyncArm,
  FalLipsyncBodyById,
  FalLipsyncEndpointId,
  FalLipsyncParams,
  FalLipsyncResultById,
} from "./lipsync";
export type {
  FalAvatarArm,
  FalAvatarBodyById,
  FalAvatarEndpointId,
  FalAvatarParams,
  FalAvatarResultById,
} from "./avatar";

export {
  FAL_ENDPOINTS,
  FAL_ENDPOINT_VERBS,
  FAL_DOC_URLS,
  FAL_IMAGE_ENDPOINTS,
  FAL_IMAGE_EDIT_ENDPOINTS,
  FAL_VIDEO_ENDPOINTS,
  FAL_LIPSYNC_ENDPOINTS,
  FAL_AVATAR_ENDPOINTS,
  FAL_REQUIRED_PROBES,
} from "./gen/endpoints.gen";
export type { FalEndpointId } from "./gen/endpoints.gen";

/**
 * The merged catalog. Imported HERE and nowhere else in this provider — see
 * `./models.ts` for why a validator reaching it would put every category's
 * rows into every category's bundle.
 */
export { models } from "./models";
export type { FalModelId } from "./models";

export { FAL_RATES, falCostUSD, falMegapixels, falPriceNote } from "./pricing";
export type { FalRate, FalRateUnit, FalTier } from "./pricing-types";
