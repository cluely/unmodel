/**
 * Smallest AI Waves Text-to-Speech — POST https://api.smallest.ai/waves/v1/tts
 *
 * Wire reference:
 * https://docs.smallest.ai/models/api-reference/text-to-speech/synthesize-speech
 * (verified 2026-08-13), cross-checked against the Lightning v3.1 and
 * Lightning v3.1 Pro model cards. Params mirror the wire body exactly.
 *
 * ONE ROUTE, TWO POOLS: `/waves/v1/tts` is unified — `model` selects the pool
 * (`lightning_v3.1` by default, `lightning_v3.1_pro` for the premium
 * catalogue). Every other body field behaves identically across both.
 *
 * HEADERS: `Accept: audio/wav` is documented as REQUIRED ("Omitting it can
 * return an empty or unplayable response"), so it ships as a static header on
 * `.request.headers` — it is not a body field and is not yours to vary; the
 * container is chosen with `output_format`. `x-expire-content: "true"` is an
 * Enterprise-only opt-in to 7-day content deletion; it rides in the params
 * object as `x_expire_content` and is STRIPPED from the wire body onto
 * `.request.headers`, because sending it in the JSON body is a silent no-op.
 *
 * CHARACTER CAP: "Maximum chunk size is 250 characters (optimal throughput at
 * ~140 characters per request)". An over-long `text` is reported as
 * `over_output_limit` — unmodel has no character-specific issue code, so the
 * message and meta ({ limitCharacters, actualCharacters }) spell out that the
 * limit is in characters, not tokens.
 *
 * COST ESTIMATES ARE PRO-ONLY: Smallest publishes a per-character list price
 * for `lightning_v3.1_pro` only ("Pricing (Standard Plan): ~$0.195/10K
 * characters" on its model card). Nothing equivalent is published for the
 * standard `lightning_v3.1` pool — which is exactly what an omitted `model`
 * resolves to. So a request that leaves `model` out gets NO `costUSD`, and a
 * `maxCostUSD` budget has nothing to compare against and silently never fires.
 * To have the budget enforced, either pin `model: "lightning_v3.1_pro"` or
 * price the request yourself off `text.length`. See ./models.ts for the full
 * search trail behind the missing rate.
 *
 * VOICE/POOL PAIRING: the docs warn that "the API does not reject mismatched
 * pairings, but using a Pro-only `voice_id` with `model=lightning_v3.1` ...
 * can return wrong or hallucinated audio". unmodel cannot see which pool a
 * voice belongs to (the catalogue lives behind GET
 * /waves/v1/lightning-v3.1/get_voices), so this is documented, not validated.
 *
 * NOT VALIDATED HERE: the streaming routes POST/WS
 * https://api.smallest.ai/waves/v1/tts/live (SSE and WebSocket share one URL,
 * protocol-dispatched) and the voice-cloning API.
 *
 * `.toSdk("smallest-ai")` is the identity: the official `smallestai` Python SDK takes the
 * same snake_case keys, and Smallest publishes no first-party JS SDK. The
 * response is binary audio, so there is no response checker.
 */

import { z } from "zod";
import { createValidator, type PipelineContext } from "../../core/pipeline";
import { JSON_HEADERS, toValidated, type ExactKeys, type Validated } from "../../core/request";
import type { ValidateOptions } from "../../core/options";
import type { ValidateEstimate, ValidateResult } from "../../core/result";
import type { ModelInfo } from "../../core/catalog-types";
import type { EndpointConstraints } from "../../core/constraint-types";
import { computeCharacterCostUSD } from "../../core/cost";
import { models, type SmallestTtsModelId } from "./models";

export const TTS_URL = "https://api.smallest.ai/waves/v1/tts";
/** SSE + WebSocket streaming (same URL, protocol-dispatched). Not validated. */
export const TTS_LIVE_URL = "https://api.smallest.ai/waves/v1/tts/live";
export const TTS_LIVE_WS_URL = "wss://api.smallest.ai/waves/v1/tts/live";

/** Server default when `model` is omitted (OpenAPI `default: lightning_v3.1`). */
export const DEFAULT_MODEL_ID = "lightning_v3.1";

/** "Maximum chunk size is 250 characters" — both Lightning v3.1 model cards. */
export const MAX_CHARACTERS = 250;

/**
 * REQUIRED static `Accept` header — documented as an enum whose only allowed
 * value is `audio/wav`, and as required for a playable response.
 */
export const REQUIRED_ACCEPT = "audio/wav";

const SYNTHESIZE_DOCS =
  "https://docs.smallest.ai/models/api-reference/text-to-speech/synthesize-speech";
const V31_CARD_DOCS = "https://docs.smallest.ai/models/model-cards/text-to-speech/lightning-v-3-1";

// ---------------------------------------------------------------------------
// Wire types — mirror the raw JSON body exactly (snake_case).
// ---------------------------------------------------------------------------

/** "8000, 16000, 24000, or 44100 Hz"; default 44100. */
export const SAMPLE_RATES = [8000, 16000, 24000, 44100] as const;
export type SmallestSampleRate = (typeof SAMPLE_RATES)[number];

/** Default "pcm". `mp3`/`wav` are directly playable; `pcm` is lowest latency. */
export const OUTPUT_FORMATS = ["mp3", "pcm", "wav", "ulaw", "alaw"] as const;
export type SmallestOutputFormat = (typeof OUTPUT_FORMATS)[number];

/**
 * The `language` enum, verbatim from the endpoint reference. `auto` routes
 * across languages. `lightning_v3.1` accepts 20 of these codes (10 European +
 * 10 Indic); `lightning_v3.1_pro` accepts all 31 — see `PRO_ONLY_LANGUAGES`.
 */
export const LANGUAGES = [
  "auto",
  "en",
  "hi",
  "mr",
  "kn",
  "ta",
  "bn",
  "gu",
  "te",
  "ml",
  "pa",
  "or",
  "es",
  "de",
  "fr",
  "it",
  "nl",
  "sv",
  "pt",
  "ru",
  "el",
  "fi",
  "no",
  "pl",
  "ar",
  "zh",
  "id",
  "ja",
  "ko",
  "ms",
  "tr",
  "vi",
] as const;
export type SmallestLanguage = (typeof LANGUAGES)[number];

/**
 * The 11 codes the endpoint reference lists only under `lightning_v3.1_pro`
 * ("31 supported languages (adds 11 over base)"): Greek, Finnish, Norwegian
 * and the 8 Asian & Middle Eastern languages. The base pool's 20 codes are
 * everything else.
 */
export const PRO_ONLY_LANGUAGES = [
  "el",
  "fi",
  "no",
  "ar",
  "zh",
  "id",
  "ja",
  "ko",
  "ms",
  "tr",
  "vi",
] as const satisfies readonly SmallestLanguage[];

export interface TtsBody {
  /** Text to convert to speech; capped at 250 characters per request. */
  text: string;
  /** Voice identifier, e.g. "meher", "magnus". Cloned voices are `voice_*`. */
  voice_id: string;
  /** Pool selector; defaults to "lightning_v3.1" server-side. */
  model?: SmallestTtsModelId | (string & {});
  /** Output sample rate (Hz); default 44100. */
  sample_rate?: SmallestSampleRate;
  /** Speech rate multiplier, 0.5–2.0; default 1. */
  speed?: number;
  /** Synthesis language; on Pro, omitting it defaults to "en + hi". */
  language?: SmallestLanguage;
  /** Language used to read numeric content, independent of `language`. */
  number_pronunciation_language?: SmallestLanguage;
  /** Read digit-flanked math operators as words. Default false. */
  math_notation?: boolean;
  /** Audio container; default "pcm". */
  output_format?: SmallestOutputFormat;
  /** Pronunciation-dictionary ids applied to this request. */
  pronunciation_dicts?: string[];
  /**
   * "WebSocket-only feature. Accepted on this endpoint but ignored" — no
   * timing data comes back over HTTP.
   */
  word_timestamps?: boolean;
  /** Client correlation id; ≤128 chars of [A-Za-z0-9._-]. */
  session_id?: string;
  /** Client correlation id; ≤128 chars of [A-Za-z0-9._-]. */
  request_id?: string;
}

export interface TtsParams extends TtsBody {
  /**
   * HEADER param (Enterprise plans only) — stripped from the wire body onto
   * `.request.headers["x-expire-content"]`. Opts this request's content into
   * deletion after 7 days; omitting it retains content, which is the default.
   */
  x_expire_content?: true;
}

// ---------------------------------------------------------------------------
// Schema (loose: unknown keys pass through with a warning).
// ---------------------------------------------------------------------------

/** "Only alphanumeric characters, hyphens, underscores, and dots are allowed." */
const CORRELATION_ID = /^[A-Za-z0-9._-]+$/;

const correlationId = (field: string) =>
  z
    .string()
    .max(128, `${field} must be at most 128 characters.`)
    .regex(
      CORRELATION_ID,
      `${field} allows only alphanumeric characters, hyphens, underscores and dots.`,
    )
    .optional();

const schema = z.looseObject({
  text: z.string().min(1, "text must not be empty."),
  voice_id: z.string().min(1, "voice_id must not be empty."),
  model: z.string().optional(),
  sample_rate: z
    .union([z.literal(8000), z.literal(16000), z.literal(24000), z.literal(44100)])
    .optional(),
  speed: z.number().min(0.5).max(2).optional(),
  language: z.enum(LANGUAGES).optional(),
  number_pronunciation_language: z.enum(LANGUAGES).optional(),
  math_notation: z.boolean().optional(),
  output_format: z.enum(OUTPUT_FORMATS).optional(),
  pronunciation_dicts: z.array(z.string()).optional(),
  word_timestamps: z.boolean().optional(),
  session_id: correlationId("session_id"),
  request_id: correlationId("request_id"),
  x_expire_content: z.literal(true).optional(),
});

// ---------------------------------------------------------------------------
// Constraints — per-model gates the endpoint reference documents.
// ---------------------------------------------------------------------------

const wordTimestampsDeny = {
  word_timestamps: {
    reason:
      'it is a "WebSocket-only feature. Accepted on this endpoint but ignored" — no per-word timing is returned over HTTP; open wss://api.smallest.ai/waves/v1/tts/live to receive `word_timestamp` frames',
    source: SYNTHESIZE_DOCS,
    ignored: true,
  },
} as const;

export const speechConstraints: Readonly<Partial<Record<string, EndpointConstraints>>> = {
  "lightning_v3.1": { deny: wordTimestampsDeny },
  "lightning_v3.1_pro": { deny: wordTimestampsDeny },
};

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

const PRO_ONLY_LANGUAGE_SET = new Set<string>(PRO_ONLY_LANGUAGES);

/**
 * The documented 250-character `text` cap. It is documented per model, so the
 * catalog's `limit.characters` drives it, with the endpoint constant as the
 * fallback for models unknown to the catalog.
 */
function checkTextLength(
  params: TtsParams,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const limit = info?.limit.characters ?? MAX_CHARACTERS;
  if (limit <= 0) return;
  const actual = params.text.length;
  if (actual <= limit) return;
  ctx.report({
    code: "over_output_limit",
    path: ["text"],
    model: params.model ?? DEFAULT_MODEL_ID,
    message: `text is ${actual} characters, over the ${limit}-character maximum chunk size of the Waves TTS API (this limit is in characters, not tokens); split the input at a natural prosodic boundary — throughput is best at ~140 characters per request.`,
    meta: { limitCharacters: limit, actualCharacters: actual, source: V31_CARD_DOCS },
  });
}

/**
 * 11 of the 32 documented `language` codes exist only on the Pro pool. Sending
 * one with the standard pool is a silent quality failure, not an API error, so
 * it is worth naming.
 */
function checkLanguagePool(
  params: TtsParams,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (info === undefined) return;
  const model = params.model ?? DEFAULT_MODEL_ID;
  if (model !== "lightning_v3.1") return;
  for (const field of ["language", "number_pronunciation_language"] as const) {
    const value = params[field];
    if (value === undefined || !PRO_ONLY_LANGUAGE_SET.has(value)) continue;
    ctx.report({
      code: "invalid_enum_value",
      path: [field],
      model,
      message: `\`${field}\` ${JSON.stringify(value)} is only supported on "lightning_v3.1_pro"; "lightning_v3.1" accepts 20 codes (10 European + 10 Indic) plus "auto". Set \`model: "lightning_v3.1_pro"\`, or use "auto" to route with an English or Hindi voice.`,
      meta: {
        allowed: LANGUAGES.filter((code) => !PRO_ONLY_LANGUAGE_SET.has(code)),
        value,
        source: SYNTHESIZE_DOCS,
      },
    });
  }
}

// ---------------------------------------------------------------------------
// Estimation — billed per input character (catalog cost.perMillionCharacters).
//
// Only `lightning_v3.1_pro` carries a published rate, so this returns `{}` for
// the default pool and every unknown model id. `maxCostUSD` cannot fire on an
// absent estimate — see the COST ESTIMATES note in this file's header.
// ---------------------------------------------------------------------------

function estimate(
  params: TtsParams,
  info: ModelInfo | undefined,
  _ctx: PipelineContext,
): ValidateEstimate {
  const costUSD = computeCharacterCostUSD(info?.cost, params.text.length);
  return costUSD === undefined ? {} : { costUSD };
}

// ---------------------------------------------------------------------------
// Validator
// ---------------------------------------------------------------------------

/**
 * SDK targets for `smallest-ai.speech`. Smallest ships no official JS SDK (the
 * `smallestai` Python SDK takes the same snake_case keys), so the single
 * self-named `"smallest-ai"` target returns the wire body unchanged. Type
 * alias, not interface: an interface has no implicit index signature and
 * cannot satisfy `SdkFormatters`.
 */
type SpeechSdkTargets<B> = { "smallest-ai": () => B };

function finalize(params: TtsParams): unknown {
  const { x_expire_content, ...body } = params;
  return toValidated(
    body,
    {
      url: TTS_URL,
      method: "POST",
      headers: {
        ...JSON_HEADERS,
        accept: REQUIRED_ACCEPT,
        ...(x_expire_content === true && { "x-expire-content": "true" }),
      },
    },
    { sdk: { "smallest-ai": () => body } },
  );
}

const validator = createValidator<TtsParams, unknown>({
  endpoint: "smallest-ai.speech",
  schema,
  modelId: (params) => params.model ?? DEFAULT_MODEL_ID,
  catalog: models,
  constraints: speechConstraints,
  checks: [checkTextLength, checkLanguagePool],
  estimate,
  finalize,
});

/**
 * Validates raw wire params for `POST /waves/v1/tts`.
 *
 * The result's enumerable properties are the exact fetch JSON body —
 * `x_expire_content` is stripped and lives on `.request.headers` instead.
 * `.toSdk("smallest-ai")` returns the body unchanged (the `smallestai` Python SDK takes the
 * same snake_case keys) and `.request` carries url/method/static headers,
 * including the required `accept: audio/wav`. Auth is your job: add an
 * `authorization: Bearer …` header.
 *
 * ```ts
 * const params = smallest.speech({
 *   text: "Hello from Waves TTS.",
 *   voice_id: "meher",
 *   model: "lightning_v3.1_pro",
 *   sample_rate: 24000,
 *   output_format: "wav",
 * });
 * const res = await fetch(params.request.url, {
 *   method: params.request.method,
 *   headers: { ...params.request.headers, authorization: `Bearer ${process.env.SMALLEST_API_KEY!}` },
 *   body: JSON.stringify(params),
 * });
 * const audio = await res.arrayBuffer();
 * ```
 */
export const speech = validator as unknown as {
  <T extends TtsParams>(
    params: T & ExactKeys<T, TtsParams>,
    options?: ValidateOptions,
  ): Validated<Omit<T, "x_expire_content">, SpeechSdkTargets<Omit<T, "x_expire_content">>>;
  safe<T extends TtsParams>(
    params: T & ExactKeys<T, TtsParams>,
    options?: ValidateOptions,
  ): ValidateResult<
    Validated<Omit<T, "x_expire_content">, SpeechSdkTargets<Omit<T, "x_expire_content">>>
  >;
  constraintsFor(modelId: string): EndpointConstraints[];
};
