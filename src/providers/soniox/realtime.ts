/**
 * Soniox real-time STT session configuration.
 *
 * `realtimeTranscription` validates the CONFIGURATION MESSAGE — the JSON a
 * client sends as the first message after opening
 * `wss://stt-rt.soniox.com/transcribe-websocket` (verified 2026-08-13 against
 * https://soniox.com/docs/stt/api-reference/websocket-api and
 * https://soniox.com/docs/stt/rt/real-time-transcription). Everything the
 * session does — model, audio format, language hints, diarization, endpoint
 * detection, translation — is decided by that one object, which is why it is
 * worth validating even though the socket itself is not.
 *
 * unmodel validates the config, not the transport: the result's enumerable
 * properties are the message (`socket.send(JSON.stringify(config))`), and
 * `.request.url` is the socket to open (`.request.method` is `"GET"` — a
 * WebSocket handshake is an HTTP GET upgrade). Streaming audio frames, the
 * empty-string end-of-stream marker, and every server token message are
 * lifecycle, and stay out of scope.
 *
 * Auth note: this API authenticates IN BAND — `api_key` is a field of the
 * configuration message, not a header. unmodel never touches keys, so the
 * field is optional here and is passed through untouched if you set it; the
 * documented flow is to merge it in at send time (and to mint a temporary key
 * for browser clients rather than shipping the real one).
 */

import { z } from "zod";
import { createValidator, type PipelineContext } from "../../core/pipeline";
import {
  toValidatedSocket,
  NO_HEADERS,
  type ExactKeys,
  type ValidatedSocket,
} from "../../core/request";
import type { ValidateOptions, MediaDeclaration } from "../../core/options";
import type { ValidateEstimate, ValidateResult } from "../../core/result";
import type { ModelInfo } from "../../core/catalog-types";
import type { EndpointConstraints } from "../../core/constraint-types";
import { computeAudioMinutesCostUSD, minutesFromSeconds } from "../../core/cost";
import type { SonioxContextObject, SonioxTranslation } from "./stt";
import { models, REALTIME_MODEL_IDS, type SonioxRealtimeModelId } from "./models";

/** "wss://stt-rt.soniox.com/transcribe-websocket" — the real-time STT socket. */
export const REALTIME_URL = "wss://stt-rt.soniox.com/transcribe-websocket";

const WEBSOCKET_DOCS = "https://soniox.com/docs/stt/api-reference/websocket-api";
const AUDIO_FORMATS_DOCS = "https://soniox.com/docs/speech-to-text/core-concepts/audio-formats";
const MODELS_DOCS = "https://soniox.com/docs/stt/models";
/**
 * The page that defines what `context` is and what its limit counts:
 * "Context size limit — Maximum 8,000 tokens (~10,000 characters)."
 */
const CONTEXT_DOCS = "https://soniox.com/docs/stt/concepts/context";

// ---------------------------------------------------------------------------
// Audio formats — "auto" plus the container formats Soniox can sniff, plus the
// raw encodings that carry no header (AUDIO_FORMATS_DOCS).
// ---------------------------------------------------------------------------

/**
 * Formats whose header Soniox reads itself: `"auto"` detects among them, and
 * each may also be named explicitly. "auto — Automatically detect the audio
 * format (aac, aiff, amr, asf, flac, mp3, ogg, wav, webm)".
 */
export const SONIOX_CONTAINER_AUDIO_FORMATS = [
  "auto",
  "aac",
  "aiff",
  "amr",
  "asf",
  "flac",
  "mp3",
  "ogg",
  "wav",
  "webm",
] as const;

/**
 * Headerless encodings. "For raw audio streams without headers, you must
 * provide: `audio_format` → encoding type. `sample_rate` → sample rate in Hz.
 * `num_channels` → number of channels." Multi-byte samples carry the byte
 * order in the name (`le`/`be`); the 8-bit forms have none to carry.
 */
export const SONIOX_RAW_AUDIO_FORMATS = [
  "pcm_s8",
  "pcm_s16le",
  "pcm_s16be",
  "pcm_s24le",
  "pcm_s24be",
  "pcm_s32le",
  "pcm_s32be",
  "pcm_u8",
  "pcm_u16le",
  "pcm_u16be",
  "pcm_u24le",
  "pcm_u24be",
  "pcm_u32le",
  "pcm_u32be",
  "pcm_f32le",
  "pcm_f32be",
  "pcm_f64le",
  "pcm_f64be",
  "mulaw",
  "alaw",
] as const;

export type SonioxContainerAudioFormat = (typeof SONIOX_CONTAINER_AUDIO_FORMATS)[number];
export type SonioxRawAudioFormat = (typeof SONIOX_RAW_AUDIO_FORMATS)[number];
export type SonioxAudioFormat = SonioxContainerAudioFormat | SonioxRawAudioFormat;

const RAW_AUDIO_FORMAT_SET: ReadonlySet<string> = new Set(SONIOX_RAW_AUDIO_FORMATS);
const AUDIO_FORMAT_SET: ReadonlySet<string> = new Set([
  ...SONIOX_CONTAINER_AUDIO_FORMATS,
  ...SONIOX_RAW_AUDIO_FORMATS,
]);

// ---------------------------------------------------------------------------
// Documented bounds.
// ---------------------------------------------------------------------------

/** `max_endpoint_delay_ms`: "500–3000, default 2000". */
export const MAX_ENDPOINT_DELAY_MS_MIN = 500;
export const MAX_ENDPOINT_DELAY_MS_MAX = 3000;
/** `endpoint_sensitivity`: "-1.0 to 1.0, default 0.0"; v5 only. */
export const ENDPOINT_SENSITIVITY_MIN = -1;
export const ENDPOINT_SENSITIVITY_MAX = 1;
/** `endpoint_latency_adjustment_level`: "0–3, default 0"; v5 only. */
export const ENDPOINT_LATENCY_ADJUSTMENT_LEVEL_MIN = 0;
export const ENDPOINT_LATENCY_ADJUSTMENT_LEVEL_MAX = 3;
/**
 * Context size cap, in characters of CONTENT.
 *
 * Two first-party statements pin this down (both re-verified 2026-08-13):
 * - CONTEXT_DOCS, under "Context size limit": "Maximum 8,000 tokens (~10,000
 *   characters)." over the four optional sections (`general`, `text`, `terms`,
 *   `translation_terms`) *combined* — "If you exceed the limit, the API will
 *   return an error → trim or summarize first."
 * - WEBSOCKET_DOCS' error list: "Context is too long (max length 10000)."
 *
 * So the server enforces a hard character number and rejects — which is why
 * this stays an ERROR rather than a warning. What it is measured OVER is the
 * combined section content: 10,000 characters is the docs' own "~"
 * approximation of an 8,000-token budget, and a token budget cannot include
 * JSON braces, quotes, commas and key names that the model never sees.
 * {@link contextLength} therefore sums the content strings. Counting
 * `JSON.stringify(context).length` instead would fail contexts whose actual
 * content is comfortably inside the limit — for a `general`-heavy context the
 * serialization overhead alone is ~25 characters per entry.
 */
export const MAX_CONTEXT_CHARACTERS = 10_000;
/** `client_reference_id` — "Max 256 characters". */
export const MAX_CLIENT_REFERENCE_ID_CHARACTERS = 256;

/** The model ids whose docs read "Supported only by the Soniox v5 model". */
const V5_MODEL_IDS: ReadonlySet<string> = new Set(["stt-rt-v5"]);

// ---------------------------------------------------------------------------
// Wire type — the configuration message, field for field.
// ---------------------------------------------------------------------------

export interface RealtimeTranscriptionConfig {
  /**
   * "Your Soniox API key." Optional here because unmodel never touches keys:
   * merge it in at send time, or pass it through and unmodel will leave it
   * alone. Browser clients should carry a temporary key, not the real one.
   */
  api_key?: string;
  /** Real-time model id, e.g. "stt-rt-v5". Async (stt-async-*) ids are not served here. */
  model: SonioxRealtimeModelId | (string & {});
  /**
   * Format of the audio frames. `"auto"` (or a container name) lets Soniox
   * read the header; a raw encoding requires `sample_rate` and `num_channels`.
   */
  audio_format: SonioxAudioFormat;
  /** Sample rate in Hz. Required for raw audio formats. */
  sample_rate?: number;
  /** 1 for mono, 2 for stereo. Required for raw audio formats. */
  num_channels?: number;
  /** Expected languages; "Set language hints when possible to significantly improve accuracy". */
  language_hints?: string[];
  /** When true, the model relies more on `language_hints`. */
  language_hints_strict?: boolean;
  /** "Each token will include a 'speaker' field". */
  enable_speaker_diarization?: boolean;
  /** "Each token will include a 'language' field". */
  enable_language_identification?: boolean;
  /** "Finalizes all non-final tokens right away, minimizing latency". */
  enable_endpoint_detection?: boolean;
  /**
   * Silence (ms) after which an endpoint is forced, {@link MAX_ENDPOINT_DELAY_MS_MIN}–
   * {@link MAX_ENDPOINT_DELAY_MS_MAX}. Default 2000.
   */
  max_endpoint_delay_ms?: number;
  /**
   * Endpoint eagerness, {@link ENDPOINT_SENSITIVITY_MIN}–{@link ENDPOINT_SENSITIVITY_MAX}.
   * Default 0. "Supported only by the Soniox v5 model."
   */
  endpoint_sensitivity?: number;
  /**
   * Latency/accuracy trade-off for endpointing, an integer
   * {@link ENDPOINT_LATENCY_ADJUSTMENT_LEVEL_MIN}–
   * {@link ENDPOINT_LATENCY_ADJUSTMENT_LEVEL_MAX}. Default 0. "Supported only
   * by the Soniox v5 model."
   */
  endpoint_latency_adjustment_level?: number;
  /**
   * Structured or free-form customization context. The four sections combined
   * carry at most {@link MAX_CONTEXT_CHARACTERS} characters of content — see
   * {@link contextLength} for what is counted.
   */
  context?: string | SonioxContextObject | null;
  /** "Real-time supports both translation modes" — one-way and two-way. */
  translation?: SonioxTranslation | null;
  /** Optional tracking identifier (max 256 chars). */
  client_reference_id?: string;
}

// ---------------------------------------------------------------------------
// Schema (loose: unknown keys pass through with an unknown_param warning).
// ---------------------------------------------------------------------------

const schema = z.looseObject({
  api_key: z.string().optional(),
  // No max length here, unlike the async endpoint: the REST reference
  // documents `model` as "max 32 chars", the WebSocket reference documents no
  // bound at all, and unmodel does not invent one.
  model: z.string().min(1),
  audio_format: z.string().min(1),
  sample_rate: z.number().int().positive().optional(),
  num_channels: z.number().int().positive().optional(),
  language_hints: z.array(z.string()).optional(),
  language_hints_strict: z.boolean().optional(),
  enable_speaker_diarization: z.boolean().optional(),
  enable_language_identification: z.boolean().optional(),
  enable_endpoint_detection: z.boolean().optional(),
  max_endpoint_delay_ms: z
    .number()
    .int()
    .min(MAX_ENDPOINT_DELAY_MS_MIN)
    .max(MAX_ENDPOINT_DELAY_MS_MAX)
    .optional(),
  endpoint_sensitivity: z
    .number()
    .min(ENDPOINT_SENSITIVITY_MIN)
    .max(ENDPOINT_SENSITIVITY_MAX)
    .optional(),
  endpoint_latency_adjustment_level: z
    .number()
    .int()
    .min(ENDPOINT_LATENCY_ADJUSTMENT_LEVEL_MIN)
    .max(ENDPOINT_LATENCY_ADJUSTMENT_LEVEL_MAX)
    .optional(),
  context: z.union([z.string(), z.looseObject({})]).nullable().optional(),
  translation: z
    .union([
      z.looseObject({ type: z.literal("one_way"), target_language: z.string() }),
      z.looseObject({ type: z.literal("two_way"), language_a: z.string(), language_b: z.string() }),
    ])
    .nullable()
    .optional(),
  client_reference_id: z.string().max(MAX_CLIENT_REFERENCE_ID_CHARACTERS).optional(),
});

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

function checkAudioFormat(
  params: RealtimeTranscriptionConfig,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const format = params.audio_format;
  if (!AUDIO_FORMAT_SET.has(format)) {
    ctx.report({
      code: "invalid_enum_value",
      path: ["audio_format"],
      message: `\`audio_format\` must be "auto", one of the container formats (${SONIOX_CONTAINER_AUDIO_FORMATS.slice(1).join(", ")}), or a raw encoding (${SONIOX_RAW_AUDIO_FORMATS.join(", ")}); got ${JSON.stringify(format)}.`,
      meta: { allowed: [...AUDIO_FORMAT_SET], value: format, source: AUDIO_FORMATS_DOCS },
    });
    return;
  }
  if (!RAW_AUDIO_FORMAT_SET.has(format)) return;
  for (const field of ["sample_rate", "num_channels"] as const) {
    if (params[field] === undefined) {
      ctx.report({
        code: "invalid_shape",
        path: [field],
        message: `\`${field}\` is required for the raw audio format "${format}" — a headerless stream carries none of its own parameters.`,
        meta: { audio_format: format, source: AUDIO_FORMATS_DOCS },
      });
    }
  }
}

/**
 * The catalog also holds the async (stt-async-*) models, so without this gate
 * one would resolve here and pass unremarked; they are served by
 * POST /v1/transcriptions, not this socket. Ids unknown to the catalog stay a
 * warning — they may be new real-time models.
 */
function checkRealtimeModel(
  params: RealtimeTranscriptionConfig,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (info === undefined || info.family === "stt-rt") return;
  ctx.report({
    code: "unsupported_capability",
    path: ["model"],
    model: params.model,
    message: `"${params.model}" is an async model served by POST https://api.soniox.com/v1/transcriptions; the real-time WebSocket accepts ${REALTIME_MODEL_IDS.map((id) => `"${id}"`).join(", ")}.`,
    meta: { allowed: [...REALTIME_MODEL_IDS], source: MODELS_DOCS },
  });
}

/**
 * `endpoint_sensitivity` and `endpoint_latency_adjustment_level` are
 * "Supported only by the Soniox v5 model". A warning rather than an error:
 * the only other catalogued real-time id, stt-rt-v4, is an alias that
 * auto-routes to v5, so the request is not necessarily rejected — it just is
 * not documented to honour these two fields.
 */
function checkV5OnlyEndpointParams(
  params: RealtimeTranscriptionConfig,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (info === undefined || V5_MODEL_IDS.has(params.model)) return;
  for (const field of ["endpoint_sensitivity", "endpoint_latency_adjustment_level"] as const) {
    if (params[field] !== undefined) {
      ctx.report({
        code: "unsupported_param",
        severity: "warning",
        path: [field],
        model: params.model,
        message: `\`${field}\` is "supported only by the Soniox v5 model"; "${params.model}" is not documented to honour it.`,
        meta: { source: WEBSOCKET_DOCS },
      });
    }
  }
}

/**
 * Characters of context CONTENT: the string form as-is, or — for the object
 * form — the four documented sections summed (CONTEXT_DOCS: "You provide
 * context through the context object that can include up to four sections").
 * `general` contributes each `key` and `value`, `terms` each string,
 * `translation_terms` each `source` and `target`, `text` itself. JSON
 * punctuation and the section/field names are structure, not context, and are
 * deliberately NOT counted — see {@link MAX_CONTEXT_CHARACTERS}. Unknown extra
 * keys are ignored rather than guessed at.
 */
export function contextLength(context: string | SonioxContextObject): number {
  if (typeof context === "string") return context.length;
  let total = 0;
  const add = (value: unknown): void => {
    if (typeof value === "string") total += value.length;
  };
  // The schema types the object form as `z.looseObject({})`, so every section
  // is untrusted at runtime — hence the Array.isArray/typeof guards.
  const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
  for (const entry of list(context.general)) {
    add((entry as { key?: unknown })?.key);
    add((entry as { value?: unknown })?.value);
  }
  add(context.text);
  for (const term of list(context.terms)) add(term);
  for (const pair of list(context.translation_terms)) {
    add((pair as { source?: unknown })?.source);
    add((pair as { target?: unknown })?.target);
  }
  return total;
}

/**
 * "Context is too long (max length 10000)" (WEBSOCKET_DOCS' error list) —
 * measured over the combined section content, per CONTEXT_DOCS' "Maximum 8,000
 * tokens (~10,000 characters)". An error, not a warning: the docs state the
 * API rejects an over-long context outright.
 */
function checkContextLength(
  params: RealtimeTranscriptionConfig,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const context = params.context;
  if (context == null) return;
  const length = contextLength(context);
  if (length > MAX_CONTEXT_CHARACTERS) {
    ctx.report({
      code: "invalid_shape",
      path: ["context"],
      message: `\`context\` carries ${length} characters of content; Soniox caps it at ${MAX_CONTEXT_CHARACTERS} (~8,000 tokens).`,
      meta: {
        limit: MAX_CONTEXT_CHARACTERS,
        actual: length,
        source: CONTEXT_DOCS,
        wireSource: WEBSOCKET_DOCS,
      },
    });
  }
}

// ---------------------------------------------------------------------------
// Estimation — the config cannot reveal how long the session runs, so the
// caller declares it out of band, exactly as on the async endpoint.
// ---------------------------------------------------------------------------

function declaredSessionSeconds(media: MediaDeclaration[] | undefined): number | undefined {
  return media?.find((d) => d.durationSeconds !== undefined)?.durationSeconds;
}

function estimateSession(
  _params: RealtimeTranscriptionConfig,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): ValidateEstimate {
  const declared = declaredSessionSeconds(ctx.options.media);
  if (declared === undefined) return {};
  const costUSD = computeAudioMinutesCostUSD(info?.cost, minutesFromSeconds(declared));
  return costUSD === undefined ? {} : { costUSD };
}

// ---------------------------------------------------------------------------
// Validator
// ---------------------------------------------------------------------------

/**
 * SDK targets for `soniox.realtimeTranscription`. Soniox's own web SDK takes
 * this same snake_case object as its session config, so the single self-named
 * `"soniox"` target returns it unchanged. Type alias, not interface — an
 * interface cannot satisfy `SdkFormatters`.
 */
type RealtimeSdkTargets<B> = { soniox: () => B };

function finalize(params: RealtimeTranscriptionConfig): unknown {
  const config = { ...params };
  return toValidatedSocket(
    config,
    { url: REALTIME_URL, method: "GET", headers: NO_HEADERS },
    { sdk: { soniox: () => config } },
  );
}

const validator = createValidator<RealtimeTranscriptionConfig, unknown>({
  endpoint: "soniox.realtimeTranscription",
  schema,
  modelId: (params) => params.model,
  catalog: models,
  checks: [checkAudioFormat, checkRealtimeModel, checkV5OnlyEndpointParams, checkContextLength],
  estimate: estimateSession,
  finalize,
});

/**
 * Validates the CONFIGURATION MESSAGE of a Soniox real-time STT session — the
 * JSON sent first on `wss://stt-rt.soniox.com/transcribe-websocket`.
 *
 * The result's enumerable properties are that message; `.request.url` is the
 * socket to open. `.toSdk("soniox")` returns the config unchanged (the web
 * SDK takes the same snake_case shape). `api_key` is a field of this message
 * rather than a header — unmodel leaves it to you, as it does every credential.
 *
 * Cost estimation: a live session has no length until it ends, so declare the
 * expected one — `options.media = [{ path: [], durationSeconds }]` — to price
 * it at the catalog's real-time rate ($0.12/hour), and pair it with
 * `options.maxCostUSD` for a budget check.
 *
 * ```ts
 * const config = soniox.realtimeTranscription({
 *   model: "stt-rt-v5",
 *   audio_format: "pcm_s16le",
 *   sample_rate: 16000,
 *   num_channels: 1,
 *   language_hints: ["en", "es"],
 *   enable_endpoint_detection: true,
 * });
 * const socket = new WebSocket(config.request.url);
 * socket.onopen = () => socket.send(JSON.stringify({ ...config, api_key: key }));
 * ```
 */
export const realtimeTranscription = validator as unknown as {
  <T extends RealtimeTranscriptionConfig>(
    params: T & ExactKeys<T, RealtimeTranscriptionConfig>,
    options?: ValidateOptions<T>,
  ): ValidatedSocket<T, RealtimeSdkTargets<T>>;
  safe<T extends RealtimeTranscriptionConfig>(
    params: T & ExactKeys<T, RealtimeTranscriptionConfig>,
    options?: ValidateOptions<T>,
  ): ValidateResult<ValidatedSocket<T, RealtimeSdkTargets<T>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
