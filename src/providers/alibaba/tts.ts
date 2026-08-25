/**
 * Qwen TTS (Alibaba Cloud Model Studio, international) —
 * POST {base}/api/v1/services/aigc/multimodal-generation/generation
 *
 * Wire reference: https://www.alibabacloud.com/help/en/model-studio/qwen-tts
 * and https://www.alibabacloud.com/help/en/model-studio/qwen-tts-api
 * (verified 2026-08-24). Params mirror the wire body exactly:
 * `{ model, input: { text, voice, language_type?, instructions?,
 * optimize_instructions? }, stream? }`.
 *
 * BASE URL: the qwen-tts page still documents the legacy international domain
 * `https://dashscope-intl.aliyuncs.com` for this route (TTS_URL); the model
 * list also publishes workspace-scoped hosts
 * (`https://{WorkspaceId}.ap-southeast-1.maas.aliyuncs.com/api/v1/...`), so
 * `ttsUrl(baseUrl)` builds the same path on any base, and `reroute()` from
 * `unmodel` re-targets a validated request.
 *
 * RESPONSE: non-streaming answers JSON with `output.audio.url` — a WAV file
 * URL valid for 24 hours (24 kHz, 16-bit, mono). With `stream: true` the
 * response is SSE (add `X-DashScope-SSE: enable`, which finalize sets for
 * you) carrying Base64 PCM chunks in `output.audio.data`. There is no request
 * field for the audio format — the output encoding is fixed.
 *
 * REALTIME IS A DIFFERENT API: `qwen3-tts-flash-realtime`,
 * `qwen3-tts-instruct-flash-realtime`, `qwen-audio-3.0-tts-plus` and
 * `qwen-audio-3.0-tts-flash` are WebSocket-only
 * (REALTIME_TTS_WSS_URL) and this validator rejects them — they are
 * catalogued in ./models.ts (`realtimeTtsModels`) so budgets and pickers can
 * see them, mirroring the ElevenLabs realtime precedent.
 *
 * BEIJING-ONLY IDS: `qwen-tts`, `qwen-tts-latest` and the dated `qwen-tts-*`
 * snapshots exist only on the China (Beijing) deployment and bill per token;
 * they are not catalogued here (see ./models.ts).
 *
 * VOICES: the voice list page closes the `voice` enum per model family —
 * 48 voices on Qwen3-TTS-Flash (17 of them on the 2025-09-18 snapshot), 24 on
 * Qwen3-TTS-Instruct-Flash — including multi-word values ("Eldric Sage",
 * "Ono Anna", "Radio Gol") sent verbatim. checkVoice refuses off-list values
 * per model; refresh the lists from qwen-tts-voice-list when they grow.
 *
 * Auth is `Authorization: Bearer <DASHSCOPE_API_KEY>` — unmodel never touches
 * keys; add the header yourself when fetching.
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
  realtimeTtsModels,
  ttsModels,
  TTS_MODEL_IDS,
  REALTIME_TTS_MODEL_IDS,
  TTS_MAX_CHARACTERS,
  INSTRUCT_TTS_MODEL_ID_SET,
  LANGUAGE_TYPES,
  VOICES_BY_MODEL,
  type AlibabaLanguageType,
  type AlibabaTtsGenerationModelId,
} from "./models";

// Declared in `./models` — an import-free leaf — so that
// `unmodel/alibaba/values` and the `tts-params` table can read these without
// this validator, its zod schema and its catalog. Re-exported here so wire
// callers find them beside the validator.
export { LANGUAGE_TYPES } from "./models";
export type { AlibabaLanguageType } from "./models";

const TTS_DOCS = "https://www.alibabacloud.com/help/en/model-studio/qwen-tts";

/** Legacy international domain — see the BASE URL note above. */
export const DEFAULT_BASE_URL = "https://dashscope-intl.aliyuncs.com";

/** Route path shared by the multimodal-generation models. */
export const TTS_PATH = "/api/v1/services/aigc/multimodal-generation/generation";

/** POST target on the default (legacy intl) base. */
export const TTS_URL = `${DEFAULT_BASE_URL}${TTS_PATH}`;

/** POST target for a caller-chosen base (workspace-scoped host, region, …). */
export function ttsUrl(baseUrl: string = DEFAULT_BASE_URL): string {
  return `${baseUrl.replace(/\/$/, "")}${TTS_PATH}`;
}

/**
 * The realtime WebSocket route on the legacy intl domain (NOT validated by
 * unmodel; workspace-scoped hosts expose
 * `wss://{WorkspaceId}.{region}.maas.aliyuncs.com/api-ws/v1/inference`).
 */
export const REALTIME_TTS_WSS_URL = "wss://dashscope-intl.aliyuncs.com/api-ws/v1/realtime";

/** "Maximum length: 1,600 tokens" — `input.instructions` (Instruct-Flash). */
export const INSTRUCTIONS_MAX_TOKENS = 1600;

// ---------------------------------------------------------------------------
// Wire types — mirror the raw JSON body exactly (snake_case).
// ---------------------------------------------------------------------------

export interface AlibabaTtsInput {
  /** Text to synthesize; ≤600 characters on the Qwen3-TTS models. */
  text: string;
  /** Voice name, from the model's own list (e.g. "Cherry", "Eldric Sage"). */
  voice: string;
  /**
   * Synthesis language; default "Auto". "We recommend matching this with the
   * language of the text."
   */
  language_type?: AlibabaLanguageType | (string & {});
  /**
   * Style/emotion instruction; Qwen3-TTS-Instruct-Flash models only.
   * ≤1,600 tokens, Chinese and English only.
   */
  instructions?: string;
  /** LLM-optimize `instructions` first; Instruct-Flash only. Default false. */
  optimize_instructions?: boolean;
}

export interface TtsGenerationParams {
  /** Model id. Required. */
  model: AlibabaTtsGenerationModelId | (string & {});
  input: AlibabaTtsInput;
  /**
   * SSE streaming: chunks of Base64 PCM in `output.audio.data`. finalize
   * adds the required `X-DashScope-SSE: enable` header when true.
   */
  stream?: boolean;
}

// ---------------------------------------------------------------------------
// Schema (loose: unknown keys pass through with a warning).
// ---------------------------------------------------------------------------

const ttsSchema = z.looseObject({
  model: z.string().min(1, "model is required"),
  input: z.looseObject({
    text: z.string().min(1, "input.text must not be empty."),
    voice: z.string().min(1, "input.voice must not be empty."),
    language_type: z.string().optional(),
    instructions: z.string().optional(),
    optimize_instructions: z.boolean().optional(),
  }),
  stream: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

const TTS_MODEL_ID_SET = new Set<string>(TTS_MODEL_IDS);
const REALTIME_TTS_MODEL_ID_SET = new Set<string>(REALTIME_TTS_MODEL_IDS);
const LANGUAGE_TYPE_SET = new Set<string>(LANGUAGE_TYPES);

function checkModelEnum(
  params: TtsGenerationParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (TTS_MODEL_ID_SET.has(params.model)) return;
  if (REALTIME_TTS_MODEL_ID_SET.has(params.model)) {
    ctx.report({
      code: "invalid_enum_value",
      path: ["model"],
      model: params.model,
      message: `"${params.model}" is a realtime (WebSocket-only) TTS model — POST ${TTS_PATH} cannot serve it. Open ${REALTIME_TTS_WSS_URL} instead, or pick one of ${TTS_MODEL_IDS.map((v) => JSON.stringify(v)).join(", ")}.`,
      meta: { allowed: [...TTS_MODEL_IDS], value: params.model, source: TTS_DOCS },
    });
    return;
  }
  ctx.report({
    code: "invalid_enum_value",
    path: ["model"],
    model: params.model,
    message: `\`model\` must be one of ${TTS_MODEL_IDS.map((v) => JSON.stringify(v)).join(", ")}; got ${JSON.stringify(params.model)} (the qwen-tts* ids are Beijing-only and not served internationally).`,
    meta: { allowed: [...TTS_MODEL_IDS], value: params.model, source: TTS_DOCS },
  });
}

/** The documented 600-character `input.text` cap (catalog `limit.characters`). */
function checkTextLength(
  params: TtsGenerationParams,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const limit = info?.limit.characters ?? TTS_MAX_CHARACTERS;
  if (limit <= 0) return;
  const actual = params.input?.text?.length ?? 0;
  if (actual <= limit) return;
  ctx.report({
    code: "over_output_limit",
    path: ["input", "text"],
    model: params.model,
    message: `\`input.text\` is ${actual} characters, over the ${limit}-character maximum the Qwen3-TTS models document (this limit is in characters, not tokens); split the text and stitch the audio.`,
    meta: { limitCharacters: limit, actualCharacters: actual, source: TTS_DOCS },
  });
}

function checkLanguageType(
  params: TtsGenerationParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const value = params.input?.language_type;
  if (value === undefined || LANGUAGE_TYPE_SET.has(value)) return;
  ctx.report({
    code: "invalid_enum_value",
    path: ["input", "language_type"],
    model: params.model,
    message: `\`input.language_type\` must be one of ${LANGUAGE_TYPES.map((v) => JSON.stringify(v)).join(", ")}; got ${JSON.stringify(value)}. Note the values are English words ("Chinese"), not BCP-47 tags.`,
    meta: { allowed: [...LANGUAGE_TYPES], value, source: TTS_DOCS },
  });
}

/** Voice names are a closed, per-model list on this API. */
function checkVoice(
  params: TtsGenerationParams,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (info === undefined) return; // unknown model: list unknown too
  const voices = VOICES_BY_MODEL[params.model];
  if (voices === undefined) return;
  const voice = params.input?.voice;
  if (voice === undefined || (voices as readonly string[]).includes(voice)) return;
  ctx.report({
    code: "invalid_enum_value",
    path: ["input", "voice"],
    model: params.model,
    message: `\`input.voice\` ${JSON.stringify(voice)} is not in the ${voices.length}-voice list "${params.model}" documents (transcribed 2026-08-24). Voice values are sent verbatim, including multi-word names like "Eldric Sage".`,
    meta: {
      allowed: [...voices],
      value: voice,
      source: "https://www.alibabacloud.com/help/en/model-studio/qwen-tts-voice-list",
    },
  });
}

/** `instructions` / `optimize_instructions` are Instruct-Flash-only fields. */
function checkInstructions(
  params: TtsGenerationParams,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (info === undefined) return;
  if (INSTRUCT_TTS_MODEL_ID_SET.has(params.model)) return;
  for (const field of ["instructions", "optimize_instructions"] as const) {
    if (params.input?.[field] === undefined) continue;
    ctx.report({
      code: "unsupported_param",
      path: ["input", field],
      model: params.model,
      message: `\`input.${field}\` applies only to the Qwen3-TTS-Instruct-Flash models; "${params.model}" does not accept it.`,
      meta: { source: TTS_DOCS },
    });
  }
}

// ---------------------------------------------------------------------------
// Estimation — billed per input character (catalog cost.perMillionCharacters);
// output audio is free.
// ---------------------------------------------------------------------------

function estimate(
  params: TtsGenerationParams,
  info: ModelInfo | undefined,
  _ctx: PipelineContext,
): ValidateEstimate {
  const costUSD = computeCharacterCostUSD(info?.cost, params.input?.text?.length ?? 0);
  return costUSD === undefined ? {} : { costUSD };
}

// ---------------------------------------------------------------------------
// Validator
// ---------------------------------------------------------------------------

/**
 * Type alias, not interface: an interface has no implicit index signature and
 * cannot satisfy `SdkFormatters`. Alibaba ships no official JS SDK for
 * DashScope, so the self-named target returns the wire body unchanged.
 */
type AlibabaSdkTargets<B> = { alibaba: () => B };

function finalize(params: TtsGenerationParams): unknown {
  const body = { ...params };
  return toValidated(
    body,
    {
      url: TTS_URL,
      method: "POST",
      headers: {
        ...JSON_HEADERS,
        // SSE is how a streamed response arrives; the header is required with
        // `stream: true` and harmless to omit otherwise.
        ...(params.stream === true && { "x-dashscope-sse": "enable" }),
      },
    },
    { sdk: { alibaba: () => body } },
  );
}

const validator = createValidator<TtsGenerationParams, unknown>({
  endpoint: "alibaba.tts",
  schema: ttsSchema,
  modelId: (params) => params.model,
  // The realtime rows are in the catalog so a rejected realtime id draws the
  // targeted enum error alone, not an unknown_model warning beside it.
  catalog: { ...ttsModels, ...realtimeTtsModels },
  checks: [checkModelEnum, checkTextLength, checkLanguageType, checkVoice, checkInstructions],
  estimate,
  finalize,
});

/**
 * Validates raw wire params for DashScope
 * `POST /api/v1/services/aigc/multimodal-generation/generation` — the Qwen3
 * TTS models on the international platform.
 *
 * The result's enumerable properties are the exact fetch JSON body;
 * `.toSdk("alibaba")` returns it unchanged. Non-streaming responses carry a
 * 24-hour WAV URL at `output.audio.url`; `stream: true` switches to SSE
 * Base64-PCM chunks and finalize adds the required `x-dashscope-sse: enable`
 * header. Auth is your job: add `authorization: Bearer <DASHSCOPE_API_KEY>`.
 *
 * Cost is the model's published per-character rate (qwen3-tts-flash $0.10 per
 * 10K characters) times `input.text.length`.
 *
 * ```ts
 * const params = alibaba.tts({
 *   model: "qwen3-tts-flash",
 *   input: { text: "Hello from Model Studio.", voice: "Cherry", language_type: "English" },
 * });
 * const res = await fetch(params.request.url, {
 *   method: params.request.method,
 *   headers: {
 *     ...params.request.headers,
 *     authorization: `Bearer ${process.env.DASHSCOPE_API_KEY}`,
 *   },
 *   body: JSON.stringify(params),
 * });
 * const { output } = await res.json(); // output.audio.url — WAV, 24h validity
 * ```
 */
export const tts = validator as unknown as {
  <T extends TtsGenerationParams>(
    params: T & ExactKeys<T, TtsGenerationParams>,
    options?: ValidateOptions<T>,
  ): Validated<T, AlibabaSdkTargets<T>>;
  safe<T extends TtsGenerationParams>(
    params: T & ExactKeys<T, TtsGenerationParams>,
    options?: ValidateOptions<T>,
  ): ValidateResult<Validated<T, AlibabaSdkTargets<T>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
