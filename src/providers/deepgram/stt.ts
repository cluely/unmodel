import { z } from "zod";
import { createValidator, type PipelineContext } from "../../core/pipeline";
import { toValidated, JSON_HEADERS, type Validated, type ExactKeys } from "../../core/request";
import type { ValidateOptions, MediaDeclaration } from "../../core/options";
import type { ValidateEstimate, ValidateResult } from "../../core/result";
import type { ModelInfo } from "../../core/catalog-types";
import type { EndpointConstraints } from "../../core/constraint-types";
import { computeAudioMinutesCostUSD, minutesFromSeconds } from "../../core/cost";
import { findMediaDeclaration } from "../../core/media/check";
import { models, type DeepgramModelId } from "./models";

export const LISTEN_URL = "https://api.deepgram.com/v1/listen";

const LISTEN_DOCS = "https://developers.deepgram.com/reference/speech-to-text/listen-pre-recorded";
const MODELS_DOCS = "https://developers.deepgram.com/docs/models-languages-overview";

// ---------------------------------------------------------------------------
// Params — Deepgram's pre-recorded API puts (nearly) everything in the QUERY
// STRING of POST /v1/listen; the HTTP body is either JSON {url} for remote
// audio or raw binary bytes for local files (verified against LISTEN_DOCS +
// https://developers.deepgram.com/docs/pre-recorded-audio on 2026-08-13).
// `ListenParams` therefore carries the query params plus an optional `url`;
// finalize() splits them: `url` becomes the wire body, everything else is
// URL-encoded into `.request.url`.
// ---------------------------------------------------------------------------

/**
 * The five redaction GROUPS `redact` names (LISTEN_DOCS). Not an exhaustive
 * value space — `redact` also takes individual entity types, for which
 * Deepgram publishes no closed list — so `ListenParams["redact"]` keeps a
 * `(string & {})` escape alongside this union and unmodel runs no enum check
 * on the field.
 */
export const REDACT_GROUPS = ["pci", "pii", "phi", "numbers", "aggressive_numbers"] as const;
export type DeepgramRedact = (typeof REDACT_GROUPS)[number];

/**
 * `encoding` values POST /v1/listen documents (LISTEN_DOCS). The live
 * WebSocket accepts a SUPERSET of these (it adds linear32, alaw and ogg-opus),
 * so `./realtime` extends this list rather than sharing it outright.
 */
export const LISTEN_ENCODINGS = [
  "linear16",
  "flac",
  "mulaw",
  "amr-nb",
  "amr-wb",
  "opus",
  "speex",
  "g729",
] as const;
export type DeepgramListenEncoding = (typeof LISTEN_ENCODINGS)[number];

export interface ListenParams {
  /**
   * Remote-audio case: becomes the JSON wire body `{url}`. Omit it for local
   * files and POST the raw audio bytes yourself to the same `.request.url`,
   * replacing the content-type header with the audio MIME type.
   */
  url?: string;
  /** Model id; Deepgram defaults to base-general when omitted. */
  model?: DeepgramModelId | (string & {});
  /** BCP-47 language tag (default "en"); "multi" enables code-switching on Nova models. */
  language?: string;
  /** Model version (default "latest"). */
  version?: string;
  callback?: string;
  callback_method?: "POST" | "PUT";
  custom_intent?: string | string[];
  custom_intent_mode?: "extended" | "strict";
  custom_topic?: string | string[];
  custom_topic_mode?: "extended" | "strict";
  detect_entities?: boolean;
  detect_language?: boolean | string[];
  /** Deprecated by Deepgram in favor of `diarize_model`; still accepted. */
  diarize?: boolean;
  diarize_model?: "latest" | "v1" | "v2";
  dictation?: boolean;
  /** Only for raw (containerless) audio uploads. */
  encoding?: DeepgramListenEncoding;
  extra?: string | string[];
  filler_words?: boolean;
  intents?: boolean;
  /** Nova-3 only; billed as the keyterm-prompting add-on. */
  keyterm?: string | string[];
  keywords?: string | string[];
  measurements?: boolean;
  mip_opt_out?: boolean;
  multichannel?: boolean;
  numerals?: boolean;
  paragraphs?: boolean;
  profanity_filter?: boolean;
  punctuate?: boolean;
  /**
   * Redaction groups (pci, pii, phi, numbers, aggressive_numbers), entity
   * types, or true. The `(string & {})` tail is deliberate and stays: on top
   * of the five named groups the docs also accept arbitrary ENTITY TYPES
   * (`redact=email_address`), which have no closed published list — so the
   * union is autocomplete for the groups, not an exhaustive space.
   */
  redact?: DeepgramRedact | (string & {}) | boolean | Array<DeepgramRedact | (string & {})>;
  replace?: string | string[];
  search?: string | string[];
  sentiment?: boolean;
  smart_format?: boolean;
  summarize?: boolean | string;
  tag?: string | string[];
  topics?: boolean;
  /** Pause length (seconds) that splits utterances; default 0.8. */
  utt_split?: number;
  utterances?: boolean;
}

// ---------------------------------------------------------------------------
// Schema (loose: unknown keys pass through with an unknown_param warning).
// ---------------------------------------------------------------------------

const stringOrList = z.union([z.string(), z.array(z.string())]);

const schema = z.looseObject({
  url: z.string().optional(),
  model: z.string().optional(),
  language: z.string().optional(),
  version: z.string().optional(),
  callback: z.string().optional(),
  callback_method: z.string().optional(),
  custom_intent: stringOrList.optional(),
  custom_intent_mode: z.string().optional(),
  custom_topic: stringOrList.optional(),
  custom_topic_mode: z.string().optional(),
  detect_entities: z.boolean().optional(),
  detect_language: z.union([z.boolean(), z.array(z.string())]).optional(),
  diarize: z.boolean().optional(),
  diarize_model: z.string().optional(),
  dictation: z.boolean().optional(),
  encoding: z.string().optional(),
  extra: stringOrList.optional(),
  filler_words: z.boolean().optional(),
  intents: z.boolean().optional(),
  keyterm: stringOrList.optional(),
  keywords: stringOrList.optional(),
  measurements: z.boolean().optional(),
  mip_opt_out: z.boolean().optional(),
  multichannel: z.boolean().optional(),
  numerals: z.boolean().optional(),
  paragraphs: z.boolean().optional(),
  profanity_filter: z.boolean().optional(),
  punctuate: z.boolean().optional(),
  redact: z.union([z.string(), z.boolean(), z.array(z.string())]).optional(),
  replace: stringOrList.optional(),
  search: stringOrList.optional(),
  sentiment: z.boolean().optional(),
  smart_format: z.boolean().optional(),
  summarize: z.union([z.boolean(), z.string()]).optional(),
  tag: stringOrList.optional(),
  topics: z.boolean().optional(),
  utt_split: z.number().optional(),
  utterances: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

/** Enum-ish query params, verified against LISTEN_DOCS on 2026-08-13. */
const QUERY_ENUMS: Record<string, readonly string[]> = {
  callback_method: ["POST", "PUT"],
  custom_intent_mode: ["extended", "strict"],
  custom_topic_mode: ["extended", "strict"],
  diarize_model: ["latest", "v1", "v2"],
  encoding: LISTEN_ENCODINGS,
};

/** Params whose enum comparison ignores case (docs show POST/PUT uppercase). */
const CASE_INSENSITIVE_ENUMS = new Set(["callback_method"]);

/**
 * Reports every string-valued query param that falls outside its documented
 * enum. Shared with the WebSocket surfaces in `./realtime`, which use the same
 * query-string transport with slightly different value spaces (live /v1/listen
 * accepts four `callback_method`s and three more encodings, Flux accepts a
 * different encoding set again), so each caller passes its own table and the
 * doc URL that table came from.
 *
 * Non-string values are skipped: array-valued params (`redact=[…]`) have no
 * closed value space on this API, and numbers/booleans are covered by zod.
 */
export function reportQueryEnums(
  params: object,
  enums: Readonly<Record<string, readonly string[]>>,
  source: string,
  ctx: PipelineContext,
): void {
  const record = params as Record<string, unknown>;
  for (const [param, allowed] of Object.entries(enums)) {
    const value = record[param];
    if (typeof value !== "string") continue;
    const candidate = CASE_INSENSITIVE_ENUMS.has(param) ? value.toUpperCase() : value;
    if (!allowed.includes(candidate)) {
      ctx.report({
        code: "invalid_enum_value",
        path: [param],
        message: `\`${param}\` must be one of ${allowed.map((v) => JSON.stringify(v)).join(", ")}; got ${JSON.stringify(value)}.`,
        meta: { allowed: [...allowed], value, source },
      });
    }
  }
}

function checkQueryEnums(
  params: ListenParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  reportQueryEnums(params, QUERY_ENUMS, LISTEN_DOCS, ctx);
}

const KEYTERM_DOCS = "https://developers.deepgram.com/docs/keyterm";
const DICTATION_DOCS = "https://developers.deepgram.com/docs/dictation";

/**
 * The subset of the params both `/v1/listen` surfaces — this module's
 * pre-recorded POST and `./realtime`'s live WebSocket — spell identically, so
 * the two model/pairing checks below can be shared instead of copied. A check
 * declared over this shape is assignable wherever a check over the fuller
 * params type is expected.
 */
export interface SharedListenParams {
  model?: string;
  keyterm?: unknown;
  dictation?: boolean;
  punctuate?: boolean;
}

/**
 * "Keyterm Prompting is available for both monolingual and multilingual
 * transcription using the Nova-3 Models, as well as Flux" (KEYTERM_DOCS) —
 * and Flux is served by /v2/listen alone, so on either /v1/listen surface
 * `keyterm` is Nova-3-only. On any other model the parameter is silently
 * ignored, which looks like a quality regression rather than a rejected
 * request. Models unknown to the catalog are left alone (they may be new
 * Nova-3 variants).
 */
export function checkKeytermModel(
  params: SharedListenParams,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (params.keyterm == null) return;
  if (info === undefined || info.family === "nova-3" || info.family === "flux") return;
  ctx.report({
    code: "unsupported_param",
    path: ["keyterm"],
    model: params.model,
    message: `\`keyterm\` is only supported by the Nova-3 models (and Flux, which is streaming-only); "${params.model}" ignores it — use \`keywords\` for pre-Nova-3 models.`,
    meta: { source: KEYTERM_DOCS },
  });
}

/**
 * "The Punctuation feature must be enabled for Dictation to work"
 * (DICTATION_DOCS) — and `punctuate` defaults to false on this endpoint, so
 * `dictation: true` alone is a silent no-op.
 */
export function checkDictationPairing(
  params: SharedListenParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (params.dictation === true && params.punctuate !== true) {
    ctx.report({
      code: "invalid_shape",
      path: ["dictation"],
      message:
        "`dictation` requires punctuation, which is off by default on /v1/listen; send `punctuate: true` alongside it.",
      meta: { source: DICTATION_DOCS },
    });
  }
}

/** Flux serves only the /v2/listen streaming WebSocket (MODELS_DOCS). */
function checkFluxNotPreRecorded(
  params: ListenParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (typeof params.model === "string" && params.model.startsWith("flux-")) {
    ctx.report({
      code: "unsupported_capability",
      path: ["model"],
      model: params.model,
      message: `"${params.model}" is a streaming-only Flux model; pre-recorded /v1/listen does not accept it — use the realtime WebSocket API (/v2/listen, \`listenFlux\`) instead.`,
      meta: { source: MODELS_DOCS },
    });
  }
}

// ---------------------------------------------------------------------------
// Estimation
// ---------------------------------------------------------------------------

/**
 * Nova-3 with `language=multi` bills at the multilingual PRE-RECORDED rate
 * ($0.0092/min) instead of the monolingual rate on the catalog entry
 * ($0.0077/min) — deepgram.com/pricing pay-as-you-go, checked 2026-08-13.
 * (The streaming column of the same table reads $0.0058 / $0.0048; this
 * endpoint is pre-recorded, so those rates do not apply here.)
 */
export const NOVA_3_MULTILINGUAL_USD_PER_MINUTE = 0.0092;

function declaredDurationSeconds(media: MediaDeclaration[] | undefined): number | undefined {
  const exact = findMediaDeclaration(media, ["url"]);
  if (exact?.durationSeconds !== undefined) return exact.durationSeconds;
  return media?.find((d) => d.durationSeconds !== undefined)?.durationSeconds;
}

function estimateListen(
  params: ListenParams,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): ValidateEstimate {
  const declared = declaredDurationSeconds(ctx.options.media);
  if (declared === undefined) return {};
  const billedMinutes = minutesFromSeconds(declared);
  const multilingualNova3 =
    params.language === "multi" && (params.model === "nova-3" || params.model === "nova-3-general");
  const costUSD = multilingualNova3
    ? billedMinutes * NOVA_3_MULTILINGUAL_USD_PER_MINUTE
    : computeAudioMinutesCostUSD(info?.cost, billedMinutes);
  return costUSD === undefined ? {} : { costUSD };
}

// ---------------------------------------------------------------------------
// URL building + finalize
// ---------------------------------------------------------------------------

/**
 * `base` with every param encoded into the query string, skipping the `omit`
 * keys and any `undefined`/`null` value. Array values repeat the key
 * (`redact=pci&redact=numbers`), matching Deepgram's documented multi-value
 * form. Every Deepgram surface configures itself this way — the REST routes
 * here and in `./speak`, and the three WebSockets in `./realtime` — so the
 * encoding lives in one place.
 */
export function withQuery(
  base: string,
  params: object,
  omit: readonly string[] = [],
): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (omit.includes(key) || value === undefined || value === null) continue;
    for (const item of Array.isArray(value) ? value : [value]) {
      query.append(key, String(item));
    }
  }
  const qs = query.toString();
  return qs === "" ? base : `${base}?${qs}`;
}

/**
 * The full request URL: LISTEN_URL plus every param except `url` encoded into
 * the query string.
 */
export function listenUrl(params: ListenParams): string {
  return withQuery(LISTEN_URL, params, ["url"]);
}

/**
 * SDK targets for `deepgram.stt`. `"deepgram"` returns the query-param
 * object without `url` — the options argument of `@deepgram/sdk`'s
 * `listen.prerecorded.transcribeUrl({url}, options)`. Type alias, not
 * interface: an interface has no implicit index signature and so cannot
 * satisfy `SdkFormatters`.
 */
type ListenSdkTargets<B> = { deepgram: () => B };

function finalize(params: ListenParams): unknown {
  const { url, ...options } = params;
  const body: { url?: string } = url === undefined ? {} : { url };
  return toValidated(
    body,
    {
      url: listenUrl(params),
      method: "POST",
      headers: JSON_HEADERS,
    },
    { sdk: { deepgram: () => options } },
  );
}

const validator = createValidator<ListenParams, unknown>({
  endpoint: "deepgram.stt",
  schema,
  modelId: (params) => params.model,
  catalog: models,
  checks: [checkQueryEnums, checkFluxNotPreRecorded, checkKeytermModel, checkDictationPairing],
  estimate: estimateListen,
  finalize,
});

/**
 * Validates params for pre-recorded STT: POST https://api.deepgram.com/v1/listen.
 *
 * All transcription options ride in the query string, so `.request.url` is
 * the fully-encoded URL and the result's enumerable properties are only the
 * JSON wire body: `{url}` for remote audio, or `{}` for local files — in the
 * local case POST your raw audio bytes to `.request.url` yourself and replace
 * the content-type header with the audio MIME type (auth: add your own
 * `authorization: Token <DEEPGRAM_API_KEY>` header either way).
 *
 * `.toSdk("deepgram")` returns the query-param object without `url` — exactly the
 * options argument of `@deepgram/sdk`'s
 * `listen.prerecorded.transcribeUrl({url}, options)` / `transcribeFile(bytes, options)`.
 *
 * Cost estimation: declare the audio length via
 * `options.media = [{ path: ["url"], durationSeconds }]`.
 */
export const stt = validator as unknown as {
  <T extends ListenParams>(
    params: T & ExactKeys<T, ListenParams>,
    options?: ValidateOptions<T>,
  ): Validated<Pick<T, "url" & keyof T>, ListenSdkTargets<Omit<T, "url">>>;
  safe<T extends ListenParams>(
    params: T & ExactKeys<T, ListenParams>,
    options?: ValidateOptions<T>,
  ): ValidateResult<Validated<Pick<T, "url" & keyof T>, ListenSdkTargets<Omit<T, "url">>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
