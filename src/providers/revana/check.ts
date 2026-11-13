/**
 * Post-generation checks for Revana's two media routes. Neither throws.
 *
 * Both documents carry their own verdict, and the types say so
 * (`Generation` and `QueueEnvelope` are unions that narrow on it). What these
 * add is the one report shape every provider's checker returns — `warnings`,
 * `finishReason`, `costUSD` — for a caller who handles a Revana job beside
 * other providers', and one thing the queue's wire does not do: tell a request
 * that worked from one that did not in a single field.
 *
 * # `COMPLETED` is not success
 *
 * "Status is `IN_QUEUE`, `IN_PROGRESS` or `COMPLETED`. A failed request is
 * also `COMPLETED`, with `error` and `error_type`"
 * (https://revana.si/queue.md; recorded in
 * `test/fixtures/revana/queue.upscale.status.failed.json`). So
 * {@link checkQueueStatus} does not mirror `status`: see {@link QueueOutcome}.
 *
 * # The cost is the charge, never an estimate
 *
 * `cost_usd` is "the charge once succeeded, 0 once failed, else null", so
 * `costUSD` is that figure or absent; the catalog's listed price is never
 * substituted for it. The queue's documents state no cost anywhere — a queue
 * `request_id` is a generation id, so `GET generationUrl(request_id)` is where
 * the charge is read, and {@link checkGeneration} reads it.
 *
 * # An error body is not a job
 *
 * A non-2xx answers `{ error: { code, message, request_id } }` on both routes.
 * Handed one, each checker says so (`meta.kind: "error_response"`) rather than
 * reporting an empty, warning-free job.
 */

import type { Issue } from "../../core/issues";
import type { ResponseReport } from "../../core/report";
import type { GenerationStatus } from "./generation-wire";

/**
 * Structural subset of a `Generation` — what `POST /v1/generations` and
 * `GET /v1/generations/{id}` answer — loose enough to take the parsed JSON of
 * either, or of an error body, without a cast.
 */
export interface GenerationLike {
  object?: string;
  status?: string;
  output?: { urls?: readonly string[] | null } | null;
  cost_usd?: number | null;
  error?: {
    code?: string;
    message?: string;
    retryable?: boolean;
    reason?: string;
    request_id?: string;
  } | null;
}

/**
 * A generation's `status`, as {@link checkGeneration} reports it on
 * `finishReason`. Revana's own four words; tail-open because the checker
 * tolerates a status it does not know rather than refusing it.
 */
export type RevanaGenerationStatus = GenerationStatus | (string & {});

/**
 * Report for a created or polled generation.
 *
 * - `finishReason` is `status`: `queued`, `running`, `succeeded` or `failed`.
 * - `costUSD` is `cost_usd` — the charge, `0` on a failure, absent while it
 *   runs.
 * - `status: "failed"` → a warning with `meta.kind: "generation_failed"`
 *   carrying the API's `code`, `retryable` ("true means the same request can
 *   work later; false means the request has to change") and, on
 *   `content_policy`, `reason`.
 * - `status: "succeeded"` with no file → `meta.kind: "empty_output"`.
 */
export function checkGeneration(res: GenerationLike): ResponseReport<RevanaGenerationStatus> {
  const warnings: Issue[] = [];
  const refused = errorResponse(res.status, res.error);
  if (refused !== undefined) warnings.push(refused);

  if (res.status === "failed") {
    const error = res.error ?? undefined;
    warnings.push({
      severity: "warning",
      code: "invalid_shape",
      path: ["error"],
      message:
        `The generation failed${error?.code === undefined ? "" : ` (${error.code})`}: ` +
        `${error?.message ?? "no message provided"}${retryAdvice(error?.retryable)}`,
      meta: {
        kind: "generation_failed",
        ...(error?.code !== undefined && { code: error.code }),
        ...(error?.retryable !== undefined && { retryable: error.retryable }),
        ...(error?.reason !== undefined && { reason: error.reason }),
      },
    });
  }
  if (res.status === "succeeded" && (res.output?.urls ?? []).length === 0) {
    warnings.push({
      severity: "warning",
      code: "invalid_shape",
      path: ["output", "urls"],
      message: "The generation succeeded but `output.urls` lists no file.",
      meta: { kind: "empty_output" },
    });
  }

  return {
    warnings,
    ...(res.status !== undefined && { finishReason: res.status }),
    usage: {},
    ...(typeof res.cost_usd === "number" && { costUSD: res.cost_usd }),
  };
}

/**
 * Structural subset of a queue envelope — what a submit and every poll of
 * `status_url` answer. `error` is the failure's sentence there (a string) and
 * an object on an error body, which is how the two are told apart.
 */
export interface QueueEnvelopeLike {
  status?: string;
  request_id?: string;
  error?: string | { code?: string; message?: string; request_id?: string } | null;
  error_type?: string | null;
}

/**
 * How a queue request stands, as {@link checkQueueStatus} reports it on
 * `finishReason`.
 *
 * The envelope's `status` with its one ambiguity taken out: `COMPLETED` here
 * means the request SUCCEEDED, and a request that completed with an `error`
 * is `ERROR` — the word Revana's own webhook uses for that outcome
 * (`status: "OK" | "ERROR"`). So `finishReason === "COMPLETED"` is safe to
 * fetch `response_url` on, which the wire's `status === "COMPLETED"` is not.
 *
 * Tail-open for an envelope status the checker does not know.
 */
export type QueueOutcome = "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED" | "ERROR" | (string & {});

/**
 * Report for a queue envelope.
 *
 * - `finishReason` is a {@link QueueOutcome}.
 * - A failed request → a warning with `meta.kind: "generation_failed"`
 *   carrying `error_type`, the failed generation's `error.code`.
 * - `costUSD` is always absent: no queue document states a cost. Read it from
 *   `GET generationUrl(request_id)`.
 */
export function checkQueueStatus(res: QueueEnvelopeLike): ResponseReport<QueueOutcome> {
  const warnings: Issue[] = [];
  const refused = errorResponse(res.status, typeof res.error === "string" ? undefined : res.error);
  if (refused !== undefined) warnings.push(refused);

  const failure = res.status === "COMPLETED" && typeof res.error === "string" ? res.error : undefined;
  if (failure !== undefined) {
    const code = res.error_type ?? undefined;
    warnings.push({
      severity: "warning",
      code: "invalid_shape",
      path: ["error"],
      message:
        `The request is \`COMPLETED\` and it failed${code === undefined ? "" : ` (${code})`}: ${failure} ` +
        "Its `response_url` answers 422, not a result.",
      meta: { kind: "generation_failed", ...(code !== undefined && { code }) },
    });
  }

  return {
    warnings,
    ...(res.status !== undefined && { finishReason: failure === undefined ? res.status : "ERROR" }),
    usage: {},
  };
}

/** The warning for a non-2xx body handed to a checker in a job's place. */
function errorResponse(
  status: string | undefined,
  error: { code?: string; message?: string; request_id?: string } | null | undefined,
): Issue | undefined {
  if (status !== undefined || error === null || error === undefined) return undefined;
  return {
    severity: "warning",
    code: "invalid_shape",
    path: ["error"],
    message:
      `This is an error response${error.code === undefined ? "" : ` (${error.code})`}, not a job: ` +
      `${error.message ?? "no message provided"}`,
    meta: {
      kind: "error_response",
      ...(error.code !== undefined && { code: error.code }),
      ...(error.request_id !== undefined && { requestId: error.request_id }),
    },
  };
}

function retryAdvice(retryable: boolean | undefined): string {
  if (retryable === undefined) return "";
  return retryable ? " The same request can work later." : " The request has to change.";
}
