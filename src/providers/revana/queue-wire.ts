/**
 * Revana's queue wire — `POST https://api.revana.si/v1/queue/revana/{model_id}`
 * — and the documents it answers with.
 *
 * Type-only. Transcribed 2026-11-12 from https://revana.si/queue.md and
 * https://revana.si/openapi.json (`submitQueueRequest`, `getQueueStatus`,
 * `getQueueResult`), and checked against a live submit, poll and result
 * (`test/fixtures/revana/queue.*.json`).
 *
 * # The same jobs, fal's HTTP convention
 *
 * "Every model returned by `GET /v1/models` has an endpoint at
 * `POST /v1/queue/revana/{model_id}`. Send the model input directly, without a
 * `{model, input}` wrapper." Admission is the generation route's — the queue
 * answers that route's own sentences, `input.resolution must be one of …`
 * included — and so are billing and the id: a queue `request_id` is a
 * `gen_…`, and `GET /v1/generations/{id}` answers the same job.
 *
 * What the route adds is the completion webhook (`fal_webhook`), and what it
 * changes is the envelope: fal's `IN_QUEUE | IN_PROGRESS | COMPLETED`, a
 * result document keyed by media kind, and no cost anywhere in either.
 *
 * # Where its body differs from `input`
 *
 * {@link QueueInput} is {@link InputFor} with two fields typed differently, because the
 * route reads them its own way (2026-11-12):
 *
 * - `duration` also takes fal's strings — `"8"`, `"8s"`;
 * - `num_images` is taken only as `1`, on every model ("Only num_images: 1 is
 *   supported; submit separate requests for more images").
 *
 * `max_cost_usd` and `max_wait_s` sit beside the input fields rather than
 * beside an `input` object ("Revana extensions `max_wait_s` and `max_cost_usd`
 * may be included alongside model input").
 */

import type {
  GenerationErrorCode,
  InputFor,
  ModelInput,
  NemesisInput,
  RevanaErrorBody,
  SeedanceInput,
} from "./generation-wire";

/**
 * `duration` on the queue route: the model's own seconds, as a number or as
 * fal spells them. "String durations such as "5" and "8s" are accepted" —
 * digits and an optional lowercase `s`, nothing else (`"8.0s"`, `"8S"` and
 * `"8 s"` are refused).
 */
export type QueueDuration<D> = [D] extends [never] ? never : D | `${D & number}` | `${D & number}s`;

/**
 * `num_images` on the queue route: only `1`, and then ignored — on every
 * model, a picture model that makes four per request on `POST /v1/generations`
 * included, and the two whose own schema has no such key. Leave it out.
 */
interface QueueCount {
  num_images?: 1;
}

/** `SeedanceInput` as a queue body: a string `duration`, and the count of one. */
export type QueueSeedanceInput = Omit<SeedanceInput, "duration"> & QueueCount & { duration?: QueueDuration<number> };

/** `NemesisInput` as a queue body. It has no `duration` on either route. */
export type QueueNemesisInput = NemesisInput & QueueCount;

/** `ModelInput`, unnarrowed, as a queue body — for a model id unmodel has no row for. */
export type QueueModelInput = Omit<ModelInput, "duration" | "num_images"> &
  QueueCount & { duration?: QueueDuration<number> };

/**
 * The input fields of a queue body for a model id: {@link InputFor} with its
 * `Queue` flag set. A catalogued model's interface is typed for the queue at
 * the source (`VideoModelInput<S, true>`) rather than re-mapped here.
 */
export type QueueInput<M extends string> = InputFor<M, true>;

/** The two Revana extensions a queue body may carry beside the input fields. */
export interface QueueExtensions {
  /**
   * "The most you will pay: routes priced above it are skipped, and if none is
   * left the request is refused with `max_cost_exceeded`."
   */
  max_cost_usd?: number;
  /** A whole number of seconds, 1–86400, as on `POST /v1/generations`. */
  max_wait_s?: number;
}

/** The JSON body of `POST /v1/queue/revana/{model_id}` — exactly what is sent. */
export type QueueBody<M extends string = string> = QueueInput<M> & QueueExtensions;

/**
 * What a `revana.*Queue` address takes: the body, plus the two things the
 * route reads from the URL instead.
 *
 * `model` is the `{model_id}` path segment and `fal_webhook` the query
 * parameter of the same name. Neither is a body field — the API answers
 * `Unrecognized key: "model"` and `Unrecognized key: "fal_webhook"` to a body
 * that carries one — so the validator takes both off and puts them in
 * `.request.url`.
 */
export type QueueRequest<M extends string = string> = {
  /** "An id returned by GET /v1/models." Goes into the path. */
  model: M;
  /**
   * Where Revana POSTs the outcome ({@link QueueWebhookDelivery}) "after
   * success or final failure". "A reachable public HTTPS URL on port 443
   * without credentials or fragments"; IPv6 targets are unsupported. Goes into
   * the query string.
   */
  fal_webhook?: string;
} & QueueBody<M>;

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

/**
 * The whole status enum. `COMPLETED` does NOT mean the request succeeded: "A
 * failed request is also `COMPLETED`, with `error` and `error_type`; its
 * result endpoint returns 422." "Jobs awaiting reconciliation stay
 * `IN_PROGRESS`."
 */
export type QueueStatus = "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED";

/**
 * What a submit (`202`; `200` for an `Idempotency-Key` replay) and every
 * status poll answer.
 *
 * ```jsonc
 * {
 *   "status": "IN_QUEUE",
 *   "request_id": "gen_2d6a38c88396424ca9dc",
 *   "gateway_request_id": "gen_2d6a38c88396424ca9dc",
 *   "response_url": "https://api.revana.si/v1/queue/revana/z-image/requests/gen_2d6a…",
 *   "status_url":   "https://api.revana.si/v1/queue/revana/z-image/requests/gen_2d6a…/status",
 *   "cancel_url":   "https://api.revana.si/v1/queue/revana/z-image/requests/gen_2d6a…/cancel"
 * }
 * ```
 *
 * `cancel_url` is there for fal clients and does nothing: "Cancellation
 * returns 405 and never cancels billing."
 */
export type QueueEnvelope = QueuePending | QueueSucceeded | QueueFailed;

/** What every {@link QueueEnvelope} carries. */
interface QueueEnvelopeBase {
  /** A generation id (`gen_…`): `GET /v1/generations/{request_id}` answers the same job, with its `cost_usd`. */
  request_id: string;
  gateway_request_id?: string;
  /** Where the result document will be. Fetch it with the API key. */
  response_url: string;
  /** Where to poll. */
  status_url: string;
  /** `405 cancellation_not_supported`. */
  cancel_url?: string;
  /** With `?logs=1`: always empty — "internal provider logs are private". */
  logs?: unknown[];
}

/** Accepted and not finished. */
export interface QueuePending extends QueueEnvelopeBase {
  status: "IN_QUEUE" | "IN_PROGRESS";
  error?: never;
  error_type?: never;
}

/** Finished, and it worked: `response_url` answers a {@link QueueResult}. */
export interface QueueSucceeded extends QueueEnvelopeBase {
  status: "COMPLETED";
  error?: never;
  error_type?: never;
}

/**
 * Finished, and it did not — under the SAME `status` as {@link QueueSucceeded}.
 * What tells the two apart is `error`, which is why the envelope is a union:
 * `envelope.status === "COMPLETED" && envelope.error === undefined` is a
 * request that succeeded, and TypeScript narrows on it. `response_url` answers
 * `422` with the same sentence. Nothing was charged.
 */
export interface QueueFailed extends QueueEnvelopeBase {
  status: "COMPLETED";
  /** The failed generation's `error.message`, "written to show the person who asked". */
  error: string;
  /** The failed generation's `error.code`. */
  error_type: GenerationErrorCode | (string & {});
}

/**
 * One output file. "Download output URLs with your Revana API key; they
 * retain account access controls" — unlike fal's public links. The URL
 * answers a `302` to short-lived storage; "do not forward your Authorization
 * header to a different host when following that redirect."
 */
export interface QueueFile {
  url: string;
  content_type?: string;
  file_name?: string;
  file_size?: number;
  /** Recorded on a picture. */
  width?: number;
  /** Recorded on a picture. */
  height?: number;
}

/** A result of pictures: `{ "images": [ … ] }`. */
export interface QueueImageResult {
  images: QueueFile[];
  /** fal's field, kept for its clients: "a placeholder empty `description`, not generated text". */
  description?: string;
  video?: never;
  audio?: never;
  audios?: never;
}

/** A result that is a video: `{ "video": { "url", … } }`. */
export interface QueueVideoResult {
  video: QueueFile;
  images?: never;
  audio?: never;
  audios?: never;
}

/** A result that is sound, from a speech or music model: `{ "audio": { "url", … }, "audios": [ … ] }`. */
export interface QueueAudioResult {
  audio: QueueFile;
  audios?: QueueFile[];
  images?: never;
  video?: never;
}

/**
 * What `response_url` answers once the request is `COMPLETED` and succeeded.
 * Before that it is `409 not_ready`; for a request that failed, `422` — both
 * a {@link QueueErrorBody}.
 *
 * One of three documents, told apart by the key it has; each arm rules the
 * other two's keys out, so `if (result.images)` narrows. It is not typed from
 * the model id: which one a request answers is the kind of FILE it made, and a
 * model's kind does not settle that (the upscaler is a picture model that
 * also takes a clip).
 */
export type QueueResult = QueueImageResult | QueueVideoResult | QueueAudioResult;

/**
 * The error body of every non-2xx on the queue routes: the generation
 * routes' own, plus fal's `detail` carrying the same sentence.
 */
export interface QueueErrorBody extends RevanaErrorBody {
  detail: string;
}

/**
 * What Revana POSTs to a `fal_webhook` — one real delivery of each kind is
 * recorded in `test/fixtures/revana/queue.webhook.*.json`.
 *
 * "Return any 2xx promptly. Delivery is at least once: deduplicate on
 * `request_id`. Failed deliveries retry up to 30 attempts over 24 hours."
 * Each delivery carries `Revana-Signature: t=<unix seconds>,v1=<hex
 * HMAC-SHA256 of "<t>.<raw body>">` and `Revana-Webhook-Id: wh_<request id>`;
 * the key is the account's signing secret ({@link WebhookSecret}). "Do not use
 * fal's JWKS to verify a Revana callback." `verifyWebhook` (`./webhook.ts`)
 * checks all of that and returns this type.
 */
export type QueueWebhookDelivery = QueueWebhookSuccess | QueueWebhookFailure;

/** The request succeeded; `payload` is the document `response_url` answers. */
export interface QueueWebhookSuccess {
  request_id: string;
  gateway_request_id: string;
  status: "OK";
  payload: QueueResult;
  error?: never;
}

/** The request failed for good. Nothing was charged. */
export interface QueueWebhookFailure {
  request_id: string;
  gateway_request_id: string;
  status: "ERROR";
  /** "a safe `error` message" — the failed generation's `error.message`. */
  error: string;
  payload: {
    /** The same sentence as `error`. */
    detail: string;
    /** The failed generation's `error.code`. */
    error_type: GenerationErrorCode | (string & {});
  };
}

/** What `GET /v1/webhooks/secret` answers (recorded 2026-11-12, the secret aside). */
export interface WebhookSecret {
  object: "webhook_secret";
  /** The HMAC key, used as the text it is — its UTF-8 bytes, not decoded from hex or base64. */
  secret: string;
  version: number;
  algorithm: "HMAC-SHA256";
  /** `Revana-Signature`. */
  header: string;
  /** `Revana-Webhook-Id`. */
  id_header: string;
  /** `"<t>.<raw body>"`. */
  signed_payload: string;
  /** "refuse a `t` more than 300 seconds from now". */
  tolerance_s: number;
}
