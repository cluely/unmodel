/**
 * fal's queue transport: the URLs, and the envelope a submit returns.
 *
 * **Import-free by rule.** Nothing here imports anything — not zod, not the
 * catalog, not a sibling. `unmodel/fal/values` and every `*-params` leaf may
 * read these, and a leaf that drags a validator in would put a provider's whole
 * check graph behind a URL string.
 *
 * ## The wire, in one paragraph
 *
 * A fal request is `POST https://queue.fal.run/{endpoint_id}` with a flat JSON
 * body and an `Authorization: Key <FAL_KEY>` header. The endpoint id IS the URL
 * path, at arbitrary depth (`fal-ai/kling-video/v2.5-turbo/pro/image-to-video`),
 * and there is no `model` field in the body — which is precisely why unmodel
 * routes fal with an `endpoint` pseudo-param: `model` is a REAL wire field on
 * several endpoints (`fal-ai/sync-lipsync/v2` sends
 * `model: "lipsync-2" | "lipsync-2-pro"`) and cannot also be the router.
 *
 * ## Auth is stated, never derived
 *
 * The header is `Authorization: Key <FAL_KEY>` — the word `Key`, then a space,
 * then the key. fal's own OpenAPI security scheme describes this as an API-key
 * header and OMITS the `Key ` prefix, so a formatter that believed the schema
 * would emit a header fal rejects. unmodel therefore states the header in prose
 * everywhere (the vidu `Token` precedent) and derives it nowhere. unmodel never
 * touches your key: add the header yourself when you fetch.
 */

/** Queue host. Submits go here; the endpoint id is the path. */
export const FAL_QUEUE_BASE_URL = "https://queue.fal.run";

/**
 * Synchronous host — the request blocks until the result is ready.
 *
 * Exported because callers ask for it, and documented because it is a trap:
 * `metadata.model_url` in fal's own listing points HERE, so a generator or a
 * reader that took that field as the submit URL would turn every request into a
 * long-held connection. `.request.url` is always the queue submit.
 */
export const FAL_SYNC_BASE_URL = "https://fal.run";

/**
 * Percent-encodes an endpoint id **per path segment**.
 *
 * The separators must survive: `fal-ai/flux/dev` is three path segments, not
 * one segment containing slashes, so `encodeURIComponent` over the whole id
 * would produce `fal-ai%2Fflux%2Fdev` and a 404. Same shape as
 * `bflModelUrl` / `krea2Url`, for the same reason — at these three providers
 * the model IS the route.
 */
function encodeEndpointPath(endpointId: string): string {
  return endpointId.split("/").map(encodeURIComponent).join("/");
}

/** Submit URL — `POST`, JSON body, returns the queue envelope. */
export function falQueueUrl(endpointId: string): string {
  return `${FAL_QUEUE_BASE_URL}/${encodeEndpointPath(endpointId)}`;
}

/** Synchronous URL — same body, blocks until done. See {@link FAL_SYNC_BASE_URL}. */
export function falSyncUrl(endpointId: string): string {
  return `${FAL_SYNC_BASE_URL}/${encodeEndpointPath(endpointId)}`;
}

/**
 * Status URL — `GET`, returns {@link FalQueueSubmitResponse}.
 *
 * Prefer the `status_url` the submit response already gave you; this exists for
 * callers who persisted only the request id.
 */
export function falStatusUrl(endpointId: string, requestId: string): string {
  return `${falQueueUrl(endpointId)}/requests/${encodeURIComponent(requestId)}/status`;
}

/** Result URL — `GET`, returns the endpoint's own result document. */
export function falResultUrl(endpointId: string, requestId: string): string {
  return `${falQueueUrl(endpointId)}/requests/${encodeURIComponent(requestId)}`;
}

/** Cancel URL — `PUT` (not `DELETE`, and not `POST`). */
export function falCancelUrl(endpointId: string, requestId: string): string {
  return `${falQueueUrl(endpointId)}/requests/${encodeURIComponent(requestId)}/cancel`;
}

/**
 * What a queue submit answers with — the envelope, not the result.
 *
 * ```jsonc
 * {
 *   "request_id": "764cabcf-b745-4b3e-ae38-1200304cf45b",
 *   "response_url": "https://queue.fal.run/fal-ai/flux/dev/requests/764cabcf…",
 *   "status_url":   "https://queue.fal.run/fal-ai/flux/dev/requests/764cabcf…/status",
 *   "cancel_url":   "https://queue.fal.run/fal-ai/flux/dev/requests/764cabcf…/cancel",
 *   "status": "IN_QUEUE",
 *   "queue_position": 0
 * }
 * ```
 *
 * ### Follow `response_url`; never construct it
 *
 * The three URLs come back on every submit and on every status poll. Use them.
 * {@link falResultUrl} exists for the caller who persisted a bare request id
 * across a process boundary — not as the normal path — because a returned URL
 * survives fal moving a request between hosts and a constructed one does not.
 *
 * ### There is no `FAILED`
 *
 * `status` is `IN_QUEUE | IN_PROGRESS | COMPLETED` and that is the whole enum:
 * fal's queue schema declares no failure state. A failed request still reports
 * `COMPLETED` and carries its failure in the RESULT document, as `error` /
 * `error_type`. Code that polls until `status === "COMPLETED"` and then assumes
 * success is code that treats every error as a malformed result.
 *
 * ### `logs` is typed `unknown` on purpose
 *
 * fal's prose documentation shows `logs` as an ARRAY of log entries; fal's own
 * OpenAPI declares it an OBJECT with free-form properties. Both cannot be true,
 * and unmodel does not get to pick a winner on the caller's behalf — so it is
 * `unknown`, and narrowing it is an explicit act at the one call site that
 * cares. (`logs` only appears at all when the status request asks for it with
 * `?logs=1`.)
 *
 * Polling itself is out of scope — transport, like every other provider here
 * (minimax, black-forest-labs, krea). unmodel validates the request and hands
 * you the URL.
 */
export interface FalQueueSubmitResponse {
  /** Opaque request id. The only field guaranteed alongside `status`. */
  request_id: string;
  /** `IN_QUEUE | IN_PROGRESS | COMPLETED` — no failure arm; see above. */
  status: FalQueueStatus;
  /** Where the RESULT document will be. Follow it; do not construct it. */
  response_url?: string;
  /** Where to poll. Follow it. */
  status_url?: string;
  /** Where to `PUT` a cancellation. Follow it. */
  cancel_url?: string;
  /** Position in the queue, when fal reports one. */
  queue_position?: number;
  /** Array in fal's docs, object in fal's OpenAPI — see the note above. */
  logs?: unknown;
  /** Free-form timing/metric bag. */
  metrics?: unknown;
}

/** The whole status enum. `COMPLETED` does NOT mean the request succeeded. */
export type FalQueueStatus = "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED";

/**
 * The failure half of a result document — what `response_url` answers when the
 * request failed.
 *
 * This is the type that makes {@link FalQueueSubmitResponse}'s "there is no
 * `FAILED`" note actionable. `status` reaches `COMPLETED` either way, so the
 * only place a failure is expressible is the result body, and it arrives as
 * `error` / `error_type` rather than as a status.
 *
 * **Transcribed from fal's prose, not from a schema.** Every one of the 171
 * committed OpenAPI snapshots in `data/fal/openapi/` declares exactly one
 * response code — `200` — across all 684 operations, so there is no generated
 * error type to point at and no machine-readable source for one. These two
 * field names come from fal's queue documentation and from the note already
 * written on {@link FalQueueSubmitResponse}; anything beyond them would be a
 * guess, so the interface stays at two fields rather than inventing a third.
 */
export interface FalQueueError {
  /** Human-grade failure message. Its presence IS the failure signal. */
  error: string;
  /** fal's own name for the failure class, when it sends one. */
  error_type?: string;
}

/**
 * One endpoint's result document, as it actually arrives: the success shape or
 * a failure, never narrowed for you.
 *
 * The success half is generated. `FalVideoResultById["fal-ai/veo3.1"]` (and its
 * nine siblings — see `./types.ts`) is fal's own declared output schema for
 * that endpoint, which is why this generic takes the shape rather than naming
 * one:
 *
 * ```ts
 * import type { FalQueueResult, FalVideoResultById } from "unmodel/fal/types";
 *
 * const body: FalQueueResult<FalVideoResultById["fal-ai/veo3.1"]> =
 *   await (await fetch(submit.response_url!)).json();
 *
 * if ("error" in body) throw new Error(body.error); // narrows to FalQueueError
 * body.video.url;                                   // narrows to the success shape
 * ```
 *
 * `"error" in body` is the discriminant on purpose: no fal result schema
 * declares an `error` property, so the `in` check separates the two arms
 * without a tag fal does not send. Pinned by `test/types/fal.test-d.ts`.
 *
 * Nothing here validates: this is a compile-time shape for a document unmodel
 * never sees. `unmodel/fal` compiles the REQUEST; polling and reading the
 * result are yours, like every other queue provider here.
 */
export type FalQueueResult<T> = T | FalQueueError;
