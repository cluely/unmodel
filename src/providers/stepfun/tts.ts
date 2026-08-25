/**
 * StepFun text to speech — POST https://api.stepfun.ai/v1/audio/speech
 *
 * Wire reference:
 * https://platform.stepfun.ai/docs/en/api-reference/audio/create-audio.md
 * (verified 2026-08-24), cross-checked against the model card
 * https://platform.stepfun.ai/docs/en/guides/models/stepaudio-2.5-tts.md.
 * Params mirror the wire body exactly.
 *
 * TWO DOMAINS: the international platform documents this route on
 * `api.stepfun.ai` (with a `/step_plan/v1/audio/speech` twin for Step Plan
 * subscribers), while the generated chat catalog's OpenAI-compatible base is
 * `api.stepfun.com` (the models.dev value). This module ships the documented
 * international URL; Step Plan callers swap the path via their own fetch.
 *
 * ONE MODEL: the reference is explicit — "Currently supports
 * `stepaudio-2.5-tts`". The generated catalog also carries `step-tts-2`
 * (2026-03-01), which is off that enum; sending it gets an
 * `invalid_enum_value` warning rather than a silent pass. The SSE/WebSocket
 * streaming routes (`stream_format: "sse"` frames on this URL, and
 * wss://api.stepfun.ai/v1/realtime/audio) and the ASR routes
 * (POST /v1/audio/asr/sse — SSE-only, no batch variant) are not validated by
 * unmodel.
 *
 * CHARACTER CAPS: `input` "Maximum length is 1,000 characters" and
 * `instruction` (global steering prose) caps at 200 — the input cap is
 * reported as `over_output_limit` (unmodel has no character-specific issue
 * code; message and meta spell out characters, not tokens), the instruction
 * cap by the zod schema.
 *
 * VOICES: `voice` "supports both official voices and custom cloned voices" —
 * both are bare strings, so the field is never enum-checked; the seven
 * documented system ids are published as `SYSTEM_VOICES` (./tts-params) for
 * pickers.
 *
 * NO PRICE: no USD rate is published on the reachable English doc pages, so
 * there is no `cost` row and no `costUSD` estimate — see ./audio-models.ts.
 *
 * `.toSdk("stepfun")` is the identity: StepFun documents raw REST (its
 * examples drive the OpenAI SDK for chat only), so the body is already the
 * only shape there is. The default response is binary audio — with
 * `return_url: true` it becomes JSON `{ created, data: { url } }` whose URL
 * lives 12 hours — so there is no response checker.
 */

import { z } from "zod";
import { createValidator, type PipelineContext } from "../../core/pipeline";
import { JSON_HEADERS, toValidated, type ExactKeys, type Validated } from "../../core/request";
import type { ValidateOptions } from "../../core/options";
import type { ValidateEstimate, ValidateResult } from "../../core/result";
import type { ModelInfo } from "../../core/catalog-types";
import type { EndpointConstraints } from "../../core/constraint-types";
import { computeCharacterCostUSD } from "../../core/cost";
import { speechModels, SPEECH_MAX_INPUT_CHARACTERS, type StepfunTtsModelId } from "./audio-models";
import { CREATE_SPEECH_DOCS, MODELS, SAMPLE_RATES } from "./tts-params";

export { SYSTEM_VOICES, SAMPLE_RATES } from "./tts-params";
export { SPEECH_MAX_INPUT_CHARACTERS } from "./audio-models";
export type { StepfunTtsModelId } from "./audio-models";

export const AUDIO_SPEECH_URL = "https://api.stepfun.ai/v1/audio/speech";
/** The Step Plan twin of the same route. Not the default. */
export const STEP_PLAN_AUDIO_SPEECH_URL = "https://api.stepfun.ai/step_plan/v1/audio/speech";
/** Realtime streaming TTS (WebSocket). Not validated by unmodel. */
export const REALTIME_AUDIO_WS_URL =
  "wss://api.stepfun.ai/v1/realtime/audio?model=stepaudio-2.5-tts";

/** "Maximum length: 200 characters" — the `instruction` cap. */
export const MAX_INSTRUCTION_CHARACTERS = 200;

// ---------------------------------------------------------------------------
// Wire types — mirror the raw JSON body exactly (snake_case).
// ---------------------------------------------------------------------------

/** `response_format` — default "mp3". `pcm` is the bare stream, `wav` adds the header. */
export const RESPONSE_FORMATS = ["mp3", "wav", "flac", "opus", "pcm"] as const;
export type StepfunResponseFormat = (typeof RESPONSE_FORMATS)[number];

/** `sample_rate` (Hz) — default 24000. */
export type StepfunSampleRate = (typeof SAMPLE_RATES)[number];

/**
 * One `pronunciation_map` rule. The reference documents a single required
 * field, `tone`: "pronunciation mapping rules, separated by `/`" (its example
 * maps "LOL" to being read as "laugh out loudly").
 */
export interface StepfunPronunciationRule {
  tone: string;
}

export interface TtsBody {
  /** The reference's enum is currently the single id "stepaudio-2.5-tts". */
  model: StepfunTtsModelId | (string & {});
  /** Text to synthesize; capped at 1,000 characters per request. Parenthesized spans are read as delivery instructions, not spoken. */
  input: string;
  /** System voice id (see SYSTEM_VOICES) or a cloned voice id. */
  voice: string;
  /** Output codec/container; default "mp3". */
  response_format?: StepfunResponseFormat;
  /** Speech rate multiplier, 0.5–2.0; default 1.0. */
  speed?: number;
  /** Loudness multiplier, 0.1–2.0; default 1.0. */
  volume?: number;
  /** Global natural-language delivery guidance; capped at 200 characters. */
  instruction?: string;
  /** Output sample rate (Hz); default 24000. */
  sample_rate?: StepfunSampleRate;
  /** Per-request pronunciation overrides. */
  pronunciation_map?: readonly StepfunPronunciationRule[];
  /** "audio" (default, binary body) or "sse" (speech.audio.* event frames). */
  stream_format?: "audio" | "sse";
  /** Strip Markdown markup from `input` before synthesis. */
  markdown_filter?: boolean;
  /** Return JSON `{ created, data: { url } }` (12-hour URL) instead of bytes. */
  return_url?: boolean;
}

// ---------------------------------------------------------------------------
// Schema (loose: unknown keys pass through with a warning).
// ---------------------------------------------------------------------------

const schema = z.looseObject({
  model: z.string(),
  input: z.string().min(1, "input must not be empty."),
  voice: z.string().min(1, "voice must not be empty."),
  response_format: z.enum(RESPONSE_FORMATS).optional(),
  speed: z
    .number()
    .min(0.5, "speed must be between 0.5 and 2.0")
    .max(2, "speed must be between 0.5 and 2.0")
    .optional(),
  volume: z
    .number()
    .min(0.1, "volume must be between 0.1 and 2.0")
    .max(2, "volume must be between 0.1 and 2.0")
    .optional(),
  instruction: z
    .string()
    .max(
      MAX_INSTRUCTION_CHARACTERS,
      `instruction is capped at ${MAX_INSTRUCTION_CHARACTERS} characters.`,
    )
    .optional(),
  sample_rate: z
    .union([
      z.literal(8000),
      z.literal(16000),
      z.literal(22050),
      z.literal(24000),
      z.literal(48000),
    ])
    .optional(),
  pronunciation_map: z.array(z.looseObject({ tone: z.string() })).optional(),
  stream_format: z.enum(["audio", "sse"]).optional(),
  markdown_filter: z.boolean().optional(),
  return_url: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

const DOCUMENTED_MODEL_ID_SET = new Set<string>(MODELS);

/**
 * The reference's model enum is the single id `stepaudio-2.5-tts`. Anything
 * else — including the catalog's own `step-tts-2` — is off-enum and may be
 * refused, so it warns rather than passing silently (same policy as
 * cartesia's TTS_MODEL_IDS).
 */
function checkModelId(params: TtsBody, _info: ModelInfo | undefined, ctx: PipelineContext): void {
  if (DOCUMENTED_MODEL_ID_SET.has(params.model)) return;
  ctx.report({
    code: "invalid_enum_value",
    severity: "warning",
    path: ["model"],
    model: params.model,
    message: `"${params.model}" is off the create-speech reference's model enum — it says "Currently supports ${MODELS.map((id) => `\`${id}\``).join(", ")}" — and may be refused.`,
    meta: { allowed: [...MODELS], value: params.model, source: CREATE_SPEECH_DOCS },
  });
}

/**
 * "Maximum length is 1,000 characters." Documented on the endpoint, so the
 * catalog's `limit.characters` drives it with the endpoint constant as the
 * fallback for ids the catalog does not know.
 */
function checkInputLength(
  params: TtsBody,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const limit = info?.limit.characters ?? SPEECH_MAX_INPUT_CHARACTERS;
  if (limit <= 0 || typeof params.input !== "string") return;
  const actual = params.input.length;
  if (actual <= limit) return;
  ctx.report({
    code: "over_output_limit",
    path: ["input"],
    model: params.model,
    message: `\`input\` is ${actual} characters; POST /v1/audio/speech caps a single request at ${limit} characters (this limit is in characters, not tokens).`,
    meta: { limitCharacters: limit, actualCharacters: actual, source: CREATE_SPEECH_DOCS },
  });
}

// ---------------------------------------------------------------------------
// Estimation — no USD rate is published for StepFun speech, so this returns
// `{}` today; `computeCharacterCostUSD` picks a rate up automatically if one
// ever lands on the catalog row.
// ---------------------------------------------------------------------------

function estimate(
  params: TtsBody,
  info: ModelInfo | undefined,
  _ctx: PipelineContext,
): ValidateEstimate {
  if (typeof params.input !== "string") return {};
  const costUSD = computeCharacterCostUSD(info?.cost, params.input.length);
  return costUSD === undefined ? {} : { costUSD };
}

// ---------------------------------------------------------------------------
// Validator
// ---------------------------------------------------------------------------

/**
 * SDK targets for `stepfun.tts`. StepFun documents raw REST for speech (no
 * first-party JS SDK), so the single self-named target returns the wire body
 * unchanged. Type alias, not interface: an interface has no implicit index
 * signature and cannot satisfy `SdkFormatters`.
 */
type TtsSdkTargets<B> = { stepfun: () => B };

function finalize(params: TtsBody): unknown {
  const body = { ...params };
  return toValidated(
    body,
    { url: AUDIO_SPEECH_URL, method: "POST", headers: JSON_HEADERS },
    { sdk: { stepfun: () => body } },
  );
}

const validator = createValidator<TtsBody, unknown>({
  endpoint: "stepfun.tts",
  schema,
  modelId: (params) => params.model,
  catalog: speechModels,
  constraints: {},
  checks: [checkModelId, checkInputLength],
  estimate,
  finalize,
});

/**
 * Validates raw wire params for `POST /v1/audio/speech`.
 *
 * The result's enumerable properties are the exact fetch JSON body;
 * `.request` carries url/method/static headers. Auth is your job: add an
 * `authorization: Bearer …` header when fetching.
 *
 * ```ts
 * const params = stepfun.tts({
 *   model: "stepaudio-2.5-tts",
 *   input: "Hello from StepAudio.",
 *   voice: "vibrant-youth",
 *   response_format: "wav",
 *   sample_rate: 24000,
 * });
 * const audio = await fetch(params.request.url, {
 *   method: params.request.method,
 *   headers: { ...params.request.headers, authorization: `Bearer ${process.env.STEPFUN_API_KEY!}` },
 *   body: JSON.stringify(params),
 * }).then((r) => r.arrayBuffer());
 * ```
 */
export const tts = validator as unknown as {
  <T extends TtsBody>(
    params: T & ExactKeys<T, TtsBody>,
    options?: ValidateOptions<T>,
  ): Validated<T, TtsSdkTargets<T>>;
  safe<T extends TtsBody>(
    params: T & ExactKeys<T, TtsBody>,
    options?: ValidateOptions<T>,
  ): ValidateResult<Validated<T, TtsSdkTargets<T>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
