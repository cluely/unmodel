/**
 * Deepgram realtime (WebSocket) session configuration.
 *
 * Three surfaces, all verified 2026-08-13 against the current AsyncAPI
 * references and feature docs:
 *
 * - `listenLive` — `wss://api.deepgram.com/v1/listen`, the streaming STT
 *   socket ("Live Audio"). Configured exactly like the pre-recorded route in
 *   `./listen`: everything is a QUERY PARAM, so the config IS the URL.
 * - `listenFlux` — `wss://api.deepgram.com/v2/listen`, Deepgram's turn-based
 *   conversational STT ("Endpoint: `/v2/listen` (not `/v1/listen`)"), plus
 *   `fluxConfigure` for its mid-stream `Configure` client message, the one
 *   JSON config object Flux documents.
 * - `speakLive` — `wss://api.deepgram.com/v1/speak`, the Aura streaming TTS
 *   socket, whose text arrives later as `{"type":"Speak"}` messages.
 *
 * unmodel validates the CONFIGURATION, not the transport. `.request.url` is
 * the socket to open (`.request.method` is `"GET"`: a WebSocket handshake is
 * an HTTP GET upgrade, never a body), and the enumerable properties are the
 * config object itself. Opening the socket, framing audio, the KeepAlive /
 * Finalize / CloseStream client messages and every server event are the
 * lifecycle, and stay out of unmodel's scope.
 *
 * Auth is yours to add, as always: an `Authorization: Token <DEEPGRAM_API_KEY>`
 * handshake header from a server, or the `["token", "<key>"]` subprotocol from
 * a browser — unmodel never touches keys.
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
import { computeAudioMinutesCostUSD } from "../../core/cost";
import {
  withQuery,
  reportQueryEnums,
  checkKeytermModel,
  checkDictationPairing,
  LISTEN_ENCODINGS,
  type DeepgramRedact,
} from "./transcribe";
import { AUDIO_FORMATS, SPEAK_SPEED_MIN, SPEAK_SPEED_MAX } from "./speech";
import {
  models,
  TTS_MODEL_IDS,
  type DeepgramSttModelId,
  type DeepgramTtsModelId,
} from "./models";

export const LISTEN_LIVE_URL = "wss://api.deepgram.com/v1/listen";
export const LISTEN_FLUX_URL = "wss://api.deepgram.com/v2/listen";
export const SPEAK_LIVE_URL = "wss://api.deepgram.com/v1/speak";

const LISTEN_LIVE_DOCS = "https://developers.deepgram.com/reference/speech-to-text/listen-streaming";
const FLUX_DOCS = "https://developers.deepgram.com/reference/speech-to-text/listen-flux";
const FLUX_CONFIGURE_DOCS = "https://developers.deepgram.com/docs/flux/configure";
const FLUX_THRESHOLD_DOCS = "https://developers.deepgram.com/docs/flux/configuration";
const SPEAK_LIVE_DOCS = "https://developers.deepgram.com/reference/text-to-speech/speak-streaming";
const SPEAK_MEDIA_DOCS = "https://developers.deepgram.com/docs/tts-media-output-settings";
const VOICE_CONTROLS_DOCS = "https://developers.deepgram.com/docs/tts-voice-controls";
const RAW_AUDIO_DOCS =
  "https://developers.deepgram.com/docs/determining-your-audio-format-for-live-streaming-audio";
const UTTERANCE_END_DOCS =
  "https://developers.deepgram.com/docs/understanding-end-of-speech-detection";
/**
 * A session's audio length is not in the config — it depends on how long the
 * socket stays open — so streaming cost estimates come from an out-of-band
 * declaration: `options.media = [{ path: [], durationSeconds }]`. The path is
 * empty because, unlike the pre-recorded route, no param references the audio;
 * any declaration carrying a duration is accepted.
 */
function declaredSessionSeconds(media: MediaDeclaration[] | undefined): number | undefined {
  return media?.find((d) => d.durationSeconds !== undefined)?.durationSeconds;
}

// ===========================================================================
// listenLive — wss://api.deepgram.com/v1/listen
// ===========================================================================

/**
 * Live `encoding` values (LISTEN_LIVE_DOCS): the pre-recorded set plus
 * `linear32`, `alaw` and `ogg-opus`, which only the streaming route documents.
 */
export const LISTEN_LIVE_ENCODINGS = [
  ...LISTEN_ENCODINGS,
  "linear32",
  "alaw",
  "ogg-opus",
] as const;
export type DeepgramLiveEncoding = (typeof LISTEN_LIVE_ENCODINGS)[number];

/**
 * Encodings that describe RAW (containerless) audio, for which "you must
 * provide the encoding and sample rate of your audio stream in your request"
 * (RAW_AUDIO_DOCS). The rest carry their parameters in a container header.
 */
const RAW_LIVE_ENCODINGS: ReadonlySet<string> = new Set([
  "linear16",
  "linear32",
  "mulaw",
  "alaw",
  "g729",
]);

/** Live `callback_method` values — wider than the pre-recorded route's POST/PUT. */
export const LISTEN_LIVE_CALLBACK_METHODS = ["POST", "GET", "PUT", "DELETE"] as const;
export type DeepgramLiveCallbackMethod = (typeof LISTEN_LIVE_CALLBACK_METHODS)[number];

/** Live `diarize_model` values; `v2` is documented for pre-recorded only. */
export const LISTEN_LIVE_DIARIZE_MODELS = ["latest", "v1"] as const;
export type DeepgramLiveDiarizeModel = (typeof LISTEN_LIVE_DIARIZE_MODELS)[number];

/**
 * "You should set the value of `utterance_end_ms` to be `1000` ms or higher"
 * (UTTERANCE_END_DOCS).
 */
export const UTTERANCE_END_MIN_MS = 1000;

// Rates below are read off https://deepgram.com/pricing (checked 2026-08-13),
// whose speech-to-text table has SEPARATE streaming and pre-recorded columns —
// these are the streaming ones, which is what a socket actually bills at.

/** Nova-3 monolingual STREAMING pay-as-you-go rate: "$0.0048/min". */
export const NOVA_3_STREAMING_USD_PER_MINUTE = 0.0048;
/** Nova-3 `language=multi` STREAMING rate: "$0.0058/min". */
export const NOVA_3_MULTILINGUAL_STREAMING_USD_PER_MINUTE = 0.0058;

/**
 * Query params of the live STT socket. Compared with `ListenParams`, the
 * pre-recorded intelligence features (summarize, topics, intents, sentiment,
 * paragraphs, utterances, custom_intent/topic, detect_language, utt_split) are
 * absent — the streaming reference documents none of them — and the
 * interim/endpointing family below is live-only.
 */
export interface ListenLiveParams {
  /** Model id; Deepgram defaults to base-general when omitted. Flux ids belong on `listenFlux`. */
  model?: DeepgramSttModelId | (string & {});
  /** BCP-47 language tag (default "en"); "multi" enables code-switching on Nova models. */
  language?: string;
  /** Model version (default "latest"). */
  version?: string;
  callback?: string;
  /** Default "POST". */
  callback_method?: DeepgramLiveCallbackMethod;
  /** Channels in the submitted audio. Default 1. */
  channels?: number;
  detect_entities?: boolean;
  /** Deprecated by Deepgram in favor of `diarize_model`; still accepted. */
  diarize?: boolean;
  diarize_model?: DeepgramLiveDiarizeModel;
  dictation?: boolean;
  /** Required (with `sample_rate`) for raw audio; omit for containerized audio. */
  encoding?: DeepgramLiveEncoding;
  /**
   * Silence (ms) after which an interim result is finalized. "Endpointing is
   * enabled by default and set to 10 milliseconds"; "Endpointing may be
   * disabled by setting `endpointing=false`".
   */
  endpointing?: number | false;
  extra?: string | string[];
  /**
   * Keeps "uh"/"um" in the transcript. Documented for streaming on the Nova
   * and Flux models (https://developers.deepgram.com/docs/filler-words); the
   * streaming AsyncAPI reference does not list it, so it is typed here on the
   * strength of that feature page alone and gets no model-specific check.
   */
  filler_words?: boolean;
  /** Emit non-final transcripts as audio arrives. Default false. */
  interim_results?: boolean;
  /** Nova-3 only; billed as the keyterm-prompting add-on. */
  keyterm?: string | string[];
  keywords?: string | string[];
  mip_opt_out?: boolean;
  multichannel?: boolean;
  numerals?: boolean;
  profanity_filter?: boolean;
  punctuate?: boolean;
  /**
   * Redaction groups, entity types, or true — same open value space as the
   * pre-recorded route (the streaming reference names `ssn` among its
   * examples, which is an entity type, not one of the five groups), so the
   * `(string & {})` tail stays and unmodel runs no enum check on the field.
   */
  redact?: DeepgramRedact | (string & {}) | boolean | Array<DeepgramRedact | (string & {})>;
  replace?: string | string[];
  /** Sample rate (Hz) of raw audio; required whenever `encoding` is. */
  sample_rate?: number;
  search?: string | string[];
  smart_format?: boolean;
  tag?: string | string[];
  /**
   * Silence (ms) after which an `UtteranceEnd` message is sent. Requires
   * `interim_results: true`; documented minimum {@link UTTERANCE_END_MIN_MS}.
   */
  utterance_end_ms?: number;
  /** Emit `SpeechStarted` events from the voice activity detector. Default false. */
  vad_events?: boolean;
}

const stringOrList = z.union([z.string(), z.array(z.string())]);

const listenLiveSchema = z.looseObject({
  model: z.string().optional(),
  language: z.string().optional(),
  version: z.string().optional(),
  callback: z.string().optional(),
  callback_method: z.string().optional(),
  channels: z.number().int().min(1).optional(),
  detect_entities: z.boolean().optional(),
  diarize: z.boolean().optional(),
  diarize_model: z.string().optional(),
  dictation: z.boolean().optional(),
  encoding: z.string().optional(),
  endpointing: z.union([z.number().int().min(0), z.literal(false)]).optional(),
  extra: stringOrList.optional(),
  filler_words: z.boolean().optional(),
  interim_results: z.boolean().optional(),
  keyterm: stringOrList.optional(),
  keywords: stringOrList.optional(),
  mip_opt_out: z.boolean().optional(),
  multichannel: z.boolean().optional(),
  numerals: z.boolean().optional(),
  profanity_filter: z.boolean().optional(),
  punctuate: z.boolean().optional(),
  redact: z.union([z.string(), z.boolean(), z.array(z.string())]).optional(),
  replace: stringOrList.optional(),
  sample_rate: z.number().int().positive().optional(),
  search: stringOrList.optional(),
  smart_format: z.boolean().optional(),
  tag: stringOrList.optional(),
  utterance_end_ms: z.number().int().min(UTTERANCE_END_MIN_MS).optional(),
  vad_events: z.boolean().optional(),
});

const LIVE_QUERY_ENUMS: Record<string, readonly string[]> = {
  callback_method: LISTEN_LIVE_CALLBACK_METHODS,
  diarize_model: LISTEN_LIVE_DIARIZE_MODELS,
  encoding: LISTEN_LIVE_ENCODINGS,
};

function checkLiveQueryEnums(
  params: ListenLiveParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  reportQueryEnums(params, LIVE_QUERY_ENUMS, LISTEN_LIVE_DOCS, ctx);
}

/**
 * Flux is a different socket, not a different model on this one: "Endpoint:
 * `/v2/listen` (not `/v1/listen`)" (FLUX_DOCS). Sending a flux id here
 * connects but never transcribes.
 */
function checkFluxRouting(
  params: ListenLiveParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (typeof params.model === "string" && params.model.startsWith("flux-")) {
    ctx.report({
      code: "unsupported_capability",
      path: ["model"],
      model: params.model,
      message: `"${params.model}" is a Flux model, served by ${LISTEN_FLUX_URL} — not by the /v1/listen socket; use \`listenFlux\` instead.`,
      meta: { source: FLUX_DOCS },
    });
  }
}

/**
 * "When using `utterance_end_ms`, setting `interim_results=true` is also
 * required" (UTTERANCE_END_DOCS) — and interim results are off by default, so
 * `utterance_end_ms` alone is a silent no-op.
 */
function checkUtteranceEndPairing(
  params: ListenLiveParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (params.utterance_end_ms !== undefined && params.interim_results !== true) {
    ctx.report({
      code: "invalid_shape",
      path: ["utterance_end_ms"],
      message:
        "`utterance_end_ms` requires `interim_results: true`, which is off by default on the live socket; send both or neither.",
      meta: { source: UTTERANCE_END_DOCS },
    });
  }
}

/**
 * "If you're streaming raw audio to Deepgram, you must provide the encoding
 * and sample rate of your audio stream in your request" (RAW_AUDIO_DOCS).
 * Containerized audio carries both in its header and should send neither.
 */
function reportRawAudioPairing(
  params: { encoding?: string; sample_rate?: number },
  rawEncodings: ReadonlySet<string>,
  source: string,
  ctx: PipelineContext,
): void {
  if (
    params.encoding !== undefined &&
    rawEncodings.has(params.encoding) &&
    params.sample_rate === undefined
  ) {
    ctx.report({
      code: "invalid_shape",
      path: ["sample_rate"],
      message: `\`encoding: "${params.encoding}"\` is raw (containerless) audio, so \`sample_rate\` is required alongside it.`,
      meta: { encoding: params.encoding, source },
    });
  }
  if (params.sample_rate !== undefined && params.encoding === undefined) {
    ctx.report({
      code: "invalid_shape",
      path: ["encoding"],
      message:
        "`sample_rate` describes raw audio, which must declare its `encoding` too; containerized audio should send neither.",
      meta: { source },
    });
  }
}

function checkLiveRawAudio(
  params: ListenLiveParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  reportRawAudioPairing(params, RAW_LIVE_ENCODINGS, RAW_AUDIO_DOCS, ctx);
}

/**
 * STREAMING rates, which are not the catalog's: `./models` carries Deepgram's
 * PRE-RECORDED prices ($0.0077/min for Nova-3), and quoting those for a socket
 * would overstate it by ~60%. Only the Nova-3 ids have a published streaming
 * rate; every other tier is "Contact Sales" on the pricing page, so they
 * estimate nothing rather than inventing a number.
 */
const LIVE_STREAMING_USD_PER_MINUTE: Readonly<Record<string, number>> = {
  "nova-3": NOVA_3_STREAMING_USD_PER_MINUTE,
  "nova-3-general": NOVA_3_STREAMING_USD_PER_MINUTE,
};

function estimateListenLive(
  params: ListenLiveParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): ValidateEstimate {
  const declared = declaredSessionSeconds(ctx.options.media);
  if (declared === undefined || params.model === undefined) return {};
  const rate = LIVE_STREAMING_USD_PER_MINUTE[params.model];
  if (rate === undefined) return {};
  const perMinute = params.language === "multi" ? NOVA_3_MULTILINGUAL_STREAMING_USD_PER_MINUTE : rate;
  return { costUSD: (declared / 60) * perMinute };
}

/** The socket URL: LISTEN_LIVE_URL plus every param encoded into the query. */
export function listenLiveUrl(params: ListenLiveParams): string {
  return withQuery(LISTEN_LIVE_URL, params);
}

/**
 * SDK targets for `deepgram.listenLive`. `"deepgram"` returns the config
 * object unchanged — it is the options argument of `@deepgram/sdk`'s
 * `listen.live(options)`. Type alias, not interface: an interface has no
 * implicit index signature and so cannot satisfy `SdkFormatters`.
 */
type ListenLiveSdkTargets<B> = { deepgram: () => B };

function finalizeListenLive(params: ListenLiveParams): unknown {
  const config = { ...params };
  return toValidatedSocket(
    config,
    { url: listenLiveUrl(params), method: "GET", headers: NO_HEADERS },
    { sdk: { deepgram: () => config } },
  );
}

const listenLiveValidator = createValidator<ListenLiveParams, unknown>({
  endpoint: "deepgram.listenLive",
  schema: listenLiveSchema,
  modelId: (params) => params.model,
  catalog: models,
  checks: [
    checkLiveQueryEnums,
    checkFluxRouting,
    checkKeytermModel,
    checkDictationPairing,
    checkUtteranceEndPairing,
    checkLiveRawAudio,
  ],
  estimate: estimateListenLive,
  finalize: finalizeListenLive,
});

/**
 * Validates the connection config of the live STT WebSocket,
 * `wss://api.deepgram.com/v1/listen`.
 *
 * Every option is a query param, so `.request.url` is the socket URL with the
 * whole config already encoded (`.request.method` is `"GET"` — the handshake
 * is an upgrade, not a body); the result's enumerable properties are the
 * config object, which `.toSdk("deepgram")` returns unchanged for
 * `@deepgram/sdk`'s `listen.live(options)`. Add auth yourself: an
 * `Authorization: Token <key>` handshake header, or the `["token", key]`
 * subprotocol in a browser.
 *
 * Cost estimation: the config cannot reveal how long the session runs, so
 * declare it — `options.media = [{ path: [], durationSeconds }]` — to price it
 * at Deepgram's STREAMING rate (not the pre-recorded rate the catalog holds).
 *
 * ```ts
 * const live = deepgram.listenLive({
 *   model: "nova-3",
 *   encoding: "linear16",
 *   sample_rate: 16000,
 *   interim_results: true,
 *   utterance_end_ms: 1000,
 * });
 * const socket = new WebSocket(live.request.url, ["token", process.env.DEEPGRAM_API_KEY!]);
 * ```
 */
export const listenLive = listenLiveValidator as unknown as {
  <T extends ListenLiveParams>(
    params: T & ExactKeys<T, ListenLiveParams>,
    options?: ValidateOptions,
  ): ValidatedSocket<T, ListenLiveSdkTargets<T>>;
  safe<T extends ListenLiveParams>(
    params: T & ExactKeys<T, ListenLiveParams>,
    options?: ValidateOptions,
  ): ValidateResult<ValidatedSocket<T, ListenLiveSdkTargets<T>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};

// ===========================================================================
// listenFlux — wss://api.deepgram.com/v2/listen
// ===========================================================================

/** The two Flux models the /v2/listen reference enumerates. */
export const FLUX_MODEL_IDS = ["flux-general-en", "flux-general-multi"] as const;
export type DeepgramFluxModelId = (typeof FLUX_MODEL_IDS)[number];

/** Flux `encoding` values (FLUX_DOCS) — no flac/amr/speex/g729. */
export const FLUX_ENCODINGS = [
  "linear16",
  "linear32",
  "mulaw",
  "alaw",
  "opus",
  "ogg-opus",
] as const;
export type DeepgramFluxEncoding = (typeof FLUX_ENCODINGS)[number];

const RAW_FLUX_ENCODINGS: ReadonlySet<string> = new Set(["linear16", "linear32", "mulaw", "alaw"]);

/** `redact` on Flux is a closed pair, unlike the open space of /v1/listen. */
export const FLUX_REDACT_VALUES = ["numbers", "aggressive_numbers"] as const;
export type DeepgramFluxRedact = (typeof FLUX_REDACT_VALUES)[number];

/** "eot_threshold — Valid values 0.5 to 0.9, default 0.7" (FLUX_THRESHOLD_DOCS). */
export const EOT_THRESHOLD_MIN = 0.5;
export const EOT_THRESHOLD_MAX = 0.9;
export const EOT_THRESHOLD_DEFAULT = 0.7;
/** "eager_eot_threshold — Valid values 0.3 to 0.9"; must be ≤ `eot_threshold`. */
export const EAGER_EOT_THRESHOLD_MIN = 0.3;
export const EAGER_EOT_THRESHOLD_MAX = 0.9;
/** "eot_timeout_ms — Valid values 500 to 60,000, defaults to 5000". */
export const EOT_TIMEOUT_MS_MIN = 500;
export const EOT_TIMEOUT_MS_MAX = 60_000;
/** "Up to 100 terms" per keyterm list (FLUX_CONFIGURE_DOCS). */
export const FLUX_KEYTERMS_MAX = 100;

/** Query params of the Flux socket. */
export interface ListenFluxParams {
  /** Required — /v2/listen serves the Flux models only. */
  model: DeepgramFluxModelId | (string & {});
  /** Required (with `sample_rate`) for raw audio; omit for containerized audio. */
  encoding?: DeepgramFluxEncoding;
  /** Sample rate (Hz) of raw audio; "16000 recommended". */
  sample_rate?: number;
  /** EOT confidence that ends a turn, {@link EOT_THRESHOLD_MIN}–{@link EOT_THRESHOLD_MAX}. Default 0.7. */
  eot_threshold?: number;
  /**
   * EOT confidence that fires the early `EagerEndOfTurn` event,
   * {@link EAGER_EOT_THRESHOLD_MIN}–{@link EAGER_EOT_THRESHOLD_MAX}. Setting it
   * enables `EagerEndOfTurn`/`TurnResumed`; must be ≤ `eot_threshold`.
   */
  eager_eot_threshold?: number;
  /** Hard turn timeout, {@link EOT_TIMEOUT_MS_MIN}–{@link EOT_TIMEOUT_MS_MAX} ms. Default 5000. */
  eot_timeout_ms?: number;
  /** Plain terms only — Flux keyterms "do not support weights or intensifiers". */
  keyterm?: string | string[];
  /** Biases the multilingual model; "only valid when model is flux-general-multi". */
  language_hint?: string | string[];
  numerals?: boolean;
  profanity_filter?: boolean;
  redact?: DeepgramFluxRedact | DeepgramFluxRedact[];
  mip_opt_out?: boolean;
  tag?: string | string[];
}

const listenFluxSchema = z.looseObject({
  model: z.string().min(1),
  encoding: z.string().optional(),
  sample_rate: z.number().int().positive().optional(),
  eot_threshold: z.number().min(EOT_THRESHOLD_MIN).max(EOT_THRESHOLD_MAX).optional(),
  eager_eot_threshold: z
    .number()
    .min(EAGER_EOT_THRESHOLD_MIN)
    .max(EAGER_EOT_THRESHOLD_MAX)
    .optional(),
  eot_timeout_ms: z.number().int().min(EOT_TIMEOUT_MS_MIN).max(EOT_TIMEOUT_MS_MAX).optional(),
  keyterm: stringOrList.optional(),
  language_hint: stringOrList.optional(),
  numerals: z.boolean().optional(),
  profanity_filter: z.boolean().optional(),
  redact: z.union([z.string(), z.array(z.string())]).optional(),
  mip_opt_out: z.boolean().optional(),
  tag: stringOrList.optional(),
});

function checkFluxQueryEnums(
  params: ListenFluxParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  reportQueryEnums(params, { encoding: FLUX_ENCODINGS }, FLUX_DOCS, ctx);
}

/** /v2/listen serves Flux and nothing else; a nova/whisper id belongs on `listenLive`. */
function checkFluxModel(
  params: ListenFluxParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (!params.model.startsWith("flux-")) {
    ctx.report({
      code: "unsupported_capability",
      path: ["model"],
      model: params.model,
      message: `"${params.model}" is not a Flux model; ${LISTEN_FLUX_URL} serves ${FLUX_MODEL_IDS.map((id) => `"${id}"`).join(", ")} — use \`listenLive\` for the Nova/Whisper models.`,
      meta: { allowed: [...FLUX_MODEL_IDS], source: FLUX_DOCS },
    });
  }
}

/** "Must be less than or equal to eot_threshold" (FLUX_THRESHOLD_DOCS). */
function checkEagerEotOrdering(
  params: ListenFluxParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const eager = params.eager_eot_threshold;
  if (eager === undefined) return;
  const eot = params.eot_threshold ?? EOT_THRESHOLD_DEFAULT;
  if (eager > eot) {
    ctx.report({
      code: "invalid_shape",
      path: ["eager_eot_threshold"],
      message: `\`eager_eot_threshold\` (${eager}) must be less than or equal to \`eot_threshold\` (${eot}${params.eot_threshold === undefined ? ", the default" : ""}).`,
      meta: { value: eager, eot_threshold: eot, source: FLUX_THRESHOLD_DOCS },
    });
  }
}

/** "Only valid when model is flux-general-multi" (FLUX_DOCS). */
function checkLanguageHintModel(
  params: ListenFluxParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (params.language_hint != null && params.model !== "flux-general-multi") {
    ctx.report({
      code: "unsupported_param",
      path: ["language_hint"],
      model: params.model,
      message: `\`language_hint\` is only valid with "flux-general-multi"; "${params.model}" ignores it.`,
      meta: { source: FLUX_DOCS },
    });
  }
}

function checkFluxRedact(
  params: ListenFluxParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (params.redact === undefined) return;
  const values: readonly string[] = Array.isArray(params.redact) ? params.redact : [params.redact];
  for (const value of values) {
    if (!FLUX_REDACT_VALUES.includes(value as DeepgramFluxRedact)) {
      ctx.report({
        code: "invalid_enum_value",
        path: ["redact"],
        message: `\`redact\` on Flux must be one of ${FLUX_REDACT_VALUES.map((v) => JSON.stringify(v)).join(", ")}; got ${JSON.stringify(value)}. The entity types and groups of /v1/listen are not documented for /v2/listen.`,
        meta: { allowed: [...FLUX_REDACT_VALUES], value, source: FLUX_DOCS },
      });
    }
  }
}

function checkFluxRawAudio(
  params: ListenFluxParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  reportRawAudioPairing(params, RAW_FLUX_ENCODINGS, FLUX_DOCS, ctx);
}

/**
 * Unlike `listenLive`, the catalog rate is the right one here: the flux-*
 * entries in `./models` carry Deepgram's STREAMING prices ($0.0065/min English,
 * $0.0078/min multilingual), because Flux has no pre-recorded route to price.
 */
function estimateListenFlux(
  _params: ListenFluxParams,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): ValidateEstimate {
  const declared = declaredSessionSeconds(ctx.options.media);
  if (declared === undefined) return {};
  const costUSD = computeAudioMinutesCostUSD(info?.cost, declared / 60);
  return costUSD === undefined ? {} : { costUSD };
}

/** The socket URL: LISTEN_FLUX_URL plus every param encoded into the query. */
export function listenFluxUrl(params: ListenFluxParams): string {
  return withQuery(LISTEN_FLUX_URL, params);
}

/** SDK targets for `deepgram.listenFlux`; `"deepgram"` returns the config unchanged. */
type ListenFluxSdkTargets<B> = { deepgram: () => B };

function finalizeListenFlux(params: ListenFluxParams): unknown {
  const config = { ...params };
  return toValidatedSocket(
    config,
    { url: listenFluxUrl(params), method: "GET", headers: NO_HEADERS },
    { sdk: { deepgram: () => config } },
  );
}

const listenFluxValidator = createValidator<ListenFluxParams, unknown>({
  endpoint: "deepgram.listenFlux",
  schema: listenFluxSchema,
  modelId: (params) => params.model,
  catalog: models,
  checks: [
    checkFluxQueryEnums,
    checkFluxModel,
    checkEagerEotOrdering,
    checkLanguageHintModel,
    checkFluxRedact,
    checkFluxRawAudio,
  ],
  estimate: estimateListenFlux,
  finalize: finalizeListenFlux,
});

/**
 * Validates the connection config of the Flux (turn-based conversational STT)
 * WebSocket, `wss://api.deepgram.com/v2/listen`.
 *
 * Same shape as `listenLive` — query params, `.request.url` is the socket —
 * but a different value space: only the Flux models, a narrower encoding set,
 * a closed `redact` pair, and the end-of-turn thresholds that make Flux
 * turn-based. Mid-stream changes to keyterms, language hints and those
 * thresholds go through `fluxConfigure`.
 *
 * Cost estimation: declare the session length via
 * `options.media = [{ path: [], durationSeconds }]`.
 */
export const listenFlux = listenFluxValidator as unknown as {
  <T extends ListenFluxParams>(
    params: T & ExactKeys<T, ListenFluxParams>,
    options?: ValidateOptions,
  ): ValidatedSocket<T, ListenFluxSdkTargets<T>>;
  safe<T extends ListenFluxParams>(
    params: T & ExactKeys<T, ListenFluxParams>,
    options?: ValidateOptions,
  ): ValidateResult<ValidatedSocket<T, ListenFluxSdkTargets<T>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};

// ---------------------------------------------------------------------------
// fluxConfigure — the `Configure` client message
// ---------------------------------------------------------------------------

/** Thresholds block of the `Configure` message; same bounds as the query params. */
export interface FluxConfigureThresholds {
  eot_threshold?: number;
  eager_eot_threshold?: number;
  eot_timeout_ms?: number;
}

/**
 * Flux's mid-stream reconfiguration message. "All fields within Configure are
 * optional; omitted parameters retain current values", and note the plural
 * names: the connection takes `keyterm`/`language_hint` query params, this
 * message takes `keyterms`/`language_hints` arrays.
 */
export interface FluxConfigureMessage {
  type: "Configure";
  thresholds?: FluxConfigureThresholds;
  /**
   * Up to {@link FLUX_KEYTERMS_MAX} terms. "When sending a Configure message
   * with keyterms, the ENTIRE keyterms list is replaced, not merged."
   */
  keyterms?: string[];
  language_hints?: string[];
}

const fluxConfigureSchema = z.looseObject({
  type: z.literal("Configure"),
  thresholds: z
    .looseObject({
      eot_threshold: z.number().min(EOT_THRESHOLD_MIN).max(EOT_THRESHOLD_MAX).optional(),
      eager_eot_threshold: z
        .number()
        .min(EAGER_EOT_THRESHOLD_MIN)
        .max(EAGER_EOT_THRESHOLD_MAX)
        .optional(),
      eot_timeout_ms: z.number().int().min(EOT_TIMEOUT_MS_MIN).max(EOT_TIMEOUT_MS_MAX).optional(),
    })
    .optional(),
  keyterms: z.array(z.string()).max(FLUX_KEYTERMS_MAX).optional(),
  language_hints: z.array(z.string()).optional(),
});

function checkConfigureEagerEotOrdering(
  params: FluxConfigureMessage,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const eager = params.thresholds?.eager_eot_threshold;
  if (eager === undefined) return;
  const eot = params.thresholds?.eot_threshold ?? EOT_THRESHOLD_DEFAULT;
  if (eager > eot) {
    ctx.report({
      code: "invalid_shape",
      path: ["thresholds", "eager_eot_threshold"],
      message: `\`eager_eot_threshold\` (${eager}) must be less than or equal to \`eot_threshold\` (${eot}${params.thresholds?.eot_threshold === undefined ? ", the default" : ""}).`,
      meta: { value: eager, eot_threshold: eot, source: FLUX_CONFIGURE_DOCS },
    });
  }
}

/** SDK targets for `deepgram.fluxConfigure`; `"deepgram"` returns the message unchanged. */
type FluxConfigureSdkTargets<B> = { deepgram: () => B };

function finalizeFluxConfigure(params: FluxConfigureMessage): unknown {
  const message = { ...params };
  return toValidatedSocket(
    message,
    { url: LISTEN_FLUX_URL, method: "GET", headers: NO_HEADERS },
    { sdk: { deepgram: () => message } },
  );
}

const fluxConfigureValidator = createValidator<FluxConfigureMessage, unknown>({
  endpoint: "deepgram.fluxConfigure",
  schema: fluxConfigureSchema,
  // The message carries no model — it reconfigures the one the socket opened
  // with — so every model-dependent layer is skipped.
  modelId: () => undefined,
  catalog: models,
  checks: [checkConfigureEagerEotOrdering],
  finalize: finalizeFluxConfigure,
});

/**
 * Validates Flux's `Configure` CLIENT MESSAGE — the JSON you send on an open
 * /v2/listen socket to swap keyterms, language hints or end-of-turn thresholds
 * mid-stream. The result's enumerable properties are the message
 * (`socket.send(JSON.stringify(msg))`); `.request.url` names the socket it
 * belongs to. A rejected message "does NOT affect the stream", so validating
 * before sending is the only way to notice a bad one early.
 */
export const fluxConfigure = fluxConfigureValidator as unknown as {
  <T extends FluxConfigureMessage>(
    params: T & ExactKeys<T, FluxConfigureMessage>,
    options?: ValidateOptions,
  ): ValidatedSocket<T, FluxConfigureSdkTargets<T>>;
  safe<T extends FluxConfigureMessage>(
    params: T & ExactKeys<T, FluxConfigureMessage>,
    options?: ValidateOptions,
  ): ValidateResult<ValidatedSocket<T, FluxConfigureSdkTargets<T>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};

// ===========================================================================
// speakLive — wss://api.deepgram.com/v1/speak
// ===========================================================================

/**
 * "Currently we only support linear16, mulaw, and alaw for our Streaming TTS
 * Websocket" (SPEAK_MEDIA_DOCS) — a third of what POST /v1/speak accepts, and
 * with no `container` or `bit_rate` to go with them.
 */
export const SPEAK_LIVE_ENCODINGS = ["linear16", "mulaw", "alaw"] as const;
export type DeepgramSpeakLiveEncoding = (typeof SPEAK_LIVE_ENCODINGS)[number];

/**
 * Every `sample_rate` the streaming socket documents; which of them a request
 * may use depends on `encoding` (mulaw/alaw stop at 16000), narrowed at
 * runtime against the shared `AUDIO_FORMATS` table in `./speak`.
 */
export const SPEAK_LIVE_SAMPLE_RATES = [8000, 16000, 24000, 32000, 48000] as const;
export type DeepgramSpeakLiveSampleRate = (typeof SPEAK_LIVE_SAMPLE_RATES)[number];

/** "Streaming Defaults — encoding: Linear16, container: n/a, sample_rate: 24000". */
export const DEFAULT_SPEAK_LIVE_ENCODING = "linear16";
/** Server-side default voice, as on the REST route. */
export const DEFAULT_SPEAK_LIVE_MODEL_ID = "aura-asteria-en";

/** Query params of the Aura streaming TTS socket. */
export interface SpeakLiveParams {
  /** Voice id; Deepgram defaults to aura-asteria-en when omitted. */
  model?: DeepgramTtsModelId | (string & {});
  /** Output codec. Default "linear16" on the socket (the REST default differs). */
  encoding?: DeepgramSpeakLiveEncoding;
  /** Output sample rate in Hz. Default 24000. */
  sample_rate?: DeepgramSpeakLiveSampleRate;
  /** Speaking-rate multiplier, {@link SPEAK_SPEED_MIN}–{@link SPEAK_SPEED_MAX}. Default 1. */
  speed?: number;
  /** Opt this session out of the Model Improvement Program. Default false. */
  mip_opt_out?: boolean;
}

const speakLiveSchema = z.looseObject({
  model: z.string().optional(),
  encoding: z.string().optional(),
  sample_rate: z.number().int().positive().optional(),
  speed: z.number().min(SPEAK_SPEED_MIN).max(SPEAK_SPEED_MAX).optional(),
  mip_opt_out: z.boolean().optional(),
});

const TTS_MODEL_ID_SET = new Set<string>(TTS_MODEL_IDS);

/**
 * The Deepgram catalog carries the STT ids alongside the Aura voices, so
 * without this gate `model: "nova-3"` would resolve and pass TTS validation
 * unremarked. Ids unknown to the catalog stay a warning — they may be new
 * voices.
 */
function checkSpeakLiveModelKind(
  params: SpeakLiveParams,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const model = params.model ?? DEFAULT_SPEAK_LIVE_MODEL_ID;
  if (info === undefined || TTS_MODEL_ID_SET.has(model)) return;
  ctx.report({
    code: "unsupported_capability",
    path: ["model"],
    model,
    message: `"${model}" is not a Deepgram text-to-speech voice; ${SPEAK_LIVE_URL} accepts the Aura and Aura-2 voices (e.g. "aura-2-thalia-en").`,
    meta: { source: SPEAK_LIVE_DOCS },
  });
}

/**
 * `encoding` enum plus the sample rates that encoding allows. Unlike the REST
 * route — where Deepgram's own pages disagree about the default, so `./speak`
 * refuses to guess — the socket publishes one unambiguous default
 * ("Streaming Defaults encoding: Linear16"), so an omitted `encoding` is
 * judged as linear16 here.
 */
function checkSpeakLiveFormat(
  params: SpeakLiveParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const encoding = params.encoding ?? DEFAULT_SPEAK_LIVE_ENCODING;
  if (!SPEAK_LIVE_ENCODINGS.includes(encoding as DeepgramSpeakLiveEncoding)) {
    ctx.report({
      code: "invalid_enum_value",
      path: ["encoding"],
      message: `\`encoding\` must be one of ${SPEAK_LIVE_ENCODINGS.map((v) => JSON.stringify(v)).join(", ")} on the streaming socket; got ${JSON.stringify(encoding)}. The other POST /v1/speak codecs (mp3, opus, flac, aac) are REST-only.`,
      meta: { allowed: [...SPEAK_LIVE_ENCODINGS], value: encoding, source: SPEAK_MEDIA_DOCS },
    });
    return;
  }
  const allowed = AUDIO_FORMATS[encoding as DeepgramSpeakLiveEncoding].sampleRates;
  if (params.sample_rate === undefined || allowed === null) return;
  if (!allowed.includes(params.sample_rate)) {
    ctx.report({
      code: "invalid_enum_value",
      path: ["sample_rate"],
      message: `\`sample_rate\` must be one of ${allowed.join(", ")} for the "${encoding}" encoding; got ${params.sample_rate}.`,
      meta: {
        allowed: [...allowed],
        value: params.sample_rate,
        encoding,
        source: SPEAK_MEDIA_DOCS,
      },
    });
  }
}

/**
 * `speed` is an Aura-2 control (VOICE_CONTROLS_DOCS); its 0.7–1.5 bounds are
 * enforced by the schema, and passing it with an Aura-1 voice is a warning —
 * the session still opens, the pace just may not change.
 */
function checkSpeakLiveSpeed(
  params: SpeakLiveParams,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (params.speed === undefined || info === undefined || info.family !== "aura") return;
  ctx.report({
    code: "unsupported_param",
    severity: "warning",
    path: ["speed"],
    model: params.model,
    message: `\`speed\` is an Aura-2 control; "${params.model ?? DEFAULT_SPEAK_LIVE_MODEL_ID}" is an Aura-1 voice, which Deepgram does not document it for.`,
    meta: { source: VOICE_CONTROLS_DOCS },
  });
}

/** The socket URL: SPEAK_LIVE_URL plus every param encoded into the query. */
export function speakLiveUrl(params: SpeakLiveParams): string {
  return withQuery(SPEAK_LIVE_URL, params);
}

/**
 * SDK targets for `deepgram.speakLive`. `"deepgram"` returns the config
 * unchanged — the options argument of `@deepgram/sdk`'s `speak.live(options)`.
 */
type SpeakLiveSdkTargets<B> = { deepgram: () => B };

function finalizeSpeakLive(params: SpeakLiveParams): unknown {
  const config = { ...params };
  return toValidatedSocket(
    config,
    { url: speakLiveUrl(params), method: "GET", headers: NO_HEADERS },
    { sdk: { deepgram: () => config } },
  );
}

const speakLiveValidator = createValidator<SpeakLiveParams, unknown>({
  endpoint: "deepgram.speakLive",
  schema: speakLiveSchema,
  modelId: (params) => params.model,
  catalog: models,
  checks: [checkSpeakLiveModelKind, checkSpeakLiveFormat, checkSpeakLiveSpeed],
  // No cost estimate: TTS bills per character and the config carries no text —
  // it arrives later as `{"type":"Speak","text":"…"}` messages. Price a
  // session with `computeCharacterCostUSD(models[voice].cost, characters)`.
  finalize: finalizeSpeakLive,
});

/**
 * Validates the connection config of the Aura streaming TTS WebSocket,
 * `wss://api.deepgram.com/v1/speak`.
 *
 * `.request.url` is the socket with the config encoded into its query; the
 * enumerable properties are the config object, which `.toSdk("deepgram")`
 * returns unchanged for `@deepgram/sdk`'s `speak.live(options)`. The text
 * itself is not part of the config — it is sent as `{"type":"Speak","text":…}`
 * messages once the socket is open, alongside `Flush`, `Clear` and `Close`,
 * none of which unmodel validates.
 *
 * ```ts
 * const tts = deepgram.speakLive({ model: "aura-2-thalia-en", encoding: "mulaw", sample_rate: 8000 });
 * const socket = new WebSocket(tts.request.url, ["token", process.env.DEEPGRAM_API_KEY!]);
 * ```
 */
export const speakLive = speakLiveValidator as unknown as {
  <T extends SpeakLiveParams>(
    params: T & ExactKeys<T, SpeakLiveParams>,
    options?: ValidateOptions,
  ): ValidatedSocket<T, SpeakLiveSdkTargets<T>>;
  safe<T extends SpeakLiveParams>(
    params: T & ExactKeys<T, SpeakLiveParams>,
    options?: ValidateOptions,
  ): ValidateResult<ValidatedSocket<T, SpeakLiveSdkTargets<T>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
