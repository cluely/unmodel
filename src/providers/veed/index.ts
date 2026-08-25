/**
 * unmodel/veed — VEED's v1 generation API.
 *
 * `https://api.veed.io/v1`, flat JSON bodies, `Authorization: Bearer vp_…`.
 *
 * ## What is here
 *
 * The two generation models VEED publishes, one address each, because they are
 * two URLs with disjoint schemas and different prices:
 *
 * - `lipsync` — `POST /v1/lipsync-2.0`. A source CLIP plus a new track;
 *   `{ video_url, audio_url }` and nothing else. $0.07 per second of output.
 * - `avatar` — `POST /v1/fabric-1.0`. A STILL plus a track;
 *   `{ image_url, audio_url, resolution }`, all three required. $0.08 per
 *   second at 480p, $0.15 at 720p.
 *
 * ## What is deliberately NOT here
 *
 * **The `video-background-removal` family** — three variants and six of VEED's
 * ten operations. A real, priced, well-documented product that matches no
 * category unmodel has: it mattes a subject out of a clip and hands back a WebM
 * with an alpha channel (or two files on h264, RGB plus the matte). `video`
 * invents frames, `imageEdit` is a still, `upscale` changes resolution — none
 * of those vocabularies fits, and a one-provider `matting` category read off a
 * single witness is exactly what this library declines to build. It joins the
 * day a second vendor publishes the same operation.
 *
 * **A presenter roster.** fal sells `veed/avatars/audio-to-video`, a library of
 * trained presenters selected by `avatar_id`. It has no native endpoint: `POST
 * /v1/avatars` answers a real JSON 404 and the OpenAPI document declares no
 * roster and no such field. So `unmodel/avatar` reaches VEED's presenters
 * through fal and VEED's Fabric model directly, and the two rows say opposite
 * things about `image` on purpose.
 *
 * ## Four things worth knowing before your first call
 *
 * **Inputs are URLs VEED fetches, and there is no alternative.** No multipart,
 * no base64, no asset ids, no presigned upload. Every media field carries the
 * pattern `^[Hh][Tt][Tt][Pp][Ss]?://` and a 8192-character ceiling, so a
 * `data:` URI and an `s3://` reference are both 422s. `checkMediaUrls` says so
 * first.
 *
 * **Every request schema is `additionalProperties: false`.** An undeclared key
 * is a refused request rather than a field VEED ignores — the opposite of sync.
 * and Topaz — which is why `checkKnownParams` reports an ERROR here where their
 * equivalents report warnings.
 *
 * **`resolution` on `fabric-1.0` is required and has no default.** It is also
 * what the price is conditioned on. `{ image_url, audio_url }` alone is a 422.
 *
 * **The POST answers a JOB, at 202, and failure has two channels.** Poll
 * `jobUrl(model, job_id)` about every ten seconds until `status` is `COMPLETED`
 * or `FAILED`. A submit rejected at the HTTP layer carries a
 * {@link VEED_ERROR_CODES} code and creates no job; a job that was accepted and
 * then failed carries a {@link VEED_JOB_ERROR_CODES} code and arrives through
 * the GET with a 200. Code that only checks `res.ok` sees half the failures.
 *
 * ## Getting a key
 *
 * The docs, the schemas and the playground are fully public — no login — but
 * keys are not self-serve: every page's footer reads "API access is granted on
 * request" and links to https://www.veed.io/contact-sales. That is a credential
 * gate rather than a documentation gate, which is why the types here are as
 * exact as any in the library and were nonetheless never exercised against a
 * live key.
 */

export { lipsync, lipsyncConstraints, LIPSYNC_MODEL } from "./lipsync";
export type { VeedLipsyncParams } from "./lipsync";

export { avatar, avatarConstraints, AVATAR_MODEL } from "./avatar";
export type { VeedAvatarParams } from "./avatar";

export {
  DOCS_BASE,
  FABRIC_URL,
  LIPSYNC_URL,
  MEDIA_URL_MAX_CHARS,
  MEDIA_URL_MIN_CHARS,
  MEDIA_URL_PATTERN,
  OPENAPI_URL,
  VEED_BASE_URL,
  VEED_ERROR_CODES,
  VEED_ERROR_REASONS,
  VEED_JOB_ERROR_CODES,
  VEED_JOB_STATUSES,
  VEED_MEDIA_EXPIRATION_DEFAULT_SECONDS,
  VEED_MODELS,
  VEED_POLL_INTERVAL_SECONDS,
  VEED_PRICING,
  VEED_RATE_LIMIT_CLASSES,
  VEED_REQUEST_HEADERS,
  VEED_RESOLUTIONS,
  VEED_TERMINAL_STATUSES,
  jobUrl,
  schemaUrl,
} from "./shared";
export type {
  VeedErrorCode,
  VeedErrorReason,
  VeedErrorResponse,
  VeedFile,
  VeedJob,
  VeedJobError,
  VeedJobErrorCode,
  VeedJobResponse,
  VeedJobStatus,
  VeedModelId,
  VeedRateLimitClass,
  VeedResolution,
  VeedVideoResult,
} from "./shared";

export { models, provider } from "./models";
export type { VeedCatalogModelId } from "./models";
