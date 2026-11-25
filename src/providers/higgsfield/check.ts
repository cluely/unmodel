/**
 * The post-generation check for a Higgsfield request. It does not throw.
 *
 * A status document carries its own verdict in `status`. What this adds is
 * the one report shape every provider's checker returns — `warnings`,
 * `finishReason`, `costUSD` — for a caller who handles a Higgsfield request
 * beside other providers', and the two things the status word alone does not
 * say.
 *
 * # `completed` is not always success
 *
 * An Ads Studio request answers `completed` with FEWER images than its
 * `batch_size` and a non-empty `errors` list: "Use its zero-based `index` to
 * identify its batch slot and inspect `errors` for unsuccessful slots"
 * (https://docs.higgsfield.ai/docs/models/ads-studio/generate.md). That is
 * `meta.kind: "partial_batch"` here.
 *
 * # Three other ways to stop
 *
 * `failed`, `nsfw` and `canceled` are each a different thing to do next, and
 * only `failed` carries an `error`. "Requests ending as `failed` or `nsfw` are
 * not charged. If an amount was reserved when the request was accepted, it is
 * refunded automatically"
 * (https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md).
 *
 * # No cost
 *
 * `costUSD` is always absent: no Higgsfield response states a charge. `POST
 * estimateUrl(endpoint)` with the same body answers the amount for the
 * account BEFORE the submit, and the catalog estimate on the validated request
 * is the list rate.
 *
 * # An error body is not a request
 *
 * A non-2xx answers `{ detail }`. Handed one, the checker says so
 * (`meta.kind: "error_response"`) instead of reporting an empty, warning-free
 * request.
 *
 * # A webhook delivery is a status too
 *
 * An `hf_webhook` delivery (`WebhookDelivery`) nests its output under
 * `payload`; the checker reads the outputs from there when `payload` is an
 * object, so a delivered result is not reported as empty.
 *
 * There is no checker for a Soul ID character (`CustomReference`): its
 * `failed` carries `fail_reason`, whose type Higgsfield does not publish.
 */

import type { Issue } from "../../core/issues";
import type { ResponseReport } from "../../core/report";
import type { RequestStatusValue } from "./request-wire";

/** The output keys of a status document, which a webhook delivery nests under `payload`. */
interface RequestOutputsLike {
  images?: readonly { url?: string; index?: number }[] | null;
  video?: { url?: string } | null;
  audio?: { url?: string } | null;
  audios?: readonly { url?: string }[] | null;
  zip?: { url?: string } | null;
  mov?: { url?: string } | null;
  jsx?: { url?: string } | null;
  fbx?: { url?: string } | null;
  ply?: { url?: string } | null;
}

/**
 * Structural subset of a status document — what a submit and every poll of
 * `status_url` answer — loose enough to take the parsed JSON of either, of a
 * webhook delivery, or of an error body, without a cast.
 */
export interface RequestStatusLike extends RequestOutputsLike {
  status?: string;
  request_id?: string;
  error?: string | null;
  /** A webhook delivery's outputs; `null` on `failed` and `nsfw`. */
  payload?: (RequestOutputsLike & { readonly [artifact: string]: unknown }) | null;
  errors?: readonly unknown[] | null;
  detail?:
    | string
    | readonly unknown[]
    | { code?: string; message?: string; retryable?: boolean; retry_after_seconds?: number }
    | null;
}

/**
 * Every key a completed request can carry ONE file under. `images` and
 * `audios` are lists; the rest are the status shape's single outputs,
 * including the artifacts "Some video and 3D operations can return" beside or
 * instead of a video (`./request-wire.ts` `RequestStatus`).
 */
const SINGLE_OUTPUT_KEYS = ["video", "audio", "zip", "mov", "jsx", "fbx", "ply"] as const satisfies readonly (keyof RequestOutputsLike)[];

/**
 * A request's `status`, as {@link checkRequestStatus} reports it on
 * `finishReason`. Higgsfield's own six words; tail-open because the checker
 * tolerates a status it does not know.
 */
export type HiggsfieldRequestStatus = RequestStatusValue | (string & {});

/**
 * Report for a submitted or polled request.
 *
 * - `finishReason` is `status`, verbatim: `queued`, `in_progress`,
 *   `completed`, `failed`, `nsfw` or `canceled`.
 * - `failed` → `meta.kind: "generation_failed"`, carrying `error`.
 * - `nsfw` → `meta.kind: "content_moderated"`.
 * - `canceled` → `meta.kind: "canceled"`.
 * - `completed` with no file under any output key → `meta.kind: "empty_output"`.
 * - `completed` with a non-empty `errors` → `meta.kind: "partial_batch"`,
 *   carrying `errors` and the `index` of every image that was delivered.
 * - no `status` and a `detail` → `meta.kind: "error_response"`.
 * - not an object at all (`null`, a string) → `meta.kind: "not_a_status"`.
 *
 * It takes a submit response too. A replayed idempotent submit "can contain
 * `"status": "queued"` even when the original request has already finished"
 * (https://docs.higgsfield.ai/docs/concepts/idempotency.md), so `queued` on a
 * submit response is not evidence that the request is waiting; `status_url`
 * is.
 */
export function checkRequestStatus(res: RequestStatusLike): ResponseReport<HiggsfieldRequestStatus> {
  const got: unknown = res;
  if (!isRecord(got)) {
    return {
      warnings: [
        {
          severity: "warning",
          code: "invalid_shape",
          path: [],
          message: `This is not a Higgsfield status document: got ${got === null ? "null" : Array.isArray(got) ? "an array" : typeof got}.`,
          meta: { kind: "not_a_status" },
        },
      ],
      usage: {},
    };
  }
  const warnings: Issue[] = [];
  const refused = errorResponse(res);
  if (refused !== undefined) warnings.push(refused);

  if (res.status === "failed") {
    warnings.push({
      severity: "warning",
      code: "invalid_shape",
      path: ["error"],
      message: `The request failed: ${res.error ?? "no error message provided"}. Failed requests are not charged; any reserved amount is refunded.`,
      meta: { kind: "generation_failed", ...(typeof res.error === "string" && { error: res.error }) },
    });
  }
  if (res.status === "nsfw") {
    warnings.push({
      severity: "warning",
      code: "invalid_shape",
      path: ["status"],
      message:
        "The request was rejected by moderation (`nsfw`). Higgsfield sends no `error` with this status and no output; it is not charged.",
      meta: { kind: "content_moderated" },
    });
  }
  if (res.status === "canceled") {
    warnings.push({
      severity: "warning",
      code: "invalid_shape",
      path: ["status"],
      message: "The request was canceled before processing started; it produced no output and is refunded.",
      meta: { kind: "canceled" },
    });
  }
  if (res.status === "completed") {
    const outputs: RequestOutputsLike = isRecord(res.payload) ? res.payload : res;
    const images = isList(outputs.images) ? outputs.images : [];
    const errors = isList(res.errors) ? res.errors : [];
    if (errors.length > 0) {
      warnings.push({
        severity: "warning",
        code: "invalid_shape",
        path: ["errors"],
        message:
          `The request is \`completed\` and ${errors.length} of its batch slots failed: ${images.length} ` +
          `${images.length === 1 ? "image was" : "images were"} delivered. Each image's \`index\` is its slot.`,
        meta: {
          kind: "partial_batch",
          errors: [...errors],
          delivered: images.map((image) => (isRecord(image) ? image.index : undefined)).filter((index) => index !== undefined),
        },
      });
    } else if (images.length === 0 && !(isList(outputs.audios) && outputs.audios.length > 0) && SINGLE_OUTPUT_KEYS.every((key) => outputs[key] == null)) {
      warnings.push({
        severity: "warning",
        code: "invalid_shape",
        path: ["status"],
        message:
          "The request is `completed` but carries no output: none of `images`, `audios`, " +
          `${SINGLE_OUTPUT_KEYS.slice(0, -1).map((key) => `\`${key}\``).join(", ")} or \`${SINGLE_OUTPUT_KEYS[SINGLE_OUTPUT_KEYS.length - 1] as string}\`.`,
        meta: { kind: "empty_output" },
      });
    }
  }

  return {
    warnings,
    ...(res.status !== undefined && { finishReason: res.status }),
    usage: {},
  };
}

/** The warning for a non-2xx body handed to the checker in a request's place. */
function errorResponse(res: RequestStatusLike): Issue | undefined {
  const detail = res.detail;
  if (res.status !== undefined || detail === undefined || detail === null) return undefined;
  if (typeof detail === "string") {
    return {
      severity: "warning",
      code: "invalid_shape",
      path: ["detail"],
      message: `This is an error response, not a request: ${detail}`,
      meta: { kind: "error_response" },
    };
  }
  if (isList(detail)) {
    return {
      severity: "warning",
      code: "invalid_shape",
      path: ["detail"],
      message: `This is a validation error response, not a request: \`detail\` lists ${detail.length} ${detail.length === 1 ? "fault" : "faults"}.`,
      meta: { kind: "error_response", detail: [...detail] },
    };
  }
  return {
    severity: "warning",
    code: "invalid_shape",
    path: ["detail"],
    message:
      `This is an error response${detail.code === undefined ? "" : ` (${detail.code})`}, not a request: ` +
      `${detail.message ?? "no message provided"}`,
    meta: {
      kind: "error_response",
      ...(detail.code !== undefined && { code: detail.code }),
      ...(detail.retryable !== undefined && { retryable: detail.retryable }),
      ...(detail.retry_after_seconds !== undefined && { retryAfterSeconds: detail.retry_after_seconds }),
    },
  };
}

function isList(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
