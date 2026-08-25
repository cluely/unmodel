/**
 * Shared wire pieces for VEED's v1 API (`https://api.veed.io/v1/...`),
 * transcribed from the OpenAPI 3.1.0 document at
 * https://api.veed.io/openapi.json and the pages it backs —
 * https://api.veed.io/docs, https://api.veed.io/models/lipsync-2.0,
 * https://api.veed.io/models/fabric-1.0 and the schema browser at
 * https://api.veed.io/reference — verified 2026-08-25.
 *
 * ## One spec, and it is unusually complete
 *
 * VEED publishes a single unauthenticated OpenAPI 3.1.0 document (56 KB, 10
 * operations, 21 component schemas) whose `servers` is `https://api.veed.io`,
 * and it also serves every component as a standalone JSON Schema at
 * `https://api.veed.io/schemas/{Name}.json` — the same URL every response
 * carries in its own `$schema` field. There was nothing to reconcile here and
 * no SDK tiebreak to run: VEED ships no JavaScript client, and the spec answers
 * every question the docs raise. Where the numbers DO disagree is pricing, and
 * the disagreement is recorded in `./models.ts`.
 *
 * Two things in the spec are worth reading twice, because both are invisible in
 * a type:
 *
 * 1. **Every request schema is `additionalProperties: false`.** A key VEED does
 *    not declare is a 422, not an ignored field — the opposite of Topaz and
 *    sync., which silently drop what they do not read. {@link checkKnownParams}
 *    is what says so before the round trip.
 * 2. **Every media field is a URL with a `pattern`**, `^[Hh][Tt][Tt][Pp][Ss]?://`,
 *    1–8192 characters. So a `data:` URI, an `s3://` reference, a bare path and
 *    a 9 KB signed URL are four different 422s, and {@link checkMediaUrls}
 *    turns all four into one message.
 *
 * ## Auth is a bearer token, and there are two 401 shapes
 *
 * `Authorization: Bearer vp_...` on every operation
 * (`components.securitySchemes.bearerAuth`, `bearerFormat: "API key"`,
 * described as "Workspace API key presented as a bearer token"). unmodel never
 * touches credentials, so it is yours to add — `.request.headers` carries the
 * content type and nothing else.
 *
 * Auth is checked BEFORE the body, so an invalid body with a bad key still
 * answers 401, and the two 401s differ:
 *
 * ```text
 * no header   401 {"error":{"code":"unauthenticated","message":"missing or malformed Authorization header","request_id":"…"}}
 * bad key     401 {"error":{"code":"unauthenticated","message":"Invalid API key.","request_id":"…","details":[{"type":"api_key","reason":"api_key_invalid"}]}}
 * ```
 *
 * One code, two messages, and only the second carries `details`. Branch on
 * `error.details[].reason` ({@link VEED_ERROR_REASONS}) rather than on the
 * message text. (Both probed live on 2026-08-25.)
 *
 * ## Every generation is a job, and there are TWO ways to fail
 *
 * `POST /v1/<model>` answers **202** with `{ data: { job_id, status:
 * "PROCESSING" } }`; poll `GET /v1/<model>/{job_id}` every ~10 seconds
 * ({@link VEED_POLL_INTERVAL_SECONDS}, from the spec's own
 * `x-veed-poll-interval-seconds`) until `COMPLETED` or `FAILED`, then read
 * `data.result.video.url`.
 *
 * ⚠️ A submit can be **rejected** at the HTTP layer (401/422/429/500 — no job
 * is created, and the body is {@link VeedErrorResponse}) or **accepted and then
 * fail** during rendering (`status: "FAILED"`, reported through the GET with a
 * {@link VeedJobErrorCode}, never as an HTTP error). Those are two different
 * error channels with two different code vocabularies, and code that only
 * checks `res.ok` sees half of them.
 *
 * There are no webhooks: the document declares no `webhooks` key and no
 * callback field on any input schema. Polling is the whole protocol.
 */

import { z } from "zod";
import type { PipelineContext } from "../../core/pipeline";
import { JSON_HEADERS } from "../../core/request";

export const VEED_BASE_URL = "https://api.veed.io";

export const VEED_HEADERS: Record<string, string> = JSON_HEADERS;

/** The documentation root. Every model also has a page at `/models/<id>`. */
export const DOCS_BASE = "https://api.veed.io";

/** `POST /v1/lipsync-2.0` — re-sync a clip to a new track. */
export const LIPSYNC_URL = `${VEED_BASE_URL}/v1/lipsync-2.0`;

/** `POST /v1/fabric-1.0` — animate a still to a track. */
export const FABRIC_URL = `${VEED_BASE_URL}/v1/fabric-1.0`;

/**
 * `GET /v1/<model>/{job_id}` — poll a submitted job.
 *
 * The path segment is the model id, which is also the submit path: a job id
 * minted by `POST /v1/fabric-1.0` is only readable at
 * `GET /v1/fabric-1.0/{id}`. There is no model-agnostic job route.
 */
export function jobUrl(model: VeedModelId | (string & {}), jobId: string): string {
  return `${VEED_BASE_URL}/v1/${model}/${jobId}`;
}

/** The machine-readable spec these types were transcribed from. */
export const OPENAPI_URL = `${VEED_BASE_URL}/openapi.json`;

/** One component schema, standalone — the `$schema` every response points at. */
export function schemaUrl(name: string): string {
  return `${VEED_BASE_URL}/schemas/${name}.json`;
}

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

/**
 * The two generation models unmodel serves, spelled exactly as they appear in
 * the path, in the docs URL and on the model page.
 *
 * VEED's "model garden" has a third family — `video-background-removal` in
 * three variants — which is deliberately not here; see `./models.ts`.
 */
export const VEED_MODELS = ["lipsync-2.0", "fabric-1.0"] as const;
export type VeedModelId = (typeof VEED_MODELS)[number];

/**
 * `resolution` on `fabric-1.0` — and note the ORDER, which is the price order
 * rather than the spec's.
 *
 * The spec lists `["720p", "480p"]` with `examples: ["720p"]`; this list is the
 * same two values cheapest-first, because they are a 2× price difference
 * ($0.08/sec at 480p, $0.15/sec at 720p) and a picker built from an array
 * should not put the expensive one first by accident. There is **no default**:
 * the field is `required`, which is the single easiest thing to get wrong on
 * this route.
 */
export const VEED_RESOLUTIONS = ["480p", "720p"] as const;
export type VeedResolution = (typeof VEED_RESOLUTIONS)[number];

// ---------------------------------------------------------------------------
// Published enums
// ---------------------------------------------------------------------------

/**
 * The states `GET /v1/<model>/{job_id}` reports.
 *
 * `CANCELLED` is in the enum on all three job schemas and there is no cancel
 * endpoint in the document, so it is almost certainly unreachable through the
 * public API today — but it is in the union because it is in the spec, and a
 * `switch` that omits it would fall through the day VEED ships one.
 */
export const VEED_JOB_STATUSES = ["PROCESSING", "COMPLETED", "FAILED", "CANCELLED"] as const;
export type VeedJobStatus = (typeof VEED_JOB_STATUSES)[number];

/** The terminal states — the ones a polling loop stops on. */
export const VEED_TERMINAL_STATUSES = ["COMPLETED", "FAILED", "CANCELLED"] as const;

/**
 * `error.code` on an HTTP rejection — the SUBMIT channel.
 *
 * From `ErrorBody.code` in the spec. These describe why no job was created;
 * the reasons a created job later failed are {@link VEED_JOB_ERROR_CODES},
 * a disjoint vocabulary.
 */
export const VEED_ERROR_CODES = [
  "invalid_request",
  "unauthenticated",
  "permission_denied",
  "not_found",
  "conflict",
  "rate_limited",
  "unavailable",
  "internal",
] as const;
export type VeedErrorCode = (typeof VEED_ERROR_CODES)[number];

/**
 * `error.details[].reason` — the sub-reason behind an HTTP rejection.
 *
 * From `ErrorDetail.reason`. Four of the five are ways an API key can be
 * unusable, which is what makes this list worth branching on: `api_key_expired`
 * and `api_key_revoked` are operator problems, `api_key_invalid` is a typo, and
 * they all arrive as the same `unauthenticated` code with the same 401.
 */
export const VEED_ERROR_REASONS = [
  "api_key_expired",
  "api_key_inactive",
  "api_key_invalid",
  "api_key_revoked",
  "job_not_found",
] as const;
export type VeedErrorReason = (typeof VEED_ERROR_REASONS)[number];

/**
 * `result.error.code` on a job that was accepted and then failed — the RENDER
 * channel.
 *
 * Identical across `JobErrorFabricErrorCode`, `JobErrorLipsync20ErrorCode` and
 * `JobErrorVideoBackgroundRemovalErrorCode`: VEED declares three separate
 * schemas with the same seven members, so one list serves every model here and
 * a divergence would show up as a spec diff rather than silently.
 *
 * `audio_too_long` is the one worth designing around — it is the only ceiling
 * VEED publishes anywhere, and it publishes no number for it.
 */
export const VEED_JOB_ERROR_CODES = [
  "input_validation",
  "content_moderation",
  "invalid_file",
  "audio_too_long",
  "transload_failed",
  "generation_failed",
  "timeout",
] as const;
export type VeedJobErrorCode = (typeof VEED_JOB_ERROR_CODES)[number];

/**
 * The rate-limit classes a 429's `X-RateLimit-Class` header names.
 *
 * VEED publishes no numbers — not an RPS, not a concurrency cap, not a quota —
 * only the shape of the answer: `Retry-After` in seconds plus
 * `X-RateLimit-{Class,Limit,Remaining,Reset}`. So a client can read its budget
 * off a 429 and cannot know it in advance, and generation sits in its own
 * class, separate from reads.
 */
export const VEED_RATE_LIMIT_CLASSES = ["read", "mutation", "ai-generation"] as const;
export type VeedRateLimitClass = (typeof VEED_RATE_LIMIT_CLASSES)[number];

/** How often the spec itself says to poll (`x-veed-poll-interval-seconds`). */
export const VEED_POLL_INTERVAL_SECONDS = 10;

/**
 * The published rate table, as data — every rate VEED prices a generation at,
 * including the one `ModelCost` has no room for.
 *
 * Transcribed from the `x-veed-pricing` extension on each submit operation in
 * https://api.veed.io/openapi.json, verified 2026-08-25. USD per second of
 * GENERATED video, `rounding: "exact"` — no minimum, and no rounding up to a
 * whole second.
 *
 * Fabric's rate is conditioned on `resolution`, which is a required request
 * field, so the exact rate for a request is always knowable; the output's
 * DURATION is not, which is why nothing here estimates. Published through
 * `unmodel/veed/values` so a picker can show the 2× difference between Fabric's
 * two resolutions at the point where a user chooses one, rather than after the
 * invoice.
 */
export const VEED_PRICING = {
  "lipsync-2.0": { perSecondUSD: 0.07 },
  "fabric-1.0": { perSecondUSD: { "480p": 0.08, "720p": 0.15 } },
} as const;

/**
 * The two request headers VEED documents on every operation.
 *
 * Neither is a body field, which is why neither is a per-model extra: they are
 * strings you add to `fetch` beside the bearer token.
 *
 * - `X-Veed-Store-IO: "0" | "1"` (default `"1"`) — `"0"` keeps this request's
 *   and response's bodies out of your request logs. The switch to reach for
 *   when the media URLs are sensitive.
 * - `X-Veed-Media-Expiration-Seconds: number` (default 86400) — how long the
 *   signed URLs VEED hands back stay fetchable. One day by default, which is
 *   the number to raise if the result is archived rather than piped.
 */
export const VEED_REQUEST_HEADERS = {
  storeIO: "X-Veed-Store-IO",
  mediaExpirationSeconds: "X-Veed-Media-Expiration-Seconds",
} as const;

/** The default of `X-Veed-Media-Expiration-Seconds`, in seconds (1 day). */
export const VEED_MEDIA_EXPIRATION_DEFAULT_SECONDS = 86_400;

// ---------------------------------------------------------------------------
// Response shapes
// ---------------------------------------------------------------------------

/** A file VEED produced. `url` is signed and expires — see the headers above. */
export interface VeedFile {
  url: string;
  /** e.g. `"video/mp4"`. */
  content_type?: string;
  file_name?: string;
  /** Bytes. `int64` in the spec. */
  file_size?: number;
}

/** `result` on a finished `lipsync-2.0` or `fabric-1.0` job. */
export interface VeedVideoResult {
  video: VeedFile;
}

/** `error` on a job that reached `FAILED`. */
export interface VeedJobError {
  code: VeedJobErrorCode;
  message: string;
  details?: ReadonlyArray<{ type: string; message: string; field?: string }> | null;
}

/**
 * The job envelope, shared by both models — `data` on the 202 and on every
 * poll.
 *
 * `result` is present once `status` is `COMPLETED`, `error` once it is
 * `FAILED`, and neither while it is `PROCESSING`. Both are optional in the
 * schema, so the status is the discriminator and the fields are not.
 */
export interface VeedJob {
  /** UUID. Also the id of the resource the job produces. */
  job_id: string;
  status: VeedJobStatus;
  result?: VeedVideoResult;
  error?: VeedJobError;
}

/** Every 2xx body is `{ data }`, and every error body is `{ error }`. */
export interface VeedJobResponse {
  data: VeedJob;
}

/** The HTTP-layer failure envelope — 401, 422, 429, 500. */
export interface VeedErrorResponse {
  error: {
    code: VeedErrorCode;
    message: string;
    /** Echo this to support; it is also on the `X-Request-ID` response header. */
    request_id: string;
    details?: ReadonlyArray<{
      type: string;
      reason?: VeedErrorReason;
      field?: string;
      message?: string;
      retry_after_ms?: number;
    }> | null;
  };
}

// ---------------------------------------------------------------------------
// Shared zod fragments
// ---------------------------------------------------------------------------

/**
 * `minLength` on every media URL. Published as data rather than enforced
 * separately — an empty string fails {@link MEDIA_URL_PATTERN} first, and with
 * a message that names the real problem.
 */
export const MEDIA_URL_MIN_CHARS = 1;

/** `maxLength` on every media URL — long enough for most signed URLs. */
export const MEDIA_URL_MAX_CHARS = 8192;

/**
 * The `pattern` every media URL carries, verbatim from the spec.
 *
 * Case-insensitive by construction rather than by flag (`[Hh][Tt][Tt][Pp]`),
 * which is worth keeping as written: it is what VEED compiles, so a URL this
 * regex rejects is a URL VEED rejects.
 */
export const MEDIA_URL_PATTERN = /^[Hh][Tt][Tt][Pp][Ss]?:\/\//;

/**
 * A media URL field — a bare `z.string()`, and the three constraints the spec
 * puts on it live in {@link checkMediaUrls} instead.
 *
 * Deliberate, and the reason is the whole house rule about where behaviour
 * lives: a schema failure short-circuits the check phase, so a
 * `.regex(MEDIA_URL_PATTERN)` here would win the race and answer "Invalid
 * string: must match pattern /^[Hh][Tt][Tt][Pp][Ss]?:\/\//" — which is true,
 * unactionable, and says nothing about the fact that VEED has no upload
 * endpoint to put the bytes in instead. The check owns the message; the schema
 * owns the shape.
 */
export const mediaUrlSchema = z.string();

/**
 * `$schema` — a read-only echo VEED accepts on input and ignores.
 *
 * Present on every input schema, described as "A URL to the JSON Schema for
 * this object" and marked `readOnly`. It is typed because
 * `additionalProperties: false` means a key that is NOT declared is a 422, and
 * this one is declared — so a caller round-tripping a response back into a
 * request does not have to strip it.
 */
export const schemaEchoSchema = z.string().optional();

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

/**
 * The shape every check below reads — the union of both models' fields.
 *
 * Written out rather than `Record<string, unknown>` for `tripo3d`'s reason: an
 * interface has no implicit index signature, so a check typed against the
 * record would not be assignable to `createValidator`'s `checks` for either
 * verb.
 */
interface VeedParams {
  video_url?: string;
  image_url?: string;
  audio_url?: string;
  resolution?: string;
}

/** The media fields, in the order a caller thinks about them. */
const MEDIA_FIELDS = ["video_url", "image_url", "audio_url"] as const;

/**
 * Every media field is a public `http(s)` URL VEED FETCHES, and the spec says
 * so three times per field.
 *
 * `format: uri`, `pattern: ^[Hh][Tt][Tt][Pp][Ss]?://` and `maxLength: 8192`.
 * There is no upload arm anywhere in this API — no multipart, no base64, no
 * asset ids — so "the bytes are in the request" is not a shape VEED has, and
 * the mistakes this catches are the four that look like URLs: a `data:` URI, an
 * `s3://` or `gs://` reference, a local path, and a signed URL longer than the
 * ceiling.
 *
 * A hard refusal rather than a warning: each one is a 422 with no job created.
 */
export function checkMediaUrls(source: string) {
  return (params: VeedParams, _info: unknown, ctx: PipelineContext): void => {
    for (const field of MEDIA_FIELDS) {
      const value = params[field];
      if (value === undefined) continue;
      if (typeof value !== "string") continue;

      if (!MEDIA_URL_PATTERN.test(value)) {
        const looksInline = value.startsWith("data:");
        ctx.report({
          code: "invalid_shape",
          path: [field],
          message:
            `\`${field}\` must be a public http(s) URL VEED can fetch — its schema carries the pattern ` +
            "`^[Hh][Tt][Tt][Pp][Ss]?://` and this value does not match. " +
            (looksInline
              ? "VEED has no upload arm at all: no multipart, no base64 and no asset ids, so a `data:` " +
                "URI has nowhere to go. Host the bytes and pass the URL."
              : "Object-store references (`s3://`, `gs://`) and local paths are not fetched either; " +
                "pass a URL the public internet can reach."),
          meta: { source, value },
        });
        continue;
      }

      if (value.length > MEDIA_URL_MAX_CHARS) {
        ctx.report({
          code: "invalid_shape",
          path: [field],
          message:
            `\`${field}\` is ${value.length} characters and VEED's ceiling is ${MEDIA_URL_MAX_CHARS}. ` +
            "Signed URLs with long query strings are the usual way to cross it — re-sign with a " +
            "shorter policy, or serve the file from a plain URL.",
          meta: { source, length: value.length, max: MEDIA_URL_MAX_CHARS },
        });
      }
    }
  };
}

/**
 * Every VEED request schema ends `additionalProperties: false`, so an undeclared
 * key is a **422 with no job created** rather than a field VEED ignores.
 *
 * That is the opposite of the two providers this category already had: sync.
 * and Topaz both drop what they do not read, which is why their equivalent
 * checks are warnings. Here the request does not run, so this is an error — and
 * it is the one check that earns its keep on a route with two fields, because
 * `providerOptions` is a hole big enough to put a typo through.
 */
export function checkKnownParams(source: string, declared: readonly string[]) {
  const allowed = new Set<string>([...declared, "$schema"]);
  return (params: VeedParams, _info: unknown, ctx: PipelineContext): void => {
    for (const key of Object.keys(params)) {
      if (allowed.has(key)) continue;
      // `unsupported_param` rather than `unknown_param` because the two codes
      // differ in severity and the severity is the point: `unknown_param` is a
      // warning, which is right where a provider IGNORES what it does not read
      // (sync., Topaz). VEED refuses the request, so this has to be an error.
      ctx.report({
        code: "unsupported_param",
        path: [key],
        message:
          `\`${key}\` is not a parameter this VEED model declares, and its schema is ` +
          "`additionalProperties: false` — VEED answers 422 and creates no job rather than ignoring " +
          `it. The fields here are ${declared.map((name) => `\`${name}\``).join(", ")}.`,
        meta: { source, declared: [...declared] },
      });
    }
  };
}
