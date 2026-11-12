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
 * ## Not here: the per-model queue
 *
 * `POST /v1/queue/revana/{model_id}` is a second, fal-shaped spelling of the
 * same jobs ("Existing `/v1/generations` … continue to work unchanged",
 * https://revana.si/queue.md). unmodel addresses the native route only; the
 * decline is recorded in `data/revana/curation.json`.
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
