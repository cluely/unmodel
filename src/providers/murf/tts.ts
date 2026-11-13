/**
 * Murf AI Speech — POST https://api.murf.ai/v1/speech/generate  (`tts`)
 *                  POST https://api.murf.ai/v1/speech/stream    (`ttsStream`)
 *
 * Wire reference:
 * https://murf.ai/api/docs/api-reference/text-to-speech/generate and
 * https://murf.ai/api/docs/api-reference/text-to-speech/stream, and their
 * request schemas in https://murf.ai/api/docs/openapi.json
 * (verified 2026-11-12). Params mirror the wire bodies exactly (camelCase).
 *
 * - TWO MODEL SPELLINGS, ONE CATALOG: `/v1/speech/generate` selects the model
 *   with `modelVersion: "GEN2"` (upper-case, and GEN2 is its only documented
 *   value); `/v1/speech/stream` uses a lower-case `model` — `"falcon-2.1"`,
 *   or one of the earlier identifiers Murf still accepts for it
 *   (`falcon-2`, `falcon2`, `FALCON`). The catalog keys on the lower-case
 *   spelling, the generate validator lower-cases `modelVersion` for lookup,
 *   and the stream validator resolves `falcon2` / `FALCON` to the
 *   `falcon-2.1` row, so both routes price and gate against the same
 *   entries. Each route refuses the other's model with an
 *   `invalid_enum_value` error naming the route that serves it: Falcon on
 *   `/v1/speech/generate`, and `gen2` on `/v1/speech/stream`, where "The
 *   Gen2 model has been decommissioned for the Streaming API."
 * - CHARACTER CAP: "The API supports up to 3,000 characters per request."
 *   (https://murf.ai/api/docs/resources/faq). A breach is reported as `over_output_limit` — there is no
 *   character-specific issue code, so the message and meta
 *   ({ limitCharacters, actualCharacters }) spell out that the limit is in
 *   characters, not tokens.
 * - COMPANDED CODECS: "ULAW and ALAW formats only support mono channel type
 *   and a sample rate of 8000 Hz. If you specify a different channel type or
 *   sample rate, the API will default to the supported values." Both halves
 *   are therefore warnings: the request succeeds, at 8000 Hz / MONO.
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
  STREAM_MODEL_ALIASES,
  STREAM_MODEL_IDS,
  type MurfStreamModelId,
} from "./models";

export const SPEECH_GENERATE_URL = "https://api.murf.ai/v1/speech/generate";
export const SPEECH_STREAM_URL = "https://api.murf.ai/v1/speech/stream";
/** Falcon 2's global router, which "automatically routes traffic to the nearest server". */
export const SPEECH_STREAM_GLOBAL_URL = "https://global.api.murf.ai/v1/speech/stream";

const GENERATE_DOCS = "https://murf.ai/api/docs/api-reference/text-to-speech/generate";
const STREAM_DOCS = "https://murf.ai/api/docs/api-reference/text-to-speech/stream";
const CUSTOMIZATION_DOCS = "https://murf.ai/api/docs/text-to-speech/speech-customization";
const TTS_OVERVIEW_DOCS = "https://murf.ai/api/docs/text-to-speech/overview";
const FAQ_DOCS = "https://murf.ai/api/docs/resources/faq";
const GEN2_STREAM_DECOMMISSION_DOCS = "https://murf.ai/api/docs/changelog/2026/10/5";

/**
 * Server-side default of the streaming `model` field: "`model` (enum,
 * optional, default: falcon-2.1)" (stream reference, 2026-11-12).
 */
export const DEFAULT_STREAM_MODEL = "falcon-2.1";

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
 * endpoint adds 16000. Default 24000.
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
/**
 * `volumeOffset` on POST /v1/speech/stream: "Adjusts loudness relative to the
 * model's default output, from -50 to 50 … Values outside the range are
 * clamped to the nearest limit." Integer, default 0 (stream reference,
 * 2026-11-12).
 */
export const VOLUME_OFFSET_MIN = -50;
export const VOLUME_OFFSET_MAX = 50;
/**
 * "Falcon 2.1 voices speak in a single style, `Conversational`. If you send
 * `style` with Falcon 2.1, use `Conversational`." (speech customization,
 * 2026-11-12)
 */
export const FALCON_STYLE = "Conversational";
/** `PronunciationDetail.type` values — openapi.json `PronunciationDetailType` (2026-11-12). */
export const PRONUNCIATION_TYPES = ["IPA", "SAY_AS"] as const;
export type PronunciationDetailType = (typeof PRONUNCIATION_TYPES)[number];

// ---------------------------------------------------------------------------
// Wire types
// ---------------------------------------------------------------------------

/** One `pronunciationDictionary` value — openapi.json `PronunciationDetail`; both fields optional. */
export interface PronunciationDetail {
  type?: PronunciationDetailType;
  pronunciation?: string;
}

/** Fields both speech routes share. */
interface SpeechCommon {
  /**
   * "The text that is to be synthesised". Max 3,000 characters. Pause syntax
   * (`[pause 1s]`) is Gen2's: "custom pause tags … are Synthesize (Gen 2) only".
   */
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
  /** Language code, e.g. "en-US", "es-ES" — on both routes, for Falcon 2.1 and Gen2 alike. */
  locale?: string;
  /** "Custom pronunciations for words in `text`." */
  pronunciationDictionary?: Record<string, PronunciationDetail>;
}

export interface SpeechGenerateBody extends SpeechCommon {
  /** Hz; default 44100. */
  sampleRate?: MurfGenerateSampleRate;
  /** "A higher variation value results in a more dynamic voice output"; 0–5, default 1. Gen2 only. */
  variation?: number;
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
  /**
   * "Valid values: falcon-2.1" (the default). "The earlier identifiers
   * falcon-2, falcon2 and FALCON are still accepted and use Falcon 2.1."
   */
  model?: MurfStreamModelId | (string & {});
  /** Hz; default 24000. */
  sampleRate?: MurfStreamSampleRate;
  /**
   * "Adjusts loudness relative to the model's default output, from -50 to
   * 50." Integer, default 0; "Values outside the range are clamped to the
   * nearest limit."
   */
  volumeOffset?: number;
  /** @deprecated Superseded by `locale`. */
  multiNativeLocale?: string;
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
  pronunciationDictionary: z
    .record(
      z.string(),
      z.looseObject({
        type: z.enum(PRONUNCIATION_TYPES).optional(),
        pronunciation: z.string().optional(),
      }),
    )
    .optional(),
};

const generateSchema = z.looseObject({
  ...commonShape,
  // Closed list, not a range.
  sampleRate: z.literal(GENERATE_SAMPLE_RATES).optional(),
  variation: z.number().int().min(VARIATION_MIN).max(VARIATION_MAX).optional(),
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
  volumeOffset: z.number().int().optional(),
  multiNativeLocale: z.string().optional(),
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

/** Catalog id behind a `/v1/speech/stream` request: `falcon2` / `FALCON` resolve to `falcon-2.1`. */
function streamModelId(params: SpeechStreamBody): string {
  const model = params.model ?? DEFAULT_STREAM_MODEL;
  return STREAM_MODEL_ALIASES.get(model) ?? model;
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
 * 8000 Hz. If you specify a different channel type or sample rate, the API
 * will default to the supported values." (overview, 2026-11-12). The API
 * substitutes rather than refuses, so a mismatch is a warning naming the
 * value that is actually applied.
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
      severity: "warning",
      path: ["sampleRate"],
      model,
      message: `\`format\` ${JSON.stringify(format)} only supports a sample rate of ${COMPANDED_SAMPLE_RATE} Hz; got ${params.sampleRate}, so the API uses ${COMPANDED_SAMPLE_RATE} Hz instead.`,
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
      severity: "warning",
      path: ["channelType"],
      model,
      message: `\`format\` ${JSON.stringify(format)} only supports the ${COMPANDED_CHANNEL_TYPE} channel type; got ${JSON.stringify(params.channelType)}, so the API uses ${COMPANDED_CHANNEL_TYPE} instead.`,
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
    meta: { limitCharacters: limit, actualCharacters: actual, source: FAQ_DOCS },
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
      message: `\`modelVersion\` must be one of ${GENERATE_MODEL_VERSIONS.map((v) => JSON.stringify(v)).join(", ")}; got ${JSON.stringify(modelVersion)}. Falcon 2.1 is served by POST /v1/speech/stream via \`model: "falcon-2.1"\`, not by this endpoint.`,
      meta: {
        allowed: [...GENERATE_MODEL_VERSIONS],
        value: modelVersion,
        source: GENERATE_DOCS,
      },
    });
  }

  checkMultiNativeLocale(params, model, ctx, GENERATE_DOCS);
}

/**
 * "We have deprecated the `multiNativeLocale` field across all Text-to-Speech
 * (TTS) endpoints" (changelog 2026-03-05). Reported as `unsupported_param` at
 * warning severity: the field is documented as deprecated (not removed), and
 * `deprecated_model` is reserved for model ids, not params.
 */
function checkMultiNativeLocale(
  params: { multiNativeLocale?: string },
  model: string,
  ctx: PipelineContext,
  source: string,
): void {
  if (params.multiNativeLocale === undefined) return;
  ctx.report({
    code: "unsupported_param",
    severity: "warning",
    path: ["multiNativeLocale"],
    model,
    message: "`multiNativeLocale` is deprecated and superseded by `locale`; use `locale` instead.",
    meta: { replacement: "locale", source },
  });
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
  checkVolumeOffset(params, model, ctx);
  checkMultiNativeLocale(params, model, ctx, STREAM_DOCS);

  // One model-kind gate: `gen2` keeps its catalog row for
  // /v1/speech/generate, so here it would resolve and price at the Gen2 rate
  // for a model this route no longer serves — "The Gen2 model has been
  // decommissioned for the Streaming API." Any other id the catalog does not
  // know already draws the pipeline's `unknown_model` warning, the right
  // severity for a value that may simply be newer than this catalog.
  if (model === "gen2") {
    ctx.report({
      code: "invalid_enum_value",
      path: ["model"],
      model,
      message: `\`model\` "gen2" has been decommissioned on POST /v1/speech/stream, which serves ${STREAM_MODEL_IDS.map((v) => JSON.stringify(v)).join(", ")}. Gen2 remains available on POST /v1/speech/generate (\`murf.tts\` with \`modelVersion: "GEN2"\`).`,
      meta: {
        allowed: [...STREAM_MODEL_IDS],
        value: params.model,
        replacement: "murf.tts",
        source: GEN2_STREAM_DECOMMISSION_DOCS,
      },
    });
  }

  // Every Falcon stream id is Falcon 2.1 — `falcon-2`, `falcon2` and `FALCON`
  // "keep working and now use Falcon 2.1" (changelog 2026-10-19) — so the
  // Falcon 2.1 rules below key on the catalog family, not on one spelling.
  if (info?.family !== "falcon") return;

  // "If you send `style` with Falcon 2.1, use `Conversational`." No rejection
  // is documented, so another value is a warning, never an error.
  if (params.style !== undefined && params.style !== FALCON_STYLE) {
    ctx.report({
      code: "invalid_enum_value",
      severity: "warning",
      path: ["style"],
      model,
      message: `Falcon 2.1 voices speak in a single style, ${JSON.stringify(FALCON_STYLE)}; got ${JSON.stringify(params.style)}. Style control is a Gen2 feature of POST /v1/speech/generate.`,
      meta: { allowed: [FALCON_STYLE], value: params.style, source: CUSTOMIZATION_DOCS },
    });
  }
}

/**
 * "Values outside -50 to 50 aren't rejected. They're clamped to the nearest
 * limit, so `80` is applied as `50` and `-70` as `-50`." (speech
 * customization, 2026-11-12). A silent clamp is worth surfacing, but it must
 * not fail a request the API fulfils, so it is a warning.
 */
function checkVolumeOffset(params: SpeechStreamBody, model: string, ctx: PipelineContext): void {
  const value = params.volumeOffset;
  if (value === undefined || (value >= VOLUME_OFFSET_MIN && value <= VOLUME_OFFSET_MAX)) return;
  const applied = value < VOLUME_OFFSET_MIN ? VOLUME_OFFSET_MIN : VOLUME_OFFSET_MAX;
  ctx.report({
    code: "invalid_shape",
    severity: "warning",
    path: ["volumeOffset"],
    model,
    message: `\`volumeOffset\` is ${value}; Murf accepts ${VOLUME_OFFSET_MIN} to ${VOLUME_OFFSET_MAX} and clamps anything outside it without an error, so the request succeeds at ${applied} instead.`,
    meta: {
      min: VOLUME_OFFSET_MIN,
      max: VOLUME_OFFSET_MAX,
      value,
      applied,
      source: CUSTOMIZATION_DOCS,
    },
  });
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
 * and the only one that serves Falcon 2.1. The response is an audio stream, so
 * there is no response checker. `encodeAsBase64` is deliberately absent from
 * the params type: it is "Not available for Streaming API". So is
 * `variation`, which the Stream Speech schema does not declare: "variations
 * are Synthesize (Gen 2) only".
 *
 * ```ts
 * const params = murf.ttsStream({ text: "Hello", voiceId: "en-US-natalie", model: "falcon-2.1" });
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
