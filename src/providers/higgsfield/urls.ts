/**
 * Higgsfield's URLs and header names, and nothing else.
 *
 * **Import-free on purpose.** Everything here is a string or a function over
 * strings, so a caller who wants only a route — to poll a request, to price a
 * body, to upload a reference — pays a few bytes rather than a validator, its
 * zod schema and a catalog.
 *
 * Transcribed 2026-11-24 from https://docs.higgsfield.ai/docs (the pages named
 * on each export) and recorded in `docs/research/higgsfield-api-2026-11-24.md`
 * §1. "**Base URL:** `https://api.higgsfield.ai`"
 * (https://docs.higgsfield.ai/docs/how-to/introduction.md).
 *
 * ## Auth
 *
 * `Authorization: Key <KEY_ID>:<KEY_SECRET>` — "Each credential consists of a
 * key ID and a secret" (https://docs.higgsfield.ai/docs/authentication.md).
 * "The API also accepts the legacy `hf-api-key` and `hf-secret` headers. New
 * integrations should use the `Authorization` header." unmodel never touches
 * credentials: add the header yourself.
 *
 * ## One POST path per route, and the route is the path
 *
 * `POST https://api.higgsfield.ai/<endpoint>` takes the route's parameters as
 * a flat JSON body: no `model` field and no wrapper. {@link submitUrl} builds
 * it; `higgsfield.image`, `higgsfield.imageEdit` and `higgsfield.video`
 * validate what goes to it.
 *
 * ## The submit only queues
 *
 * It answers `{ status: "queued", request_id, status_url, cancel_url }`. "Use
 * the URLs from the response instead of constructing them manually"
 * (https://docs.higgsfield.ai/docs/concepts/requests.md); the builders here
 * are for a caller who kept only the id. Polling is transport and stays out of
 * unmodel's scope.
 */

/** `https://api.higgsfield.ai` — every route hangs off this, with no version prefix. */
export const HIGGSFIELD_BASE_URL = "https://api.higgsfield.ai";

/**
 * The submit query parameter that has Higgsfield POST the outcome instead of
 * being polled for it: "URL-encoded HTTPS endpoint that receives the result
 * when the request finishes"
 * (https://docs.higgsfield.ai/docs/api-reference/headers.md).
 */
export const HF_WEBHOOK_PARAM = "hf_webhook";

/**
 * `POST https://api.higgsfield.ai/<endpoint>` — submit a generation.
 *
 * The route id is the path at any depth (`bytedance/seedance-2.5/text-to-video`),
 * so each segment is encoded on its own and the slashes are kept. `hfWebhook`
 * becomes the `hf_webhook` query parameter, the only place the API reads it.
 */
export function submitUrl(endpoint: string, hfWebhook?: string): string {
  const base = `${HIGGSFIELD_BASE_URL}/${encodePath(endpoint)}`;
  return hfWebhook === undefined ? base : `${base}?${HF_WEBHOOK_PARAM}=${encodeURIComponent(hfWebhook)}`;
}

/**
 * `POST https://api.higgsfield.ai/estimate/<endpoint>` — the same body as the
 * generation, priced instead of run. It answers `{ "usd": "0.094" }`, a
 * decimal STRING.
 *
 * "Use the estimate returned for your authenticated account as the
 * authoritative amount"
 * (https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md). This is
 * the figure unmodel's own estimate cannot know: it carries the account's
 * discounts.
 */
export function estimateUrl(endpoint: string): string {
  return `${HIGGSFIELD_BASE_URL}/estimate/${encodePath(endpoint)}`;
}

/**
 * `DELETE /requests/{request_id}` — answers `{ request_id, status: "deleted" }`.
 * `409` while the request is `queued` or `in_progress`. It deletes the files,
 * the prompt and the parameters; billing records are kept.
 */
export function requestUrl(requestId: string): string {
  return `${HIGGSFIELD_BASE_URL}/requests/${encodeURIComponent(requestId)}`;
}

/**
 * `GET /requests/{request_id}/status` — poll this until `status` is one of
 * `HIGGSFIELD_TERMINAL_STATUSES`. Prefer the `status_url` the submit answered.
 */
export function requestStatusUrl(requestId: string): string {
  return `${requestUrl(requestId)}/status`;
}

/**
 * `POST /requests/{request_id}/cancel` — `202 Accepted` with an EMPTY body.
 * "Cancellation is available only while every job in the request remains
 * queued"; `400` once processing has started. Prefer the `cancel_url` the
 * submit answered.
 */
export function requestCancelUrl(requestId: string): string {
  return `${requestUrl(requestId)}/cancel`;
}

/**
 * `POST /files/generate-upload-url` — `{ content_type }` answers
 * `{ public_url, upload_url, content_type, upload_headers }`. `PUT` the bytes
 * to `upload_url` with every `upload_headers` entry and NO API credentials,
 * within one hour; `public_url` is then what a route's `*_url` parameter takes
 * (https://docs.higgsfield.ai/docs/concepts/file-uploads.md).
 *
 * No route takes bytes, so this is the only way to send a local file. The
 * accepted types are `HIGGSFIELD_UPLOAD_CONTENT_TYPES`.
 */
export const FILES_GENERATE_UPLOAD_URL = `${HIGGSFIELD_BASE_URL}/files/generate-upload-url`;

/** Where the upload route is documented. */
export const HIGGSFIELD_UPLOAD_SOURCE = "https://docs.higgsfield.ai/docs/concepts/file-uploads.md";

/**
 * What to do with a file that is not already at a public URL, as every
 * `higgsfield.*` message about one says it: "Use a presigned upload URL when
 * your input media is not already available through a public HTTPS URL."
 */
export const HIGGSFIELD_UPLOAD_HINT =
  `No Higgsfield route takes bytes: \`POST ${FILES_GENERATE_UPLOAD_URL}\` with \`{ content_type }\`, \`PUT\` the file to ` +
  "the `upload_url` it answers, and send its `public_url` here.";

/**
 * `POST /v1/custom-references` — train a Soul ID character; what
 * `higgsfield.characterTrain` validates
 * (https://docs.higgsfield.ai/docs/models/soul-id/create-character.md).
 */
export const CUSTOM_REFERENCES_URL = `${HIGGSFIELD_BASE_URL}/v1/custom-references`;

/**
 * `GET /v1/custom-references/list?page=1&page_size=20` — the account's
 * characters: `{ total, page, page_size, total_pages, items }`.
 */
export const CUSTOM_REFERENCES_LIST_URL = `${CUSTOM_REFERENCES_URL}/list`;

/**
 * `GET /v1/custom-references/{reference_id}` — poll a character until its
 * `status` is `completed` or `failed`. `DELETE` on the same URL answers `204`
 * with no body.
 */
export function customReferenceUrl(referenceId: string): string {
  return `${CUSTOM_REFERENCES_URL}/${encodeURIComponent(referenceId)}`;
}

/**
 * `GET /v1/text2image/soul-styles` — the Soul styles a `style_id` names on
 * `higgsfield-ai/soul/standard`: an array of
 * `{ id, name, description, preview_url }`
 * (https://docs.higgsfield.ai/docs/models/soul-standard/generate.md).
 */
export const SOUL_STYLES_URL = `${HIGGSFIELD_BASE_URL}/v1/text2image/soul-styles`;

/**
 * `GET /v1/text2image/soul-styles/v2` — the same list for the Soul 2 routes
 * (https://docs.higgsfield.ai/docs/models/soul-2/generate.md).
 */
export const SOUL_STYLES_V2_URL = `${SOUL_STYLES_URL}/v2`;

/**
 * `GET /models/higgsfield/genjutsu/restyle/v1.0/presets` — the presets a
 * `preset_id` names on `higgsfield/genjutsu/restyle/v1.0`: `{ model, items }`
 * (https://docs.higgsfield.ai/docs/models/genjutsu/restyle.md).
 */
export const GENJUTSU_RESTYLE_PRESETS_URL = `${HIGGSFIELD_BASE_URL}/models/higgsfield/genjutsu/restyle/v1.0/presets`;

/**
 * `GET /marketing-studio/image/presets?search&size&cursor` — the presets a
 * `preset_id` names on the three `marketing-studio/image` routes:
 * `{ total, cursor, items }`. `cursor` is a zero-based offset, and `null` in
 * the response on the last page
 * (https://docs.higgsfield.ai/docs/models/marketing-studio-image/generate.md).
 */
export const MARKETING_STUDIO_IMAGE_PRESETS_URL = `${HIGGSFIELD_BASE_URL}/marketing-studio/image/presets`;

/**
 * `GET /models/higgsfield/ai-influencer/options` — the live option catalog
 * `higgsfield/ai-influencer`'s `selection` is drawn from:
 * `{ config_revision, categories }`. Unauthenticated while the model is public
 * (https://dash.higgsfield.ai/models/higgsfield/ai-influencer/llms.txt).
 */
export const AI_INFLUENCER_OPTIONS_URL = `${HIGGSFIELD_BASE_URL}/models/higgsfield/ai-influencer/options`;

/**
 * `GET /models/usage` — usage analytics, "not a billing record". Its
 * `quantity`, `unit_price` and `cost` are decimal strings
 * (https://docs.higgsfield.ai/docs/enterprise/usage-and-billing.md).
 */
export const MODELS_USAGE_URL = `${HIGGSFIELD_BASE_URL}/models/usage`;

// ---------------------------------------------------------------------------
// Per-request headers. unmodel sets none of them: `.request.headers` carries
// only what a route requires of every request, and these are the caller's
// choice per submit (https://docs.higgsfield.ai/docs/api-reference/headers.md).
// ---------------------------------------------------------------------------

/**
 * Makes a submit replay-safe: "Higgsfield returns the original `request_id`
 * without creating or charging for another generation", and reusing a key with
 * different parameters answers `422`. The fingerprint is the endpoint, the
 * JSON body, the webhook and `Hf-Expires-After`, where "Array order, omitted
 * fields, explicit `null` values, and different URLs do matter"
 * (https://docs.higgsfield.ai/docs/concepts/idempotency.md) — which is why
 * unmodel never adds, removes or defaults a body key.
 */
export const IDEMPOTENCY_KEY_HEADER = "Idempotency-Key";
/** "Keys must contain 1–255 visible ASCII characters without whitespace." */
export const IDEMPOTENCY_KEY_MAX_LENGTH = 255;

/**
 * "Seconds to keep the request's data after it finishes, from 3600 to your
 * account retention. It can only shorten retention; out-of-range values return
 * `422`."
 */
export const HF_EXPIRES_AFTER_HEADER = "Hf-Expires-After";
/** The shortest retention the header accepts: one hour. */
export const HF_EXPIRES_AFTER_MIN_SECONDS = 3600;

// ---------------------------------------------------------------------------
// Webhook delivery headers — Standard Webhooks
// (https://docs.higgsfield.ai/docs/how-to/webhooks.md). unmodel ships the
// names and the delivery type, and no verifier: see ./index.ts.
// ---------------------------------------------------------------------------

export const WEBHOOK_ID_HEADER = "webhook-id";
/** Unix seconds. */
export const WEBHOOK_TIMESTAMP_HEADER = "webhook-timestamp";
/** Space-separated `v1,<base64>` entries; two while a rotated secret is still valid. */
export const WEBHOOK_SIGNATURE_HEADER = "webhook-signature";

function encodePath(endpoint: string): string {
  return endpoint.split("/").map(encodeURIComponent).join("/");
}
