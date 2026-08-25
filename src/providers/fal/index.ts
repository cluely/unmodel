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
 * ## Wave 1a
 *
 * This entry currently exports the transport surface only — the URL helpers and
 * the queue envelope. The nine validators (`fal.image`, `fal.imageEdit`,
 * `fal.video`, `fal.lipsync`, `fal.upscale`, `fal.avatar`, `fal.tts`,
 * `fal.stt`, `fal.music`), their catalog slices and the unified adapters land
 * in the following waves, on top of the generated files in `./gen/`.
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
