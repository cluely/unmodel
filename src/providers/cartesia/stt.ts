/**
 * Cartesia Batch Speech-to-Text (Ink) — POST https://api.cartesia.ai/stt
 *
 * Wire reference: https://docs.cartesia.ai/api-reference/stt/transcribe
 * (Cartesia-Version 2026-03-01, verified 2026-08-13). This endpoint is
 * multipart/form-data, not JSON: the params object holds the form fields
 * (with `file` as a Blob/File, or a string you resolve yourself), the
 * JSON-serializable config fields are validated, and the raw-fetch path is
 * `.request.url` + `toFormData(params)` as the body. Do NOT set a
 * content-type header yourself — fetch derives the multipart boundary from
 * the FormData body ( `.request.headers` therefore carries only the REQUIRED
 * `Cartesia-Version` header).
 *
 * On the wire the array field is spelled `timestamp_granularities[]`; the
 * params object uses the bracket-less key `timestamp_granularities` and
 * `toFormData` appends each element under the bracketed name.
 *
 * The realtime STT WebSocket endpoints (wss:///stt/websocket and the
 * turn-detection variant), which are the only route to the `ink-2` model,
 * are not validated by unmodel.
 */

import { z } from "zod";
import { createValidator, type PipelineContext } from "../../core/pipeline";
import { toValidated, type ExactKeys, type Validated } from "../../core/request";
import type { ValidateOptions } from "../../core/options";
import type { ValidateEstimate, ValidateResult } from "../../core/result";
import type { ModelInfo } from "../../core/catalog-types";
import type { EndpointConstraints } from "../../core/constraint-types";
import { computeAudioMinutesCostUSD } from "../../core/cost";
import { findMediaDeclaration } from "../../core/media/check";
import { models, type CartesiaSttModelId } from "./models";
import { CARTESIA_VERSION } from "./tts";

export const STT_TRANSCRIBE_URL = "https://api.cartesia.ai/stt";

const STT_TRANSCRIBE_DOCS = "https://docs.cartesia.ai/api-reference/stt/transcribe";

// ---------------------------------------------------------------------------
// Params — multipart form fields of POST /stt.
// ---------------------------------------------------------------------------

/** Raw-PCM input encodings (only relevant for headerless raw audio). */
export type CartesiaSttEncoding =
  | "pcm_s16le"
  | "pcm_s32le"
  | "pcm_f16le"
  | "pcm_f32le"
  | "pcm_mulaw"
  | "pcm_alaw";

/**
 * The `language` enum POST /stt publishes (Cartesia-Version 2026-03-01) —
 * https://docs.cartesia.ai/api-reference/stt/transcribe, transcribed in doc
 * order. Note this is a DIFFERENT, much larger set than the 42-code TTS list:
 * batch STT is Whisper-backed and adds its long tail (cy, haw, yue, …).
 */
export const CARTESIA_STT_LANGUAGES = [
  "en", "zh", "de", "es", "ru", "ko", "fr", "ja", "pt", "tr",
  "pl", "ca", "nl", "ar", "sv", "it", "id", "hi", "fi", "vi",
  "he", "uk", "el", "ms", "cs", "ro", "da", "hu", "ta", "no",
  "th", "ur", "hr", "bg", "lt", "la", "mi", "ml", "cy", "sk",
  "te", "fa", "lv", "bn", "sr", "az", "sl", "kn", "et", "mk",
  "br", "eu", "is", "hy", "ne", "mn", "bs", "kk", "sq", "sw",
  "gl", "mr", "pa", "si", "km", "sn", "yo", "so", "af", "oc",
  "ka", "be", "tg", "sd", "gu", "am", "yi", "lo", "uz", "fo",
  "ht", "ps", "tk", "nn", "mt", "sa", "lb", "my", "bo", "tl",
  "mg", "as", "tt", "haw", "ln", "ha", "ba", "jw", "su", "yue",
] as const;

export type CartesiaSttLanguage = (typeof CARTESIA_STT_LANGUAGES)[number];

export interface SttTranscribeParams {
  /**
   * The audio file (flac, m4a, mp3, mp4, mpeg, mpga, oga, ogg, wav, webm —
   * or raw PCM with `encoding`/`sample_rate`). Pass a Blob/File for real
   * uploads; a string is appended to the form verbatim (resolve URLs to
   * bytes yourself before sending).
   */
  file: Blob | string;
  /** Batch transcription accepts only the ink-whisper family. */
  model: CartesiaSttModelId | (string & {});
  /** ISO-639-1 code from {@link CARTESIA_STT_LANGUAGES}; defaults to "en". */
  language?: CartesiaSttLanguage | (string & {});
  /** Wire field `timestamp_granularities[]`; only "word" is supported. */
  timestamp_granularities?: Array<"word">;
  /** Raw PCM only. */
  encoding?: CartesiaSttEncoding;
  /** Sample rate in Hz; raw PCM only. */
  sample_rate?: number;
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const schema = z.looseObject({
  file: z.union([z.instanceof(Blob), z.string()]),
  model: z.string(),
  language: z.string().optional(),
  timestamp_granularities: z.array(z.literal("word")).optional(),
  encoding: z
    .enum(["pcm_s16le", "pcm_s32le", "pcm_f16le", "pcm_f32le", "pcm_mulaw", "pcm_alaw"])
    .optional(),
  sample_rate: z.number().int().positive().optional(),
});

// ---------------------------------------------------------------------------
// Checks + estimation
// ---------------------------------------------------------------------------

/** Batch /stt accepts only the ink-whisper model family (docs). */
function checkBatchModel(
  params: SttTranscribeParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const model = params.model;
  if (model === "ink-whisper" || model.startsWith("ink-whisper-")) return;
  ctx.report({
    code: "invalid_enum_value",
    path: ["model"],
    model,
    message: `\`model\` must be "ink-whisper" for batch transcription (POST /stt); got ${JSON.stringify(model)}. Realtime-only models such as "ink-2" require the STT WebSocket endpoint, which unmodel does not validate.`,
    meta: { allowed: ["ink-whisper"], value: model, source: STT_TRANSCRIBE_DOCS },
  });
}

const STT_LANGUAGE_SET = new Set<string>(CARTESIA_STT_LANGUAGES);

/**
 * `language` is a closed 75-value enum in the transcribe reference; the SDK
 * types it as a bare string, so an unsupported code only fails at request
 * time.
 */
function checkLanguage(
  params: SttTranscribeParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const language = params.language;
  if (typeof language !== "string" || STT_LANGUAGE_SET.has(language)) return;
  ctx.report({
    code: "invalid_enum_value",
    path: ["language"],
    model: params.model,
    message: `\`language\` must be one of the ${CARTESIA_STT_LANGUAGES.length} documented codes; got ${JSON.stringify(language)}.`,
    meta: { allowed: [...CARTESIA_STT_LANGUAGES], value: language, source: STT_TRANSCRIBE_DOCS },
  });
}

/**
 * STT is billed by audio duration, which the validator cannot read from a
 * Blob — declare it via `options.media = [{ path: ["file"], durationSeconds }]`.
 * Cartesia's catalog carries no USD rate (credit pricing is plan-dependent —
 * see models.ts), so `costUSD` stays undefined until a defensible conversion
 * exists.
 */
function estimateStt(
  _params: SttTranscribeParams,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): ValidateEstimate {
  const declared = findMediaDeclaration(ctx.options.media, ["file"]);
  if (declared?.durationSeconds === undefined) return {};
  const costUSD = computeAudioMinutesCostUSD(info?.cost, declared.durationSeconds / 60);
  return costUSD === undefined ? {} : { costUSD };
}

// ---------------------------------------------------------------------------
// FormData helper — the raw-fetch body builder for this multipart endpoint.
// ---------------------------------------------------------------------------

/**
 * Builds the multipart body for POST /stt from validated params. Array
 * values are appended once per element under the bracketed wire name
 * (`timestamp_granularities[]`); numbers are stringified; unknown
 * passed-through keys ride along when they are string/number/boolean/Blob.
 * `encoding`/`sample_rate` are QUERY params of this endpoint (they ride on
 * `.request.url`), so they are never form fields.
 */
export function toFormData(params: SttTranscribeParams): FormData {
  const { file, timestamp_granularities, encoding, sample_rate, ...rest } = params;
  void encoding;
  void sample_rate;
  const form = new FormData();
  form.append("file", file as Blob | string);
  for (const granularity of timestamp_granularities ?? []) {
    form.append("timestamp_granularities[]", granularity);
  }
  for (const [key, value] of Object.entries(rest as Record<string, unknown>)) {
    if (value === undefined || value === null) continue;
    if (value instanceof Blob || typeof value === "string") form.append(key, value);
    else if (typeof value === "number" || typeof value === "boolean") {
      form.append(key, String(value));
    }
  }
  return form;
}

// ---------------------------------------------------------------------------
// Validator
// ---------------------------------------------------------------------------

/**
 * SDK targets for `cartesia.stt`. `@cartesia/cartesia-js` takes wire-shaped
 * params (it just passes the file as a separate positional argument), so the
 * single `"cartesia"` formatter is the identity. Type alias, not interface —
 * an interface cannot satisfy `SdkFormatters`.
 */
type SttSdkTargets<B> = { cartesia: () => B };

function finalize(
  params: SttTranscribeParams,
): Validated<SttTranscribeParams, SttSdkTargets<SttTranscribeParams>> {
  // Per the OpenAPI spec, `encoding` and `sample_rate` are QUERY params —
  // they go on the URL, not into the multipart form.
  const { encoding, sample_rate, ...formFields } = params;
  const query = new URLSearchParams();
  if (encoding !== undefined) query.set("encoding", encoding);
  if (sample_rate !== undefined) query.set("sample_rate", String(sample_rate));
  const queryString = query.toString();
  const body = { ...formFields } as SttTranscribeParams;
  // Multipart: no content-type header — fetch sets it (with the boundary)
  // from the FormData body. Only the required version header is static.
  return toValidated(
    body,
    {
      url: queryString === "" ? STT_TRANSCRIBE_URL : `${STT_TRANSCRIBE_URL}?${queryString}`,
      method: "POST",
      headers: { "Cartesia-Version": CARTESIA_VERSION },
    },
    { sdk: { cartesia: () => body } },
  );
}

const validator = createValidator<
  SttTranscribeParams,
  Validated<SttTranscribeParams, SttSdkTargets<SttTranscribeParams>>
>({
  endpoint: "cartesia.stt",
  schema,
  modelId: (params) => params.model,
  catalog: models,
  checks: [checkBatchModel, checkLanguage],
  estimate: estimateStt,
  finalize,
});

/**
 * Validates params for batch POST /stt (multipart). The result's enumerable
 * properties are the validated form fields — do not JSON.stringify them;
 * send `toFormData(validated)` as the fetch body instead. `.toSdk("cartesia")`
 * returns the params unchanged (note: `@cartesia/cartesia-js` passes the
 * file as a separate positional argument — re-shape at the call site if you
 * use the SDK). Auth is your job: add an `X-API-Key` header.
 *
 * ```ts
 * const params = cartesia.stt({ file, model: "ink-whisper" });
 * await fetch(params.request.url, {
 *   method: params.request.method,
 *   headers: { ...params.request.headers, "X-API-Key": process.env.CARTESIA_API_KEY! },
 *   body: toFormData(params),
 * });
 * ```
 */
export const stt = validator as unknown as {
  <T extends SttTranscribeParams>(
    params: T & ExactKeys<T, SttTranscribeParams>,
    options?: ValidateOptions,
  ): Validated<T, SttSdkTargets<T>>;
  safe<T extends SttTranscribeParams>(
    params: T & ExactKeys<T, SttTranscribeParams>,
    options?: ValidateOptions,
  ): ValidateResult<Validated<T, SttSdkTargets<T>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
