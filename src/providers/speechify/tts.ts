/**
 * SpeechifyAI Text to Speech — POST https://api.speechify.ai/v1/audio/speech
 * (`tts`) and POST https://api.speechify.ai/v1/audio/stream (`ttsStream`).
 *
 * Wire reference: the live OpenAPI 3.1 spec at
 * https://docs.speechify.ai/openapi/api-reference.json, plus
 * https://docs.speechify.ai/build/text-to-speech-api,
 * https://docs.speechify.ai/build/guides/concepts/models and
 * https://docs.speechify.ai/build/guides/concepts/api-limits
 * (all verified 2026-08-13). Params mirror the wire body exactly.
 *
 * HOST: `https://api.speechify.ai` is the documented API base URL. The docs
 * site is explicit that this is the canonical host ("use exactly, do not
 * invent variants"); the older `api.sws.speechify.com` spelling appears
 * nowhere in the current reference, so unmodel does not emit it.
 *
 * THE TWO ROUTES ARE NOT THE SAME SHAPE — this is the whole reason both are
 * validated separately:
 * - `audio_format` (wav/mp3/ogg/aac/pcm) exists ONLY on /v1/audio/speech.
 *   Sending it to /v1/audio/stream is a no-op, so unmodel rejects it there.
 * - `output_format` is on both, but the streaming enum drops the two `wav_*`
 *   values: "wav is only available on POST /v1/audio/speech".
 * - `Accept` is a HEADER on /v1/audio/stream (there is no such header on
 *   /v1/audio/speech, which always answers JSON). It rides in the params
 *   object as `accept` for ergonomics but is STRIPPED from the wire body onto
 *   `.request.headers`. `output_format` "takes precedence over this header".
 * - The 2,000-character cap applies to /v1/audio/speech; /v1/audio/stream
 *   accepts 20,000. Both counts "include SSML tags".
 *
 * CHARACTER CAPS: an over-long `input` is reported as `over_output_limit` —
 * unmodel has no character-specific issue code, so the message and meta
 * ({ limitCharacters, actualCharacters }) spell out that the limit is in
 * characters, not tokens.
 *
 * COST: billing counts "the number of characters sent to the API (whitespace
 * and SSML tags are not counted)", so `input.length` is an upper bound —
 * exactly what `estimate.costUSD` is documented to be.
 *
 * NOT VALIDATED HERE: POST /v1/audio/stream/with-timestamps (an SSE route
 * whose body matches `stream`, but which rejects the two legacy Simba 1.6
 * models with 400 `speech_marks_unsupported`) and the dialogue route. The
 * voice-cloning routes are validated by ./voice-clone and
 * ./voice-consent-challenge.
 *
 * NO RESPONSE CHECKER on either route, and `/v1/audio/speech` answering JSON
 * is not an oversight. unmodel's response side reports quality, usage and cost
 * signals; that envelope is `audio_data` (base64 audio),
 * `billable_characters_count` and `speech_marks` — the audio, the count the
 * request layer already estimated, and an alignment document. Nothing to warn
 * about, so scope stays request validation. `/v1/audio/stream` answers an
 * audio stream, which has no JSON to check at all. `SPEECHIFY_TTS_DELIVERY`
 * in ./tts-params names where the bytes are.
 *
 * `.toSdk("speechify")` is the identity on `tts`: @speechify/api's
 * `GetSpeechRequest` is snake_case with exactly the wire keys. On `stream` it
 * re-attaches the stripped header as `Accept`, matching that SDK's
 * `GetStreamRequest`.
 */

import { z } from "zod";
import { createValidator, type PipelineContext } from "../../core/pipeline";
import { JSON_HEADERS, toValidated, type ExactKeys, type Validated } from "../../core/request";
import type { ValidateOptions } from "../../core/options";
import type { ValidateEstimate, ValidateResult } from "../../core/result";
import type { ModelInfo } from "../../core/catalog-types";
import type { EndpointConstraints } from "../../core/constraint-types";
import { computeCharacterCostUSD } from "../../core/cost";
import { models, type SpeechifyTtsModelId } from "./models";

export const AUDIO_SPEECH_URL = "https://api.speechify.ai/v1/audio/speech";
export const AUDIO_STREAM_URL = "https://api.speechify.ai/v1/audio/stream";
/**
 * SSE variant — same body as `stream`, but the two legacy Simba 1.6 models
 * return 400 `speech_marks_unsupported`. Not validated by unmodel.
 */
export const AUDIO_STREAM_WITH_TIMESTAMPS_URL =
  "https://api.speechify.ai/v1/audio/stream/with-timestamps";

/** Server-side default when `model` is omitted (OpenAPI `default: simba-3.0`). */
export const DEFAULT_MODEL_ID = "simba-3.0";

/** "2,000 characters" on /v1/audio/speech — API Limits. */
export const SPEECH_MAX_CHARACTERS = 2000;
/** "20,000 characters" on /v1/audio/stream — API Limits. */
export const STREAM_MAX_CHARACTERS = 20000;

const SPEC_URL = "https://docs.speechify.ai/openapi/api-reference.json";
const LIMITS_DOCS = "https://docs.speechify.ai/build/guides/concepts/api-limits";
const MODELS_DOCS = "https://docs.speechify.ai/build/guides/concepts/models";

// ---------------------------------------------------------------------------
// Wire types — mirror the raw JSON bodies exactly (snake_case).
// ---------------------------------------------------------------------------

/** `audio_format` enum — /v1/audio/speech only. Default "wav". */
export const AUDIO_FORMATS = ["wav", "mp3", "ogg", "aac", "pcm"] as const;
export type SpeechifyAudioFormat = (typeof AUDIO_FORMATS)[number];

/** `output_format` on /v1/audio/speech: `codec_sampleRate_bitrate` strings. */
export const SPEECH_OUTPUT_FORMATS = [
  "pcm_8000",
  "pcm_16000",
  "pcm_22050",
  "pcm_24000",
  "pcm_44100",
  "pcm_48000",
  "mp3_22050_32",
  "mp3_22050_64",
  "mp3_22050_96",
  "mp3_22050_128",
  "mp3_22050_192",
  "mp3_24000_32",
  "mp3_24000_64",
  "mp3_24000_96",
  "mp3_24000_128",
  "mp3_24000_192",
  "wav_24000",
  "wav_48000",
  "ulaw_8000",
  "ogg_24000",
  "aac_24000",
] as const;
export type SpeechifyOutputFormat = (typeof SPEECH_OUTPUT_FORMATS)[number];

/**
 * `output_format` on /v1/audio/stream — "Same as `AudioOutputFormat` minus the
 * `wav_*` formats: wav is only available on `POST /v1/audio/speech`."
 */
export const STREAM_OUTPUT_FORMATS = SPEECH_OUTPUT_FORMATS.filter(
  (format): format is Exclude<SpeechifyOutputFormat, "wav_24000" | "wav_48000"> =>
    format !== "wav_24000" && format !== "wav_48000",
);
export type SpeechifyStreamOutputFormat = (typeof STREAM_OUTPUT_FORMATS)[number];

/** `Accept` header values documented for /v1/audio/stream. */
export const STREAM_ACCEPT_VALUES = [
  "audio/mpeg",
  "audio/ogg",
  "audio/aac",
  "audio/pcm",
] as const;
export type SpeechifyStreamAccept = (typeof STREAM_ACCEPT_VALUES)[number];

export interface SpeechifyOptions {
  /**
   * Normalize output loudness to -14 LUFS / -2 dBTP / 7 LU. Default false;
   * "can increase latency".
   */
  loudness_normalization?: boolean;
  /**
   * Expand numbers, dates etc. into words. Default true on /v1/audio/speech
   * and false on /v1/audio/stream — the two routes differ.
   */
  text_normalization?: boolean;
}

export interface AudioSpeechBody {
  /** Plain text or SSML. Capped at 2,000 characters on this route. */
  input: string;
  /** Voice id from GET /v1/voices. */
  voice_id: string;
  /** Defaults to "simba-3.0" server-side. */
  model?: SpeechifyTtsModelId | (string & {});
  /** ISO 639-1 + ISO 3166-1 region, e.g. "en-US". */
  language?: string;
  /** Container only; default "wav". /v1/audio/speech ONLY. */
  audio_format?: SpeechifyAudioFormat;
  /** `codec_sampleRate_bitrate`; takes precedence over `audio_format`. */
  output_format?: SpeechifyOutputFormat;
  options?: SpeechifyOptions;
}

export interface AudioStreamParams {
  /** Plain text or SSML. Capped at 20,000 characters on this route. */
  input: string;
  voice_id: string;
  model?: SpeechifyTtsModelId | (string & {});
  language?: string;
  /** `codec_sampleRate_bitrate`; no `wav_*` values on this route. */
  output_format?: SpeechifyStreamOutputFormat;
  options?: SpeechifyOptions;
  /**
   * HEADER param — stripped from the wire body onto `.request.headers.accept`.
   * Selects the container when `output_format` is unset.
   */
  accept?: SpeechifyStreamAccept;
}

/** `stream`'s wire body: identical to the params minus the header. */
export type AudioStreamBody = Omit<AudioStreamParams, "accept">;

/**
 * @speechify/api's `GetStreamRequest` carries the header inside the same
 * object, capitalised as `Accept`.
 */
export type AudioStreamSdkParams = AudioStreamBody & { Accept?: SpeechifyStreamAccept };

// ---------------------------------------------------------------------------
// Schemas (loose: unknown keys pass through with a warning).
// ---------------------------------------------------------------------------

const optionsSchema = z.looseObject({
  loudness_normalization: z.boolean().optional(),
  text_normalization: z.boolean().optional(),
});

const ttsSchema = z.looseObject({
  input: z.string().min(1, "input must not be empty."),
  voice_id: z.string().min(1, "voice_id must not be empty."),
  model: z.string().optional(),
  language: z.string().optional(),
  audio_format: z.enum(AUDIO_FORMATS).optional(),
  output_format: z.string().optional(),
  options: optionsSchema.optional(),
});

const streamSchema = z.looseObject({
  input: z.string().min(1, "input must not be empty."),
  voice_id: z.string().min(1, "voice_id must not be empty."),
  model: z.string().optional(),
  language: z.string().optional(),
  output_format: z.string().optional(),
  options: optionsSchema.optional(),
  accept: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

const SPEECH_OUTPUT_FORMAT_SET = new Set<string>(SPEECH_OUTPUT_FORMATS);
const STREAM_OUTPUT_FORMAT_SET = new Set<string>(STREAM_OUTPUT_FORMATS);
const ACCEPT_SET = new Set<string>(STREAM_ACCEPT_VALUES);

type AnyParams = AudioSpeechBody | AudioStreamParams;

/**
 * Per-route `input` cap. The cap is documented on the endpoint, not the
 * model, so it applies even when the model id is unknown to the catalog; the
 * catalog's `limit.characters` only ever narrows it further.
 */
function checkInputLength(route: "speech" | "stream", cap: number) {
  return (params: AnyParams, info: ModelInfo | undefined, ctx: PipelineContext): void => {
    const catalogCap = info?.limit.characters;
    const limit = catalogCap !== undefined && catalogCap > 0 ? Math.min(cap, catalogCap) : cap;
    const actual = params.input.length;
    if (actual <= limit) return;
    ctx.report({
      code: "over_output_limit",
      path: ["input"],
      model: params.model ?? DEFAULT_MODEL_ID,
      message: `\`input\` is ${actual} characters; POST /v1/audio/${route} caps a request at ${limit} characters (this limit is in characters, not tokens, and SSML tags count toward it). Split the input, or use POST /v1/audio/stream for up to ${STREAM_MAX_CHARACTERS}.`,
      meta: { limitCharacters: limit, actualCharacters: actual, source: LIMITS_DOCS },
    });
  };
}

function checkOutputFormat(allowed: readonly string[], set: Set<string>, route: string) {
  return (params: AnyParams, _info: ModelInfo | undefined, ctx: PipelineContext): void => {
    const format = params.output_format;
    if (format === undefined || set.has(format)) return;
    const wavOnTts =
      route === "stream" && (format === "wav_24000" || format === "wav_48000");
    ctx.report({
      code: "invalid_enum_value",
      path: ["output_format"],
      message: wavOnTts
        ? `\`output_format\` ${JSON.stringify(format)} is not available on POST /v1/audio/stream — "wav is only available on POST /v1/audio/speech".`
        : `\`output_format\` must be one of ${allowed.map((v) => JSON.stringify(v)).join(", ")}; got ${JSON.stringify(format)}.`,
      meta: { allowed: [...allowed], value: format, source: SPEC_URL },
    });
  };
}

/**
 * `simba-3.2` "is English only, so a non-English voice returns 400". unmodel
 * cannot see the voice's locale, but it can see an explicitly non-English
 * `language`, which is the same rejection with a visible cause.
 *
 * `simba-3.0`'s off-list languages are deliberately NOT gated: the docs say
 * they "often work but are not validated", so an error would be wrong.
 */
function checkModelLanguage(
  params: AnyParams,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const model = params.model ?? DEFAULT_MODEL_ID;
  if (model !== "simba-3.2" || info === undefined) return;
  const language = params.language;
  if (language === undefined || /^en(-|$)/i.test(language)) return;
  ctx.report({
    code: "unsupported_capability",
    path: ["language"],
    model,
    message: `\`language\` is ${JSON.stringify(language)}, but "simba-3.2" is English only — a non-English request returns 400. Use "simba-3.0" (English + de-DE, es-ES, es-MX, fr-FR, it-IT, pt-BR) or "simba-multilingual" (30+ locales).`,
    meta: { value: language, source: MODELS_DOCS },
  });
}

/** `audio_format` is a /v1/audio/speech field; on the stream route it is dead weight. */
function checkNoAudioFormat(
  params: AudioStreamParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const value = (params as { audio_format?: unknown }).audio_format;
  if (value === undefined) return;
  ctx.report({
    code: "unsupported_param",
    path: ["audio_format"],
    message:
      "`audio_format` is only a field of POST /v1/audio/speech; POST /v1/audio/stream selects its container with the `Accept` header (pass `accept`) or with `output_format`, which takes precedence over it.",
    meta: { source: SPEC_URL },
  });
}

function checkAccept(
  params: AudioStreamParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const accept = params.accept;
  if (accept === undefined || ACCEPT_SET.has(accept)) return;
  ctx.report({
    code: "invalid_enum_value",
    path: ["accept"],
    message: `\`accept\` must be one of ${STREAM_ACCEPT_VALUES.map((v) => JSON.stringify(v)).join(", ")}; got ${JSON.stringify(accept)}.`,
    meta: { allowed: [...STREAM_ACCEPT_VALUES], value: accept, source: SPEC_URL },
  });
}

// ---------------------------------------------------------------------------
// Estimation — billed per input character (catalog cost.perMillionCharacters).
// ---------------------------------------------------------------------------

function estimate(
  params: AnyParams,
  info: ModelInfo | undefined,
  _ctx: PipelineContext,
): ValidateEstimate {
  const costUSD = computeCharacterCostUSD(info?.cost, params.input.length);
  return costUSD === undefined ? {} : { costUSD };
}

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

/**
 * SDK targets for `speechify.tts`. @speechify/api's `GetSpeechRequest` is
 * snake_case with exactly the wire keys, so the single `"speechify"` formatter
 * is the identity. Type alias, not interface: an interface has no implicit
 * index signature and cannot satisfy `SdkFormatters`.
 */
type TtsSdkTargets<B> = { speechify: () => B };

/** SDK targets for `speechify.ttsStream` — @speechify/api's `GetStreamRequest`. */
type TtsStreamSdkTargets<B> = { speechify: () => B };

function finalizeTts(
  params: AudioSpeechBody,
): Validated<AudioSpeechBody, TtsSdkTargets<AudioSpeechBody>> {
  const body = { ...params };
  return toValidated(
    body,
    {
      url: AUDIO_SPEECH_URL,
      method: "POST",
      headers: JSON_HEADERS,
    },
    { sdk: { speechify: () => body } },
  );
}

const ttsValidator = createValidator<
  AudioSpeechBody,
  Validated<AudioSpeechBody, TtsSdkTargets<AudioSpeechBody>>
>({
  endpoint: "speechify.tts",
  schema: ttsSchema,
  modelId: (params) => params.model ?? DEFAULT_MODEL_ID,
  catalog: models,
  checks: [
    checkInputLength("speech", SPEECH_MAX_CHARACTERS),
    checkOutputFormat(SPEECH_OUTPUT_FORMATS, SPEECH_OUTPUT_FORMAT_SET, "speech"),
    checkModelLanguage,
  ],
  estimate,
  finalize: finalizeTts,
});

function finalizeStream(params: AudioStreamParams): unknown {
  const { accept, ...body } = params;
  return toValidated(
    body,
    {
      url: AUDIO_STREAM_URL,
      method: "POST",
      headers: { ...JSON_HEADERS, ...(accept !== undefined && { accept }) },
    },
    { sdk: { speechify: () => ({ ...body, ...(accept !== undefined && { Accept: accept }) }) } },
  );
}

const streamValidator = createValidator<AudioStreamParams, unknown>({
  endpoint: "speechify.ttsStream",
  schema: streamSchema,
  modelId: (params) => params.model ?? DEFAULT_MODEL_ID,
  catalog: models,
  checks: [
    checkInputLength("stream", STREAM_MAX_CHARACTERS),
    checkOutputFormat(STREAM_OUTPUT_FORMATS, STREAM_OUTPUT_FORMAT_SET, "stream"),
    checkModelLanguage,
    checkNoAudioFormat,
    checkAccept,
  ],
  estimate,
  finalize: finalizeStream,
});

/**
 * Validates raw wire params for `POST /v1/audio/speech` — the non-streaming
 * route, which answers JSON (`audio_data` base64 + `billable_characters_count`
 * + `speech_marks`) and caps `input` at 2,000 characters.
 *
 * The returned object's enumerable props are the exact fetch JSON body;
 * `.toSdk("speechify")` returns it unchanged (@speechify/api's `GetSpeechRequest` is
 * snake_case with the same keys) and `.request` carries url/method/static
 * headers. Auth is your job: add an `authorization: Bearer …` header.
 *
 * ```ts
 * const params = speechify.tts({
 *   input: "Hello from Speechify.",
 *   voice_id: "geffen_32",
 *   model: "simba-3.2",
 *   audio_format: "mp3",
 * });
 * const res = await fetch(params.request.url, {
 *   method: params.request.method,
 *   headers: { ...params.request.headers, authorization: `Bearer ${process.env.SPEECHIFY_API_KEY!}` },
 *   body: JSON.stringify(params),
 * });
 * ```
 */
export const tts = ttsValidator as unknown as {
  <T extends AudioSpeechBody>(
    params: T & ExactKeys<T, AudioSpeechBody>,
    options?: ValidateOptions<T>,
  ): Validated<T, TtsSdkTargets<T>>;
  safe<T extends AudioSpeechBody>(
    params: T & ExactKeys<T, AudioSpeechBody>,
    options?: ValidateOptions<T>,
  ): ValidateResult<Validated<T, TtsSdkTargets<T>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};

/**
 * Validates raw wire params for `POST /v1/audio/stream` — chunked raw audio
 * bytes, `input` up to 20,000 characters, no `audio_format` and no `wav_*`
 * `output_format`.
 *
 * `accept` is stripped from the body onto `.request.headers.accept`;
 * `.toSdk("speechify")` re-attaches it as `Accept` for @speechify/api's
 * `GetStreamRequest`.
 *
 * ```ts
 * const params = speechify.ttsStream({
 *   input: longArticle,
 *   voice_id: "geffen_32",
 *   model: "simba-3.2",
 *   output_format: "mp3_24000_128",
 * });
 * const res = await fetch(params.request.url, {
 *   method: params.request.method,
 *   headers: { ...params.request.headers, authorization: `Bearer ${process.env.SPEECHIFY_API_KEY!}` },
 *   body: JSON.stringify(params),
 * });
 * ```
 */
export const ttsStream = streamValidator as unknown as {
  <T extends AudioStreamParams>(
    params: T & ExactKeys<T, AudioStreamParams>,
    options?: ValidateOptions<T>,
  ): Validated<Omit<T, "accept">, TtsStreamSdkTargets<AudioStreamSdkParams>>;
  safe<T extends AudioStreamParams>(
    params: T & ExactKeys<T, AudioStreamParams>,
    options?: ValidateOptions<T>,
  ): ValidateResult<Validated<Omit<T, "accept">, TtsStreamSdkTargets<AudioStreamSdkParams>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
