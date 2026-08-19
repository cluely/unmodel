/**
 * Hume Octave Text-to-Speech — POST https://api.hume.ai/v0/tts
 *
 * Wire reference:
 * https://dev.hume.ai/reference/text-to-speech-tts/synthesize-json and
 * https://dev.hume.ai/docs/text-to-speech-tts/overview (both verified
 * 2026-08-13). Params mirror the wire body exactly (snake_case).
 *
 * NO `model` FIELD. Octave is selected with `version`, a string enum whose
 * documented values are `"1"` and `"2"` — not numbers. Omitting it lets Hume
 * "automatically route the request to the most appropriate model". unmodel
 * resolves an omitted `version` to the `octave` catalog row so the character
 * cap and cost still apply; both versions share one cap and one published
 * rate, so nothing depends on which model actually serves the request, and
 * this is deliberately NOT a claim about Hume's routing.
 *
 * CAPS ARE PER UTTERANCE, NOT PER REQUEST: "5,000 characters per Utterance"
 * for `text`, "1,000 characters per Utterance" for `description`. A request
 * may carry many utterances, so unmodel checks each one and reports the
 * offending index in the issue path. An over-long `text` is reported as
 * `over_output_limit` — there is no character-specific issue code, so the
 * message and meta ({ limitCharacters, actualCharacters }) spell out that the
 * limit is in characters, not tokens.
 *
 * DOCUMENTED REJECTIONS ENCODED HERE:
 * - `version: "2"` with no voice anywhere in `utterances` — "Requests that set
 *   `version: 2` without a voice will be rejected."
 * - `include_timestamp_types` on `version: "1"` — "Only supported for Octave 2
 *   requests"; the response documents timestamps as simply absent otherwise,
 *   so it is a warning, not an error.
 * - `instant_mode` on this route — "Instant mode is only supported for
 *   streaming endpoints"; a warning, since it does not fail the request.
 *
 * ROUTES: /v0/tts (this one, JSON with base64 audio), /v0/tts/file (audio
 * bytes) and the streaming routes /v0/tts/stream/json, /v0/tts/stream/file
 * all take the same body — only /v0/tts is finalized here. The bidirectional
 * WebSocket /v0/tts/stream/input is a different protocol and is not validated.
 *
 * `.toSdk("hume")` re-shapes the body for the `hume` TypeScript SDK's
 * `client.tts.synthesizeJson(...)`, which is camelCase (`numGenerations`,
 * `trailingSilence`, …). Auth is an `X-Hume-Api-Key` header — unmodel never
 * touches keys; add it yourself when fetching.
 */

import { z } from "zod";
import { createValidator, type PipelineContext } from "../../core/pipeline";
import { JSON_HEADERS, toValidated, type ExactKeys, type Validated } from "../../core/request";
import type { ValidateOptions } from "../../core/options";
import type { ValidateEstimate, ValidateResult } from "../../core/result";
import type { ModelInfo } from "../../core/catalog-types";
import type { EndpointConstraints } from "../../core/constraint-types";
import { computeCharacterCostUSD } from "../../core/cost";
import { models, type HumeTtsModelId } from "./models";

export const TTS_URL = "https://api.hume.ai/v0/tts";
/** Same body, downloadable audio file instead of JSON. Not what finalize targets. */
export const TTS_FILE_URL = "https://api.hume.ai/v0/tts/file";
/** Streaming variants — same body; these are the routes `instant_mode` applies to. */
export const TTS_STREAM_JSON_URL = "https://api.hume.ai/v0/tts/stream/json";
export const TTS_STREAM_FILE_URL = "https://api.hume.ai/v0/tts/stream/file";
/** Bidirectional WebSocket — different protocol, not validated by unmodel. */
export const TTS_STREAM_INPUT_URL = "wss://api.hume.ai/v0/tts/stream/input";

/** "Maximum text length: 5,000 characters per Utterance". */
export const MAX_TEXT_CHARACTERS = 5000;
/** "Maximum description length: 1,000 characters per Utterance". */
export const MAX_DESCRIPTION_CHARACTERS = 1000;
/** "Maximum generations per request: 5". */
export const MAX_GENERATIONS = 5;

const SYNTHESIZE_DOCS = "https://dev.hume.ai/reference/text-to-speech-tts/synthesize-json";
const OVERVIEW_DOCS = "https://dev.hume.ai/docs/text-to-speech-tts/overview";

// ---------------------------------------------------------------------------
// Wire types — mirror the raw JSON body exactly (snake_case).
// ---------------------------------------------------------------------------

export type HumeVoiceProvider = "HUME_AI" | "CUSTOM_VOICE";

/** A voice is referenced by `id` or by `name`, never both. */
export type HumeVoiceRef =
  | { id: string; provider?: HumeVoiceProvider }
  | { name: string; provider?: HumeVoiceProvider };

export interface HumeUtterance {
  /** The text to synthesize. Capped at 5,000 characters per utterance. */
  text: string;
  /**
   * Acting directions when a voice is set (keep to ~100 characters), or a
   * voice prompt when it is not. Capped at 1,000 characters.
   */
  description?: string | null;
  /** Speed multiplier, 0.5–2; default 1. Outside 0.75–1.5 "may cause instability". */
  speed?: number;
  /** Trailing silence in seconds, 0–5; default 0. */
  trailing_silence?: number;
  /** Applies to this and all subsequent utterances until set again. */
  voice?: HumeVoiceRef | null;
}

/** Context is either a prior generation id or a list of context utterances. */
export type HumeContext = { generation_id: string } | { utterances: HumeUtterance[] };

export type HumeAudioFormatType = "mp3" | "pcm" | "wav";
export interface HumeFormat {
  type: HumeAudioFormatType;
}

export type HumeTimestampType = "word" | "phoneme";

/** Documented values of the `version` enum — strings, not numbers. */
export const OCTAVE_VERSIONS = ["1", "2"] as const;
export type HumeOctaveVersion = (typeof OCTAVE_VERSIONS)[number];

export interface TtsBody {
  /** The utterances to convert to speech. */
  utterances: HumeUtterance[];
  /** Style/prosody context; these utterances are NOT synthesized or billed. */
  context?: HumeContext | null;
  /** Output audio format; default { type: "mp3" }. */
  format?: HumeFormat;
  /** Timestamp types to include. Octave 2 only; default []. */
  include_timestamp_types?: HumeTimestampType[];
  /** Number of generations, 1–5; default 1. */
  num_generations?: number;
  /** Split utterances into natural speech segments; default true. */
  split_utterances?: boolean;
  /** Concatenate chunks into a single audio file; default false. */
  strip_headers?: boolean;
  /** Experimental sampling temperature, 0.1–1. */
  temperature?: number | null;
  /** Octave version selector, "1" or "2". Omit to let Hume route. */
  version?: HumeOctaveVersion;
  /** Ultra-low-latency streaming; default true, streaming routes only. */
  instant_mode?: boolean;
}

// ---------------------------------------------------------------------------
// SDK view — the `hume` TS SDK's tts.synthesizeJson takes camelCase keys.
// ---------------------------------------------------------------------------

export interface TtsSdkUtterance {
  text: string;
  description?: string;
  speed?: number;
  trailingSilence?: number;
  voice?: HumeVoiceRef;
}

export interface TtsSdkParams {
  utterances: TtsSdkUtterance[];
  context?: { generationId: string } | { utterances: TtsSdkUtterance[] };
  format?: HumeFormat;
  includeTimestampTypes?: HumeTimestampType[];
  numGenerations?: number;
  splitUtterances?: boolean;
  stripHeaders?: boolean;
  temperature?: number;
  version?: HumeOctaveVersion;
  instantMode?: boolean;
}

// ---------------------------------------------------------------------------
// Schema (loose: unknown keys pass through with a warning).
// ---------------------------------------------------------------------------

const voiceSchema = z.union([
  z.looseObject({
    id: z.string().min(1, "voice.id must not be empty."),
    provider: z.enum(["HUME_AI", "CUSTOM_VOICE"]).optional(),
  }),
  z.looseObject({
    name: z.string().min(1, "voice.name must not be empty."),
    provider: z.enum(["HUME_AI", "CUSTOM_VOICE"]).optional(),
  }),
]);

const utteranceSchema = z.looseObject({
  text: z.string(),
  description: z
    .string()
    .max(
      MAX_DESCRIPTION_CHARACTERS,
      `description is capped at ${MAX_DESCRIPTION_CHARACTERS} characters per utterance.`,
    )
    .nullable()
    .optional(),
  speed: z.number().min(0.5).max(2).optional(),
  trailing_silence: z.number().min(0).max(5).optional(),
  voice: voiceSchema.nullable().optional(),
});

const schema = z.looseObject({
  utterances: z.array(utteranceSchema).min(1, "utterances must contain at least one utterance."),
  context: z
    .union([
      z.looseObject({ generation_id: z.string().min(1) }),
      z.looseObject({ utterances: z.array(utteranceSchema) }),
    ])
    .nullable()
    .optional(),
  format: z.looseObject({ type: z.enum(["mp3", "pcm", "wav"]) }).optional(),
  include_timestamp_types: z.array(z.enum(["word", "phoneme"])).optional(),
  num_generations: z.number().int().min(1).max(MAX_GENERATIONS).optional(),
  split_utterances: z.boolean().optional(),
  strip_headers: z.boolean().optional(),
  temperature: z.number().min(0.1).max(1).nullable().optional(),
  version: z.enum(OCTAVE_VERSIONS).optional(),
  instant_mode: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

/** Per-utterance `text` cap (catalog `limit.characters`, 5,000 by default). */
function checkUtteranceLengths(
  params: TtsBody,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const limit = info?.limit.characters ?? MAX_TEXT_CHARACTERS;
  if (limit <= 0) return;
  params.utterances.forEach((utterance, index) => {
    const actual = utterance.text.length;
    if (actual <= limit) return;
    ctx.report({
      code: "over_output_limit",
      path: ["utterances", index, "text"],
      model: params.version === "2" ? "octave-2" : "octave",
      message: `utterances[${index}].text is ${actual} characters, over Octave's ${limit}-character per-utterance limit (this limit is in characters, not tokens); split it into several utterances.`,
      meta: { limitCharacters: limit, actualCharacters: actual, source: OVERVIEW_DOCS },
    });
  });
}

/**
 * "When you specify version `2`, you must also provide a `voice`. Requests
 * that set `version: 2` without a voice will be rejected." A voice carries
 * forward to subsequent utterances, so this only fires when no utterance in
 * the request names one at all.
 */
function checkVersionTwoVoice(
  params: TtsBody,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (params.version !== "2") return;
  if (params.utterances.some((utterance) => utterance.voice != null)) return;
  ctx.report({
    code: "unsupported_capability",
    path: ["utterances", 0, "voice"],
    model: "octave-2",
    message:
      '`version: "2"` requires a voice — Octave 2 does not support dynamic voice generation, and a request that sets it without a `voice` on any utterance is rejected. Set `utterances[0].voice` to a `{ id }` or `{ name }`, or drop `version` to let Hume route the request.',
    meta: { source: SYNTHESIZE_DOCS },
  });
}

/** "Only supported for Octave 2 requests" — silently absent on version "1". */
function checkTimestampTypes(
  params: TtsBody,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const types = params.include_timestamp_types;
  if (types === undefined || types.length === 0) return;
  if (params.version !== "1") return;
  ctx.report({
    code: "unsupported_param",
    severity: "warning",
    path: ["include_timestamp_types"],
    model: "octave",
    message:
      '`include_timestamp_types` is only supported for Octave 2 requests; with `version: "1"` the response\'s `timestamps` arrays come back empty rather than erroring. Set `version: "2"` (which also requires a `voice`) to receive word or phoneme timestamps.',
    meta: { source: SYNTHESIZE_DOCS, ignored: true },
  });
}

/** "Instant mode is only supported for streaming endpoints." */
function checkInstantMode(
  params: TtsBody,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (params.instant_mode === undefined) return;
  ctx.report({
    code: "unsupported_param",
    severity: "warning",
    path: ["instant_mode"],
    message: `\`instant_mode\` is only supported for the streaming endpoints (${TTS_STREAM_JSON_URL}, ${TTS_STREAM_FILE_URL}); POST /v0/tts returns one complete JSON payload, so the flag has no effect here.`,
    meta: { source: SYNTHESIZE_DOCS, ignored: true },
  });
}

// ---------------------------------------------------------------------------
// Estimation
// ---------------------------------------------------------------------------

/**
 * Billed per character at the plan's published rate ($0.15 per 1,000
 * characters on Creator, stepping down to $0.05 on Business —
 * https://www.hume.ai/pricing; models.ts carries the highest of those as
 * `perMillionCharacters: 150`). `context` utterances are excluded from the
 * count — "These will not be converted to speech output".
 *
 * UNVERIFIED WORST CASE — the `num_generations` multiplier below is an
 * ASSUMPTION, not a sourced rate. Hume publishes no statement that a request
 * asking for N generations bills N times the input text: the pricing page, the
 * billing page (https://dev.hume.ai/docs/resources/billing), the TTS overview
 * and the /v0/tts reference were all checked on 2026-08-13, and the only thing
 * any of them says about the field is "Number of audio generations to produce
 * from the input utterances" (SYNTHESIZE_DOCS) — nothing about cost. The only
 * observable published billing unit is the character.
 *
 * It is kept because `estimate.costUSD` is specified as a worst-case ceiling
 * and `num_generations` maxes out at MAX_GENERATIONS (5): if Hume charges per
 * generated character, N generations genuinely cost N×; if it charges the
 * input text once per request, this over-estimates by up to 5×. So with
 * `num_generations > 1` treat the estimate as an upper bound whose floor is
 * `costUSD / num_generations`, and NOT as a claim about how Hume bills. Do not
 * narrow the multiplier without a published source to cite here.
 */
function estimate(
  params: TtsBody,
  info: ModelInfo | undefined,
  _ctx: PipelineContext,
): ValidateEstimate {
  const characters = params.utterances.reduce((sum, utterance) => sum + utterance.text.length, 0);
  const generations = params.num_generations ?? 1;
  // Worst-case ceiling only — per-generation billing is UNVERIFIED (see above).
  const costUSD = computeCharacterCostUSD(info?.cost, characters * generations);
  return costUSD === undefined ? {} : { costUSD };
}

// ---------------------------------------------------------------------------
// Finalize: wire body + .toSdk("hume") + .request
// ---------------------------------------------------------------------------

function toSdkUtterance(utterance: HumeUtterance): TtsSdkUtterance {
  const out: Record<string, unknown> = { text: utterance.text };
  if (utterance.description != null) out.description = utterance.description;
  if (utterance.speed != null) out.speed = utterance.speed;
  if (utterance.trailing_silence != null) out.trailingSilence = utterance.trailing_silence;
  if (utterance.voice != null) out.voice = utterance.voice;
  return out as unknown as TtsSdkUtterance;
}

function toSdkParams(body: TtsBody): TtsSdkParams {
  const out: Record<string, unknown> = { utterances: body.utterances.map(toSdkUtterance) };
  if (body.context != null) {
    out.context =
      "generation_id" in body.context
        ? { generationId: body.context.generation_id }
        : { utterances: body.context.utterances.map(toSdkUtterance) };
  }
  if (body.format !== undefined) out.format = body.format;
  if (body.include_timestamp_types !== undefined) {
    out.includeTimestampTypes = body.include_timestamp_types;
  }
  if (body.num_generations !== undefined) out.numGenerations = body.num_generations;
  if (body.split_utterances !== undefined) out.splitUtterances = body.split_utterances;
  if (body.strip_headers !== undefined) out.stripHeaders = body.strip_headers;
  if (body.temperature != null) out.temperature = body.temperature;
  if (body.version !== undefined) out.version = body.version;
  if (body.instant_mode !== undefined) out.instantMode = body.instant_mode;
  return out as unknown as TtsSdkParams;
}

/**
 * SDK targets for `hume.speech`. `"hume"` re-shapes the snake_case wire body into
 * the camelCase params the official `hume` TypeScript SDK's
 * `client.tts.synthesizeJson(...)` expects. Type alias, not interface: an
 * interface has no implicit index signature and cannot satisfy
 * `SdkFormatters`.
 */
type SpeechSdkTargets = { hume: () => TtsSdkParams };

function finalize(params: TtsBody): unknown {
  const body = { ...params };
  return toValidated(
    body,
    {
      url: TTS_URL,
      method: "POST",
      headers: JSON_HEADERS,
    },
    { sdk: { hume: () => toSdkParams(body) } },
  );
}

const validator = createValidator<TtsBody, unknown>({
  endpoint: "hume.speech",
  schema,
  // See the module JSDoc: an omitted `version` resolves to `octave` purely so
  // the (identical) cap and rate still apply.
  modelId: (params) => (params.version === "2" ? "octave-2" : "octave"),
  catalog: models,
  checks: [checkUtteranceLengths, checkVersionTwoVoice, checkTimestampTypes, checkInstantMode],
  estimate,
  finalize,
});

/**
 * Validates raw wire params for Hume `POST /v0/tts`.
 *
 * The result's enumerable properties are the exact fetch JSON body;
 * `.toSdk("hume")` returns the camelCase shape `client.tts.synthesizeJson(...)`
 * expects (explicit nulls dropped), and `.request` carries url/method/static
 * headers. Auth is your job: add an `X-Hume-Api-Key` header.
 *
 * COST: `estimate.costUSD` prices the `utterances` text (not `context`) at
 * Hume's highest published character rate, $0.15 per 1,000 characters
 * (https://www.hume.ai/pricing), and then multiplies by `num_generations`.
 * That multiplication is a deliberate worst-case ceiling, NOT a documented
 * rate: Hume publishes a per-character price and says nothing anywhere about
 * how `num_generations` (max 5) is billed. Assume the true cost lies between
 * `costUSD / num_generations` and `costUSD`; with the default
 * `num_generations: 1` the two coincide and the estimate is just the published
 * rate.
 *
 * ```ts
 * const params = hume.speech({
 *   utterances: [{ text: "Beauty is no quality in things themselves.", voice: { name: "Ito", provider: "HUME_AI" } }],
 *   format: { type: "mp3" },
 *   version: "2",
 * });
 * const res = await fetch(params.request.url, {
 *   method: params.request.method,
 *   headers: { ...params.request.headers, "X-Hume-Api-Key": process.env.HUME_API_KEY! },
 *   body: JSON.stringify(params),
 * });
 * const { generations } = await res.json();
 * ```
 */
export const speech = validator as unknown as {
  <T extends TtsBody>(
    params: T & ExactKeys<T, TtsBody>,
    options?: ValidateOptions,
  ): Validated<T, SpeechSdkTargets>;
  safe<T extends TtsBody>(
    params: T & ExactKeys<T, TtsBody>,
    options?: ValidateOptions,
  ): ValidateResult<Validated<T, SpeechSdkTargets>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
