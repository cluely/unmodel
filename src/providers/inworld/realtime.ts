/**
 * Inworld realtime SESSION-CONFIG objects — the two WebSocket surfaces.
 *
 * Inworld's realtime APIs are configured by a JSON object sent as the FIRST
 * FRAME of a socket, and that object is what unmodel validates. The socket
 * lifecycle around it — audio chunks, interim transcripts, `endTurn`,
 * `send_text`, `flush_context`, `closeStream`, reconnects — is transport and
 * stays out of unmodel's scope, exactly as with `openai.realtimeSession`.
 *
 * Two configs, one per surface (both verified 2026-11-12):
 *
 * - `realtimeTranscribeConfig` — the `transcribeConfig` frame of
 *   `wss://api.inworld.ai/stt/v1/transcribe:streamBidirectional`
 *   (https://docs.inworld.ai/api-reference/sttAPI/speechtotext/transcribe-stream-websocket).
 *   This is the SAME object the sync endpoint takes as its `transcribeConfig`
 *   field, which is why its types, bounds and rules all live in ./stt and are
 *   re-used here — the only differences are the surface-specific ones: the
 *   streaming vendors' config blocks (`assemblyaiConfig`, `sonioxConfig`)
 *   exist only here, the model roster is the WebSocket roster, and the
 *   compressed encodings are rejected.
 *
 * - `realtimeVoiceContext` — the `create` payload of
 *   `wss://api.inworld.ai/tts/v1/voice:streamBidirectional`
 *   (https://docs.inworld.ai/api-reference/ttsAPI/texttospeech/synthesize-speech-websocket).
 *   Inworld calls one synthesis stream a CONTEXT: `create` opens one with a
 *   voice and a config, `send_text` feeds it, `flush_context` synthesises,
 *   `close_context` ends it. The create payload shares voiceId / modelId /
 *   audioConfig / temperature / timestampType / applyTextNormalization /
 *   language / deliveryMode with the REST body validated by ./tts, so those
 *   bounds and the per-model gates in `ttsConstraints` are re-used verbatim;
 *   the buffering fields (`maxBufferDelayMs`, `bufferCharThreshold`,
 *   `autoMode`, `timestampTransportStrategy`) are streaming-only.
 *
 * `.request` on both points at the `wss://` URL with method `"GET"`: a
 * WebSocket handshake is an HTTP GET upgrade and carries no request body, so
 * read `.request.url` as "the socket to open" and send the validated object as
 * the first frame. `.toSdk("inworld")` wraps it in the frame envelope the
 * protocol expects (`{ transcribeConfig }` / `{ create }`) — Inworld ships no
 * official JS SDK for either surface, so that envelope is the whole formatting
 * job.
 */

import { z } from "zod";
import { createValidator, type PipelineContext } from "../../core/pipeline";
import {
  toValidatedSocket,
  NO_HEADERS,
  type ExactKeys,
  type ValidatedSocket,
} from "../../core/request";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";
import type { ModelInfo } from "../../core/catalog-types";
import type { EndpointConstraints } from "../../core/constraint-types";
import {
  checkTranscribeConfig,
  streamOnlyConfigShape,
  transcribeConfigShape,
  sttVendorOf,
  INWORLD_STT_STREAM_UNSUPPORTED_ENCODINGS,
  STT_AUDIO_FORMATS_DOCS,
  STT_THIRD_PARTY_DOCS,
  type InworldRealtimeTranscribeConfig,
} from "./stt";
import {
  audioConfigSchema,
  ttsConstraints,
  type InworldAudioConfig,
  type InworldAudioEncoding,
  type InworldApplyTextNormalization,
  type InworldDeliveryMode,
  type InworldTimestampType,
} from "./tts";
import { sttModels, ttsModels, STT_STREAM_MODEL_IDS, type InworldTtsModelId } from "./models";

/**
 * Bidirectional STT streaming. "Server-side clients send `Authorization:
 * Basic <INWORLD_API_KEY>` on the WebSocket upgrade request", and "Do not put
 * tokens in URL query parameters" (STT_WEBSOCKET_DOCS); browsers, which cannot
 * set that header, connect with a one-time token in the `bearer_` subprotocol.
 */
export const STT_STREAM_WS_URL = "wss://api.inworld.ai/stt/v1/transcribe:streamBidirectional";

/** Bidirectional TTS streaming; one socket carries many independent contexts. */
export const TTS_STREAM_WS_URL = "wss://api.inworld.ai/tts/v1/voice:streamBidirectional";

export const TTS_WEBSOCKET_DOCS =
  "https://docs.inworld.ai/api-reference/ttsAPI/texttospeech/synthesize-speech-websocket";
export const STT_WEBSOCKET_DOCS =
  "https://docs.inworld.ai/api-reference/sttAPI/speechtotext/transcribe-stream-websocket";

// ---------------------------------------------------------------------------
// Realtime STT — the `transcribeConfig` first frame.
// ---------------------------------------------------------------------------

/** `.toSdk("inworld")` shape: the client frame `{ transcribeConfig }`. */
export interface RealtimeTranscribeFrame<
  T extends InworldRealtimeTranscribeConfig = InworldRealtimeTranscribeConfig,
> {
  transcribeConfig: T;
}

const realtimeTranscribeSchema = z.looseObject({
  ...transcribeConfigShape,
  ...streamOnlyConfigShape,
});

function checkStreamConfig(
  params: InworldRealtimeTranscribeConfig,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  checkTranscribeConfig(params, info, ctx, {
    path: [],
    surface: "stream",
    allowedModelIds: STT_STREAM_MODEL_IDS,
  });
}

/**
 * The compressed encodings the streaming surface cannot take. Enforced as a
 * check rather than a narrower enum so the message can say WHY (and name the
 * encodings that do work) instead of surfacing a bare zod union failure.
 */
function checkStreamEncoding(
  params: InworldRealtimeTranscribeConfig,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const encoding = params.audioEncoding;
  const unsupported: readonly string[] = INWORLD_STT_STREAM_UNSUPPORTED_ENCODINGS;
  if (!unsupported.includes(encoding)) {
    checkLinear16Route(params, ctx);
    return;
  }
  ctx.report({
    code: "invalid_enum_value",
    path: ["audioEncoding"],
    model: params.modelId,
    message: `\`audioEncoding: "${encoding}"\` is not supported by the Inworld STT WebSocket; stream LINEAR16 (16 kHz, 16-bit, mono is the documented recommendation), or POST /stt/v1/transcribe to transcribe a ${encoding} file.`,
    meta: {
      value: encoding,
      unsupported: [...INWORLD_STT_STREAM_UNSUPPORTED_ENCODINGS],
      source: STT_AUDIO_FORMATS_DOCS,
    },
  });
}

/** Routed vendors whose STT_THIRD_PARTY_DOCS block says "audio must be `LINEAR16`". */
const LINEAR16_ONLY_VENDORS: readonly string[] = ["assemblyai", "soniox"];

/**
 * The AssemblyAI and Soniox blocks of STT_THIRD_PARTY_DOCS each say
 * "WebSocket streaming only; audio must be `LINEAR16`", while the WebSocket
 * reference lists `AUTO_DETECT` (and the zero value) for every model without
 * a per-vendor note. A warning, not an error: the two pages disagree, and
 * the request may well be served.
 */
function checkLinear16Route(params: InworldRealtimeTranscribeConfig, ctx: PipelineContext): void {
  const vendor = sttVendorOf(params.modelId);
  if (vendor === undefined || !LINEAR16_ONLY_VENDORS.includes(vendor)) return;
  if (params.audioEncoding === "LINEAR16") return;
  ctx.report({
    code: "invalid_enum_value",
    severity: "warning",
    path: ["audioEncoding"],
    model: params.modelId,
    message: `\`audioEncoding: "${params.audioEncoding}"\` on "${params.modelId}": Inworld documents the ${vendor} routes as "audio must be \`LINEAR16\`"; stream LINEAR16 and set \`sampleRateHertz\` to the audio's rate.`,
    meta: { value: params.audioEncoding, expected: "LINEAR16", vendor, source: STT_THIRD_PARTY_DOCS },
  });
}

/**
 * SDK targets for `inworld.realtimeTranscribeConfig`. Inworld ships no
 * official JS SDK for the STT socket, so the single self-named `"inworld"`
 * target returns the protocol's client frame. Type alias, not interface — an
 * interface has no implicit index signature and cannot satisfy
 * `SdkFormatters`.
 */
type RealtimeTranscribeSdkTargets<T extends InworldRealtimeTranscribeConfig> = {
  inworld: () => RealtimeTranscribeFrame<T>;
};

function finalizeTranscribeConfig(params: InworldRealtimeTranscribeConfig): unknown {
  const body = { ...params };
  return toValidatedSocket(
    body,
    {
      url: STT_STREAM_WS_URL,
      method: "GET",
      headers: NO_HEADERS,
    },
    { sdk: { inworld: () => ({ transcribeConfig: body }) } },
  );
}

const transcribeConfigValidator = createValidator<InworldRealtimeTranscribeConfig, unknown>({
  endpoint: "inworld.realtimeTranscribeConfig",
  schema: realtimeTranscribeSchema,
  modelId: (params) => params.modelId,
  catalog: sttModels,
  checks: [checkStreamConfig, checkStreamEncoding],
  finalize: finalizeTranscribeConfig,
});

/**
 * Validates the `transcribeConfig` SESSION-CONFIG OBJECT of the Inworld STT
 * WebSocket — not an HTTP body. The result's enumerable props are the config
 * itself; `.toSdk("inworld")` wraps it in the `{ transcribeConfig }` client
 * frame the protocol expects, and `.request.url` is the socket to open
 * (method `"GET"`: the handshake is an HTTP upgrade, so there is no body).
 *
 * The identical object is accepted by the sync endpoint as the
 * `transcribeConfig` field of its body — see `inworld.stt`, which adds
 * `audioData` and validates the same rules against the sync model roster.
 *
 * ```ts
 * const config = inworld.realtimeTranscribeConfig({
 *   modelId: "inworld/inworld-stt-1",
 *   audioEncoding: "LINEAR16",
 *   sampleRateHertz: 16000,
 *   language: "en",
 *   voiceProfileConfig: { enableVoiceProfile: true, topN: 5 },
 * });
 * // Node `ws`: the key rides on the upgrade request, never in the URL.
 * const socket = new WebSocket(config.request.url, {
 *   headers: { Authorization: `Basic ${process.env.INWORLD_API_KEY!}` },
 * });
 * socket.onopen = () => socket.send(JSON.stringify(config.toSdk("inworld")));
 * ```
 */
export const realtimeTranscribeConfig = transcribeConfigValidator as unknown as {
  <T extends InworldRealtimeTranscribeConfig>(
    params: T & ExactKeys<T, InworldRealtimeTranscribeConfig>,
    options?: ValidateOptions<T>,
  ): ValidatedSocket<T, RealtimeTranscribeSdkTargets<T>>;
  safe<T extends InworldRealtimeTranscribeConfig>(
    params: T & ExactKeys<T, InworldRealtimeTranscribeConfig>,
    options?: ValidateOptions<T>,
  ): ValidateResult<ValidatedSocket<T, RealtimeTranscribeSdkTargets<T>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};

// ---------------------------------------------------------------------------
// Realtime TTS — the `create` context config.
// ---------------------------------------------------------------------------

/** `send_text.text` — "Maximum 2000 UTF-16 code units per message." */
export const TTS_STREAM_MAX_TEXT_CHARACTERS = 2000;
/**
 * `bufferCharThreshold` — "Omission or 0 selects 1000; accepted values range
 * from 0 to 2000."
 */
export const TTS_STREAM_MAX_BUFFER_CHAR_THRESHOLD = 2000;
/** "the session will automatically be closed after 10 minutes of inactivity across any context". */
export const TTS_STREAM_IDLE_TIMEOUT_MINUTES = 10;

/**
 * When timestamps are delivered relative to the audio they describe.
 * WebSocket-only — the REST synthesize endpoint documents the field on its
 * `:stream` variant, but the enum is spelled out here.
 */
export type InworldTimestampTransportStrategy =
  | "TIMESTAMP_TRANSPORT_STRATEGY_UNSPECIFIED"
  | "SYNC"
  | "ASYNC";

/**
 * The socket's `audioConfig` — the REST object, whose encoding enum here also
 * lists the proto zero value: `"AUDIO_ENCODING_UNSPECIFIED", "LINEAR16",
 * "MP3", …` (TTS_WEBSOCKET_DOCS).
 */
export interface InworldVoiceContextAudioConfig extends Omit<InworldAudioConfig, "audioEncoding"> {
  /** Default: "MP3". */
  audioEncoding?: InworldAudioEncoding | "AUDIO_ENCODING_UNSPECIFIED";
}

/**
 * The `create` payload — Inworld's realtime TTS session config. The
 * `contextId` that rides ALONGSIDE it in the client frame is envelope, not
 * config: it is auto-generated when omitted and is how later `send_text` /
 * `flush_context` / `close_context` frames address this context, so it is
 * added at send time (see the example on `realtimeVoiceContext`) rather than
 * validated as a config field.
 */
export interface InworldVoiceContextConfig {
  /** Voice identifier, e.g. "Dennis". */
  voiceId: string;
  modelId: InworldTtsModelId | (string & {});
  audioConfig?: InworldVoiceContextAudioConfig;
  /** Range (0, 2]; default 1.0. Ignored by inworld-tts-2. */
  temperature?: number;
  /** Default "TIMESTAMP_TYPE_UNSPECIFIED". */
  timestampType?: InworldTimestampType;
  /** Milliseconds the server waits before flushing a partial buffer. */
  maxBufferDelayMs?: number;
  /**
   * Characters that trigger an automatic flush — "Omission or 0 selects 1000;
   * accepted values range from 0 to 2000."
   */
  bufferCharThreshold?: number;
  applyTextNormalization?: InworldApplyTextNormalization;
  /** Flush on sentence boundaries — "recommended" when sending full phrases. */
  autoMode?: boolean;
  timestampTransportStrategy?: InworldTimestampTransportStrategy;
  /** BCP-47 tag (e.g. "en-US"); auto-detected when omitted. */
  language?: string;
  /** "Only supported by `inworld-tts-2`. The field is ignored on other models." */
  deliveryMode?: InworldDeliveryMode;
}

/** `.toSdk("inworld")` shape: the client frame `{ create }`. */
export interface RealtimeVoiceContextFrame<
  T extends InworldVoiceContextConfig = InworldVoiceContextConfig,
> {
  create: T;
}

const voiceContextSchema = z.looseObject({
  voiceId: z.string().min(1, "voiceId must not be empty."),
  modelId: z.string().min(1, "modelId must not be empty."),
  // Same object, same bounds as the REST body, plus the zero-value encoding
  // this page's enum lists.
  audioConfig: audioConfigSchema
    .extend({
      audioEncoding: z
        .enum(["AUDIO_ENCODING_UNSPECIFIED", "LINEAR16", "MP3", "OGG_OPUS", "ALAW", "MULAW", "FLAC", "PCM", "WAV"])
        .optional(),
    })
    .optional(),
  temperature: z.number().gt(0).max(2).optional(),
  timestampType: z.enum(["TIMESTAMP_TYPE_UNSPECIFIED", "WORD", "CHARACTER"]).optional(),
  maxBufferDelayMs: z.number().int().min(0).optional(),
  bufferCharThreshold: z
    .number()
    .int()
    .min(0)
    .max(
      TTS_STREAM_MAX_BUFFER_CHAR_THRESHOLD,
      `bufferCharThreshold must be at most ${TTS_STREAM_MAX_BUFFER_CHAR_THRESHOLD}.`,
    )
    .optional(),
  applyTextNormalization: z
    .enum(["APPLY_TEXT_NORMALIZATION_UNSPECIFIED", "ON", "OFF"])
    .optional(),
  autoMode: z.boolean().optional(),
  timestampTransportStrategy: z
    .enum(["TIMESTAMP_TRANSPORT_STRATEGY_UNSPECIFIED", "SYNC", "ASYNC"])
    .optional(),
  language: z.string().optional(),
  deliveryMode: z
    .enum(["DELIVERY_MODE_UNSPECIFIED", "STABLE", "BALANCED", "CREATIVE"])
    .optional(),
});

/**
 * SDK targets for `inworld.realtimeVoiceContext`. Inworld ships no official
 * JS SDK for the TTS socket, so the single self-named `"inworld"` target
 * returns the protocol's client frame. Type alias, not interface — an
 * interface has no implicit index signature and cannot satisfy
 * `SdkFormatters`.
 */
type RealtimeVoiceContextSdkTargets<T extends InworldVoiceContextConfig> = {
  inworld: () => RealtimeVoiceContextFrame<T>;
};

function finalizeVoiceContext(params: InworldVoiceContextConfig): unknown {
  const body = { ...params };
  return toValidatedSocket(
    body,
    {
      url: TTS_STREAM_WS_URL,
      method: "GET",
      headers: NO_HEADERS,
    },
    { sdk: { inworld: () => ({ create: body }) } },
  );
}

const voiceContextValidator = createValidator<InworldVoiceContextConfig, unknown>({
  endpoint: "inworld.realtimeVoiceContext",
  schema: voiceContextSchema,
  modelId: (params) => params.modelId,
  catalog: ttsModels,
  // The per-model gates are properties of the MODEL, not of the transport:
  // `deliveryMode` is ignored off inworld-tts-2 and `temperature` is ignored
  // on it, on both surfaces, so the REST table is re-used rather than
  // re-stated.
  constraints: ttsConstraints,
  finalize: finalizeVoiceContext,
});

/**
 * Validates the `create` SESSION-CONFIG OBJECT of the Inworld realtime TTS
 * WebSocket — not an HTTP body. The result's enumerable props are the context
 * config; `.toSdk("inworld")` wraps it in the `{ create }` client frame, and
 * `.request.url` is the socket to open (method `"GET"`: the handshake is an
 * HTTP upgrade, so there is no body).
 *
 * Limits the config itself cannot express are exported as constants:
 * {@link TTS_STREAM_MAX_TEXT_CHARACTERS} (per `send_text` frame) and
 * {@link TTS_STREAM_IDLE_TIMEOUT_MINUTES}. Connection and context counts are
 * plan-dependent, not constants: "Each active context counts as one
 * concurrent generation", and concurrent connections are "set at 10× your
 * concurrent generation limit"
 * (https://docs.inworld.ai/resources/concurrency-limits, 2026-11-12).
 *
 * ```ts
 * const context = inworld.realtimeVoiceContext({
 *   voiceId: "Dennis",
 *   modelId: "inworld-tts-2",
 *   audioConfig: { audioEncoding: "LINEAR16", sampleRateHertz: 48000 },
 *   autoMode: true,
 *   deliveryMode: "BALANCED",
 * });
 * socket.send(JSON.stringify({ ...context.toSdk("inworld"), contextId: "greeting" }));
 * socket.send(JSON.stringify({ send_text: { text: "Hello." }, contextId: "greeting" }));
 * ```
 */
export const realtimeVoiceContext = voiceContextValidator as unknown as {
  <T extends InworldVoiceContextConfig>(
    params: T & ExactKeys<T, InworldVoiceContextConfig>,
    options?: ValidateOptions<T>,
  ): ValidatedSocket<T, RealtimeVoiceContextSdkTargets<T>>;
  safe<T extends InworldVoiceContextConfig>(
    params: T & ExactKeys<T, InworldVoiceContextConfig>,
    options?: ValidateOptions<T>,
  ): ValidateResult<ValidatedSocket<T, RealtimeVoiceContextSdkTargets<T>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
