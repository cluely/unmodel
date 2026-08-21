/**
 * LMNT Speech — POST https://api.lmnt.com/v1/ai/speech/bytes  (`tts`)
 *              POST https://api.lmnt.com/v1/ai/speech         (`ttsDetailed`)
 *
 * Wire reference: https://docs.lmnt.com/api/speech/generate and
 * https://docs.lmnt.com/api/speech/generate-detailed (verified 2026-08-13).
 * Params mirror the wire body exactly.
 *
 * - `/v1/ai/speech/bytes` is the endpoint LMNT recommends ("recommended for
 *   most text-to-speech use cases"); it returns a streaming binary response,
 *   so it has no response checker. `/v1/ai/speech` waits for the full
 *   generation and returns JSON — base64 `audio` plus optional word
 *   `timestamps` — and is the only one that accepts `return_timestamps`.
 * - REQUIRED VERSION HEADER: "When making API requests, you must send an
 *   `lmnt-version` request header." `.request.headers` carries
 *   `lmnt-version: 1.2`, the latest documented version; `1.0` and `1.1` are
 *   "considered deprecated and may be unavailable to new users".
 * - CHARACTER CAP: `text` is capped at "max 5000 characters per request
 *   (including spaces)". A breach is reported as `over_output_limit` — there
 *   is no character-specific issue code, so the message and meta
 *   ({ limitCharacters, actualCharacters }) spell out that the limit is in
 *   characters, not tokens.
 * - `temperature` and `top_p` publish illustrative values ("Lower values
 *   (like 0.3)…", "A higher value (like 0.9)…") but no hard bounds, so
 *   unmodel deliberately enforces none.
 * - `format` splits into streamable (mp3, ulaw, webm, pcm_s16le, pcm_f32le)
 *   and non-streamable (aac, wav) sets. Both are accepted on both endpoints;
 *   the distinction is latency only ("For non-streamable formats, all speech
 *   will be generated before encoding"), so it is documented, not enforced.
 * - Auth is an `X-API-Key` header — unmodel never touches keys; add it
 *   yourself when fetching.
 */

import { z } from "zod";
import { createValidator, type PipelineContext } from "../../core/pipeline";
import { JSON_HEADERS, toValidated, type ExactKeys, type Validated } from "../../core/request";
import type { ValidateOptions } from "../../core/options";
import type { ValidateEstimate, ValidateResult } from "../../core/result";
import type { ModelInfo } from "../../core/catalog-types";
import type { EndpointConstraints } from "../../core/constraint-types";
import { computeCharacterCostUSD } from "../../core/cost";
import { models, LMNT_MAX_CHARACTERS, type LmntTtsModelId } from "./models";

/** Streaming binary response — the endpoint LMNT recommends by default. */
export const SPEECH_BYTES_URL = "https://api.lmnt.com/v1/ai/speech/bytes";
/** Non-streaming JSON response: base64 audio + optional word timestamps. */
export const SPEECH_URL = "https://api.lmnt.com/v1/ai/speech";

/**
 * REQUIRED static `lmnt-version` header value — the latest documented
 * version (https://docs.lmnt.com/api/versioning, checked 2026-08-13).
 * Carried in `.request.headers`.
 */
export const LMNT_VERSION = "1.2";

const SPEECH_DOCS = "https://docs.lmnt.com/api/speech/generate";
const VERSIONING_DOCS = "https://docs.lmnt.com/api/versioning";

/**
 * Formats "encoded and returned as they're generated" on a streaming
 * endpoint.
 */
export const STREAMABLE_FORMATS = ["mp3", "ulaw", "webm", "pcm_s16le", "pcm_f32le"] as const;
/** Formats for which "all speech will be generated before encoding". */
export const NON_STREAMABLE_FORMATS = ["aac", "wav"] as const;

/** Every documented `format` value. Default "mp3". */
export const SPEECH_FORMATS = [...STREAMABLE_FORMATS, ...NON_STREAMABLE_FORMATS] as const;
export type LmntFormat = (typeof SPEECH_FORMATS)[number];

/**
 * "The desired output sample rate in Hz. Defaults to `24000` for all formats
 * except `mulaw` which defaults to `8000`."
 */
export const SPEECH_SAMPLE_RATES = [8000, 16000, 24000] as const;
export type LmntSampleRate = (typeof SPEECH_SAMPLE_RATES)[number];

/**
 * "The desired language. Two letter ISO 639-1 code." `auto` (the default)
 * selects automatic detection; the other 31 are LMNT's supported languages.
 */
export const SPEECH_LANGUAGES = [
  "auto",
  "ar",
  "as",
  "bn",
  "cs",
  "da",
  "de",
  "en",
  "es",
  "fi",
  "fr",
  "hi",
  "id",
  "it",
  "ja",
  "ko",
  "ml",
  "mr",
  "nl",
  "pl",
  "pt",
  "ru",
  "sk",
  "sv",
  "ta",
  "te",
  "th",
  "tr",
  "uk",
  "ur",
  "vi",
  "zh",
] as const;
export type LmntLanguage = (typeof SPEECH_LANGUAGES)[number];

// ---------------------------------------------------------------------------
// Wire types — mirror the request body exactly.
// ---------------------------------------------------------------------------

export interface SpeechBody {
  /** "The text to generate speech from; max 5000 characters per request (including spaces)." */
  text: string;
  /** "The voice id of the voice to use" — see the List voices endpoint. */
  voice: string;
  /** "The model to use for speech generation." Default "blizzard". */
  model?: LmntTtsModelId | (string & {});
  /** Container/codec; default "mp3". */
  format?: LmntFormat;
  /** Hz; default 24000 (8000 for `ulaw`). */
  sample_rate?: LmntSampleRate;
  /** ISO 639-1 code; default "auto" (automatic detection). */
  language?: LmntLanguage | (string & {});
  /**
   * "Influences how expressive and emotionally varied the speech becomes."
   * The docs give examples (0.3 neutral, 1.0 dynamic) but no hard bounds.
   */
  temperature?: number;
  /**
   * "Controls the stability of the generated speech." Examples 0.3 (stable)
   * to 0.9 (flexible); no hard bounds are documented.
   */
  top_p?: number;
  /** "the generated speech will also be saved to your clip library". Default false. */
  debug?: boolean;
}

/** `/v1/ai/speech` only — the streaming `bytes` endpoint has no JSON envelope. */
export interface SpeechDetailedBody extends SpeechBody {
  /** Return word-level `timestamps` alongside the base64 audio. Default false. */
  return_timestamps?: boolean;
}

// ---------------------------------------------------------------------------
// Schema (loose: unknown keys pass through with a warning).
// ---------------------------------------------------------------------------

const baseShape = {
  text: z.string().min(1, "text must not be empty."),
  voice: z.string().min(1, "voice must not be empty."),
  model: z.string().optional(),
  format: z.string().optional(),
  // Closed list, not a range.
  sample_rate: z.literal(SPEECH_SAMPLE_RATES).optional(),
  language: z.string().optional(),
  // No documented bounds — see module JSDoc.
  temperature: z.number().optional(),
  top_p: z.number().optional(),
  debug: z.boolean().optional(),
};

const ttsSchema = z.looseObject(baseShape);
const ttsDetailedSchema = z.looseObject({
  ...baseShape,
  return_timestamps: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// Checks (shared by both endpoints)
// ---------------------------------------------------------------------------

const FORMAT_SET = new Set<string>(SPEECH_FORMATS);
const LANGUAGE_SET = new Set<string>(SPEECH_LANGUAGES);

function checkEnums(params: SpeechBody, _info: ModelInfo | undefined, ctx: PipelineContext): void {
  const { format, language } = params;
  if (format !== undefined && !FORMAT_SET.has(format)) {
    ctx.report({
      code: "invalid_enum_value",
      path: ["format"],
      model: params.model,
      message: `\`format\` must be one of ${SPEECH_FORMATS.map((v) => JSON.stringify(v)).join(", ")}; got ${JSON.stringify(format)}.`,
      meta: { allowed: [...SPEECH_FORMATS], value: format, source: SPEECH_DOCS },
    });
  }
  if (language !== undefined && !LANGUAGE_SET.has(language)) {
    ctx.report({
      code: "invalid_enum_value",
      path: ["language"],
      model: params.model,
      message: `\`language\` must be "auto" or one of the ${SPEECH_LANGUAGES.length - 1} documented ISO 639-1 codes; got ${JSON.stringify(language)}.`,
      meta: { allowed: [...SPEECH_LANGUAGES], value: language, source: SPEECH_DOCS },
    });
  }
}

/**
 * Per-request character cap on `text` (catalog `limit.characters`). The cap
 * is documented at the endpoint level, so it applies even when `model` is
 * omitted or unknown to the catalog. Reported as `over_output_limit` — see
 * module JSDoc for the issue-code decision.
 */
function checkCharacterLimit(
  params: SpeechBody,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const limit = info?.limit.characters ?? LMNT_MAX_CHARACTERS;
  if (limit <= 0) return;
  const actual = params.text.length;
  if (actual <= limit) return;
  ctx.report({
    code: "over_output_limit",
    path: ["text"],
    model: params.model,
    message: `\`text\` is ${actual} characters; LMNT caps a single speech request at ${limit} characters (this limit is in characters, not tokens). Split the input into multiple requests.`,
    meta: { limitCharacters: limit, actualCharacters: actual, source: SPEECH_DOCS },
  });
}

/**
 * `blizzard` is the only documented `model` value and the only catalog
 * entry, so there is no separate model-kind gate: an id the catalog does not
 * know already draws the pipeline's `unknown_model` warning, which is the
 * right severity for a value that may simply be newer than this catalog.
 */
const CHECKS = [checkEnums, checkCharacterLimit];

// ---------------------------------------------------------------------------
// Estimation — billed per input character (catalog cost.perMillionCharacters).
// ---------------------------------------------------------------------------

function estimate(
  params: SpeechBody,
  info: ModelInfo | undefined,
  _ctx: PipelineContext,
): ValidateEstimate {
  const costUSD = computeCharacterCostUSD(info?.cost, params.text.length);
  return costUSD === undefined ? {} : { costUSD };
}

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

/** Static headers every LMNT request needs: JSON body + the version gate. */
const LMNT_HEADERS: Record<string, string> = Object.freeze({
  ...JSON_HEADERS,
  // Required — see VERSIONING_DOCS (referenced so the constant is traceable).
  "lmnt-version": LMNT_VERSION,
});

/**
 * SDK targets shared by both LMNT speech endpoints. `lmnt-node` takes
 * wire-shaped params, so the single `"lmnt"` formatter is the identity. Type
 * alias, not interface: an interface has no implicit index signature and
 * cannot satisfy `SdkFormatters`.
 */
type TtsSdkTargets<B> = { lmnt: () => B };

function finalizeFor(url: string) {
  return <B extends object>(params: B): Validated<B, TtsSdkTargets<B>> => {
    const body = { ...params };
    return toValidated(
      body,
      { url, method: "POST", headers: LMNT_HEADERS },
      { sdk: { lmnt: () => body } },
    );
  };
}

const ttsValidator = createValidator<SpeechBody, Validated<SpeechBody, TtsSdkTargets<SpeechBody>>>({
  endpoint: "lmnt.tts",
  schema: ttsSchema,
  modelId: (params) => params.model,
  catalog: models,
  checks: CHECKS,
  estimate,
  finalize: finalizeFor(SPEECH_BYTES_URL),
});

const ttsDetailedValidator = createValidator<
  SpeechDetailedBody,
  Validated<SpeechDetailedBody, TtsSdkTargets<SpeechDetailedBody>>
>({
  endpoint: "lmnt.ttsDetailed",
  schema: ttsDetailedSchema,
  modelId: (params) => params.model,
  catalog: models,
  checks: CHECKS,
  estimate,
  finalize: finalizeFor(SPEECH_URL),
});

/**
 * Validates params for LMNT `POST /v1/ai/speech/bytes` — the recommended
 * endpoint, which returns a streaming binary audio response.
 *
 * The result's enumerable properties are the exact fetch JSON body;
 * `.toSdk("lmnt")` returns it unchanged (`lmnt-node` takes wire-shaped params) and
 * `.request` carries the URL, method and the REQUIRED static `lmnt-version`
 * header. Auth is your job: add an `X-API-Key` header.
 *
 * ```ts
 * const params = lmnt.tts({ text: "Hello world", voice: "leah", format: "mp3" });
 * const res = await fetch(params.request.url, {
 *   method: params.request.method,
 *   headers: { ...params.request.headers, "X-API-Key": process.env.LMNT_API_KEY! },
 *   body: JSON.stringify(params),
 * });
 * const audio = await res.arrayBuffer();
 * ```
 */
export const tts = ttsValidator as unknown as {
  <T extends SpeechBody>(
    params: T & ExactKeys<T, SpeechBody>,
    options?: ValidateOptions<T>,
  ): Validated<T, TtsSdkTargets<T>>;
  safe<T extends SpeechBody>(
    params: T & ExactKeys<T, SpeechBody>,
    options?: ValidateOptions<T>,
  ): ValidateResult<Validated<T, TtsSdkTargets<T>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};

/**
 * Validates params for LMNT `POST /v1/ai/speech` — the non-streaming variant
 * that waits for the full generation and answers with JSON: base64 `audio`
 * plus, when `return_timestamps` is set, word-level `timestamps`
 * (`{ text, start, duration }`). The response carries no usage or billing
 * field, so there is no response checker.
 *
 * ```ts
 * const params = lmnt.ttsDetailed({ text: "Hello", voice: "leah", return_timestamps: true });
 * const res = await fetch(params.request.url, {
 *   method: params.request.method,
 *   headers: { ...params.request.headers, "X-API-Key": process.env.LMNT_API_KEY! },
 *   body: JSON.stringify(params),
 * });
 * const { audio, timestamps } = await res.json();
 * ```
 */
export const ttsDetailed = ttsDetailedValidator as unknown as {
  <T extends SpeechDetailedBody>(
    params: T & ExactKeys<T, SpeechDetailedBody>,
    options?: ValidateOptions<T>,
  ): Validated<T, TtsSdkTargets<T>>;
  safe<T extends SpeechDetailedBody>(
    params: T & ExactKeys<T, SpeechDetailedBody>,
    options?: ValidateOptions<T>,
  ): ValidateResult<Validated<T, TtsSdkTargets<T>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};

export { VERSIONING_DOCS as LMNT_VERSIONING_DOCS };
