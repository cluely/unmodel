/**
 * ElevenLabs streaming Text to Speech WebSocket — the CONNECTION CONFIG and the
 * first (`InitializeConnection`) message of
 * `wss://api.elevenlabs.io/v1/text-to-speech/{voice_id}/stream-input`.
 *
 * unmodel validates config objects, never transport: this module validates the
 * documented query parameters of the socket URL plus the JSON of the *first*
 * message you send on it. Opening the socket, streaming `SendText` messages
 * (`{ text, try_trigger_generation, flush }`), closing it with `{ text: "" }`
 * and reading `audioOutput` frames back are transport and stay out of scope —
 * as does authentication, which rides the connection (`xi-api-key` header, the
 * `authorization` / `single_use_token` query params, or the `xi-api-key` /
 * `authorization` fields of the first message; unmodel never touches keys).
 *
 * Wire notes (verified 2026-08-13 against the AsyncAPI reference
 * https://elevenlabs.io/docs/api-reference/text-to-speech/v-1-text-to-speech-voice-id-stream-input
 * and the guide https://elevenlabs.io/docs/websockets):
 * - `voice_id` is a URL path segment and every connection setting is a QUERY
 *   param; only `text`, `voice_settings`, `generation_config` and
 *   `pronunciation_dictionary_locators` travel in the first message. The two
 *   halves are validated together here and split apart by
 *   {@link textToSpeechStreamInputUrl} and
 *   {@link toInitializeConnectionMessage}.
 * - `text` of the first message must be a single blank space —
 *   "The initial text that must be sent is a blank space." The builder emits it
 *   for you; passing anything else is an error.
 * - `generation_config.chunk_length_schedule` defaults to `[120, 160, 250, 290]`
 *   and "Each item should be in the range 50-500"; the guide calls the items
 *   "an array of integers that represent the number of characters", so the
 *   schema enforces integers in 50–500.
 * - `voice_settings.speed` is documented on this endpoint as "Values range from
 *   0.7 to 1.2, with 1.0 being the default speed" — the same bounds the REST
 *   convert endpoint documents (./text-to-speech). `stability` (0.5),
 *   `similarity_boost` (0.75), `style` (0) and `use_speaker_boost` (true)
 *   publish defaults but no bounds, so none are enforced. Unlike the REST body,
 *   these fields are NOT nullable here.
 * - `pronunciation_dictionary_locators` items require BOTH
 *   `pronunciation_dictionary_id` and `version_id` on this endpoint (the REST
 *   body allows a null `version_id`), and "Must only be provided in the first
 *   message". The REST reference's "at most 3" cap is not republished here, so
 *   no count cap is enforced.
 * - `inactivity_timeout` — "The default timeout is set to 20, with a maximum
 *   allowed value of 180" (seconds). No minimum is published; unmodel's floor
 *   of 1 is a sanity bound, not a documented one.
 * - There is no `.request`: a WebSocket URL is not fetchable, and unmodel's
 *   `RequestMeta` describes an HTTP POST. The validated object's enumerable
 *   props are the params you passed; feed them to the two builders above.
 */

import { z } from "zod";
import { createValidator, type PipelineContext } from "../../core/pipeline";
import type { ExactKeys } from "../../core/request";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";
import type { ModelInfo } from "../../core/catalog-types";
import type { EndpointConstraints } from "../../core/constraint-types";
import { models, TTS_MODEL_IDS, type ElevenlabsTtsModelId } from "./models";
import { textToSpeechConstraints } from "./constraints";
import {
  TTS_OUTPUT_FORMATS,
  TTS_SPEED_MAX,
  TTS_SPEED_MIN,
  type ElevenlabsOutputFormat,
} from "./text-to-speech";

/**
 * Base of the streaming TTS socket; the full address is
 * `${STREAM_INPUT_WS_BASE_URL}/{voice_id}/stream-input`. ElevenLabs also
 * publishes data-residency hosts for this channel (`api.us.elevenlabs.io`,
 * `api.eu.residency.elevenlabs.io`, `api.in.residency.elevenlabs.io`,
 * `api.sg.residency.elevenlabs.io`); swap the host yourself if your workspace
 * is pinned to one.
 */
export const STREAM_INPUT_WS_BASE_URL = "wss://api.elevenlabs.io/v1/text-to-speech";

const STREAM_INPUT_DOCS_URL =
  "https://elevenlabs.io/docs/api-reference/text-to-speech/v-1-text-to-speech-voice-id-stream-input";
const CONVERT_DOCS_URL = "https://elevenlabs.io/docs/api-reference/text-to-speech/convert";
const MODELS_DOCS_URL = "https://elevenlabs.io/docs/models";

/** "Each item should be in the range 50-500" (STREAM_INPUT_DOCS_URL). */
export const STREAM_INPUT_CHUNK_LENGTH_MIN = 50;
/** "Each item should be in the range 50-500" (STREAM_INPUT_DOCS_URL). */
export const STREAM_INPUT_CHUNK_LENGTH_MAX = 500;

/** "The default value for `chunk_length_schedule` is: [120, 160, 250, 290]." */
export const STREAM_INPUT_DEFAULT_CHUNK_LENGTH_SCHEDULE = [120, 160, 250, 290] as const;

/** "The default timeout is set to 20" seconds (STREAM_INPUT_DOCS_URL). */
export const STREAM_INPUT_INACTIVITY_TIMEOUT_DEFAULT = 20;
/** "with a maximum allowed value of 180" seconds (STREAM_INPUT_DOCS_URL). */
export const STREAM_INPUT_INACTIVITY_TIMEOUT_MAX = 180;

// ---------------------------------------------------------------------------
// Wire types — query params + the InitializeConnection message.
// ---------------------------------------------------------------------------

/**
 * `voice_settings` of the first message (AsyncAPI `RealtimeVoiceSettings`).
 * Non-nullable here, unlike the REST body's `ElevenlabsVoiceSettings`, and
 * "must either be not provided or not changed" on later messages.
 */
export interface StreamInputVoiceSettings {
  /** "Defines the stability for voice settings." Default 0.5, no bounds. */
  stability?: number;
  /** "Defines the similarity boost for voice settings." Default 0.75. */
  similarity_boost?: number;
  /** Style exaggeration; V2+ models only. Default 0, no documented bounds. */
  style?: number;
  /** Speaker boost; V2+ models only. Default true. */
  use_speaker_boost?: boolean;
  /** "Values range from 0.7 to 1.2, with 1.0 being the default speed." */
  speed?: number;
}

/** Buffer schedule of the first message (AsyncAPI `GenerationConfig`). */
export interface StreamInputGenerationConfig {
  /**
   * "The minimum amount of text that needs to be sent and present in our
   * buffer before audio starts being generated", per generation, in
   * characters. Default `[120, 160, 250, 290]`; each item 50–500.
   */
  chunk_length_schedule?: number[];
}

/** Both ids are REQUIRED on this endpoint (the REST body allows a null version). */
export interface StreamInputPronunciationDictionaryLocator {
  pronunciation_dictionary_id: string;
  version_id: string;
}

/** The documented query params of the stream-input socket. */
export interface TextToSpeechStreamInputQuery {
  /** "Identifier of the model that will be used"; no server default published. */
  model_id?: ElevenlabsTtsModelId | (string & {});
  /**
   * ISO 639-1 code enforcing a language. "This parameter is not supported for
   * multilingual_v2 models" — reported via the shared TTS constraint table.
   */
  language_code?: string;
  /** `false` selects zero-retention mode (enterprise only). */
  enable_logging?: boolean;
  /** "Formatted as codec_sample_rate_bitrate", e.g. `mp3_44100_128`. */
  output_format?: ElevenlabsOutputFormat;
  /** Seconds of inactivity before the socket closes. Default 20, max 180. */
  inactivity_timeout?: number;
  /** "Sync the text alignment to every returned response". */
  sync_alignment?: boolean;
  /**
   * "Disabling the chunk schedule and all buffers … only recommended when
   * sending full sentences."
   */
  auto_mode?: boolean;
  /** Text normalization mode: 'auto', 'on', 'off'. */
  apply_text_normalization?: "auto" | "on" | "off";
  /** Best-effort deterministic sampling; the REST reference bounds it 0–4294967295. */
  seed?: number;
  /**
   * Parse SSML tags in the streamed text. Required `true` when using
   * phoneme-based pronunciation dictionaries — though "SSML parsing is
   * automatically enabled if this parameter is not set".
   */
  enable_ssml_parsing?: boolean;
}

/** The JSON of the first message, exactly as it goes on the wire. */
export interface InitializeConnectionMessage {
  /** "The initial text that must be sent is a blank space." */
  text: " ";
  voice_settings?: StreamInputVoiceSettings;
  generation_config?: StreamInputGenerationConfig;
  pronunciation_dictionary_locators?: StreamInputPronunciationDictionaryLocator[];
}

/** Connection query params + the first message's fields, validated together. */
export interface TextToSpeechStreamInputParams extends TextToSpeechStreamInputQuery {
  /** URL path segment: `${STREAM_INPUT_WS_BASE_URL}/{voice_id}/stream-input`. */
  voice_id: string;
  /**
   * First-message text. Only the documented blank space is legal;
   * {@link toInitializeConnectionMessage} emits it whether or not you pass it.
   */
  text?: " ";
  voice_settings?: StreamInputVoiceSettings;
  generation_config?: StreamInputGenerationConfig;
  /** "Must only be provided in the first message." */
  pronunciation_dictionary_locators?: StreamInputPronunciationDictionaryLocator[];
}

// ---------------------------------------------------------------------------
// Schema (loose: unknown keys pass through with a warning).
// ---------------------------------------------------------------------------

const schema = z.looseObject({
  voice_id: z.string().min(1, "voice_id must be a non-empty voice id"),
  model_id: z.string().optional(),
  language_code: z.string().optional(),
  enable_logging: z.boolean().optional(),
  output_format: z.string().optional(),
  // "The default timeout is set to 20, with a maximum allowed value of 180."
  // Only the maximum is documented; 1 is unmodel's floor for a timeout.
  inactivity_timeout: z.number().min(1).max(STREAM_INPUT_INACTIVITY_TIMEOUT_MAX).optional(),
  sync_alignment: z.boolean().optional(),
  auto_mode: z.boolean().optional(),
  apply_text_normalization: z.enum(["auto", "on", "off"]).optional(),
  // Bound published on the REST reference for the same param (CONVERT_DOCS_URL).
  seed: z.number().int().min(0).max(4294967295).optional(),
  enable_ssml_parsing: z.boolean().optional(),
  text: z.literal(" ", 'the first message\'s `text` must be the blank space " "').optional(),
  voice_settings: z
    .looseObject({
      stability: z.number().optional(),
      similarity_boost: z.number().optional(),
      style: z.number().optional(),
      use_speaker_boost: z.boolean().optional(),
      // "Values range from 0.7 to 1.2" (STREAM_INPUT_DOCS_URL).
      speed: z.number().min(TTS_SPEED_MIN).max(TTS_SPEED_MAX).optional(),
    })
    .optional(),
  generation_config: z
    .looseObject({
      chunk_length_schedule: z
        .array(
          z
            .number()
            .int()
            .min(STREAM_INPUT_CHUNK_LENGTH_MIN)
            .max(STREAM_INPUT_CHUNK_LENGTH_MAX),
        )
        .optional(),
    })
    .optional(),
  pronunciation_dictionary_locators: z
    .array(
      z.looseObject({
        pronunciation_dictionary_id: z.string(),
        // REQUIRED on this endpoint, unlike the REST body.
        version_id: z.string(),
      }),
    )
    .optional(),
});

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

const TTS_MODEL_ID_SET = new Set<string>(TTS_MODEL_IDS);
const OUTPUT_FORMAT_SET = new Set<string>(TTS_OUTPUT_FORMATS);

/**
 * The catalog carries every documented ElevenLabs model id, including ones
 * served by other APIs (realtime STT, music, sound effects, speech-to-speech,
 * text-to-voice); the streaming TTS socket serves the same family the REST
 * convert endpoint does. Ids unknown to the catalog stay a warning — they may
 * be new TTS models.
 */
function checkTtsModelKind(
  params: TextToSpeechStreamInputParams,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const model = params.model_id;
  if (model === undefined || info === undefined || TTS_MODEL_ID_SET.has(model)) return;
  ctx.report({
    code: "unsupported_capability",
    path: ["model_id"],
    model,
    message: `"${model}" is not a text-to-speech model; the stream-input WebSocket accepts ${TTS_MODEL_IDS.map((id) => `"${id}"`).join(", ")}.`,
    meta: { allowed: [...TTS_MODEL_IDS], source: MODELS_DOCS_URL },
  });
}

/**
 * `output_format` is documented here with the same prose as the REST convert
 * endpoint ("Formatted as codec_sample_rate_bitrate…") but WITHOUT republishing
 * the value list, so an unlisted value is a warning rather than an error: the
 * enum below is sourced from CONVERT_DOCS_URL, and this page never says the
 * socket refuses anything outside it.
 */
function checkOutputFormat(
  params: TextToSpeechStreamInputParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const format = params.output_format;
  if (format === undefined || OUTPUT_FORMAT_SET.has(format)) return;
  ctx.report({
    code: "invalid_enum_value",
    severity: "warning",
    path: ["output_format"],
    message: `\`output_format\` ${JSON.stringify(format)} is not one of the values ElevenLabs publishes for text-to-speech (${TTS_OUTPUT_FORMATS.map((v) => JSON.stringify(v)).join(", ")}); the stream-input reference republishes no enum, so this may still be accepted.`,
    meta: {
      allowed: [...TTS_OUTPUT_FORMATS],
      value: format,
      source: CONVERT_DOCS_URL,
    },
  });
}

/**
 * "auto_mode … focuses on reducing the latency by disabling the chunk schedule
 * and all buffers" — a `chunk_length_schedule` sent alongside it is dropped on
 * the floor, so this warns rather than fails (the request still works).
 */
function checkAutoMode(
  params: TextToSpeechStreamInputParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (params.auto_mode !== true) return;
  if (params.generation_config?.chunk_length_schedule === undefined) return;
  ctx.report({
    code: "unsupported_param",
    severity: "warning",
    path: ["generation_config", "chunk_length_schedule"],
    message:
      "`generation_config.chunk_length_schedule` is ignored when `auto_mode` is true — auto mode disables the chunk schedule and all buffers.",
    meta: { ignored: true, source: STREAM_INPUT_DOCS_URL },
  });
}

// ---------------------------------------------------------------------------
// Builders — the socket URL and the first message.
// ---------------------------------------------------------------------------

/**
 * Builds the stream-input socket address for validated params: the voice id is
 * interpolated into the path and every documented connection setting is
 * appended as a query param. Auth is deliberately absent — send the
 * `xi-api-key` header (or your own `authorization` / `single_use_token` query
 * param) yourself.
 */
export function textToSpeechStreamInputUrl(params: TextToSpeechStreamInputParams): string {
  const base = `${STREAM_INPUT_WS_BASE_URL}/${encodeURIComponent(params.voice_id)}/stream-input`;
  const search = new URLSearchParams();
  const set = (key: string, value: string | number | boolean | undefined): void => {
    if (value !== undefined) search.set(key, String(value));
  };
  set("model_id", params.model_id);
  set("language_code", params.language_code);
  set("enable_logging", params.enable_logging);
  set("output_format", params.output_format);
  set("inactivity_timeout", params.inactivity_timeout);
  set("sync_alignment", params.sync_alignment);
  set("auto_mode", params.auto_mode);
  set("apply_text_normalization", params.apply_text_normalization);
  set("seed", params.seed);
  set("enable_ssml_parsing", params.enable_ssml_parsing);
  const qs = search.toString();
  return qs === "" ? base : `${base}?${qs}`;
}

/**
 * Extracts the first (`InitializeConnection`) message from validated params —
 * `JSON.stringify` it and send it as the first frame. The mandatory blank-space
 * `text` is always emitted; the connection query params are left out (they
 * belong to {@link textToSpeechStreamInputUrl}), as is auth.
 */
export function toInitializeConnectionMessage(
  params: TextToSpeechStreamInputParams,
): InitializeConnectionMessage {
  return {
    text: " ",
    ...(params.voice_settings !== undefined && { voice_settings: params.voice_settings }),
    ...(params.generation_config !== undefined && { generation_config: params.generation_config }),
    ...(params.pronunciation_dictionary_locators !== undefined && {
      pronunciation_dictionary_locators: params.pronunciation_dictionary_locators,
    }),
  };
}

// ---------------------------------------------------------------------------
// Validator — no `finalize`: there is no HTTP body and no fetchable URL, so
// the validated object is the params themselves (see module JSDoc).
// ---------------------------------------------------------------------------

const validator = createValidator<TextToSpeechStreamInputParams>({
  endpoint: "elevenlabs.textToSpeechStreamInput",
  schema,
  // No server-side default is documented for the socket's `model_id`
  // (the REST body's eleven_multilingual_v2 default is not republished here),
  // so model-dependent checks are skipped when it is omitted.
  modelId: (params) => params.model_id,
  catalog: models,
  // Same per-model rules as the REST endpoint: `language_code` is silently
  // ignored by multilingual_v2 models.
  constraints: textToSpeechConstraints,
  checks: [checkTtsModelKind, checkOutputFormat, checkAutoMode],
  // No estimate: the socket is billed per character of the text you stream
  // later, none of which is known at connect time.
});

/**
 * Validates the CONNECTION CONFIG and first message of the ElevenLabs
 * streaming TTS WebSocket
 * (`wss://api.elevenlabs.io/v1/text-to-speech/{voice_id}/stream-input`).
 *
 * The result is the validated params; split them with
 * {@link textToSpeechStreamInputUrl} (socket address, query params applied) and
 * {@link toInitializeConnectionMessage} (the JSON of the first frame). The
 * socket lifecycle — opening it, streaming `{ text }` frames, `flush`,
 * `try_trigger_generation`, closing with `{ text: "" }` — is transport and
 * outside unmodel's scope, as is auth.
 *
 * ```ts
 * const config = elevenlabs.textToSpeechStreamInput({
 *   voice_id: "JBFqnCBsd6RMkjVDRZzb",
 *   model_id: "eleven_flash_v2_5",
 *   output_format: "mp3_44100_128",
 *   inactivity_timeout: 180,
 *   voice_settings: { stability: 0.5, similarity_boost: 0.8, speed: 1.1 },
 *   generation_config: { chunk_length_schedule: [120, 160, 250, 290] },
 * });
 * const ws = new WebSocket(textToSpeechStreamInputUrl(config), {
 *   headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY! },
 * });
 * ws.send(JSON.stringify(toInitializeConnectionMessage(config)));
 * ```
 */
export const textToSpeechStreamInput = validator as unknown as {
  <T extends TextToSpeechStreamInputParams>(
    params: T & ExactKeys<T, TextToSpeechStreamInputParams>,
    options?: ValidateOptions,
  ): T;
  safe<T extends TextToSpeechStreamInputParams>(
    params: T & ExactKeys<T, TextToSpeechStreamInputParams>,
    options?: ValidateOptions,
  ): ValidateResult<T>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
