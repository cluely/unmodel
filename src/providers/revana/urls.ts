/**
 * Revana's URLs, and nothing else.
 *
 * **Import-free on purpose.** Everything here is a string or a function over
 * strings, so a caller who wants only a route — to poll a generation, to price
 * a request, to upload a reference — pays a few bytes rather than a validator,
 * its zod schema and a catalog.
 *
 * Transcribed 2026-11-12 from https://revana.si/openapi.json (`info.version`
 * `2026-10-31`, `servers[0].url` `https://api.revana.si`) and
 * https://revana.si/llms-full.txt:
 *
 * > - Base URL: https://api.revana.si/v1
 * > - Auth: `Authorization: Bearer <key>` (create keys at
 * >   https://revana.si/dashboard). Keep keys server-side.
 *
 * unmodel never touches credentials: add the header yourself.
 *
 * ## One POST path for every image, video, speech and music model
 *
 * `POST /v1/generations` takes `{ model, input }` and `model` — a real body
 * field — picks the model. So `revana.video`, `revana.image`, `revana.tts` and
 * the other media addresses all post to {@link GENERATIONS_URL}; what differs
 * between them is which models and which `input` fields they type
 * (`docs/decisions.md` §4). Language models are the one exception: they run on
 * the OpenAI-compatible `POST /v1/chat/completions` (`CHAT_COMPLETIONS_URL`
 * in ./chat.ts).
 *
 * ## The create only queues
 *
 * It answers `202` with a `Generation` whose `status` is `queued`. Poll
 * {@link generationUrl} "every few seconds until `status` is `succeeded` or
 * `failed`", then read `output.urls` or follow {@link generationContentUrl}.
 * Polling is transport and stays out of unmodel's scope.
 *
 * ## The second route: one path per model
 *
 * `POST /v1/queue/revana/{model_id}` runs the same jobs through fal's HTTP
 * convention (https://revana.si/queue.md): the model is the path, the body is
 * the input with no `{ model, input }` wrapper, and an optional
 * `?fal_webhook=` has Revana POST the outcome instead of being polled for it.
 * {@link queueUrl} builds it; the `revana.*Queue` addresses (`./queue.ts`)
 * validate what goes to it. A queue `request_id` is a generation id, so
 * {@link generationUrl} answers the same job — with its `cost_usd`, which the
 * queue's own documents never state.
 */

/** `https://api.revana.si/v1` — every Revana route hangs off this. */
export const REVANA_BASE_URL = "https://api.revana.si/v1";

/** `POST` — submit a generation; `GET` — list the account's generations. */
export const GENERATIONS_URL = `${REVANA_BASE_URL}/generations`;

/**
 * `POST` — the same body as a create, priced instead of run.
 *
 * "Nothing is created or held; free." It answers `quoted_usd` (the first
 * route's price) and `reserved_usd` (the most the request can cost if a dearer
 * backup route makes it) — the exact figures unmodel's own estimate cannot
 * know, because they depend on which routes are up. "Pass the quote as
 * `max_cost_usd`."
 */
export const GENERATIONS_QUOTE_URL = `${GENERATIONS_URL}/quote`;

/**
 * `GET` — the keyless catalog: "every model you can generate with right now,
 * with options and prices". `scripts/codegen-revana.ts` snapshots it.
 */
export const MODELS_URL = `${REVANA_BASE_URL}/models`;

/** `GET` — the key's account: `available_usd`, `held_usd`, `balance_usd`, `spent_usd`. */
export const BALANCE_URL = `${REVANA_BASE_URL}/balance`;

/**
 * `POST` — `{ content_type, bytes, filename? }` answers a one-hour
 * `upload_url` to `PUT` the bytes to, and a 14-day `url` to use as a reference.
 *
 * References are "public https:// links", so this is the only way to send a
 * local file. Limits: "image/*, video/*, audio/* up to 30, 50 and 15 MB".
 */
export const UPLOADS_URL = `${REVANA_BASE_URL}/uploads`;

/** `GET /v1/generations/{id}` — poll this until `status` is `succeeded` or `failed`. */
export function generationUrl(id: string): string {
  return `${GENERATIONS_URL}/${encodeURIComponent(id)}`;
}

/**
 * `GET /v1/generations/{id}/content` — a `302` to a short-lived file URL.
 *
 * "Picture models can return several files: `output.urls` lists them, and the
 * second is `/content/2`, the third `/content/3`." So `index` is 1-based and
 * the first file has no suffix.
 */
export function generationContentUrl(id: string, index = 1): string {
  const base = `${generationUrl(id)}/content`;
  return index <= 1 ? base : `${base}/${index}`;
}

/** `https://api.revana.si/v1/queue` — what a fal client's `https://queue.fal.run` is rewritten to. */
export const QUEUE_BASE_URL = `${REVANA_BASE_URL}/queue`;

/**
 * `POST /v1/queue/revana/{model_id}` — submit; answers the queue envelope.
 *
 * `falWebhook` becomes the `fal_webhook` query parameter, the only place the
 * route reads it (in the body it is an unrecognised key). "Optional
 * `fal_webhook=<url>` queues a POST after success or final failure."
 */
export function queueUrl(modelId: string, falWebhook?: string): string {
  const base = `${QUEUE_BASE_URL}/revana/${encodeURIComponent(modelId)}`;
  return falWebhook === undefined ? base : `${base}?fal_webhook=${encodeURIComponent(falWebhook)}`;
}

/**
 * `GET …/requests/{request_id}/status` — poll this. Prefer the `status_url`
 * the submit answered; this is for a caller who kept only the id.
 */
export function queueStatusUrl(modelId: string, requestId: string): string {
  return `${queueResultUrl(modelId, requestId)}/status`;
}

/**
 * `GET …/requests/{request_id}` — the result document once `status` is
 * `COMPLETED`: `409 not_ready` before, `422` for a request that failed.
 */
export function queueResultUrl(modelId: string, requestId: string): string {
  return `${queueUrl(modelId)}/requests/${encodeURIComponent(requestId)}`;
}

/**
 * `GET /v1/webhooks/secret` — the account's signing secret, for verifying a
 * delivery's `Revana-Signature` ("Read the secret once …, your API key as
 * the bearer token").
 */
export const WEBHOOKS_SECRET_URL = `${REVANA_BASE_URL}/webhooks/secret`;
