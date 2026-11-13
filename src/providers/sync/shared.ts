/**
 * Shared wire pieces for sync.'s v2 API (`https://api.sync.so/v2/...`),
 * transcribed from the curated OpenAPI 3.1 document at
 * https://sync.so/docs/openapi.json and the endpoint reference pages —
 * `/api-reference/api/generate-api/create`, `/models/lipsync`, `/models/sync-3`,
 * `/api-reference/guides/authentication`, `/api-reference/guides/rate-limits`,
 * `/api-reference/guides/webhooks`, `/developer-guides/segments`,
 * `/developer-guides/dialogue-editing` — verified 2026-11-12. Every docs route
 * also serves raw Markdown at `<route>.md`, which is what was read.
 *
 * ## Two specs, and which one this file follows
 *
 * sync. publishes TWO unauthenticated OpenAPI documents: a curated
 * developer-facing one at `https://sync.so/docs/openapi.json` (256 KB, 39 paths)
 * and the full backend spec at `https://sync.so/openapi.json` (718 KB, 63
 * paths). unmodel types the CURATED one, because it is the surface the reference
 * pages document for API-key callers. Where the two disagree, the tiebreak goes
 * to `@sync.so/sdk@0.4.0`'s shipped `.d.ts` (the wire-typing policy: docs, then
 * the reference, then the SDK). Two disagreements stand, and both are resolved
 * here:
 *
 * 1. **The model roster.** The curated spec enumerates five ids; the full spec
 *    adds `lipsync-2-mini` and `appearence-1`. `Model.d.ts` in the SDK declares
 *    exactly the five, and neither extra id has a docs page or a published rate.
 *    {@link SYNC_MODELS} is the five.
 * 2. **The request content type.** The curated spec declares only
 *    `multipart/form-data` on `POST /v2/generate` (its one operation there is
 *    "Create Generation with Files"); the prose docs and the SDK both use JSON.
 *    `generations/client/Client.js` posts `contentType: "application/json"`,
 *    `requestType: "json"` to `/v2/generate`. **JSON is the primary path** and is
 *    what unmodel compiles to; the multipart form exists only for direct file
 *    uploads and is not modelled.
 *
 * `GenerationOptions` is not a disagreement: the curated spec and the SDK's
 * `GenerationOptions.d.ts` declare the same fifteen fields, with `prompt` a
 * plain `string`, and all fifteen are typed. The three the full spec adds
 * (`output_bucket_name`, `pads`, `speedup`) are backend-only and are not.
 *
 * The SDK LAGS the curated spec in two places, and there it does not win — a
 * tiebreaker settles a disagreement, not an absence: `DubDto.d.ts` declares
 * none of `cloningStrength`, `startTime` and `endTime`, which the curated
 * `DubDto` carries, and `GetGenerationRequest.d.ts` still describes
 * `include=progress` as adding `progress_percent` where the spec declares a
 * `progress` object (see {@link SyncGenerationQuery}).
 *
 * ## Auth is a header key, and there are two 401 shapes
 *
 * `x-api-key: <SYNC_API_KEY>` on every request
 * (/api-reference/guides/authentication; the SDK reads the same env var).
 * unmodel never touches credentials, so it is yours to add — `.request.headers`
 * carries the content type and nothing else. The API also accepts a dashboard
 * session cookie, which is why a MISSING header and an INVALID key answer
 * differently:
 *
 * ```text
 * no header      401 {"message":"Either Cookie or x-api-key header must be provided","error":"Unauthorized","statusCode":401}
 * bad key        401 {"message":"Unauthorized","statusCode":401}
 * ```
 *
 * Two shapes, one status. An error mapper that reads `error` will find it
 * missing on the second. (Both probed live on 2026-08-25.)
 *
 * The one other request header sync. documents on `POST /v2/generate` is the
 * optional `Idempotency-Key` — and an unkeyed retry within 60 seconds is a 409,
 * so a retry loop needs it; see {@link SYNC_IDEMPOTENCY_HEADER}.
 *
 * ## Every generation is a job
 *
 * `POST /v2/generate` answers **201** with a {@link SYNC_GENERATION_STATUSES}
 * `PENDING` generation; poll `GET /v2/generate/{id}` until `COMPLETED`,
 * `FAILED` or `REJECTED`, then read `outputUrl`. Set `webhookUrl` to be told
 * instead of asking — the callback is signed with `Sync-Signature:
 * t=<unix>,v1=<hmac_sha256>` over `${timestamp}.` + the RAW body, keyed on the
 * `whsec_…` secret from `GET /v2/organizations/webhook/secret`.
 *
 * ⚠️ The webhook payload is a SUBSET of the polling payload, not the same
 * object. The curated `GenerationNotification` carries `id`, `createdAt`,
 * `status`, `model`, `input`, `webhookUrl`, `options`, `outputUrl`, `error` and
 * `errorCode` (the last two `null` unless the generation failed or was
 * rejected), plus `synthesizedAudioUrl`, `dubAudioUrl` and `dubAudioAssetId`;
 * it omits `outputFileName`, `projectId`, `segments` and `outputDuration`.
 * Branch on `errorCode` in both. A delivery is retried "up to 6 times over
 * about 2 hours" and keeps one `Sync-Delivery-Id` header across its retries,
 * which is the key to deduplicate on (/api-reference/guides/webhooks).
 *
 * ## Generation is bounded by concurrency, not by a request rate
 *
 * /api-reference/guides/rate-limits publishes request-rate limits for
 * `POST /v2/tts`, `/v2/tts/jobs`, `/v2/voices` and `/v2/assets/upload` only —
 * "Generation creation also enforces the plan's concurrency limit". The plan
 * defaults are Free 1, Hobbyist 3, Creator 10, Growth 20, Scale 50 and
 * Enterprise "50 or a higher custom allowance" in-flight generations, and an
 * overflow answers **429** `concurrency_limit_reached` with
 * `activeGenerations`, `concurrencyLimit` and `retryAfterSeconds` on the body
 * and `Retry-After`, `X-Sync-Concurrency-Limit` and `X-Sync-Active-Generations`
 * headers — so branch on `errorCode`, not on the status. The maximum video
 * length is plan-bound too, from 15 seconds on Free to 30 minutes on Scale
 * (https://sync.so/pricing). Neither the plan nor the in-flight count is
 * visible in a request, so nothing here checks either.
 */

import { z } from "zod";
import type { PipelineContext } from "../../core/pipeline";
import { JSON_HEADERS } from "../../core/request";

export const SYNC_BASE_URL = "https://api.sync.so";

export const SYNC_HEADERS: Record<string, string> = JSON_HEADERS;

export const DOCS_BASE = "https://sync.so/docs";

/** `POST /v2/generate` — create a generation. Both verbs post here. */
export const GENERATE_URL = `${SYNC_BASE_URL}/v2/generate`;

/**
 * The `Idempotency-Key` request header on `POST /v2/generate`, and the pattern
 * its value must match.
 *
 * From /api-reference/api/generate-api/create and
 * /api-reference/guides/idempotency, verified 2026-11-12:
 *
 * - Optional. "Case-sensitive organization-scoped key, 1–128 characters
 *   matching [A-Za-z0-9._~-]+. Send exactly one header."
 * - `POST /v2/generate` only (JSON and multipart) — not batch creation or
 *   standalone TTS.
 * - 201 on first acceptance; an equivalent retry answers 200 with the same
 *   generation and `Idempotency-Replayed: true`. A retry after `FAILED` or
 *   `REJECTED` starts (and bills) a new generation.
 * - A malformed key answers 400 `INVALID_IDEMPOTENCY_KEY`; a changed payload
 *   409 `IDEMPOTENCY_KEY_CONFLICT`, or `IDEMPOTENCY_IN_PROGRESS` while the
 *   original is still being prepared. Keys are retained seven days.
 * - **Without a key**, "An API-key request without the header that is
 *   identical to one your organization sent in the last 60 seconds returns 409
 *   DUPLICATE_SUBMISSION with the original generationId" — a naive retry loop
 *   is refused, and the generation to poll is the one in that body.
 *
 * "Not a JSON field": add it to `fetch` beside `x-api-key`. unmodel never
 * writes it.
 */
export const SYNC_IDEMPOTENCY_HEADER = "Idempotency-Key";
export const SYNC_IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._~-]{1,128}$/;

/**
 * The three documented query params of `GET /v2/generate/{id}`, and the one
 * combination the spec forbids.
 *
 * Transcribed verbatim from `https://sync.so/docs/openapi.json` (verified
 * 2026-11-12):
 *
 * - **`wait`** — "When true, long-poll: hold the request open until the
 *   generation reaches a terminal status (COMPLETED/FAILED/REJECTED) or the
 *   timeout elapses, then return the latest state. Waits are short (10s max) —
 *   treat this as a convenience for jobs about to finish, and poll again (the
 *   response includes a `Retry-After: 2` header) or use a webhook for longer
 *   jobs. wait=true responses also carry `X-Sync-Wait-Mode: long_poll` and
 *   `X-Sync-Wait-Timeout-Seconds` headers. **Cannot be combined with
 *   include=progress.**"
 * - **`timeout`** — "Max seconds to hold a wait=true request open (default 5,
 *   max 10 — values outside 1-10 are rejected with a 400). On timeout the
 *   current (non-terminal) generation is returned with HTTP 200, so check
 *   `status` and poll again, or use a webhook for long jobs."
 * - **`include`** — "Comma-separated extra fields to include. include=progress
 *   adds a `progress` object with the render stage, measured progress and the
 *   expected finish time. Works for generations created through the API as
 *   well as in sync's own apps."
 *
 * The mutual exclusion is the union's job: `include: "progress"` and
 * `wait`/`timeout` are two arms with `?: never` on the other's keys, the same
 * device `docs/decisions.md` §4 uses for `google.tts`'s XOR'd `speechConfig`.
 * Writing both is a compile error rather than a 400 twenty seconds later.
 *
 * The `progress` object is a declared property of the curated `Generation`
 * ("Only included when the generation is requested with include=progress"),
 * typed `GenerationProgress`: `stage`, `percent`, `fraction`, `completedTasks`,
 * `runningTasks`, `waitingTasks`, `estimatedFinishAt`, `estimatedTimeRemaining`.
 * `@sync.so/sdk@0.4.0`'s `GetGenerationRequest` takes the same three params but
 * its docstring still says `include=progress` "adds a progress_percent field";
 * the spec declares the property and the SDK only describes it, so the spec
 * wins.
 */
export type SyncGenerationQuery =
  | { wait?: boolean; timeout?: number; include?: never }
  | { include: "progress"; wait?: never; timeout?: never };

/**
 * `GET /v2/generate/{id}` — poll a submitted generation, with the documented
 * query params appended.
 *
 * ```ts
 * generationUrl("gen_abc");                        // …/v2/generate/gen_abc
 * generationUrl("gen_abc", { wait: true, timeout: 8 });
 * generationUrl("gen_abc", { include: "progress" });
 * ```
 *
 * This builds a STRING and nothing else: it is **NOT validated by unmodel**,
 * and it is exported for convenience (the `breezeblue.textToSpeechStreamUrl`
 * precedent). Polling is transport — no fetch, no retry loop, no `Retry-After`
 * handling, and no `Generation` response type, which is why sync.'s response
 * shape stays prose in this module's header.
 *
 * See {@link SyncGenerationQuery} for the params verbatim, the 1-10 `timeout`
 * range that answers 400 outside it, the response headers a `wait=true` call
 * carries, and the shape `include=progress` adds.
 */
export function generationUrl(id: string, query: SyncGenerationQuery = {}): string {
  const base = `${SYNC_BASE_URL}/v2/generate/${encodeURIComponent(id)}`;
  const search = new URLSearchParams();
  if (query.include !== undefined) search.set("include", query.include);
  if (query.wait !== undefined) search.set("wait", String(query.wait));
  if (query.timeout !== undefined) search.set("timeout", String(query.timeout));
  const qs = search.toString();
  return qs === "" ? base : `${base}?${qs}`;
}

/**
 * `POST /v2/generations/estimate` — a pre-flight quote, and NOT for the
 * generation body.
 *
 * It takes its own `EstimateCostRequest` — `model` and `duration` (finite,
 * positive billable seconds) required, plus `fps`, `workflow`
 * (`"lipsync" | "translate-and-dub"`) and `reasoningEnabled` — and answers
 * `estimatedFrameCount`, `estimatedGenerationCost`, `estimatedCredits` (null for
 * dollar-billed organizations), `durationCheck` and, for dubbing, `breakdown`.
 * "No media is fetched and no generation is created"; `POST
 * /v2/generate/estimate-cost` is an alias (/api-reference/api/generate-api/estimate-cost,
 * verified 2026-11-12).
 *
 * It answers the question unmodel can only approximate — the price is per
 * output FRAME and the duration is the input clip's, which a URL does not
 * reveal — but only once you supply that duration. Omitting `fps` "defaults to
 * 25 for credit-billed organizations and 30 otherwise", and 30 frames cost 20%
 * more than the 25-fps per-second rates the catalog carries. unmodel never
 * calls it — it never makes a network request.
 */
export const ESTIMATE_COST_URL = `${SYNC_BASE_URL}/v2/generations/estimate`;

/** `GET /v2/models` — the live roster, with `deprecatedAt` models filtered out. */
export const MODELS_URL = `${SYNC_BASE_URL}/v2/models`;

/**
 * `GET /v2/errors` — the full failure catalog, **unauthenticated**.
 *
 * Returns `{ code, message, suggestion, nextAction? }[]`. `nextAction` is on 23
 * of the 135 entries and takes nine values on 2026-11-12 (`buy_credits`,
 * `confirm_payment`, `contact_support`, `manage_integration`, `pay_invoice`,
 * `reduce_input`, `retry_later`, `update_payment_method`, `upgrade_plan`). It is
 * where {@link SYNC_ERROR_CODES} was transcribed from and is the refresh source
 * when it goes stale.
 */
export const ERRORS_URL = `${SYNC_BASE_URL}/v2/errors`;

/** `GET /v2/organizations/webhook/secret` — the `whsec_…` webhook signing key. */
export const WEBHOOK_SECRET_URL = `${SYNC_BASE_URL}/v2/organizations/webhook/secret`;

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

/**
 * The five model ids `POST /v2/generate` accepts.
 *
 * The curated spec's `Model` enum, confirmed against `@sync.so/sdk@0.4.0`'s
 * `Model.d.ts` on 2026-11-12. The full backend spec adds `lipsync-2-mini` and
 * `appearence-1`; neither has a docs page (both `/models/<id>.md` routes answer
 * "Page Not Found"), neither has a published rate, and neither is in the SDK —
 * so unmodel does not type them.
 */
export const SYNC_MODELS = [
  "sync-3",
  "lipsync-2",
  "lipsync-2-pro",
  "lipsync-1.9.0-beta",
  "react-1",
] as const;
export type SyncModelId = (typeof SYNC_MODELS)[number];

/**
 * The models that accept an IMAGE as their visual input — one, and it is the
 * whole reason `unmodel/avatar` reaches this provider.
 *
 * Verbatim from the create-generation reference: "Image inputs are only
 * supported with the sync-3 model." `sync-3`'s own page repeats it — "sync-3 is
 * the only model that supports image input" — and adds the formats: JPEG, PNG,
 * WebP. Note that `react-1`, which is otherwise the most capable model here,
 * is NOT on this list: expression control needs a performance to react to.
 */
export const SYNC_IMAGE_MODELS = ["sync-3"] as const;
export type SyncImageModelId = (typeof SYNC_IMAGE_MODELS)[number];

/**
 * The models `options.temperature` applies to.
 *
 * From the per-model options matrix on /models/lipsync: `temperature` is "Yes"
 * for `lipsync-2` and `lipsync-2-pro`, "No (native)" for `sync-3` and "No" for
 * `lipsync-1.9.0-beta`. `react-1` is absent from that matrix; the full spec
 * describes the field as lipsync-2-family only, so it is not listed here.
 */
export const SYNC_TEMPERATURE_MODELS = ["lipsync-2", "lipsync-2-pro"] as const;

/**
 * The models `options.occlusion_detection_enabled` applies to.
 *
 * Same matrix: "Yes" for `lipsync-2`, `lipsync-2-pro` and `lipsync-1.9.0-beta`,
 * "No (automatic)" for `sync-3` — which detects obstructions natively and has
 * no switch because it never needed one.
 */
export const SYNC_OCCLUSION_MODELS = ["lipsync-2", "lipsync-2-pro", "lipsync-1.9.0-beta"] as const;

/**
 * The models `options.reasoning_enabled` applies to.
 *
 * Same matrix, verified 2026-11-12: "| `reasoning_enabled` | No | Yes | No
 * (built-in) | No |" for `lipsync-2`, `lipsync-2-pro`, `sync-3` and
 * `lipsync-1.9.0-beta` — "Supported on lipsync-2-pro; sync-3 has it built in"
 * (the field's own description). `react-1` is absent from the matrix, as for
 * `temperature`. The reasoning pass is priced — the estimate endpoint's
 * `reasoningEnabled` "Include[s] reasoning pricing when supported by the
 * model" — but no rate is published, so no row carries it.
 */
export const SYNC_REASONING_MODELS = ["lipsync-2-pro"] as const;

/**
 * The models `options.model_mode` and `options.prompt` apply to.
 *
 * Both fields say so in their own descriptions — "only works with react-1" —
 * and `react-1` is the only model in the roster whose `ModelInfo.type` is
 * `"react"` rather than `"lipsync"`.
 */
export const SYNC_REACT_MODELS = ["react-1"] as const;

/**
 * The models `options.active_speaker_detection` applies to — every one but
 * `react-1`.
 *
 * The /models/lipsync matrix marks it supported on all four lipsync models, and
 * /models/react (verified 2026-11-12) excludes the fifth: "The
 * `active_speaker_detection` option is not supported, including both automatic
 * detection (`auto_detect`) and manual selection via bounding box or frame
 * number."
 */
export const SYNC_ACTIVE_SPEAKER_MODELS = [
  "sync-3",
  "lipsync-2",
  "lipsync-2-pro",
  "lipsync-1.9.0-beta",
] as const;

/**
 * The models the top-level `segments` array applies to — every one but
 * `react-1`.
 *
 * /developer-guides/segments restricts no model; /models/react (verified
 * 2026-11-12) says "Multi-segment generation with different audio inputs is not
 * available" and, in its model reference, "No multi-segment generation".
 */
export const SYNC_SEGMENT_MODELS = [
  "sync-3",
  "lipsync-2",
  "lipsync-2-pro",
  "lipsync-1.9.0-beta",
] as const;

// ---------------------------------------------------------------------------
// Published enums
// ---------------------------------------------------------------------------

/**
 * `options.sync_mode` — what to do when the clip and the track are different
 * lengths. Defaults to `"bounce"`.
 *
 * Five arms, each a different answer to the same question (from the SDK's
 * per-arm doc comments, which are richer than the spec's):
 *
 * - `bounce` — clip shorter than audio: play it forwards then backwards to fill.
 * - `loop` — clip shorter: repeat it.
 * - `cut_off` — audio longer: truncate the audio to the clip.
 * - `silence` — clip longer: pad the audio with silence.
 * - `remap` — change the clip's playback speed to match the audio exactly.
 *
 * Otherwise (clip longer than audio) every mode crops the clip.
 *
 * ⚠️ **Ignored for image inputs**, which have no intrinsic duration. See
 * {@link checkImageOptions}.
 *
 * This is also the field `fal-ai/sync-lipsync/v2` exposes under the same name
 * with the same five arms — because it IS this model, resold. One vendor
 * agreeing with itself through a reseller is one witness, so `sync_mode` is a
 * per-model extra at both providers rather than canonical vocabulary.
 */
export const SYNC_SYNC_MODES = ["bounce", "loop", "cut_off", "silence", "remap"] as const;
export type SyncSyncMode = (typeof SYNC_SYNC_MODES)[number];

/**
 * `options.model_mode` — how much of the face `react-1` is allowed to move.
 * Defaults to `"face"`. `"head"` adds natural talking-head motion.
 */
export const SYNC_MODEL_MODES = ["lips", "face", "head"] as const;
export type SyncModelMode = (typeof SYNC_MODEL_MODES)[number];

/**
 * `options.prompt` — the six emotions `react-1` documents.
 *
 * The WIRE field is a plain `string` in the curated spec and in
 * `@sync.so/sdk@0.4.0` ("React-1 accepts emotion prompts; the appearance model
 * accepts a free-form appearance edit instruction"), so {@link SyncGenerationOptions}
 * types it `SyncEmotion | (string & {})`. These six are what /models/react
 * lists — "Emotion prompt for the generation. Currently supports single-word
 * emotions only." — and a `react-1` prompt outside them is a warning rather
 * than a refusal: no page says whether sync. rejects or ignores one.
 */
export const SYNC_EMOTIONS = [
  "happy",
  "sad",
  "angry",
  "disgusted",
  "surprised",
  "neutral",
] as const;
export type SyncEmotion = (typeof SYNC_EMOTIONS)[number];

/**
 * `options.blending_mode` — "Controls how generated frames blend into the
 * source media." The curated `BlendingMode` enum, verified 2026-11-12. No page
 * says which models take it, so it is typed and not gated.
 */
export const SYNC_BLENDING_MODES = ["default", "advanced", "disabled"] as const;
export type SyncBlendingMode = (typeof SYNC_BLENDING_MODES)[number];

/**
 * `options.output_format` — "Deprecated output container setting; defaults to
 * mp4." The curated `OutputFormat` enum, verified 2026-11-12.
 */
export const SYNC_OUTPUT_FORMATS = ["mp4", "mov"] as const;
export type SyncOutputFormat = (typeof SYNC_OUTPUT_FORMATS)[number];

/**
 * The states `GET /v2/generate/{id}` reports.
 *
 * `COMPLETED`, `FAILED` and `REJECTED` are terminal. `REJECTED` is the one worth
 * handling separately: it means the request never ran (moderation, plan limits)
 * rather than that it ran and failed, and it is charged differently.
 */
export const SYNC_GENERATION_STATUSES = [
  "PENDING",
  "PROCESSING",
  "COMPLETED",
  "FAILED",
  "REJECTED",
] as const;
export type SyncGenerationStatus = (typeof SYNC_GENERATION_STATUSES)[number];

/** `ModelInfo.type` on `GET /v2/models` — the two model families. */
export const SYNC_MODEL_TYPES = ["lipsync", "react"] as const;
export type SyncModelType = (typeof SYNC_MODEL_TYPES)[number];

/** The one TTS provider sync. proxies for `type: "text"` inputs and dubbing. */
export const SYNC_TTS_PROVIDERS = ["elevenlabs"] as const;
export type SyncTtsProvider = (typeof SYNC_TTS_PROVIDERS)[number];

/**
 * `dubParams.targetLang` — the 110 languages sync.'s dubbing integration takes.
 *
 * `dubParams.sourceLang` is the same list plus `"auto"`, which is its default.
 * Transcribed from `common_DubLanguage` in the curated spec, in the spec's own
 * order, 2026-11-12. The last seventeen are regional variants ("Regional
 * variants include `es-MX`, `es-ES`, and `pt-BR`" — /tutorials/dubbing);
 * `@sync.so/sdk@0.4.0`'s `DubLanguage.d.ts` stops at `fil` and lacks them, an
 * absence the spec wins.
 */
export const SYNC_DUB_LANGUAGES = [
  "en", "gu", "no", "sl", "pa", "ta", "az", "gl", "is", "sw", "my", "fi", "el",
  "he", "lt", "ms", "sv", "fr", "ca", "hr", "lv", "ro", "sd", "th", "tn", "pl",
  "ceb", "da", "hu", "mr", "tl", "ug", "wo", "zu", "zh", "hi", "as", "ha", "kk",
  "ki", "rn", "ky", "st", "te", "war", "ak", "be", "cs", "ka", "mn", "bo", "ts",
  "ar", "ss", "nl", "tr", "af", "bs", "et", "rw", "ne", "ko", "it", "es", "sq",
  "eu", "kn", "sk", "su", "ve", "pt", "am", "hy", "doi", "de", "jv", "mk", "ja",
  "vi", "cy", "nso", "uk", "bg", "id", "lg", "yo", "ml", "fa", "tg", "ur", "uz",
  "ru", "fil", "ar-EG", "yue", "zh-TW", "dgo", "en-AU", "en-CA", "en-GB",
  "en-US", "fr-CA", "fr-FR", "cmn", "pt-BR", "pt-PT", "es-AR", "es-CL", "es-ES",
  "es-MX",
] as const;
export type SyncDubLanguage = (typeof SYNC_DUB_LANGUAGES)[number];

/** `dubParams.sourceLang` — the target list plus automatic detection. */
export const SYNC_DUB_SOURCE_LANGUAGES = ["auto", ...SYNC_DUB_LANGUAGES] as const;
export type SyncDubSourceLanguage = (typeof SYNC_DUB_SOURCE_LANGUAGES)[number];

/**
 * Every `errorCode` sync. publishes, transcribed from `GET /v2/errors` on
 * **2026-11-12** — 135 codes, in the catalog's own order.
 *
 * A hand catalog rather than a generated one on purpose. The endpoint is
 * unauthenticated and could be fetched at build time, but the value of the list
 * is that it is REVIEWED: a code appearing or disappearing is a change to the
 * failure surface a caller branches on, and a generator would land it silently.
 * Refresh it by re-reading {@link ERRORS_URL}, which also carries a `message`,
 * an actionable `suggestion` and sometimes a `nextAction` per code.
 *
 * `errorCode` is the field to branch on — the `message` text is not stable.
 * Match it case-sensitively and expect both casings: the catalog lists
 * `voice_blocked` and `VOICE_BLOCKED`, `invalid_idempotency_key` and
 * `INVALID_IDEMPOTENCY_KEY`, `voice_sample_too_short` and
 * `VOICE_SAMPLE_TOO_SHORT` as separate codes.
 */
export const SYNC_ERROR_CODES = [
  "PILOT_ALLOWANCE_EXCEEDED",
  "PILOT_EXPIRED",
  "PILOT_NOT_ACTIVE",
  "generation_unsupported_model",
  "generation_pipeline_failed",
  "generation_unknown_error",
  "generation_input_validation_failed",
  "generation_infra_storage_error",
  "generation_infra_resource_exhausted",
  "generation_infra_service_unavailable",
  "generation_customer_iam_role_assume_failed",
  "generation_customer_output_bucket_not_found",
  "generation_customer_output_bucket_access_denied",
  "generation_input_video_inaccessible",
  "generation_input_audio_inaccessible",
  "generation_input_image_inaccessible",
  "generation_input_video_invalid",
  "generation_input_audio_invalid",
  "generation_input_segments_invalid",
  "generation_input_trim_invalid",
  "generation_input_face_selection_invalid",
  "generation_input_resolution_unsupported",
  "generation_input_duration_greater_than_max_duration",
  "cost_estimate_unavailable",
  "generation_model_duration_exceeded",
  "generation_plan_duration_exceeded",
  "dubbing_duration_exceeded",
  "free_tier_generations_exhausted",
  "plan_feature_unavailable",
  "account_payment_required",
  "unpaid_usage_limit_reached",
  "usage_prepayment_declined",
  "usage_prepayment_requires_action",
  "linked_unpaid_balance",
  "insufficient_credits",
  "account_on_hold",
  "account_suspended",
  "voice_clone_limit_reached",
  "elevenlabs_quota_exceeded",
  "generation_input_asset_type_mismatch",
  "generation_input_too_many_visual",
  "generation_input_dub_audio_conflict",
  "dialogue_edit_not_found",
  "dialogue_edit_not_completed",
  "dialogue_edit_source_mismatch",
  "dialogue_edit_audio_conflict",
  "dialogue_edit_removal_too_large",
  "dialogue_edit_retime_required",
  "dialogue_edit_unsupported",
  "dialogue_edit_batch_mixed_sources",
  "dialogue_edit_too_many_edits",
  "concurrency_limit_reached",
  "rate_limit_exceeded",
  "generation_not_deletable_while_processing",
  "invalid_generation_id",
  "unsupported_generation_id_format",
  "generation_not_found",
  "generation_not_ready",
  "generation_not_downloadable",
  "generation_output_unavailable",
  "generation_download_unavailable",
  "generation_admission_paused",
  "generation_admission_unavailable",
  "generation_conflict",
  "generation_media_probe_timeout",
  "generation_media_probe_unavailable",
  "controller_timeout",
  "controller_unavailable",
  "controller_dependency_error",
  "internal_error",
  "project_not_found",
  "asset_not_found",
  "asset_forbidden",
  "invalid_asset_id_format",
  "uploaded_file_not_found",
  "file_not_in_org_storage",
  "file_size_exceeds_plan_limit",
  "voice_not_found",
  "voice_verification_required",
  "voice_blocked",
  "voice_access_denied",
  "voice_sample_not_accessible",
  "voice_sample_type_unsupported",
  "voice_sample_upload_required",
  "voice_sample_extraction_failed",
  "voice_sample_source_too_large",
  "voice_sample_too_short",
  "voice_sample_invalid",
  "voice_name_conflict",
  "voice_clone_busy",
  "voice_clone_pending",
  "elevenlabs_api_key_invalid",
  "elevenlabs_service_unavailable",
  "integration_setup_requires_studio",
  "invalid_idempotency_key",
  "idempotency_key_conflict",
  "async_tts_not_enabled",
  "payment_method_declined",
  "payment_provider_unavailable",
  "usage_dependency_unavailable",
  "upload_capacity_unavailable",
  "invalid_organization_id",
  "organization_access_denied",
  "api_key_organization_bound",
  "oauth_organization_not_granted",
  "organization_owner_missing",
  "approval_plan_unavailable",
  "approval_credits_unavailable",
  "already_on_plan",
  "billing_managed_by_sync",
  "machine_payment_required",
  "machine_payments_unavailable",
  "import_in_progress",
  "import_failed",
  "import_daily_limit_reached",
  "import_not_enabled",
  "import_unavailable",
  "INVALID_IDEMPOTENCY_KEY",
  "IDEMPOTENCY_KEY_CONFLICT",
  "IDEMPOTENCY_IN_PROGRESS",
  "IDEMPOTENCY_OUTCOME_UNKNOWN",
  "IDEMPOTENCY_UNAVAILABLE",
  "IDEMPOTENCY_GENERATION_DELETED",
  "DUPLICATE_SUBMISSION",
  "EXTRACTION_FAILED",
  "VOICE_CLONE_FAILED",
  "VOICE_SAMPLE_TOO_SHORT",
  "VOICE_BLOCKED",
  "VOICE_VERIFICATION_REQUIRED",
  "SYNTHESIS_FAILED",
  "EDIT_TOO_LONG",
  "SOURCE_TOO_LONG",
  "PLAN_FAILED",
  "TIMEOUT",
  "UNKNOWN",
] as const;
export type SyncErrorCode = (typeof SYNC_ERROR_CODES)[number];

// ---------------------------------------------------------------------------
// Input items
// ---------------------------------------------------------------------------

/**
 * The `url`-or-`assetId` pair every media input item carries.
 *
 * The spec encodes the pairing as `allOf: [{ anyOf: [{required:["url"]},
 * {required:["assetId"]}] }]` — an `anyOf`, so it is "at least one" rather than
 * exclusive, and both fields are individually optional. {@link checkInputRefs}
 * is what turns "at least one" into a message.
 */
export interface SyncMediaRef {
  /**
   * A publicly reachable http(s) URL sync. fetches. Also an `s3://` URL in
   * your organization's custom output bucket, if it has one; a TikTok,
   * Instagram, Facebook or YouTube link is imported first, and a linked audio
   * input (or a linked video in a segments or dubbing request) answers 409
   * `import_in_progress` until the import finishes.
   */
  url?: string;
  /** An asset id from your media library (`POST /v2/assets`). */
  assetId?: string;
}

/** A source clip. `refId` labels it for a `segments` entry to point back at. */
export interface SyncVideoInput extends SyncMediaRef {
  type: "video";
  refId?: string;
  /** @deprecated Use the top-level `segments` array. */
  segments_secs?: unknown;
  /** @deprecated Use the top-level `segments` array. */
  segments_frames?: unknown;
}

/**
 * A still to animate. **`sync-3` only** — see {@link SYNC_IMAGE_MODELS}.
 * JPEG, PNG or WebP.
 */
export interface SyncImageInput extends SyncMediaRef {
  type: "image";
  refId?: string;
}

/** A recorded voice track. */
export interface SyncAudioInput extends SyncMediaRef {
  type: "audio";
  /** Required when `segments` is used — that is how a segment names its track. */
  refId?: string;
}

/** The ElevenLabs voice configuration a `type: "text"` input speaks with. */
export interface SyncTtsProviderConfig {
  name: SyncTtsProvider;
  /** A sync. voice id (cloned in Studio) or an ElevenLabs voice id. */
  voiceId: string;
  script: string;
  /** 0–1, default 0.5. Lower is more expressive and less repeatable. */
  stability?: number;
  /** 0–1, default 0.75. How closely to adhere to the original voice. */
  similarityBoost?: number;
}

/**
 * A script instead of a track: sync. synthesizes it, then lip-syncs to it.
 *
 * The finished generation carries `synthesizedAudioUrl` — reuse it as an
 * {@link SyncAudioInput} to keep the exact same take across generations rather
 * than re-synthesizing and getting a different one.
 */
export interface SyncTtsInput {
  type: "text";
  provider: SyncTtsProviderConfig;
  /** Required when `segments` is used. */
  refId?: string;
}

/** The two ways a voice arrives: recorded, or written and spoken for you. */
export type SyncAudioLikeInput = SyncAudioInput | SyncTtsInput;

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/**
 * Which face in the frame to sync, when there is more than one.
 *
 * Three ways to say it, in ascending order of how much you already know:
 * `auto_detect` (let sync. find the talker), `frame_number` + `coordinates`
 * (point at one face in one frame), or `bounding_boxes` / `bounding_boxes_url`
 * (you already ran detection and have a box per frame).
 *
 * `coordinates` are RAW PIXELS in the source's own space, not normalized ratios
 * — the spec says so explicitly, and it is the easy mistake here.
 */
export interface SyncActiveSpeaker {
  /** Defaults to `false`. **Not supported for image inputs** — see {@link checkImageOptions}. */
  auto_detect?: boolean;
  /** Use ASD v3. */
  v3?: boolean;
  /** Which frame `coordinates` refers to. `0` for an image input. */
  frame_number?: number;
  /** `[x, y]` in the source's native pixel space. Not normalized. */
  coordinates?: number[];
  /** `[x1, y1, x2, y2]` per frame, or null where no face was found. */
  bounding_boxes?: (number[] | null)[];
  /** A JSON file with a `bounding_boxes` array, for payloads too big to inline. */
  bounding_boxes_url?: string;
  /** Base64-encoded reference face image (128x128 WebP) for selected-speaker detection. */
  face_image?: string;
}

/**
 * The fifteen generation options the developer-facing spec publishes — the
 * same fifteen `@sync.so/sdk@0.4.0`'s `GenerationOptions` declares.
 *
 * Six are model-gated, and sync. IGNORES an option a model does not take
 * rather than refusing the request ("Unsupported options are ignored if
 * included in a request" — /models/lipsync; /models/react says only "not
 * supported"). So the gate is reported as a
 * WARNING here: refusing would reject a request the API honours, and staying
 * silent would let a caller believe a dial did something. The other nine are
 * typed and not gated, because no page says which models take them.
 */
export interface SyncGenerationOptions {
  /** Duration-mismatch strategy; default `"bounce"`. Ignored for image inputs. */
  sync_mode?: SyncSyncMode;
  /** `react-1` only. Which region the model may move; default `"face"`. */
  model_mode?: SyncModelMode;
  /**
   * `react-1` only. The emotion to perform, default `"neutral"` — one word;
   * {@link SYNC_EMOTIONS} are the six /models/react lists. A plain `string` on
   * the wire, which is why the tail is open.
   */
  prompt?: SyncEmotion | (string & {});
  /** Reference image URLs "for appearance editing generations. At most 10." */
  prompt_image_uris?: string[];
  /** "Prompt for image-to-video generation." */
  i2v_prompt?: string;
  /** `lipsync-2` / `lipsync-2-pro` only. 0 least expressive, 1 most; default 0.5. */
  temperature?: number;
  /** Which face to sync when the frame has several. Not on `react-1`. */
  active_speaker_detection?: SyncActiveSpeaker;
  /** Not on `sync-3`, which does it natively. Default `false`; slows generation. */
  occlusion_detection_enabled?: boolean;
  /** "URL for precomputed face bounding boxes." */
  face_boxes_url?: string;
  /**
   * `lipsync-2-pro` only (`sync-3` has it built in). Default `false`: "analyze
   * and correct frames with artifacts, occlusions, or extreme poses during
   * generation; slows down generation."
   */
  reasoning_enabled?: boolean;
  /** "Whether to enable the refinement pass for the generation." */
  refinement_enabled?: boolean;
  /** "Controls how generated frames blend into the source media." */
  blending_mode?: SyncBlendingMode;
  /** @deprecated "Deprecated output container setting; defaults to mp4." */
  output_format?: SyncOutputFormat;
  /** @deprecated "Deprecated output frame-rate setting." */
  fps?: number;
  /**
   * @deprecated Exactly `[width, height]`, each finite and 180–4096 inclusive;
   * "Invalid values are discarded and the option is treated as omitted."
   */
  output_resolution?: number[];
}

/** Per-segment overrides — the same options, applied to one time range only. */
export interface SyncSegmentOptionsOverride {
  sync_mode?: SyncSyncMode;
  temperature?: number;
  occlusion_detection_enabled?: boolean;
  active_speaker_detection?: SyncActiveSpeaker;
}

/** Which track plays over one stretch of the clip, and which slice of it. */
export interface SyncSegmentAudioInput {
  /** The `refId` of an audio or text input in the same request. */
  refId: string;
  /** Crop the referenced track. `startTime` and `endTime` come as a pair. */
  startTime?: number;
  endTime?: number;
}

/**
 * One stretch of the clip — bounded in seconds or in frames — and the track
 * that covers it.
 *
 * Segments are how one video takes several voices. Every audio or text input
 * must carry a unique `refId` when this array is present, because the segment
 * names its track by that id — {@link checkSegmentRefIds} says so before sync.
 * does.
 *
 * Every field is optional in the curated spec and in the SDK; the rules between
 * them are prose on /developer-guides/segments and are checked by
 * `sync.lipsync`: a lipsynced segment needs an `audioInput` ("Only a segment
 * with `lipsync: false` can omit `audioInput`"), frame bounds are strictly
 * ordered where time bounds may be equal, and "At least one segment must be
 * lipsynced".
 */
export interface SyncGenerationSegment {
  /** Seconds. Must be ≤ `endTime`. */
  startTime?: number;
  /** Seconds. Must be ≥ `startTime`. */
  endTime?: number;
  /** Frames, instead of time bounds. Must be strictly < `endFrame`. */
  startFrame?: number;
  /** Frames, instead of time bounds. Must be strictly > `startFrame`. */
  endFrame?: number;
  /** Required unless `lipsync` is `false`. */
  audioInput?: SyncSegmentAudioInput;
  /**
   * Default `true`. `false` keeps this part of the video exactly as it is — not
   * lipsynced and not billed — and plays the request's one output track over
   * it; see `outputAudio`.
   */
  lipsync?: boolean;
  optionsOverride?: SyncSegmentOptionsOverride;
}

/**
 * The audio input that plays over the WHOLE finished output, "replacing the
 * sound of every part, lipsynced or not".
 *
 * Only with `segments` ("outputAudio needs segments" is a 422), and `refId` must
 * name an `audio` input — "not a text input". When a segment sets
 * `lipsync: false` and this is omitted, the request's only audio input is
 * used. Not available to organizations with zero data retention, a custom
 * output bucket or a retention override, which a request cannot show.
 */
export interface SyncOutputAudio {
  refId: string;
}

/**
 * A completed dialogue edit (`POST /v2/dialogue-edits`) to lip-sync to.
 *
 * Like `dubParams`, a request MODE: the edit supplies the audio and the edited
 * regions, so the body carries exactly one video — "the same video the
 * dialogue edit was made from" — "and no audio input, segments or dubParams".
 * An API-key request whose organization's rollout lacks segment lipsync and
 * section expansion answers 422 `dialogue_edit_retime_required`, which a
 * request cannot show either.
 */
export interface SyncDialogueEditReference {
  /** "Id of a completed dialogue edit from POST /v2/dialogue-edits." */
  id: string;
}

/**
 * Redub the clip into another language before lip-syncing it.
 *
 * A dubbed request is a DIFFERENT request shape rather than an extra option:
 * the voice comes out of the video's own audio track, so the body carries
 * exactly one video input and no audio or text input at all. Sending both is
 * rejected with `generation_input_dub_audio_conflict`, which
 * {@link checkDubParams} catches first.
 */
export interface SyncDubParams {
  providerName: SyncTtsProvider;
  targetLang: SyncDubLanguage | (string & {});
  /** Defaults to `"auto"`. */
  sourceLang?: SyncDubSourceLanguage | (string & {});
  /** @deprecated Ignored — dubbing v2 detects speakers automatically. */
  numSpeakers?: number;
  /** Integer 1–10. "Higher values preserve more of the source voice." */
  cloningStrength?: number;
  /** Seconds into the source, default 0. Output and billing cover only the range. */
  startTime?: number;
  /** Seconds; "Must be after startTime". Defaults to the end of the video. */
  endTime?: number;
}

// ---------------------------------------------------------------------------
// Shared zod fragments
// ---------------------------------------------------------------------------

const mediaRefSchema = {
  url: z.string().optional(),
  assetId: z.string().optional(),
  refId: z.string().optional(),
};

export const videoInputSchema = z.looseObject({
  type: z.literal("video"),
  ...mediaRefSchema,
});

export const imageInputSchema = z.looseObject({
  type: z.literal("image"),
  ...mediaRefSchema,
});

export const audioInputSchema = z.looseObject({
  type: z.literal("audio"),
  ...mediaRefSchema,
});

export const ttsInputSchema = z.looseObject({
  type: z.literal("text"),
  provider: z.looseObject({
    name: z.enum(SYNC_TTS_PROVIDERS),
    voiceId: z.string(),
    script: z.string(),
    stability: z.number().min(0).max(1).optional(),
    similarityBoost: z.number().min(0).max(1).optional(),
  }),
  refId: z.string().optional(),
});

export const activeSpeakerSchema = z.looseObject({
  auto_detect: z.boolean().optional(),
  v3: z.boolean().optional(),
  frame_number: z.number().int().optional(),
  coordinates: z.array(z.number()).optional(),
  bounding_boxes: z.array(z.union([z.array(z.number()), z.null()])).optional(),
  bounding_boxes_url: z.string().optional(),
  face_image: z.string().optional(),
});

export const optionsSchema = z.looseObject({
  sync_mode: z.enum(SYNC_SYNC_MODES).optional(),
  model_mode: z.enum(SYNC_MODEL_MODES).optional(),
  prompt: z.string().optional(),
  prompt_image_uris: z.array(z.string()).optional(),
  i2v_prompt: z.string().optional(),
  temperature: z.number().optional(),
  active_speaker_detection: activeSpeakerSchema.optional(),
  occlusion_detection_enabled: z.boolean().optional(),
  face_boxes_url: z.string().optional(),
  reasoning_enabled: z.boolean().optional(),
  refinement_enabled: z.boolean().optional(),
  blending_mode: z.enum(SYNC_BLENDING_MODES).optional(),
  output_format: z.enum(SYNC_OUTPUT_FORMATS).optional(),
  fps: z.number().optional(),
  output_resolution: z.array(z.number()).optional(),
});

/** `outputFileName` — up to 255 characters; sync. sanitizes and appends `.mp4`. */
export const OUTPUT_FILE_NAME_MAX_CHARS = 255;

/** Where the two count ceilings below are stated in prose. */
const LIMITS_SOURCE = `${DOCS_BASE}/developer-guides/segments`;

/**
 * `input` — at most 101 items: one visual plus up to 100 voices.
 *
 * https://sync.so/docs/developer-guides/segments.md (verified 2026-11-12): "A
 * generation can have up to 100 segments and up to 101 inputs: one video plus
 * up to 100 audio or text inputs. Requests over these limits return 400." The
 * curated spec's `common_CreateGenerationDto.input` repeats it — "At most 101
 * inputs." — in its description and declares no `maxItems`, so the cap is a
 * named check ({@link checkInputArity}) rather than a schema bound.
 */
export const SYNC_MAX_INPUTS = 101;

/**
 * `segments` — at most 100 entries. Same guide sentence; the curated spec's
 * `common_CreateGenerationDto.segments` says "At most 100 segments." (verified
 * 2026-11-12), again with no `maxItems`.
 */
export const SYNC_MAX_SEGMENTS = 100;

/** The fields both verbs share, as one zod fragment. */
export const generationCommonSchema = {
  model: z.string(),
  options: optionsSchema.optional(),
  webhookUrl: z.string().optional(),
  outputFileName: z.string().max(OUTPUT_FILE_NAME_MAX_CHARS).optional(),
  projectId: z.string().optional(),
};

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

/**
 * The shape every check below reads — the union of both verbs' fields, with
 * everything widened to its base type.
 *
 * Written out rather than `Record<string, unknown>` for `tripo3d`'s reason: an
 * interface has no implicit index signature, so a check typed against the
 * record would not be assignable to `createValidator`'s `checks` for either
 * verb. The enums are enforced by each verb's own zod schema.
 */
interface GenerationParams {
  model: string;
  input?: readonly { type?: string; url?: string; assetId?: string; refId?: string }[];
  options?: {
    sync_mode?: string;
    model_mode?: string;
    prompt?: string;
    temperature?: number;
    occlusion_detection_enabled?: boolean;
    reasoning_enabled?: boolean;
    active_speaker_detection?: { auto_detect?: boolean };
  };
  segments?: readonly unknown[];
  dubParams?: unknown;
  dialogueEdit?: unknown;
}

const VISUAL_TYPES = new Set(["video", "image"]);
const VOICE_TYPES = new Set(["audio", "text"]);

/**
 * The arity rule, stated verbatim in the spec and enforced here.
 *
 * "Normal lipsync requests must include exactly one visual input (video or
 * image) and one audio or text input." It is the first thing a caller gets
 * wrong — `input` is an ARRAY, so passing two clips or forgetting the track
 * both type-check — and the API's own refusal
 * (`generation_input_too_many_visual`) arrives after a round trip.
 *
 * A dubbed request and a dialogue-edit request are the two documented
 * exceptions: each carries one video and NO voice, on purpose, and each is
 * checked where its own rule lives ({@link checkDubParams}, and
 * `checkDialogueEdit` in `./lipsync.ts`).
 *
 * The array also has a ceiling, {@link SYNC_MAX_INPUTS}, which is a 400 over
 * it and is checked here because both verbs share it.
 */
export function checkInputArity(source: string, visual: "video" | "image") {
  return (params: GenerationParams, _info: unknown, ctx: PipelineContext): void => {
    const input = params.input;
    if (!Array.isArray(input)) return;

    if (input.length > SYNC_MAX_INPUTS) {
      ctx.report({
        code: "invalid_shape",
        path: ["input"],
        model: params.model,
        message:
          `sync. accepts at most ${SYNC_MAX_INPUTS} inputs per generation (one ${visual} plus up to ` +
          `${SYNC_MAX_INPUTS - 1} audio or text inputs); this request has ${input.length} — over the ` +
          "limit the API answers 400. Split the voices across several generations.",
        meta: { source: LIMITS_SOURCE, inputs: input.length, max: SYNC_MAX_INPUTS },
      });
    }

    const visuals = input.filter((item) => VISUAL_TYPES.has(String(item?.type)));
    const voices = input.filter((item) => VOICE_TYPES.has(String(item?.type)));

    if (visuals.length !== 1) {
      ctx.report({
        code: "invalid_shape",
        path: ["input"],
        model: params.model,
        message:
          `A generation takes exactly one visual input; this request has ${visuals.length}. ` +
          `Pass a single \`{ type: "${visual}", url }\` (or \`assetId\`) item` +
          (visuals.length > 1
            ? " — several clips is a several-generation job, not one request."
            : "."),
        meta: { source, visuals: visuals.length },
      });
    }

    // A dubbed request supplies its voice from the video's own track, and a
    // dialogue-edit request from the completed edit; the "no voice input" half
    // of each rule is checked where it belongs.
    if (params.dubParams !== undefined || params.dialogueEdit !== undefined) return;

    if (voices.length === 0) {
      ctx.report({
        code: "invalid_shape",
        path: ["input"],
        model: params.model,
        message:
          "A generation needs something to say: add an `{ type: \"audio\", url }` item, or a " +
          '`{ type: "text", provider: { name: "elevenlabs", voiceId, script } }` item to have sync. ' +
          "speak a script for you. (A `dubParams` request and a `dialogueEdit` request are the two " +
          "exceptions — they take the voice out of the video's own track and out of a completed " +
          "dialogue edit.)",
        meta: { source, voices: 0 },
      });
    } else if (voices.length > 1 && params.segments === undefined) {
      ctx.report({
        code: "invalid_shape",
        path: ["input"],
        model: params.model,
        message:
          `${voices.length} audio or text inputs were given and no \`segments\` array to place them. ` +
          "Several tracks over one clip is the `segments` feature: give each track a unique `refId` " +
          "and add a segment naming it, or send one track.",
        meta: { source, voices: voices.length },
      });
    }
  };
}

/**
 * Each media item needs a `url` or an `assetId`.
 *
 * The spec spells this as an `anyOf` over two `required` lists, which is a
 * shape zod's loose object cannot express and a caller cannot see: both fields
 * are individually optional, so `{ type: "video" }` type-checks and 422s.
 */
export function checkInputRefs(source: string) {
  return (params: GenerationParams, _info: unknown, ctx: PipelineContext): void => {
    const input = params.input;
    if (!Array.isArray(input)) return;
    input.forEach((item, index) => {
      const type = String(item?.type);
      if (!VISUAL_TYPES.has(type) && type !== "audio") return;
      if (item?.url !== undefined || item?.assetId !== undefined) return;
      ctx.report({
        code: "invalid_shape",
        path: ["input", index, "url"],
        model: params.model,
        message:
          `\`input[${index}]\` is a \`${type}\` item with neither \`url\` nor \`assetId\`. sync. needs one ` +
          "of the two: a publicly reachable URL it fetches, or the id of an asset you uploaded with " +
          "POST /v2/assets.",
        meta: { source, index, type },
      });
    });
  };
}

/**
 * An image input narrows the model to `sync-3`, and nothing else does.
 *
 * A hard refusal rather than a warning: the API answers
 * `generation_unsupported_model` — "This model is not supported for the
 * selected generation type." — and the fix is to change the model rather than
 * to drop a field.
 */
export function checkImageModel(source: string) {
  return (params: GenerationParams, _info: unknown, ctx: PipelineContext): void => {
    const input = params.input;
    if (!Array.isArray(input)) return;
    if (!input.some((item) => item?.type === "image")) return;
    if ((SYNC_IMAGE_MODELS as readonly string[]).includes(params.model)) return;
    ctx.report({
      code: "unsupported_capability",
      path: ["model"],
      model: params.model,
      message:
        `An \`image\` input is supported by ${SYNC_IMAGE_MODELS.map((id) => `"${id}"`).join(", ")} and by no ` +
        `other sync. model; "${params.model}" takes a video. Either switch the model, or pass ` +
        '`{ type: "video", url }` — a still and a clip are different products here, which is why ' +
        "unmodel files them as `avatar` and `lipsync`.",
      meta: { source, allowed: [...SYNC_IMAGE_MODELS] },
    });
  };
}

/**
 * The five model-gated options, reported as warnings because sync. ignores
 * them rather than refusing.
 *
 * The gate is published as a matrix on /models/lipsync ("Unsupported options
 * are ignored if included in a request") and repeated in each field's own
 * description. A caller who set `temperature: 0.9` on `sync-3` got the default
 * expressiveness and no indication; this is the indication.
 *
 * The sixth gated option, `active_speaker_detection`, is not a row here: its
 * gate is `react-1`'s own page, which does not say the field is ignored — see
 * `checkReactLimitations` in `./lipsync.ts`.
 */
const GATED_OPTIONS: ReadonlyArray<{
  readonly key:
    | "temperature"
    | "occlusion_detection_enabled"
    | "reasoning_enabled"
    | "model_mode"
    | "prompt";
  readonly models: readonly string[];
  readonly why: string;
}> = [
  {
    key: "temperature",
    models: SYNC_TEMPERATURE_MODELS,
    why: "expressiveness is native to sync-3 and absent from lipsync-1.9.0-beta",
  },
  {
    key: "occlusion_detection_enabled",
    models: SYNC_OCCLUSION_MODELS,
    why: "sync-3 detects obstructions automatically and has no switch",
  },
  {
    key: "reasoning_enabled",
    models: SYNC_REASONING_MODELS,
    why: "sync-3 has the reasoning pass built in and the other models have none",
  },
  { key: "model_mode", models: SYNC_REACT_MODELS, why: "only react-1 chooses an edit region" },
  { key: "prompt", models: SYNC_REACT_MODELS, why: "only react-1 performs an emotion" },
];

export function checkModelGatedOptions(source: string) {
  return (params: GenerationParams, _info: unknown, ctx: PipelineContext): void => {
    const options = params.options;
    if (options === undefined) return;
    for (const gate of GATED_OPTIONS) {
      if (options[gate.key] === undefined) continue;
      if (gate.models.includes(params.model)) continue;
      ctx.report({
        code: "unknown_param",
        path: ["options", gate.key],
        model: params.model,
        message:
          `\`options.${gate.key}\` only applies to ${gate.models.map((id) => `"${id}"`).join(", ")}, and this ` +
          `request names "${params.model}" — ${gate.why}. sync. ignores an option a model does not take, ` +
          "so the request will succeed and the dial will have done nothing.",
        meta: { source, allowed: [...gate.models] },
      });
    }
  };
}

/**
 * A `react-1` emotion outside the six /models/react lists — a warning.
 *
 * The wire field is a free `string` (curated spec and SDK alike), and the page
 * says only "Currently supports single-word emotions only" before listing six.
 * Whether sync. rejects or ignores a seventh is not written anywhere, so
 * refusing could reject a request the API fulfils and silence could let a
 * caller believe an emotion was performed. Other models are the gate's
 * business, above.
 */
export function checkReactPrompt(source: string) {
  return (params: GenerationParams, _info: unknown, ctx: PipelineContext): void => {
    const prompt = params.options?.prompt;
    if (prompt === undefined) return;
    if (!(SYNC_REACT_MODELS as readonly string[]).includes(params.model)) return;
    if ((SYNC_EMOTIONS as readonly string[]).includes(prompt)) return;
    ctx.report({
      code: "invalid_enum_value",
      severity: "warning",
      path: ["options", "prompt"],
      model: params.model,
      message:
        `"${prompt}" is not one of the emotions "${params.model}" documents — ` +
        `${SYNC_EMOTIONS.map((emotion) => `"${emotion}"`).join(", ")} — and sync. does not say what ` +
        "it does with another word. Use one of the six, or omit `prompt` to keep the emotional " +
        "context of the input video.",
      meta: { source, allowed: [...SYNC_EMOTIONS] },
    });
  };
}

/**
 * Two options mean nothing to a still, and they mean nothing for different
 * reasons — so they get different severities.
 *
 * `sync_mode` answers "what if the clip and the track are different lengths",
 * which a still cannot be asked; sync. ignores it, so this is a warning.
 * `active_speaker_detection.auto_detect` is documented as NOT SUPPORTED for
 * image inputs, with a prescribed alternative — `coordinates` in the image's
 * native pixel space with `frame_number: 0` — so it is an error that names the
 * alternative.
 *
 * The two doc pages disagree about how far this goes: `GenerationOptions`
 * describes `active_speaker_detection` as a whole as "Not supported for image
 * inputs", while `/models/sync-3` says manual selection IS supported and only
 * auto-detect is not. The per-model page is the narrower, later statement and
 * is what this check follows.
 */
export function checkImageOptions(source: string) {
  return (params: GenerationParams, _info: unknown, ctx: PipelineContext): void => {
    const options = params.options;
    if (options === undefined) return;

    if (options.sync_mode !== undefined) {
      ctx.report({
        code: "unknown_param",
        path: ["options", "sync_mode"],
        model: params.model,
        message:
          "`options.sync_mode` decides what to do when the clip and the track are different lengths, " +
          "and an image has no duration to mismatch — sync. ignores it for image inputs. The output's " +
          "length is the audio's.",
        meta: { source },
      });
    }

    if (options.active_speaker_detection?.auto_detect === true) {
      ctx.report({
        code: "unsupported_param",
        path: ["options", "active_speaker_detection", "auto_detect"],
        model: params.model,
        message:
          "`auto_detect: true` is not supported for image inputs. For a still with more than one face, " +
          "point at the one to animate: `coordinates: [x, y]` in the image's NATIVE PIXEL space (not " +
          "normalized) together with `frame_number: 0`.",
        meta: { source },
      });
    }
  };
}

/**
 * `dubParams` forbids the voice inputs the request would otherwise need.
 *
 * The one place where "add the audio" is the wrong advice. A dubbed generation
 * extracts the source audio from the video, translates it and lip-syncs the
 * result, so an `audio` or `text` item is a contradiction rather than an extra
 * — `generation_input_dub_audio_conflict` is its own error code, which is how
 * often it happens.
 */
export function checkDubParams(source: string) {
  return (params: GenerationParams, _info: unknown, ctx: PipelineContext): void => {
    if (params.dubParams === undefined) return;
    const input = params.input;
    if (!Array.isArray(input)) return;
    const voices = input.filter((item) => VOICE_TYPES.has(String(item?.type)));
    if (voices.length === 0) return;
    ctx.report({
      code: "invalid_shape",
      path: ["dubParams"],
      model: params.model,
      message:
        `\`dubParams\` dubs the video's OWN audio track into ${
          (params.dubParams as { targetLang?: string } | undefined)?.targetLang === undefined
            ? "the target language"
            : `"${(params.dubParams as { targetLang?: string }).targetLang ?? ""}"`
        }, so the request must carry exactly one video input and no audio or text input; this one ` +
        `has ${voices.length}. Drop the voice input, or drop \`dubParams\` and supply the translated ` +
        "track yourself.",
      meta: { source, voices: voices.length },
    });
  };
}

/**
 * `segments` names its tracks by `refId`, so every track needs one and no two
 * may share.
 *
 * Stated twice in the spec — on `Audio.refId` ("Required when using segments
 * array") and on the `input` description — and invisible in the type, because
 * `refId` is optional on the item where it is conditionally required.
 */
export function checkSegmentRefIds(source: string) {
  return (params: GenerationParams, _info: unknown, ctx: PipelineContext): void => {
    const segments = params.segments;
    if (!Array.isArray(segments) || segments.length === 0) return;
    const input = params.input;
    if (!Array.isArray(input)) return;
    const voices = input.filter((item) => VOICE_TYPES.has(String(item?.type)));

    const missing = voices.filter((item) => item?.refId === undefined).length;
    if (missing > 0) {
      ctx.report({
        code: "invalid_shape",
        path: ["input"],
        model: params.model,
        message:
          `\`segments\` is present and ${missing} of the ${voices.length} audio or text inputs carry no ` +
          "`refId`. A segment points at its track by that id, so each one needs a unique `refId` before " +
          "a segment can name it.",
        meta: { source, missing },
      });
    }

    const ids = voices.map((item) => item?.refId).filter((id): id is string => id !== undefined);
    const duplicated = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
    if (duplicated.length > 0) {
      ctx.report({
        code: "invalid_shape",
        path: ["input"],
        model: params.model,
        message:
          `${duplicated.map((id) => `"${id}"`).join(", ")} ${duplicated.length === 1 ? "is" : "are"} used as ` +
          "a `refId` by more than one input. The ids have to be unique — a segment naming a duplicated " +
          "one cannot say which track it meant.",
        meta: { source, duplicated },
      });
    }

    // A segment whose `refId` names nothing is the mirror of the above and is
    // just as invisible: `audioInput.refId` is a required STRING, so a typo
    // type-checks.
    const known = new Set(ids);
    segments.forEach((segment, index) => {
      const refId = (segment as { audioInput?: { refId?: string } } | undefined)?.audioInput?.refId;
      if (refId === undefined || known.has(refId)) return;
      ctx.report({
        code: "invalid_shape",
        path: ["segments", index, "audioInput", "refId"],
        model: params.model,
        message:
          `\`segments[${index}]\` names the track "${refId}", which no input carries. The ids in scope are ` +
          `${known.size === 0 ? "none — no input declares a `refId`" : [...known].map((id) => `"${id}"`).join(", ")}.`,
        meta: { source, refId, known: [...known] },
      });
    });
  };
}
