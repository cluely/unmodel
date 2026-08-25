/**
 * ElevenLabs Text to Speech — POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}
 *
 * Wire notes (verified against
 * https://elevenlabs.io/docs/api-reference/text-to-speech/convert and the
 * Fern-generated types in elevenlabs/elevenlabs-js on 2026-08-13):
 * - `voice_id` is a URL path param: it rides in the params object for
 *   ergonomics but is STRIPPED from the wire body and interpolated into
 *   `.request.url`.
 * - `output_format`, `enable_logging` and `optimize_streaming_latency` are
 *   QUERY params: also stripped from the body and appended to
 *   `.request.url`. Sending them in the JSON body (as an SDK-shaped params
 *   object invites) is a silent no-op — notably `enable_logging: false`,
 *   which is how zero-retention mode is requested.
 * - Character caps are per-model request limits on `text` (e.g. 10k for
 *   eleven_multilingual_v2, 40k for eleven_flash_v2_5). unmodel reports a
 *   breach as code `over_output_limit` — the code names tokens elsewhere, but
 *   here the message and meta ({ limitCharacters, actualCharacters }) are
 *   explicitly about characters. There is no character-specific issue code.
 * - The endpoint responds with raw audio bytes, not JSON, so there is no
 *   response checker for TTS.
 * - Auth is an `xi-api-key` header — unmodel never touches keys; add it
 *   yourself when fetching.
 */

import { z } from "zod";
import { createValidator, type PipelineContext } from "../../core/pipeline";
import { JSON_HEADERS, toValidated, type ExactKeys, type Validated } from "../../core/request";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";
import type { ModelInfo } from "../../core/catalog-types";
import type { EndpointConstraints } from "../../core/constraint-types";
import { computeCharacterCostUSD } from "../../core/cost";
import { models, TTS_MODEL_IDS, type ElevenlabsTtsModelId } from "./models";
import { ttsConstraints } from "./constraints";

export const TEXT_TO_SPEECH_BASE_URL = "https://api.elevenlabs.io/v1/text-to-speech";

/**
 * Server-side default when `model_id` is omitted —
 * https://elevenlabs.io/docs/api-reference/text-to-speech/convert
 * ("Defaults to eleven_multilingual_v2"). Model-dependent checks (character
 * cap, cost) run against this model when none is given.
 */
export const DEFAULT_TTS_MODEL_ID = "eleven_multilingual_v2";

/**
 * `output_format` query param values ("codec_sample_rate_bitrate") —
 * https://elevenlabs.io/docs/api-reference/text-to-speech/convert.
 * Some are plan-gated (mp3_44100_192 needs Creator+, 44.1kHz PCM/WAV needs
 * Pro+); unmodel cannot see your plan, so all documented values pass.
 */
export const TTS_OUTPUT_FORMATS = [
  "alaw_8000",
  "mp3_22050_32",
  "mp3_24000_48",
  "mp3_44100_128",
  "mp3_44100_192",
  "mp3_44100_32",
  "mp3_44100_64",
  "mp3_44100_96",
  "opus_48000_128",
  "opus_48000_192",
  "opus_48000_32",
  "opus_48000_64",
  "opus_48000_96",
  "pcm_16000",
  "pcm_22050",
  "pcm_24000",
  "pcm_32000",
  "pcm_44100",
  "pcm_48000",
  "pcm_8000",
  "ulaw_8000",
  "wav_16000",
  "wav_22050",
  "wav_24000",
  "wav_32000",
  "wav_44100",
  "wav_48000",
  "wav_8000",
] as const;

export type ElevenlabsOutputFormat = (typeof TTS_OUTPUT_FORMATS)[number];

/**
 * `optimize_streaming_latency` query values — the documented space is exactly
 * the integers 0–4 ("0 - default mode (no latency optimizations) … 4 - max
 * latency optimizations", TTS_DOCS_URL), enforced at runtime by
 * `z.number().int().min(0).max(4)` on the schema below. Closed: there is no
 * level 5.
 */
export const TTS_OPTIMIZE_STREAMING_LATENCY_LEVELS = [0, 1, 2, 3, 4] as const;

export type ElevenlabsOptimizeStreamingLatency =
  (typeof TTS_OPTIMIZE_STREAMING_LATENCY_LEVELS)[number];

/**
 * Documented bounds of `voice_settings.speed` —
 * https://elevenlabs.io/docs/best-practices/prompting/controls
 * ("Values below 1.0 will slow the voice down, to a minimum of 0.7. Values
 * above 1.0 will speed up the voice, to a maximum of 1.2."). The API
 * reference itself publishes no bounds, so this is the only documented
 * source; `stability`, `similarity_boost` and `style` have no documented
 * numeric range anywhere and are therefore left unconstrained.
 */
export const TTS_SPEED_MIN = 0.7;
export const TTS_SPEED_MAX = 1.2;

// ---------------------------------------------------------------------------
// Wire types — mirror the raw JSON body exactly (snake_case). Explicit `null`
// means "use the provider default" on nullable fields.
// ---------------------------------------------------------------------------

export interface ElevenlabsVoiceSettings {
  /**
   * Voice consistency; lower values give more emotional range. Default 0.5.
   * The docs publish no numeric bounds, so unmodel enforces none.
   */
  stability?: number | null;
  /** Adherence to the original voice. Default 0.75. No documented bounds. */
  similarity_boost?: number | null;
  /** Style exaggeration. Default 0. No documented bounds. */
  style?: number | null;
  /** Boost similarity to the original speaker. Default true. */
  use_speaker_boost?: boolean | null;
  /** Speech speed multiplier; documented range 0.7–1.2. Default 1. */
  speed?: number | null;
}

export interface ElevenlabsPronunciationDictionaryLocator {
  pronunciation_dictionary_id: string;
  version_id?: string | null;
}

export interface TextToSpeechParams {
  /**
   * URL path param — stripped from the wire body; `.request.url` is
   * `${TEXT_TO_SPEECH_BASE_URL}/{voice_id}`.
   */
  voice_id: string;
  /** The text to convert to speech (billed per character). */
  text: string;
  /** Defaults to "eleven_multilingual_v2" server-side. */
  model_id?: ElevenlabsTtsModelId | (string & {});
  /**
   * ISO 639-1 code enforcing a language. Not supported by multilingual_v2
   * models (constraint error); models that don't support the given code
   * silently ignore it.
   */
  language_code?: string | null;
  /** Per-request overrides of the voice's stored settings. */
  voice_settings?: ElevenlabsVoiceSettings | null;
  /** Up to 3 pronunciation dictionary locators, applied in order. */
  pronunciation_dictionary_locators?: ElevenlabsPronunciationDictionaryLocator[] | null;
  /** Best-effort deterministic sampling; integer 0–4294967295. */
  seed?: number | null;
  /** Text that came before this request's text (continuity). */
  previous_text?: string | null;
  /** Text that comes after this request's text (continuity). */
  next_text?: string | null;
  /** Up to 3 request ids of samples generated before this one. */
  previous_request_ids?: string[] | null;
  /** Up to 3 request ids of samples that come after this one. */
  next_request_ids?: string[] | null;
  /** Text normalization mode. Default "auto". */
  apply_text_normalization?: "auto" | "on" | "off";
  /** Language-specific text normalization (currently Japanese only; adds latency). */
  apply_language_text_normalization?: boolean;
  /** @deprecated Temporary latency workaround — use the IVC voice version. */
  use_pvc_as_ivc?: boolean;
  /**
   * QUERY param — stripped from the wire body and appended to `.request.url`
   * as `?output_format=…`. Default mp3_44100_128.
   */
  output_format?: ElevenlabsOutputFormat;
  /**
   * QUERY param (default true). `false` selects zero-retention mode, which
   * is enterprise-gated and forbids history/request-stitching features.
   */
  enable_logging?: boolean;
  /**
   * QUERY param, integer 0–4. @deprecated by ElevenLabs ("use the
   * `stream` endpoints with `optimize_streaming_latency` unset"), still
   * documented and accepted. `null` keeps the provider default.
   */
  optimize_streaming_latency?: ElevenlabsOptimizeStreamingLatency | null;
}

// ---------------------------------------------------------------------------
// SDK view — @elevenlabs/elevenlabs-js is camelCase and takes the voice id as
// a separate argument: client.textToSpeech.convert(voiceId, request).
// `.toSdk("elevenlabs")` returns { voiceId, request } with keys camelCased and
// null-valued fields dropped (null means "use the provider default", which
// for the SDK is expressed by omission).
// ---------------------------------------------------------------------------

export interface TextToSpeechSdkVoiceSettings {
  stability?: number;
  similarityBoost?: number;
  style?: number;
  useSpeakerBoost?: boolean;
  speed?: number;
}

export interface TextToSpeechSdkRequest {
  text: string;
  modelId?: string;
  languageCode?: string;
  voiceSettings?: TextToSpeechSdkVoiceSettings;
  pronunciationDictionaryLocators?: Array<{ pronunciationDictionaryId: string; versionId?: string }>;
  seed?: number;
  previousText?: string;
  nextText?: string;
  previousRequestIds?: string[];
  nextRequestIds?: string[];
  applyTextNormalization?: "auto" | "on" | "off";
  applyLanguageTextNormalization?: boolean;
  usePvcAsIvc?: boolean;
  outputFormat?: ElevenlabsOutputFormat;
  enableLogging?: boolean;
  optimizeStreamingLatency?: ElevenlabsOptimizeStreamingLatency;
}

export interface TextToSpeechSdkParams {
  voiceId: string;
  request: TextToSpeechSdkRequest;
}

// ---------------------------------------------------------------------------
// Schema (loose: unknown keys pass through with a warning).
// ---------------------------------------------------------------------------

const voiceSettingsSchema = z.looseObject({
  stability: z.number().nullable().optional(),
  similarity_boost: z.number().nullable().optional(),
  style: z.number().nullable().optional(),
  use_speaker_boost: z.boolean().nullable().optional(),
  speed: z.number().nullable().optional(),
});

const textToSpeechSchema = z.looseObject({
  voice_id: z.string().min(1, "voice_id must be a non-empty voice id"),
  text: z.string(),
  model_id: z.string().optional(),
  language_code: z.string().nullable().optional(),
  voice_settings: voiceSettingsSchema.nullable().optional(),
  pronunciation_dictionary_locators: z
    .array(
      z.looseObject({
        pronunciation_dictionary_id: z.string(),
        version_id: z.string().nullable().optional(),
      }),
    )
    .max(3, "at most 3 pronunciation dictionary locators are allowed per request")
    .nullable()
    .optional(),
  seed: z.number().int().min(0).max(4294967295).nullable().optional(),
  previous_text: z.string().nullable().optional(),
  next_text: z.string().nullable().optional(),
  previous_request_ids: z
    .array(z.string())
    .max(3, "at most 3 previous_request_ids are allowed")
    .nullable()
    .optional(),
  next_request_ids: z
    .array(z.string())
    .max(3, "at most 3 next_request_ids are allowed")
    .nullable()
    .optional(),
  apply_text_normalization: z.enum(["auto", "on", "off"]).optional(),
  apply_language_text_normalization: z.boolean().optional(),
  use_pvc_as_ivc: z.boolean().optional(),
  output_format: z.string().optional(),
  enable_logging: z.boolean().optional(),
  // "0 - default mode … 4 - max latency optimizations" — the documented
  // range is the integers 0–4.
  optimize_streaming_latency: z.number().int().min(0).max(4).nullable().optional(),
});

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

const OUTPUT_FORMAT_SET = new Set<string>(TTS_OUTPUT_FORMATS);
const TTS_DOCS_URL = "https://elevenlabs.io/docs/api-reference/text-to-speech/convert";
const MODELS_DOCS_URL = "https://elevenlabs.io/docs/models";
const CONTROLS_DOCS_URL = "https://elevenlabs.io/docs/best-practices/prompting/controls";

const TTS_MODEL_ID_SET = new Set<string>(TTS_MODEL_IDS);

/**
 * The catalog carries every documented ElevenLabs model id, including ones
 * served by other APIs (realtime STT, music, sound effects, speech-to-speech,
 * text-to-voice). Those ids resolve in the catalog, so without this gate they
 * would pass text-to-speech validation unremarked; the endpoint rejects them.
 * Ids unknown to the catalog stay a warning (`unknown_model`) — they may be
 * new TTS models.
 */
function checkTtsModelKind(
  params: TextToSpeechParams,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const model = params.model_id ?? DEFAULT_TTS_MODEL_ID;
  if (info === undefined || TTS_MODEL_ID_SET.has(model)) return;
  ctx.report({
    code: "unsupported_capability",
    path: ["model_id"],
    model,
    message: `"${model}" is not a text-to-speech model; POST /v1/text-to-speech accepts ${TTS_MODEL_IDS.map((id) => `"${id}"`).join(", ")}.`,
    meta: { allowed: [...TTS_MODEL_IDS], source: MODELS_DOCS_URL },
  });
}

/**
 * `voice_settings.speed` is the only voice setting with documented bounds
 * (0.7–1.2, CONTROLS_DOCS_URL). stability / similarity_boost / style publish
 * none, so they are deliberately unchecked.
 */
function checkVoiceSettings(
  params: TextToSpeechParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const speed = params.voice_settings?.speed;
  if (speed == null) return;
  if (speed < TTS_SPEED_MIN || speed > TTS_SPEED_MAX) {
    ctx.report({
      code: "invalid_shape",
      path: ["voice_settings", "speed"],
      message: `\`voice_settings.speed\` is ${speed}; ElevenLabs documents a range of ${TTS_SPEED_MIN}–${TTS_SPEED_MAX}.`,
      meta: { min: TTS_SPEED_MIN, max: TTS_SPEED_MAX, value: speed, source: CONTROLS_DOCS_URL },
    });
  }
}

function checkOutputFormat(
  params: TextToSpeechParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const format = params.output_format;
  if (format === undefined || OUTPUT_FORMAT_SET.has(format)) return;
  ctx.report({
    code: "invalid_enum_value",
    path: ["output_format"],
    message: `\`output_format\` must be one of ${TTS_OUTPUT_FORMATS.map((v) => JSON.stringify(v)).join(", ")}; got ${JSON.stringify(format)}.`,
    meta: { allowed: [...TTS_OUTPUT_FORMATS], value: format, source: TTS_DOCS_URL },
  });
}

/**
 * Per-model character cap on `text` (catalog `limit.characters`). Reported as
 * `over_output_limit` with a characters-explicit message and
 * meta { limitCharacters, actualCharacters } — see module JSDoc.
 */
function checkCharacterLimit(
  params: TextToSpeechParams,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const limit = info?.limit.characters;
  if (limit === undefined) return;
  const actual = params.text.length;
  if (actual <= limit) return;
  const model = params.model_id ?? DEFAULT_TTS_MODEL_ID;
  ctx.report({
    code: "over_output_limit",
    path: ["text"],
    model,
    message: `\`text\` is ${actual} characters; "${model}" caps a single text-to-speech request at ${limit} characters.`,
    meta: { limitCharacters: limit, actualCharacters: actual, source: MODELS_DOCS_URL },
  });
}

// ---------------------------------------------------------------------------
// Estimation — TTS is billed per input character (catalog
// cost.perMillionCharacters); character count is `text.length`.
// ---------------------------------------------------------------------------

function estimate(params: TextToSpeechParams, info: ModelInfo | undefined, _ctx: PipelineContext) {
  const costUSD = computeCharacterCostUSD(info?.cost, params.text.length);
  return costUSD === undefined ? {} : { costUSD };
}

// ---------------------------------------------------------------------------
// Finalize: wire body (voice_id and output_format stripped — they live in
// the URL) + .toSdk("elevenlabs") + .request
// ---------------------------------------------------------------------------

/**
 * The three documented query params of POST /v1/text-to-speech/{voice_id}.
 * Typed exactly like their `TextToSpeechParams` counterparts so hand-built
 * URLs get the same autocomplete (and the same compile errors) as validated
 * ones.
 */
export interface TextToSpeechQuery {
  output_format?: ElevenlabsOutputFormat;
  enable_logging?: boolean;
  optimize_streaming_latency?: ElevenlabsOptimizeStreamingLatency | null;
}

/** Endpoint URL for a voice id, with the documented query params appended. */
export function textToSpeechUrl(voiceId: string, query: TextToSpeechQuery = {}): string {
  const base = `${TEXT_TO_SPEECH_BASE_URL}/${encodeURIComponent(voiceId)}`;
  const search = new URLSearchParams();
  if (query.output_format !== undefined) search.set("output_format", query.output_format);
  if (query.enable_logging !== undefined) search.set("enable_logging", String(query.enable_logging));
  if (query.optimize_streaming_latency != null) {
    search.set("optimize_streaming_latency", String(query.optimize_streaming_latency));
  }
  const qs = search.toString();
  return qs === "" ? base : `${base}?${qs}`;
}

/** Wire snake_case → SDK camelCase for top-level body keys. */
const SDK_KEY_MAP: Record<string, string> = {
  text: "text",
  model_id: "modelId",
  language_code: "languageCode",
  voice_settings: "voiceSettings",
  pronunciation_dictionary_locators: "pronunciationDictionaryLocators",
  seed: "seed",
  previous_text: "previousText",
  next_text: "nextText",
  previous_request_ids: "previousRequestIds",
  next_request_ids: "nextRequestIds",
  apply_text_normalization: "applyTextNormalization",
  apply_language_text_normalization: "applyLanguageTextNormalization",
  use_pvc_as_ivc: "usePvcAsIvc",
};

function camelizeVoiceSettings(settings: ElevenlabsVoiceSettings): TextToSpeechSdkVoiceSettings {
  const out: Record<string, unknown> = {};
  if (settings.stability != null) out.stability = settings.stability;
  if (settings.similarity_boost != null) out.similarityBoost = settings.similarity_boost;
  if (settings.style != null) out.style = settings.style;
  if (settings.use_speaker_boost != null) out.useSpeakerBoost = settings.use_speaker_boost;
  if (settings.speed != null) out.speed = settings.speed;
  return out as TextToSpeechSdkVoiceSettings;
}

type TextToSpeechBody = Omit<
  TextToSpeechParams,
  "voice_id" | "output_format" | "enable_logging" | "optimize_streaming_latency"
>;

function buildSdkParams(
  voiceId: string,
  query: TextToSpeechQuery,
  body: TextToSpeechBody,
): TextToSpeechSdkParams {
  const request: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (value == null) continue; // null = provider default → omitted for the SDK
    const sdkKey = SDK_KEY_MAP[key] ?? key; // unknown params pass through unchanged
    if (key === "voice_settings") {
      request[sdkKey] = camelizeVoiceSettings(value as ElevenlabsVoiceSettings);
    } else if (key === "pronunciation_dictionary_locators") {
      request[sdkKey] = (value as ElevenlabsPronunciationDictionaryLocator[]).map((locator) => ({
        pronunciationDictionaryId: locator.pronunciation_dictionary_id,
        ...(locator.version_id != null && { versionId: locator.version_id }),
      }));
    } else {
      request[sdkKey] = value;
    }
  }
  // The SDK takes the query params inside the same request object.
  if (query.output_format !== undefined) request.outputFormat = query.output_format;
  if (query.enable_logging !== undefined) request.enableLogging = query.enable_logging;
  if (query.optimize_streaming_latency != null) {
    request.optimizeStreamingLatency = query.optimize_streaming_latency;
  }
  return { voiceId, request: request as unknown as TextToSpeechSdkRequest };
}

/**
 * SDK targets for `elevenlabs.tts`. `"elevenlabs"` re-shapes the wire
 * body into the `{ voiceId, request }` pair that
 * `@elevenlabs/elevenlabs-js`'s `client.textToSpeech.convert(voiceId, request)`
 * takes. Type alias, not interface: an interface has no implicit index
 * signature and cannot satisfy `SdkFormatters`.
 */
export type TtsSdkTargets = { elevenlabs: () => TextToSpeechSdkParams };

function finalize(params: TextToSpeechParams): unknown {
  const { voice_id, output_format, enable_logging, optimize_streaming_latency, ...body } = params;
  const query: TextToSpeechQuery = {
    ...(output_format !== undefined && { output_format }),
    ...(enable_logging !== undefined && { enable_logging }),
    ...(optimize_streaming_latency !== undefined && { optimize_streaming_latency }),
  };
  return toValidated(
    body,
    {
      url: textToSpeechUrl(voice_id, query),
      method: "POST",
      headers: JSON_HEADERS,
    },
    { sdk: { elevenlabs: () => buildSdkParams(voice_id, query, body) } },
  );
}

const validator = createValidator<TextToSpeechParams, unknown>({
  endpoint: "elevenlabs.tts",
  schema: textToSpeechSchema,
  // model_id is optional on the wire; checks run against the documented
  // server-side default so the 10k multilingual_v2 cap applies when omitted.
  modelId: (params) => params.model_id ?? DEFAULT_TTS_MODEL_ID,
  catalog: models,
  constraints: ttsConstraints,
  checks: [checkOutputFormat, checkCharacterLimit, checkTtsModelKind, checkVoiceSettings],
  estimate,
  finalize,
});

/**
 * Validates raw wire params for ElevenLabs
 * `POST /v1/text-to-speech/{voice_id}`.
 *
 * The returned object's enumerable props are the exact fetch JSON body —
 * `voice_id` (path param) and the three query params (`output_format`,
 * `enable_logging`, `optimize_streaming_latency`) are stripped and live in
 * `.request.url` instead. `.toSdk("elevenlabs")` returns `{ voiceId, request }`
 * for `@elevenlabs/elevenlabs-js`'s
 * `client.textToSpeech.convert(voiceId, request)` (camelCase keys, explicit
 * nulls dropped). Auth is your job: add an `xi-api-key` header when fetching.
 *
 * ```ts
 * const params = elevenlabs.tts({
 *   voice_id: "JBFqnCBsd6RMkjVDRZzb",
 *   text: "Hello world",
 *   model_id: "eleven_flash_v2_5",
 *   output_format: "mp3_44100_128",
 * });
 * const res = await fetch(params.request.url, {
 *   method: params.request.method,
 *   headers: { ...params.request.headers, "xi-api-key": process.env.ELEVENLABS_API_KEY! },
 *   body: JSON.stringify(params),
 * });
 * const audio = await res.arrayBuffer();
 * ```
 */
export const tts = validator as unknown as {
  <T extends TextToSpeechParams>(
    params: T & ExactKeys<T, TextToSpeechParams>,
    options?: ValidateOptions<T>,
  ): Validated<Omit<T, keyof TextToSpeechQuery | "voice_id">, TtsSdkTargets>;
  safe<T extends TextToSpeechParams>(
    params: T & ExactKeys<T, TextToSpeechParams>,
    options?: ValidateOptions<T>,
  ): ValidateResult<
    Validated<Omit<T, keyof TextToSpeechQuery | "voice_id">, TtsSdkTargets>
  >;
  constraintsFor(modelId: string): EndpointConstraints[];
};
