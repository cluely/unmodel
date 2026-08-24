/**
 * Murf AI Speech — POST https://api.murf.ai/v1/speech/generate  (`tts`)
 *                  POST https://api.murf.ai/v1/speech/stream    (`ttsStream`)
 *
 * Wire reference:
 * https://murf.ai/api/docs/api-reference/text-to-speech/generate and
 * https://murf.ai/api/docs/api-reference/text-to-speech/stream
 * (verified 2026-08-13). Params mirror the wire bodies exactly (camelCase).
 *
 * - TWO MODEL SPELLINGS, ONE CATALOG: `/v1/speech/generate` selects the model
 *   with `modelVersion: "GEN2"` (upper-case, and GEN2 is its only documented
 *   value); `/v1/speech/stream` uses `model: "falcon-2" | "gen2"`
 *   (lower-case). The catalog keys on the lower-case spelling and the
 *   generate validator lower-cases `modelVersion` for lookup, so both routes
 *   price and gate against the same entries. Asking `/v1/speech/generate`
 *   for Falcon 2 is an `invalid_enum_value` error pointing at the streaming
 *   endpoint.
 * - CHARACTER CAP: "The API supports up to 3,000 characters per request."
 *   A breach is reported as `over_output_limit` — there is no
 *   character-specific issue code, so the message and meta
 *   ({ limitCharacters, actualCharacters }) spell out that the limit is in
 *   characters, not tokens.
 * - COMPANDED CODECS: "ULAW and ALAW formats only support mono channel type
 *   and a sample rate of 8000 Hz." Both halves are enforced as errors.
 * - RESPONSE CHECKER, PER ROUTE — Murf has one, for exactly one of its two
 *   routes, so "murf has no checker" and "murf has a checker" are both wrong.
 *   `/v1/speech/generate` answers with JSON (`audioFile`,
 *   `audioLengthInSeconds`, `remainingCharacterCount`, `wordDurations`) and
 *   HAS one: `checkTts` in `./check`, exported from `unmodel/murf`.
 *   `/v1/speech/stream` answers with an audio stream — no JSON, so no
 *   checker. `MURF_TTS_DELIVERY` in ./tts-params is the machine-readable
 *   twin of that split, keyed by model because the routes are.
 * - REGIONAL ROUTERS: Falcon 2 also publishes a global router
 *   (`https://global.api.murf.ai/v1/speech/stream`) plus eleven regional
 *   hosts. `.request.url` targets the documented default host; swap the
 *   origin yourself if you route regionally.
 * - Auth is an `api-key` header — unmodel never touches keys; add it
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
import {
  models,
  MURF_MAX_CHARACTERS,
  GENERATE_MODEL_VERSIONS,
  type MurfTtsModelId,
} from "./models";

export const SPEECH_GENERATE_URL = "https://api.murf.ai/v1/speech/generate";
export const SPEECH_STREAM_URL = "https://api.murf.ai/v1/speech/stream";
/** Falcon 2's global router, which "automatically routes traffic to the nearest server". */
export const SPEECH_STREAM_GLOBAL_URL = "https://global.api.murf.ai/v1/speech/stream";

const GENERATE_DOCS = "https://murf.ai/api/docs/api-reference/text-to-speech/generate";
const STREAM_DOCS = "https://murf.ai/api/docs/api-reference/text-to-speech/stream";
const CUSTOMIZATION_DOCS = "https://murf.ai/api/docs/text-to-speech/speech-customization";
const TTS_OVERVIEW_DOCS = "https://murf.ai/api/docs/text-to-speech/overview";

/**
 * Server-side default of the streaming `model` field. The docs qualify it —
 * "Default is falcon-2 for all regions except US-East" — so on a US-East
 * host an omitted `model` resolves to gen2 instead, and the cost estimate
 * for an omitted `model` understates there. Pass `model` explicitly to
 * remove the ambiguity.
 */
export const DEFAULT_STREAM_MODEL = "falcon-2";

/** Server-side default of `modelVersion` on POST /v1/speech/generate. */
export const DEFAULT_MODEL_VERSION = "GEN2";

/** Documented `format` values; default "WAV". */
export const SPEECH_FORMATS = ["MP3", "WAV", "FLAC", "ALAW", "ULAW", "PCM", "OGG"] as const;
export type MurfFormat = (typeof SPEECH_FORMATS)[number];

/** Documented `channelType` values; default "MONO". */
export const CHANNEL_TYPES = ["STEREO", "MONO"] as const;
export type MurfChannelType = (typeof CHANNEL_TYPES)[number];

/** `sampleRate` values POST /v1/speech/generate accepts; default 44100. */
export const GENERATE_SAMPLE_RATES = [8000, 24000, 44100, 48000] as const;
export type MurfGenerateSampleRate = (typeof GENERATE_SAMPLE_RATES)[number];

/**
 * `sampleRate` values POST /v1/speech/stream accepts — the streaming
 * endpoint adds 16000. Default 24000 for Falcon 2, 44100 for Gen2.
 */
export const STREAM_SAMPLE_RATES = [8000, 16000, 24000, 44100, 48000] as const;
export type MurfStreamSampleRate = (typeof STREAM_SAMPLE_RATES)[number];

/** "ULAW and ALAW formats only support mono channel type and a sample rate of 8000 Hz." */
export const COMPANDED_FORMATS = ["ULAW", "ALAW"] as const;
export const COMPANDED_SAMPLE_RATE = 8000;
export const COMPANDED_CHANNEL_TYPE = "MONO";

/** "Any integer between -50 and 50" — `rate` and `pitch`. Default 0. */
export const RATE_MIN = -50;
export const RATE_MAX = 50;
export const PITCH_MIN = -50;
export const PITCH_MAX = 50;
/** "An integer between 0 and 5" — `variation`. Default 1. */
export const VARIATION_MIN = 0;
export const VARIATION_MAX = 5;

// ---------------------------------------------------------------------------
// Wire types
// ---------------------------------------------------------------------------

/** Fields both speech routes share. */
interface SpeechCommon {
  /** "The text that is to be synthesised"; supports pause syntax (`[pause 1s]`). Max 3,000 characters. */
  text: string;
  /** "Use the GET /v1/speech/voices API to find supported voiceIds" (e.g. "en-US-natalie"). */
  voiceId: string;
  /** Predefined voice style, e.g. "Angry", "Sad". */
  style?: string;
  /** Speed of the voiceover; "Any integer between -50 and 50". Default 0. */
  rate?: number;
  /** Pitch of the voiceover; "Any integer between -50 and 50". Default 0. */
  pitch?: number;
  /** Container/codec; default "WAV". */
  format?: MurfFormat;
  /** Default "MONO". */
  channelType?: MurfChannelType;
  /** Language code, e.g. "en-US", "es-ES". Gen2 only. */
  locale?: string;
  /** "A higher variation value results in a more dynamic voice output"; 0–5, default 1. Gen2 only. */
  variation?: number;
}

export interface SpeechGenerateBody extends SpeechCommon {
  /** Hz; default 44100. */
  sampleRate?: MurfGenerateSampleRate;
  /** "Set to true to receive audio in response as Base64 encoded string" (zero server retention). */
  encodeAsBase64?: boolean;
  /** Target length in seconds; 0 ignores it. "~150 words/1000 characters … around 60 seconds". Gen2 only. */
  audioDuration?: number;
  /** Only documented value: "GEN2" (the default). Falcon 2 lives on the streaming route. */
  modelVersion?: string;
  /** Return word durations against the original text. English only. Default false. */
  wordDurationsAsOriginalText?: boolean;
  /** @deprecated Superseded by `locale`. */
  multiNativeLocale?: string;
}

export interface SpeechStreamBody extends SpeechCommon {
  /** "falcon-2" (default outside US-East) or "gen2". */
  model?: MurfTtsModelId | (string & {});
  /** Hz; default 24000 for Falcon 2, 44100 for Gen2. */
  sampleRate?: MurfStreamSampleRate;
}

// ---------------------------------------------------------------------------
// Schemas (loose: unknown keys pass through with a warning).
// ---------------------------------------------------------------------------

const commonShape = {
  text: z.string().min(1, "text must not be empty."),
  voiceId: z.string().min(1, "voiceId must not be empty."),
  style: z.string().optional(),
  rate: z.number().int().min(RATE_MIN).max(RATE_MAX).optional(),
  pitch: z.number().int().min(PITCH_MIN).max(PITCH_MAX).optional(),
  format: z.string().optional(),
  channelType: z.string().optional(),
  locale: z.string().optional(),
  variation: z.number().int().min(VARIATION_MIN).max(VARIATION_MAX).optional(),
};

const generateSchema = z.looseObject({
  ...commonShape,
  // Closed list, not a range.
  sampleRate: z.literal(GENERATE_SAMPLE_RATES).optional(),
  encodeAsBase64: z.boolean().optional(),
  audioDuration: z.number().min(0).optional(),
  modelVersion: z.string().optional(),
  wordDurationsAsOriginalText: z.boolean().optional(),
  multiNativeLocale: z.string().optional(),
});

const streamSchema = z.looseObject({
  ...commonShape,
  model: z.string().optional(),
  sampleRate: z.literal(STREAM_SAMPLE_RATES).optional(),
});

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

const FORMAT_SET = new Set<string>(SPEECH_FORMATS);
const CHANNEL_TYPE_SET = new Set<string>(CHANNEL_TYPES);
const COMPANDED_FORMAT_SET = new Set<string>(COMPANDED_FORMATS);
const GENERATE_MODEL_VERSION_SET = new Set<string>(GENERATE_MODEL_VERSIONS);

/** Catalog id behind a `/v1/speech/generate` request (see module JSDoc). */
function generateModelId(params: SpeechGenerateBody): string {
  return (params.modelVersion ?? DEFAULT_MODEL_VERSION).toLowerCase();
}

function streamModelId(params: SpeechStreamBody): string {
  return params.model ?? DEFAULT_STREAM_MODEL;
}

function checkSharedEnums(
  params: SpeechCommon,
  model: string | undefined,
  ctx: PipelineContext,
  source: string,
): void {
  const { format, channelType } = params;
  if (format !== undefined && !FORMAT_SET.has(format)) {
    ctx.report({
      code: "invalid_enum_value",
      path: ["format"],
      model,
      message: `\`format\` must be one of ${SPEECH_FORMATS.map((v) => JSON.stringify(v)).join(", ")}; got ${JSON.stringify(format)}.`,
      meta: { allowed: [...SPEECH_FORMATS], value: format, source },
    });
  }
  if (channelType !== undefined && !CHANNEL_TYPE_SET.has(channelType)) {
    ctx.report({
      code: "invalid_enum_value",
      path: ["channelType"],
      model,
      message: `\`channelType\` must be one of ${CHANNEL_TYPES.map((v) => JSON.stringify(v)).join(", ")}; got ${JSON.stringify(channelType)}.`,
      meta: { allowed: [...CHANNEL_TYPES], value: channelType, source },
    });
  }
}

/**
 * "ULAW and ALAW formats only support mono channel type and a sample rate of
 * 8000 Hz." Both halves are hard requirements, so a mismatch is an error —
 * the API cannot fulfil the requested combination.
 */
function checkCompandedFormat(
  params: SpeechCommon & { sampleRate?: number },
  model: string | undefined,
  ctx: PipelineContext,
): void {
  const format = params.format;
  if (format === undefined || !COMPANDED_FORMAT_SET.has(format)) return;

  if (params.sampleRate !== undefined && params.sampleRate !== COMPANDED_SAMPLE_RATE) {
    ctx.report({
      code: "invalid_enum_value",
      path: ["sampleRate"],
      model,
      message: `\`format\` ${JSON.stringify(format)} only supports a sample rate of ${COMPANDED_SAMPLE_RATE} Hz; got ${params.sampleRate}.`,
      meta: {
        allowed: [COMPANDED_SAMPLE_RATE],
        value: params.sampleRate,
        format,
        source: TTS_OVERVIEW_DOCS,
      },
    });
  }
  if (params.channelType !== undefined && params.channelType !== COMPANDED_CHANNEL_TYPE) {
    ctx.report({
      code: "invalid_enum_value",
      path: ["channelType"],
      model,
      message: `\`format\` ${JSON.stringify(format)} only supports the ${COMPANDED_CHANNEL_TYPE} channel type; got ${JSON.stringify(params.channelType)}.`,
      meta: {
        allowed: [COMPANDED_CHANNEL_TYPE],
        value: params.channelType,
        format,
        source: TTS_OVERVIEW_DOCS,
      },
    });
  }
}

/**
 * Per-request character cap on `text`. Documented at the API level, so it
 * applies even when the model is unknown to the catalog.
 */
function checkCharacterLimit(
  params: SpeechCommon,
  info: ModelInfo | undefined,
  model: string | undefined,
  ctx: PipelineContext,
): void {
  const limit = info?.limit.characters ?? MURF_MAX_CHARACTERS;
  if (limit <= 0) return;
  const actual = params.text.length;
  if (actual <= limit) return;
  ctx.report({
    code: "over_output_limit",
    path: ["text"],
    model,
    message: `\`text\` is ${actual} characters; the Murf API "supports up to ${limit} characters per request" (this limit is in characters, not tokens). Split the input into multiple requests.`,
    meta: { limitCharacters: limit, actualCharacters: actual, source: TTS_OVERVIEW_DOCS },
  });
}

// --- /v1/speech/generate checks --------------------------------------------

function checkGenerate(
  params: SpeechGenerateBody,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const model = generateModelId(params);
  checkSharedEnums(params, model, ctx, GENERATE_DOCS);
  checkCompandedFormat(params, model, ctx);
  checkCharacterLimit(params, info, model, ctx);

  const modelVersion = params.modelVersion;
  if (modelVersion !== undefined && !GENERATE_MODEL_VERSION_SET.has(modelVersion)) {
    ctx.report({
      code: "invalid_enum_value",
      path: ["modelVersion"],
      model,
      message: `\`modelVersion\` must be one of ${GENERATE_MODEL_VERSIONS.map((v) => JSON.stringify(v)).join(", ")}; got ${JSON.stringify(modelVersion)}. Falcon 2 is served by POST /v1/speech/stream via \`model: "falcon-2"\`, not by this endpoint.`,
      meta: {
        allowed: [...GENERATE_MODEL_VERSIONS],
        value: modelVersion,
        source: GENERATE_DOCS,
      },
    });
  }

  // Reported as `unsupported_param` at warning severity: the field is
  // documented as deprecated (not removed), and `deprecated_model` is
  // reserved for model ids, not params.
  if (params.multiNativeLocale !== undefined) {
    ctx.report({
      code: "unsupported_param",
      severity: "warning",
      path: ["multiNativeLocale"],
      model,
      message: "`multiNativeLocale` is deprecated and superseded by `locale`; use `locale` instead.",
      meta: { replacement: "locale", source: GENERATE_DOCS },
    });
  }
}

// --- /v1/speech/stream checks ----------------------------------------------

function checkStream(
  params: SpeechStreamBody,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const model = streamModelId(params);
  checkSharedEnums(params, model, ctx, STREAM_DOCS);
  checkCompandedFormat(params, model, ctx);
  checkCharacterLimit(params, info, model, ctx);

  // No model-kind gate here: STREAM_MODEL_IDS is exactly the catalog, so an
  // id the catalog does not know already draws the pipeline's
  // `unknown_model` warning — the right severity for a value that may simply
  // be newer than this catalog. The live gate is on /v1/speech/generate,
  // whose `modelVersion` enum genuinely excludes Falcon 2.

  // "variation … (Gen2 only)" — Falcon 2 accepts the request and ignores it,
  // so the requested dynamism is silently not applied.
  if (params.variation !== undefined && model === "falcon-2") {
    ctx.report({
      code: "unsupported_param",
      severity: "warning",
      path: ["variation"],
      model,
      message:
        "`variation` is documented as Gen2 only; Falcon 2 accepts the request but the requested pause/pitch/speed variation is not applied.",
      meta: { ignored: true, source: CUSTOMIZATION_DOCS },
    });
  }
}

// ---------------------------------------------------------------------------
// Estimation — billed per input character (catalog cost.perMillionCharacters).
// ---------------------------------------------------------------------------

function estimate(
  params: SpeechCommon,
  info: ModelInfo | undefined,
  _ctx: PipelineContext,
): ValidateEstimate {
  const costUSD = computeCharacterCostUSD(info?.cost, params.text.length);
  return costUSD === undefined ? {} : { costUSD };
}

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

/**
 * SDK targets shared by both Murf speech endpoints. The official `murf`
 * Python/JS SDKs take wire-shaped params, so the single `"murf"` formatter is
 * the identity. No `"ai-sdk"` target: the AI SDK has no Murf speech provider,
 * and a target that emits params nothing accepts is worse than no target at
 * all. Type alias, not interface — an interface has no implicit index
 * signature and cannot satisfy `SdkFormatters`.
 */
type TtsSdkTargets<B> = { murf: () => B };

function finalizeFor(url: string) {
  return <B extends object>(params: B): Validated<B, TtsSdkTargets<B>> => {
    const body = { ...params };
    return toValidated(
      body,
      { url, method: "POST", headers: JSON_HEADERS },
      { sdk: { murf: () => body } },
    );
  };
}

const generateValidator = createValidator<
  SpeechGenerateBody,
  Validated<SpeechGenerateBody, TtsSdkTargets<SpeechGenerateBody>>
>({
  endpoint: "murf.tts",
  schema: generateSchema,
  modelId: generateModelId,
  catalog: models,
  checks: [checkGenerate],
  estimate,
  finalize: finalizeFor(SPEECH_GENERATE_URL),
});

const streamValidator = createValidator<
  SpeechStreamBody,
  Validated<SpeechStreamBody, TtsSdkTargets<SpeechStreamBody>>
>({
  endpoint: "murf.ttsStream",
  schema: streamSchema,
  modelId: streamModelId,
  catalog: models,
  checks: [checkStream],
  estimate,
  finalize: finalizeFor(SPEECH_STREAM_URL),
});

/**
 * Validates params for Murf `POST /v1/speech/generate` — the Gen2
 * studio-quality route, which answers with JSON (`audioFile`,
 * `audioLengthInSeconds`, `remainingCharacterCount`, `wordDurations`); pass
 * that response to `checkTts` from this module's `./check`.
 *
 * The result's enumerable properties are the exact fetch JSON body;
 * `.toSdk("murf")` returns it unchanged (the official `murf` Python/JS SDKs take
 * wire-shaped params) and `.request` carries the URL, method and
 * `content-type`. Auth is your job: add an `api-key` header.
 *
 * ```ts
 * const params = murf.tts({ text: "Hello world", voiceId: "en-US-natalie", format: "MP3" });
 * const res = await fetch(params.request.url, {
 *   method: params.request.method,
 *   headers: { ...params.request.headers, "api-key": process.env.MURF_API_KEY! },
 *   body: JSON.stringify(params),
 * });
 * ```
 */
export const tts = generateValidator as unknown as {
  <T extends SpeechGenerateBody>(
    params: T & ExactKeys<T, SpeechGenerateBody>,
    options?: ValidateOptions<T>,
  ): Validated<T, TtsSdkTargets<T>>;
  safe<T extends SpeechGenerateBody>(
    params: T & ExactKeys<T, SpeechGenerateBody>,
    options?: ValidateOptions<T>,
  ): ValidateResult<Validated<T, TtsSdkTargets<T>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};

/**
 * Validates params for Murf `POST /v1/speech/stream` — the low-latency route
 * and the only one that serves Falcon 2. The response is an audio stream, so
 * there is no response checker. `encodeAsBase64` is deliberately absent from
 * the params type: it is "Not available for Streaming API".
 *
 * ```ts
 * const params = murf.ttsStream({ text: "Hello", voiceId: "en-US-natalie", model: "falcon-2" });
 * const res = await fetch(params.request.url, {
 *   method: params.request.method,
 *   headers: { ...params.request.headers, "api-key": process.env.MURF_API_KEY! },
 *   body: JSON.stringify(params),
 * });
 * ```
 */
export const ttsStream = streamValidator as unknown as {
  <T extends SpeechStreamBody>(
    params: T & ExactKeys<T, SpeechStreamBody>,
    options?: ValidateOptions<T>,
  ): Validated<T, TtsSdkTargets<T>>;
  safe<T extends SpeechStreamBody>(
    params: T & ExactKeys<T, SpeechStreamBody>,
    options?: ValidateOptions<T>,
  ): ValidateResult<Validated<T, TtsSdkTargets<T>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
