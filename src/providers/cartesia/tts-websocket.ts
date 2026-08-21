/**
 * Cartesia realtime Text-to-Speech WebSocket — the GENERATION REQUEST message
 * of `wss://api.cartesia.ai/tts/websocket`.
 *
 * unmodel validates config objects, never transport: this module validates the
 * JSON message you send on the socket (one per transcript chunk of a context),
 * not the socket itself. Opening the connection, interleaving `flush`, reading
 * `chunk` / `timestamps` / `done` frames back, and the cancel-context message
 * (`{ context_id, cancel: true }`) are transport and stay out of scope, as is
 * auth (`X-API-Key` header from a server, or an `access_token` query param from
 * a browser — unmodel never touches credentials).
 *
 * Wire notes (verified 2026-08-13 against
 * https://docs.cartesia.ai/api-reference/tts/websocket, Cartesia-Version
 * 2026-03-01):
 * - VERSIONING DIFFERS FROM REST. The batch endpoints take a `Cartesia-Version`
 *   HEADER; this socket takes a `cartesia_version` QUERY param, which
 *   {@link ttsWebsocketUrl} appends for you. Same value
 *   ({@link CARTESIA_VERSION}), different transport slot.
 * - `context_id` is REQUIRED here (it has no counterpart on POST /tts/bytes):
 *   it identifies the speech context that keeps prosody continuous across
 *   inputs. "Inputs on the same context must keep all fields except
 *   `transcript` and `continue` the same"
 *   (https://docs.cartesia.ai/use-the-api/tts-websocket/contexts) — a rule
 *   across messages, which a single-message validator cannot check.
 * - `output_format` is narrower than the REST one: `container` is `"raw"` only
 *   (no wav/mp3), and both `encoding` and `sample_rate` are required. The
 *   encoding and sample-rate value sets are the REST ones, so the shared
 *   {@link CartesiaEncoding} / {@link CartesiaSampleRate} types apply.
 * - `generation_config` carries the same documented ranges as REST — volume
 *   [0.5, 2.0], speed [0.6, 1.5] — and the same emotion vocabulary: the
 *   AsyncAPI lists only the primary emotions inline but points at "the complete
 *   list" on
 *   https://docs.cartesia.ai/build-with-cartesia/capability-guides/volume-speed-emotion,
 *   which is the 58-label set {@link CARTESIA_EMOTIONS} that ./tts already
 *   validates against.
 * - `max_buffer_delay_ms`: "Values between [0, 5000]ms are supported. Defaults
 *   to 3000ms."
 * - The contexts guide mentions a `duration` field alongside `transcript` and
 *   `continue`; the API reference's generation-request schema does not publish
 *   it, so it is not modeled (it would pass through as an unknown param).
 * - There is no `.request`: a WebSocket URL is not fetchable, and unmodel's
 *   `RequestMeta` describes an HTTP POST. The validated object's enumerable
 *   props ARE the JSON message — `JSON.stringify` it and send it.
 *
 * BREAKING (type-level only): `language` and `generation_config.emotion` are
 * closed to their enums here as on POST /tts/bytes, so a `string`-typed
 * variable no longer assigns. See the open-tail rule in ./speech.
 */

import { z } from "zod";
import { createValidator, type PipelineContext } from "../../core/pipeline";
import type { ExactKeys } from "../../core/request";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";
import type { ModelInfo } from "../../core/catalog-types";
import type { EndpointConstraints } from "../../core/constraint-types";
import { models, TTS_MODEL_IDS, type CartesiaTtsModelId } from "./models";
import {
  CARTESIA_EMOTIONS,
  CARTESIA_TTS_LANGUAGES,
  CARTESIA_VERSION,
  speechConstraints,
  type CartesiaEmotion,
  type CartesiaEncoding,
  type CartesiaSampleRate,
  type CartesiaTtsLanguage,
  type CartesiaVoice,
} from "./speech";

export const TTS_WEBSOCKET_URL = "wss://api.cartesia.ai/tts/websocket";

const TTS_WEBSOCKET_DOCS = "https://docs.cartesia.ai/api-reference/tts/websocket";

/** "Values between [0, 5000]ms are supported." (TTS_WEBSOCKET_DOCS) */
export const TTS_WEBSOCKET_MAX_BUFFER_DELAY_MS_MIN = 0;
/** "Values between [0, 5000]ms are supported." (TTS_WEBSOCKET_DOCS) */
export const TTS_WEBSOCKET_MAX_BUFFER_DELAY_MS_MAX = 5000;
/** "Defaults to 3000ms." (TTS_WEBSOCKET_DOCS) */
export const TTS_WEBSOCKET_MAX_BUFFER_DELAY_MS_DEFAULT = 3000;

// ---------------------------------------------------------------------------
// Wire types — mirror the Generation Request message exactly.
// ---------------------------------------------------------------------------

/**
 * Socket output format: raw PCM only. `container` accepts a single value and
 * both other fields are required — the wav/mp3 containers of POST /tts/bytes
 * have no counterpart on the socket.
 */
export interface CartesiaWebsocketOutputFormat {
  container: "raw";
  encoding: CartesiaEncoding;
  sample_rate: CartesiaSampleRate;
}

/** Speech attribute controls; identical ranges to the REST endpoint's. */
export interface CartesiaWebsocketGenerationConfig {
  /** Range [0.5, 2.0]; default 1. */
  volume?: number;
  /** Range [0.6, 1.5]; default 1. */
  speed?: number;
  /**
   * One of the 58 documented labels ({@link CARTESIA_EMOTIONS}). Closed, per
   * the open-tail rule in ./speech: an off-enum label is an
   * `invalid_enum_value` *error* here, unlike an off-enum `model_id`, which is
   * a warning and therefore keeps its tail.
   */
  emotion?: CartesiaEmotion;
}

export interface TtsWebsocketMessage {
  /** Model id; the socket publishes the same enum as POST /tts/bytes. */
  model_id: CartesiaTtsModelId | (string & {});
  /** "Transcript chunk to add to the audio being generated by this context." */
  transcript: string;
  /** Keep identical across every message of one context. */
  voice: CartesiaVoice;
  /** Keep identical across every message of one context. Raw PCM only. */
  output_format: CartesiaWebsocketOutputFormat;
  /** REQUIRED. "A unique identifier for the context", e.g. a UUID. */
  context_id: string;
  /**
   * "The transcript's language." Keep identical across one context. Closed:
   * the same 42-code enum as POST /tts/bytes, refused at *error* severity.
   */
  language?: CartesiaTtsLanguage;
  /**
   * `true` while more transcript chunks will follow on this context; `false`
   * on the last one (the default) to minimize latency.
   */
  continue?: boolean;
  /** Max ms to buffer text before generating. [0, 5000]; default 3000. */
  max_buffer_delay_ms?: number;
  /** Flush the context, splitting a continuation into separately-done parts. */
  flush?: boolean;
  /** Emit word-level timestamps for the generated audio. Default false. */
  add_timestamps?: boolean;
  /** Emit phoneme-level timestamps for the generated audio. Default false. */
  add_phoneme_timestamps?: boolean;
  /** Normalized (`true`) vs original (`false`) timestamps. */
  use_normalized_timestamps?: boolean;
  /** Pronunciation dictionary id — sonic-3 models and newer only. */
  pronunciation_dict_id?: string;
  generation_config?: CartesiaWebsocketGenerationConfig;
  /** @deprecated Use `generation_config.speed` instead. */
  speed?: "slow" | "normal" | "fast";
}

// ---------------------------------------------------------------------------
// Schema (loose: unknown keys pass through with a warning).
// ---------------------------------------------------------------------------

const outputFormatSchema = z.looseObject({
  container: z.literal("raw", 'the TTS socket only supports `container: "raw"`'),
  encoding: z.enum(["pcm_f32le", "pcm_s16le", "pcm_mulaw", "pcm_alaw"]),
  sample_rate: z.union([
    z.literal(8000),
    z.literal(16000),
    z.literal(22050),
    z.literal(24000),
    z.literal(44100),
    z.literal(48000),
  ]),
});

const schema = z.looseObject({
  model_id: z.string(),
  transcript: z.string(),
  voice: z.looseObject({ mode: z.literal("id"), id: z.string() }),
  output_format: outputFormatSchema,
  context_id: z.string().min(1, "context_id is required on the TTS socket"),
  language: z.string().optional(),
  continue: z.boolean().optional(),
  max_buffer_delay_ms: z
    .number()
    .int()
    .min(TTS_WEBSOCKET_MAX_BUFFER_DELAY_MS_MIN)
    .max(TTS_WEBSOCKET_MAX_BUFFER_DELAY_MS_MAX)
    .optional(),
  flush: z.boolean().optional(),
  add_timestamps: z.boolean().optional(),
  add_phoneme_timestamps: z.boolean().optional(),
  use_normalized_timestamps: z.boolean().optional(),
  pronunciation_dict_id: z.string().optional(),
  generation_config: z
    .looseObject({
      volume: z.number().min(0.5).max(2).optional(),
      speed: z.number().min(0.6).max(1.5).optional(),
      emotion: z.string().optional(),
    })
    .optional(),
  speed: z.enum(["slow", "normal", "fast"]).optional(),
});

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

const LANGUAGE_SET = new Set<string>(CARTESIA_TTS_LANGUAGES);
const EMOTION_SET = new Set<string>(CARTESIA_EMOTIONS);
const TTS_MODEL_ID_SET = new Set<string>(TTS_MODEL_IDS);

/**
 * `language` and `generation_config.emotion` are closed enums; the emotion set
 * is the complete 58-label list the capability guide publishes (the AsyncAPI
 * shows only the primary labels inline and links to that list).
 */
function checkEnums(
  params: TtsWebsocketMessage,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const language = params.language;
  if (typeof language === "string" && !LANGUAGE_SET.has(language)) {
    ctx.report({
      code: "invalid_enum_value",
      path: ["language"],
      model: params.model_id,
      message: `\`language\` must be one of the ${CARTESIA_TTS_LANGUAGES.length} documented codes; got ${JSON.stringify(language)}.`,
      meta: {
        allowed: [...CARTESIA_TTS_LANGUAGES],
        value: language,
        source: TTS_WEBSOCKET_DOCS,
      },
    });
  }
  const emotion = params.generation_config?.emotion;
  if (typeof emotion === "string" && !EMOTION_SET.has(emotion)) {
    ctx.report({
      code: "invalid_enum_value",
      path: ["generation_config", "emotion"],
      model: params.model_id,
      message: `\`generation_config.emotion\` must be one of the ${CARTESIA_EMOTIONS.length} documented labels; got ${JSON.stringify(emotion)}.`,
      meta: { allowed: [...CARTESIA_EMOTIONS], value: emotion, source: TTS_WEBSOCKET_DOCS },
    });
  }
}

/**
 * Same two gates as POST /tts/bytes: an Ink (STT) id on the TTS socket is an
 * error, and a cataloged sonic id outside the published `model_id` enum is a
 * warning (the docs neither list it here nor say the socket refuses it). Ids
 * unknown to the catalog stay an `unknown_model` warning.
 */
function checkTtsModelKind(
  params: TtsWebsocketMessage,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (info === undefined) return;
  if (info.family === "ink") {
    ctx.report({
      code: "unsupported_capability",
      path: ["model_id"],
      model: params.model_id,
      message: `"${params.model_id}" is a speech-to-text (Ink) model; the TTS socket only accepts the sonic family. Realtime Ink runs on wss /stt/websocket (see \`cartesia.sttWebsocket\`).`,
      meta: { source: TTS_WEBSOCKET_DOCS },
    });
    return;
  }
  if (TTS_MODEL_ID_SET.has(params.model_id)) return;
  ctx.report({
    code: "invalid_enum_value",
    severity: "warning",
    path: ["model_id"],
    model: params.model_id,
    message: `"${params.model_id}" is not in the \`model_id\` enum wss /tts/websocket publishes for Cartesia-Version ${CARTESIA_VERSION} (${TTS_MODEL_IDS.map((id) => `"${id}"`).join(", ")}); it may be refused.`,
    meta: { allowed: [...TTS_MODEL_IDS], value: params.model_id, source: TTS_WEBSOCKET_DOCS },
  });
}

// ---------------------------------------------------------------------------
// Builder — the socket URL.
// ---------------------------------------------------------------------------

/**
 * Builds the TTS socket address. `cartesia_version` is a QUERY param on this
 * endpoint (the REST endpoints take it as the `Cartesia-Version` header); auth
 * is deliberately absent — send an `X-API-Key` header, or append your own
 * `access_token` query param when connecting from a browser.
 */
export function ttsWebsocketUrl(cartesiaVersion: string = CARTESIA_VERSION): string {
  return `${TTS_WEBSOCKET_URL}?cartesia_version=${encodeURIComponent(cartesiaVersion)}`;
}

// ---------------------------------------------------------------------------
// Validator — no `finalize`: the validated object already IS the socket
// message, and there is no fetchable URL to hang on `.request`.
// ---------------------------------------------------------------------------

const validator = createValidator<TtsWebsocketMessage>({
  endpoint: "cartesia.ttsWebsocket",
  schema,
  modelId: (params) => params.model_id,
  catalog: models,
  // Same per-model rule as POST /tts/bytes: pronunciation dictionaries are
  // sonic-3 and newer.
  constraints: speechConstraints,
  checks: [checkEnums, checkTtsModelKind],
  // No estimate: Cartesia publishes no USD rate (credits only — see models.ts),
  // so a per-character estimate could only ever be undefined.
});

/**
 * Validates one GENERATION REQUEST message for the Cartesia TTS WebSocket
 * (`wss://api.cartesia.ai/tts/websocket`). The result's enumerable properties
 * are exactly the JSON to send on the socket; build the address with
 * {@link ttsWebsocketUrl} (it carries the required `cartesia_version` query
 * param). The connection itself, `flush`/cancel bookkeeping and the audio
 * frames coming back are transport, outside unmodel's scope, as is auth.
 *
 * ```ts
 * const ws = new WebSocket(ttsWebsocketUrl(), {
 *   headers: { "X-API-Key": process.env.CARTESIA_API_KEY! },
 * });
 * const message = cartesia.ttsWebsocket({
 *   model_id: "sonic-3.5",
 *   transcript: "Hello, world! ",
 *   voice: { mode: "id", id: "a0e99841-438c-4a64-b679-ae501e7d6091" },
 *   output_format: { container: "raw", encoding: "pcm_s16le", sample_rate: 8000 },
 *   context_id: crypto.randomUUID(),
 *   continue: true,
 * });
 * ws.send(JSON.stringify(message));
 * ```
 */
export const ttsWebsocket = validator as unknown as {
  <T extends TtsWebsocketMessage>(
    params: T & ExactKeys<T, TtsWebsocketMessage>,
    options?: ValidateOptions<T>,
  ): T;
  safe<T extends TtsWebsocketMessage>(
    params: T & ExactKeys<T, TtsWebsocketMessage>,
    options?: ValidateOptions<T>,
  ): ValidateResult<T>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
