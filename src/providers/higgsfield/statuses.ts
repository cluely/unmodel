/**
 * Higgsfield's status vocabularies and its upload content types, as values.
 *
 * **Import-free on purpose**, like `./urls.ts`: a polling loop wants
 * `HIGGSFIELD_TERMINAL_STATUSES` and nothing else.
 *
 * There is ONE status vocabulary for every generation route — the docs, the
 * shared OpenAPI document and both SDKs agree on these six values
 * (`docs/research/higgsfield-api-2026-11-24.md` §1.4). Soul ID training
 * (`higgsfield.characterTrain`) has its own five, and a webhook fires on three.
 */

/**
 * `status` on a submit response and on `GET /requests/{id}/status`
 * (https://docs.higgsfield.ai/docs/concepts/requests.md). `canceled` has one
 * `l`.
 */
export const HIGGSFIELD_REQUEST_STATUSES = ["queued", "in_progress", "completed", "failed", "nsfw", "canceled"] as const;

/**
 * The four statuses a request does not leave. Stop polling on any of them —
 * and note that only `completed` carries output, and that a `completed` Ads
 * Studio request can still have failed slots (`checkRequestStatus`).
 */
export const HIGGSFIELD_TERMINAL_STATUSES = ["completed", "failed", "nsfw", "canceled"] as const;

/**
 * `status` on a Soul ID character (`GET /v1/custom-references/{id}`)
 * (https://docs.higgsfield.ai/docs/models/soul-id/create-character.md).
 */
export const HIGGSFIELD_CUSTOM_REFERENCE_STATUSES = ["not_ready", "queued", "in_progress", "completed", "failed"] as const;

/**
 * The statuses a webhook delivery reports. `canceled` is not among them: the
 * webhook page lists these three
 * (https://docs.higgsfield.ai/docs/how-to/webhooks.md).
 */
export const HIGGSFIELD_WEBHOOK_STATUSES = ["completed", "failed", "nsfw"] as const;

/**
 * What `POST /files/generate-upload-url` accepts as `content_type`
 * (https://docs.higgsfield.ai/docs/concepts/file-uploads.md).
 */
export const HIGGSFIELD_UPLOAD_CONTENT_TYPES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
  "audio/wav",
  "audio/x-wav",
  "video/mp4",
] as const;
