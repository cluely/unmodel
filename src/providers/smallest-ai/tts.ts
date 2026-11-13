/**
 * Smallest AI Waves Text-to-Speech — POST https://api.smallest.ai/waves/v1/tts
 *
 * Wire reference:
 * https://docs.smallest.ai/api-reference/models/text-to-speech/synthesize-speech
 * (verified 2026-11-12), cross-checked against the Lightning v3.1 and
 * Lightning v3.1 Pro model cards. Params mirror the wire body exactly. Where
 * the cards and the reference disagree (the default model, the character cap,
 * voice/pool pairing), the reference wins: "Several API reference pages
 * described behaviour the API doesn't have. They now match it."
 * (https://docs.smallest.ai/changelog/models/2026/11/5).
 *
 * ONE ROUTE, TWO POOLS: `/waves/v1/tts` is unified — `model` selects the pool
 * (`lightning_v3.1`, `lightning_v3.1_pro` for the premium catalogue, or
 * `lightning_v3.1_pro_10_26` for the Pro pool's preview checkpoint). Every
 * other body field behaves identically across them: "Same concurrency and
 * latency profile across all three. Other request parameters behave
 * identically." (endpoint reference). `lightning_v3.1` retires on 2026-11-30
 * and is then served by `lightning_v3.1_pro` (./models.ts).
 *
 * NO DEFAULT POOL: "If you omit `model`, it's picked from the voice: Pro
 * catalog voices use `lightning_v3.1_pro`, all others `lightning_v3.1`."
 * (endpoint reference). unmodel cannot see which pool a voice belongs to, so
 * an omitted `model` resolves no catalog row: the per-pool checks do not run
 * and there is no cost estimate. Older pages still say the field "defaults to
 * standard Lightning v3.1"; the reference supersedes them.
 *
 * HEADERS: `x-expire-content: "true"` is an Enterprise-only opt-in to 7-day
 * content deletion; it rides in the params object as `x_expire_content` and is
 * STRIPPED from the wire body onto `.request.headers`, because sending it in
 * the JSON body is a silent no-op. No `Accept` header is sent: "Optional. The
 * server ignores it; `output_format` sets the audio format." (endpoint
 * reference).
 *
 * CHARACTER CAP: "Max 8000 characters after trim; whitespace-only strings are
 * rejected." (endpoint reference, sync and SSE). A longer `text` is reported
 * as `over_output_limit` — unmodel has no character-specific issue code, so
 * the message and meta ({ limitCharacters, actualCharacters }) spell out that
 * the limit is in characters, not tokens. Both model cards still give "Max
 * chunk size 250 characters" (optimal throughput at ~140 characters per
 * request); crossing that is a warning, never an error. The whitespace-only
 * half of the quote is not checked here: such a `text` passes the schema's
 * `min(1)` and draws the API's 400.
 *
 * COST: both pools publish a per-character rate (./models.ts). A request that
 * leaves `model` out gets NO `costUSD` — its pool, and so its rate, is picked
 * from the voice — and a `maxCostUSD` budget then has nothing to compare
 * against and silently never fires. Pin `model` to have the budget enforced.
 *
 * VOICE/POOL PAIRING: "Voice catalogs differ between `lightning_v3.1` and
 * `lightning_v3.1_pro`, and a mismatched pair returns `400`" (endpoint
 * reference). unmodel cannot see which pool a voice belongs to (each pool
 * lists its own voices, behind its own `get_voices` route), so this is
 * documented, not validated.
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
import {
  CONTENT_FILTER_ACTIONS,
  DATE_FORMATS,
  LANGUAGES,
  PRO_ONLY_LANGUAGES,
  models,
  type SmallestContentFilter,
  type SmallestDateFormat,
  type SmallestTtsModelId,
  type SmallestLanguage,
} from "./models";

// Declared in `./models` — an import-free leaf — so that `unmodel/smallest-ai/values`
// and the `*-params` table can read these without this validator, its zod schema
// and its catalog. Re-exported here so every existing caller is unchanged.
export { CONTENT_FILTER_ACTIONS, DATE_FORMATS, LANGUAGES, PRO_ONLY_LANGUAGES } from "./models";
export type {
  SmallestContentFilter,
  SmallestContentFilterAction,
  SmallestDateFormat,
  SmallestLanguage,
} from "./models";

export const TTS_URL = "https://api.smallest.ai/waves/v1/tts";
/** SSE + WebSocket streaming (same URL, protocol-dispatched). Not validated. */
export const TTS_LIVE_URL = "https://api.smallest.ai/waves/v1/tts/live";
export const TTS_LIVE_WS_URL = "wss://api.smallest.ai/waves/v1/tts/live";

/**
 * "Max 8000 characters after trim" — the endpoint reference. Every catalog row
 * carries it as `limit.characters`; this is the fallback when `model` is
 * omitted or uncatalogued.
 */
export const MAX_CHARACTERS = 8000;

/**
 * "Max chunk size 250 characters" — both model cards, beside "Optimal
 * throughput at ~140 characters per request". The reference does not enforce
 * it, so crossing it is a warning.
 */
const CHUNK_CHARACTERS = 250;

const SYNTHESIZE_DOCS =
  "https://docs.smallest.ai/api-reference/models/text-to-speech/synthesize-speech";
const V31_CARD_DOCS = "https://docs.smallest.ai/model-cards/text-to-speech/lightning-v-3-1";

// ---------------------------------------------------------------------------
// Wire types — mirror the raw JSON body exactly (snake_case).
// ---------------------------------------------------------------------------

/** "8000, 16000, 24000, or 44100 Hz"; default 44100. */
export const SAMPLE_RATES = [8000, 16000, 24000, 44100] as const;
export type SmallestSampleRate = (typeof SAMPLE_RATES)[number];

/** Default "pcm". `mp3`/`wav` are directly playable; `pcm` is lowest latency. */
export const OUTPUT_FORMATS = ["mp3", "pcm", "wav", "ulaw", "alaw"] as const;
export type SmallestOutputFormat = (typeof OUTPUT_FORMATS)[number];

export interface TtsBody {
  /** Text to convert to speech; at most 8000 characters after trim. */
  text: string;
  /** Voice identifier, e.g. "meher", "magnus". Cloned voices are `voice_*`. */
  voice_id: string;
  /**
   * Pool selector. Omitted, the pool is picked from the voice: Pro catalog
   * voices use "lightning_v3.1_pro", all others "lightning_v3.1".
   */
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
  /** How all-numeric dates (e.g. "05/03/2024") are read out. */
  date_format?: SmallestDateFormat;
  /** Content filter on `text`; off unless `enabled` is `true`. */
  content_filter?: SmallestContentFilter;
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
  date_format: z.enum(DATE_FORMATS).optional(),
  content_filter: z
    .looseObject({
      enabled: z.boolean().optional(),
      action: z.enum(CONTENT_FILTER_ACTIONS).optional(),
    })
    .optional(),
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

export const ttsConstraints: Readonly<Partial<Record<string, EndpointConstraints>>> = {
  "lightning_v3.1": { deny: wordTimestampsDeny },
  "lightning_v3.1_pro": { deny: wordTimestampsDeny },
  "lightning_v3.1_pro_10_26": { deny: wordTimestampsDeny },
};

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

const PRO_ONLY_LANGUAGE_SET = new Set<string>(PRO_ONLY_LANGUAGES);

/**
 * The `text` cap, measured the way the reference states it: "Max 8000
 * characters after trim". The catalog's `limit.characters` drives it, with the
 * endpoint constant as the fallback for an omitted or uncatalogued `model`.
 * The model cards' 250-character "Max chunk size" is a throughput figure the
 * reference does not enforce, so crossing it is a warning.
 */
function checkTextLength(
  params: TtsParams,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const limit = info?.limit.characters ?? MAX_CHARACTERS;
  const actual = params.text.trim().length;
  if (limit > 0 && actual > limit) {
    ctx.report({
      code: "over_output_limit",
      path: ["text"],
      model: params.model,
      message: `text is ${actual} characters after trim, over the ${limit}-character maximum of the Waves TTS API (this limit is in characters, not tokens); split the input at a natural prosodic boundary.`,
      meta: { limitCharacters: limit, actualCharacters: actual, source: SYNTHESIZE_DOCS },
    });
    return;
  }
  if (actual <= CHUNK_CHARACTERS) return;
  ctx.report({
    code: "over_output_limit",
    severity: "warning",
    path: ["text"],
    model: params.model,
    message: `text is ${actual} characters after trim. The API accepts up to ${limit}, but the Lightning v3.1 model cards give ${CHUNK_CHARACTERS} characters as the maximum chunk size, with throughput best at ~140 characters per request; split the input if latency matters.`,
    meta: {
      chunkCharacters: CHUNK_CHARACTERS,
      limitCharacters: limit,
      actualCharacters: actual,
      source: V31_CARD_DOCS,
    },
  });
}

/**
 * 11 of the 32 documented `language` codes are listed only for the Pro pool;
 * this names one sent to `lightning_v3.1` by name. A warning, not an error: the
 * reference says "On `lightning_v3.1` the model accepts 20 language codes (10
 * European + 10 Indic) plus `auto`" but documents no 400 for the other 11, and
 * from 2026-11-30 the id is served by Pro, which "accepts every `language`
 * code that `lightning_v3.1` accepts" — and these 11 besides
 * (https://docs.smallest.ai/api-reference/deprecations/models).
 * `number_pronunciation_language` is gated the same way, because with
 * `language` omitted it "also becomes the synthesis language". An omitted
 * `model` is never gated: its pool is picked from the voice.
 */
function checkLanguagePool(
  params: TtsParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (params.model !== "lightning_v3.1") return;
  for (const field of ["language", "number_pronunciation_language"] as const) {
    const value = params[field];
    if (value === undefined || !PRO_ONLY_LANGUAGE_SET.has(value)) continue;
    ctx.report({
      code: "invalid_enum_value",
      severity: "warning",
      path: [field],
      model: params.model,
      message: `\`${field}\` ${JSON.stringify(value)} is listed only for "lightning_v3.1_pro"; "lightning_v3.1" accepts 20 codes (10 European + 10 Indic) plus "auto". Set \`model: "lightning_v3.1_pro"\` — which serves every "lightning_v3.1" request from 2026-11-30 — or use "auto".`,
      meta: {
        allowed: LANGUAGES.filter((code) => !PRO_ONLY_LANGUAGE_SET.has(code)),
        value,
        source: SYNTHESIZE_DOCS,
      },
    });
  }
}

/**
 * `word_timestamps` with no `model`. The deny table is keyed by pool and an
 * omitted `model` resolves none, so the constraint layer does not run; the
 * rule holds on every pool, so it is reported here instead.
 */
function checkWordTimestampsWithoutModel(
  params: TtsParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (params.model !== undefined || params.word_timestamps == null) return;
  const rule = wordTimestampsDeny.word_timestamps;
  ctx.report({
    code: "unsupported_param",
    severity: "warning",
    path: ["word_timestamps"],
    message: `\`word_timestamps\` is silently ignored by the API on every Lightning pool: ${rule.reason}`,
    meta: { source: rule.source, ignored: true },
  });
}

// ---------------------------------------------------------------------------
// Estimation — billed per input character (catalog cost.perMillionCharacters).
//
// Returns `{}` for an omitted `model` (no row resolves: the pool, and so the
// rate, is picked from the voice) and for every uncatalogued id. `maxCostUSD`
// cannot fire on an absent estimate — see the COST note in this file's header.
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
 * SDK targets for `smallest-ai.tts`. Smallest ships no official JS SDK (the
 * `smallestai` Python SDK takes the same snake_case keys), so the single
 * self-named `"smallest-ai"` target returns the wire body unchanged. Type
 * alias, not interface: an interface has no implicit index signature and
 * cannot satisfy `SdkFormatters`.
 */
type TtsSdkTargets<B> = { "smallest-ai": () => B };

function finalize(params: TtsParams): unknown {
  const { x_expire_content, ...body } = params;
  return toValidated(
    body,
    {
      url: TTS_URL,
      method: "POST",
      headers: {
        ...JSON_HEADERS,
        ...(x_expire_content === true && { "x-expire-content": "true" }),
      },
    },
    { sdk: { "smallest-ai": () => body } },
  );
}

const validator = createValidator<TtsParams, unknown>({
  endpoint: "smallest-ai.tts",
  schema,
  modelId: (params) => params.model,
  catalog: models,
  constraints: ttsConstraints,
  checks: [checkTextLength, checkLanguagePool, checkWordTimestampsWithoutModel],
  estimate,
  finalize,
});

/**
 * Validates raw wire params for `POST /waves/v1/tts`.
 *
 * The result's enumerable properties are the exact fetch JSON body —
 * `x_expire_content` is stripped and lives on `.request.headers` instead.
 * `.toSdk("smallest-ai")` returns the body unchanged (the `smallestai` Python SDK takes the
 * same snake_case keys) and `.request` carries url/method/static headers.
 * Auth is your job: add an `authorization: Bearer …` header.
 *
 * ```ts
 * const params = smallest.tts({
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
export const tts = validator as unknown as {
  <T extends TtsParams>(
    params: T & ExactKeys<T, TtsParams>,
    options?: ValidateOptions<T>,
  ): Validated<Omit<T, "x_expire_content">, TtsSdkTargets<Omit<T, "x_expire_content">>>;
  safe<T extends TtsParams>(
    params: T & ExactKeys<T, TtsParams>,
    options?: ValidateOptions<T>,
  ): ValidateResult<
    Validated<Omit<T, "x_expire_content">, TtsSdkTargets<Omit<T, "x_expire_content">>>
  >;
  constraintsFor(modelId: string): EndpointConstraints[];
};
