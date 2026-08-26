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
 * All ten validators — `image` (32 text-to-image endpoints), `imageEdit` (17
 * editing), `video` (35 generation and editing routes), `lipsync` (10),
 * `avatar` (8), `upscale` (11), `threeD` (19), `tts` (23), `stt` (6) and
 * `music` (10) — plus the transport surface and the merged catalog. 171
 * curated endpoints in all, every one of them typed from fal's own published
 * OpenAPI document. Their RESULT documents are typed too, as
 * `Fal<Verb>ResultById` on `unmodel/fal/types`.
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

export type {
  FalQueueError,
  FalQueueResult,
  FalQueueStatus,
  FalQueueSubmitResponse,
} from "./urls";

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
export { upscale } from "./upscale";
export { threeD } from "./three-d";
export { tts } from "./tts";
export { stt } from "./stt";
export { music } from "./music";

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
export type {
  FalUpscaleArm,
  FalUpscaleBodyById,
  FalUpscaleEndpointId,
  FalUpscaleParams,
  FalUpscaleResultById,
} from "./upscale";
export type {
  FalThreeDArm,
  FalThreeDBodyById,
  FalThreeDEndpointId,
  FalThreeDParams,
  FalThreeDResultById,
} from "./three-d";
export type {
  FalTtsArm,
  FalTtsBodyById,
  FalTtsEndpointId,
  FalTtsParams,
  FalTtsResultById,
} from "./tts";
export type {
  FalSttArm,
  FalSttBodyById,
  FalSttEndpointId,
  FalSttParams,
  FalSttResultById,
} from "./stt";
export type {
  FalMusicArm,
  FalMusicBodyById,
  FalMusicEndpointId,
  FalMusicParams,
  FalMusicResultById,
} from "./music";

export {
  FAL_ENDPOINTS,
  FAL_ENDPOINT_VERBS,
  FAL_DOC_URLS,
  FAL_IMAGE_ENDPOINTS,
  FAL_IMAGE_EDIT_ENDPOINTS,
  FAL_VIDEO_ENDPOINTS,
  FAL_LIPSYNC_ENDPOINTS,
  FAL_AVATAR_ENDPOINTS,
  FAL_UPSCALE_ENDPOINTS,
  FAL_THREE_D_ENDPOINTS,
  FAL_TTS_ENDPOINTS,
  FAL_STT_ENDPOINTS,
  FAL_MUSIC_ENDPOINTS,
  FAL_REQUIRED_PROBES,
  // The other half of the roster: the ids unmodel was asked for and turned
  // down, each with the reason `data/fal/curation.json` recorded. Exported so
  // "why is this not served?" has an answer in the package rather than only in
  // a data file the package builds from.
  FAL_EXCLUDED,
  FAL_EXCLUDED_CATEGORIES,
} from "./gen/endpoints.gen";
export type { FalEndpointId } from "./gen/endpoints.gen";

/**
 * The merged catalog. Imported HERE and nowhere else in this provider — see
 * `./models.ts` for why a validator reaching it would put every category's
 * rows into every category's bundle.
 */
export { models, provider } from "./models";
export type { FalModelId } from "./models";

export { FAL_RATES, falCostUSD, falMegapixels, falPriceNote } from "./pricing";
export type { FalRate, FalRateUnit, FalTier } from "./pricing-types";

// Declaration-portability carriers. One type-only line; see
// src/core/carriers.ts for why a consumer that emits its own `.d.ts` cannot
// name this entry's inferred result types without it (TS2742 / TS2883).
export type * from "../../core/carriers";
