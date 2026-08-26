/**
 * OpenAI text to speech — POST https://api.openai.com/v1/audio/speech
 *
 * Wire notes (audited 2026-08-13 against
 * https://developers.openai.com/api/docs/api-reference/audio/createSpeech and
 * https://developers.openai.com/api/docs/guides/text-to-speech, with the
 * OpenAPI-generated openai@7.4.0 `resources/audio/speech.d.ts` as a
 * cross-check):
 * - JSON in, raw audio bytes (or an SSE stream) out — there is no response
 *   checker for speech.
 * - `voice` takes a documented built-in voice name OR a custom voice object
 *   `{ id: "voice_1234" }`. The built-in list is per-model (tts-1 and
 *   tts-1-hd support 9 of the 13), so string voices are validated by
 *   checkVoice below rather than by the constraint enum layer — an object
 *   value must not be enum-checked.
 * - `input` is capped at 4096 characters endpoint-wide; the cap rides the
 *   hand catalog as `limit.characters` and is reported as `over_output_limit`
 *   (there is no character-specific issue code — same convention as the other
 *   TTS providers). Because it is an endpoint cap, an unknown model id falls
 *   back to the same 4096 rather than escaping the check.
 * - Auth is an `authorization: Bearer <key>` header — unmodel never touches
 *   keys; add it yourself when fetching.
 */

import { z } from "zod";
import { createValidator, type PipelineContext } from "../../core/pipeline";
import { toValidated, JSON_HEADERS, type Validated, type ExactKeys } from "../../core/request";
import type { ValidateOptions } from "../../core/options";
import type { ValidateEstimate, ValidateResult } from "../../core/result";
import type { FutureModelId, ModelInfo } from "../../core/catalog-types";
import type { EndpointConstraints } from "../../core/constraint-types";
import { computeCharacterCostUSD } from "../../core/cost";
import { speechModels, SPEECH_MAX_INPUT_CHARACTERS } from "./audio-models";
import {
  ttsConstraints,
  SPEECH_RESPONSE_FORMATS,
  SPEECH_VOICES,
  TTS_1_VOICES,
} from "./constraints";

export const AUDIO_SPEECH_URL = "https://api.openai.com/v1/audio/speech";

const SPEECH_DOCS = "https://developers.openai.com/api/docs/api-reference/audio/createSpeech";
const TTS_GUIDE_DOCS = "https://developers.openai.com/api/docs/guides/text-to-speech";

/** Every built-in voice name the endpoint documents. */
export type SpeechVoice = (typeof SPEECH_VOICES)[number];
/** The subset tts-1 / tts-1-hd support. */
export type Tts1Voice = (typeof TTS_1_VOICES)[number];
export type SpeechResponseFormat = (typeof SPEECH_RESPONSE_FORMATS)[number];

/** Custom voice reference — "you may also provide a custom voice object". */
export interface SpeechCustomVoice {
  id: string;
}

// ---------------------------------------------------------------------------
// Wire types — Tier A: one arm per documented model id. Params a model
// rejects are typed `never` so they fail at compile time.
// ---------------------------------------------------------------------------

interface SpeechBodyCommon {
  /** The text to generate audio for. Maximum 4096 characters. */
  input: string;
  /** Output container/codec. Defaults to "mp3". */
  response_format?: SpeechResponseFormat;
  /** 0.25 to 4.0; 1.0 is the default. */
  speed?: number;
}

/**
 * tts-1 / tts-1-hd: no `instructions` ("Does not work with `tts-1` or
 * `tts-1-hd`"), no SSE streaming ("`sse` is not supported for `tts-1` or
 * `tts-1-hd`"), and the 9-voice subset.
 */
interface Tts1BodyCommon extends SpeechBodyCommon {
  voice: Tts1Voice | SpeechCustomVoice;
  instructions?: never;
  stream_format?: "audio";
}

export interface Tts1Body extends Tts1BodyCommon {
  model: "tts-1";
}

export interface Tts1HdBody extends Tts1BodyCommon {
  model: "tts-1-hd";
}

interface Gpt4oMiniTtsBodyCommon extends SpeechBodyCommon {
  voice: SpeechVoice | SpeechCustomVoice;
  /** Additional steering of tone/accent/delivery. */
  instructions?: string;
  stream_format?: "sse" | "audio";
}

export interface Gpt4oMiniTtsBody extends Gpt4oMiniTtsBodyCommon {
  model: "gpt-4o-mini-tts";
}

export interface Gpt4oMiniTtsSnapshotBody extends Gpt4oMiniTtsBodyCommon {
  model: "gpt-4o-mini-tts-2025-12-15";
}

/** Escape hatch for models unmodel doesn't know yet (unknown_model warning). */
export interface UnknownSpeechModelBody<Model extends string> {
  model: FutureModelId<Model, keyof SpeechBodyByModel>;
  input: string;
  voice: string | SpeechCustomVoice;
  [key: string]: unknown;
}

/**
 * Closed over documented models by default. Supply a future model literal to
 * opt into the loose arm: `SpeechBody<"tts-2">`.
 */
export type SpeechBody<FutureModel extends string = never> =
  | Tts1Body
  | Tts1HdBody
  | Gpt4oMiniTtsBody
  | Gpt4oMiniTtsSnapshotBody
  | UnknownSpeechModelBody<FutureModel>;

export interface SpeechBodyByModel {
  "tts-1": Tts1Body;
  "tts-1-hd": Tts1HdBody;
  "gpt-4o-mini-tts": Gpt4oMiniTtsBody;
  "gpt-4o-mini-tts-2025-12-15": Gpt4oMiniTtsSnapshotBody;
}

/** Resolves a model id literal to its exact Tier-A arm. */
type SpeechArm<M extends string> = M extends keyof SpeechBodyByModel
  ? SpeechBodyByModel[M]
  : UnknownSpeechModelBody<M>;

/** Runtime implementation type; the public alias stays closed by default. */
type AnySpeechBody = SpeechBody<string>;
type SpeechModelInput = keyof SpeechBodyByModel | (string & {});

// ---------------------------------------------------------------------------
// Schema — loose; per-model narrowing happens in constraints.ts (runtime) and
// the Tier-A arms (types).
// ---------------------------------------------------------------------------

const ttsSchema = z.looseObject({
  model: z.string(),
  input: z.string(),
  voice: z.union([z.string(), z.looseObject({ id: z.string() })]),
  instructions: z.string().optional(),
  response_format: z.string().optional(),
  speed: z
    .number()
    .min(0.25, "speed must be between 0.25 and 4.0")
    .max(4, "speed must be between 0.25 and 4.0")
    .optional(),
  stream_format: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

/** Built-in voice names, per model — text-to-speech guide. */
const VOICES_BY_MODEL: Readonly<Record<string, readonly string[]>> = {
  "tts-1": TTS_1_VOICES,
  "tts-1-hd": TTS_1_VOICES,
  "gpt-4o-mini-tts": SPEECH_VOICES,
  "gpt-4o-mini-tts-2025-12-15": SPEECH_VOICES,
};

/**
 * Validates the STRING form of `voice` against the model's documented
 * built-in list. Object voices (`{ id }`) are custom voices and are never
 * enum-checked — which is also why `voice` carries no constraint-table enum.
 */
function checkVoice(params: AnySpeechBody, _info: ModelInfo | undefined, ctx: PipelineContext): void {
  const voice = (params as { voice?: unknown }).voice;
  if (typeof voice !== "string") return;
  const allowed = Object.hasOwn(VOICES_BY_MODEL, params.model)
    ? VOICES_BY_MODEL[params.model]
    : undefined;
  if (allowed === undefined || allowed.includes(voice)) return;
  ctx.report({
    code: "invalid_enum_value",
    path: ["voice"],
    model: params.model,
    message: `\`voice\` must be one of ${allowed.map((v) => JSON.stringify(v)).join(", ")} for "${params.model}" (or a custom voice object like { id: "voice_1234" }); got ${JSON.stringify(voice)}.`,
    meta: { allowed: [...allowed], value: voice, source: TTS_GUIDE_DOCS },
  });
}

/**
 * "The text to generate audio for. The maximum length is 4096 characters."
 * Reported as `over_output_limit` with a characters-explicit message and meta
 * { limitCharacters, actualCharacters } — see module JSDoc.
 *
 * The cap is documented on the ENDPOINT, not per model, so an id the catalog
 * does not know yet still gets it (`SPEECH_MAX_INPUT_CHARACTERS` fallback) —
 * same policy as inworld.tts. Without the fallback a brand-new speech model
 * would silently lose the only limit this endpoint has.
 */
function checkInputLength(
  params: AnySpeechBody,
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
    message: `\`input\` is ${actual} characters; ${info === undefined ? "POST /v1/audio/speech" : `"${params.model}"`} caps a single speech request at ${limit} characters.`,
    meta: { limitCharacters: limit, actualCharacters: actual, source: SPEECH_DOCS },
  });
}

// ---------------------------------------------------------------------------
// Estimation — tts-1 / tts-1-hd are billed per input character
// (cost.perMillionCharacters). gpt-4o-mini-tts is billed per token (text in /
// audio out), and the audio-token count is unknowable before the call, so it
// deliberately gets no estimate rather than a guess.
// ---------------------------------------------------------------------------

function estimate(
  params: AnySpeechBody,
  info: ModelInfo | undefined,
  _ctx: PipelineContext,
): ValidateEstimate {
  if (typeof params.input !== "string") return {};
  const costUSD = computeCharacterCostUSD(info?.cost, params.input.length);
  return costUSD === undefined ? {} : { costUSD };
}

/**
 * SDK targets for `openai.tts`. The `openai` SDK's `audio.speech.create`
 * params are wire-shaped, so the single `"openai"` formatter is the identity.
 * Type alias, not interface: an interface has no implicit index signature and
 * cannot satisfy `SdkFormatters`.
 */
type TtsSdkTargets<B> = { openai: () => B };

function finalize(params: AnySpeechBody): unknown {
  const body = { ...params };
  return toValidated(
    body,
    {
      url: AUDIO_SPEECH_URL,
      method: "POST",
      headers: JSON_HEADERS,
    },
    { sdk: { openai: () => body } },
  );
}

const validator = createValidator<AnySpeechBody, unknown>({
  endpoint: "openai.tts",
  schema: ttsSchema,
  modelId: (params) => params.model,
  catalog: speechModels,
  constraints: ttsConstraints,
  checks: [checkVoice, checkInputLength],
  estimate,
  finalize,
});

/**
 * Validates params for POST /v1/audio/speech. Known models get their exact
 * per-model surface at compile time (e.g. `instructions` is a compile error
 * for tts-1, and `"marin"` is not a tts-1 voice); unknown models fall back to
 * a loose arm with a runtime unknown_model warning. The result's enumerable
 * props are the exact JSON fetch body; `.toSdk("openai")` returns it unchanged in
 * shape (the OpenAI SDK's `audio.speech.create` params are wire-shaped).
 *
 * ```ts
 * const params = openai.tts({
 *   model: "gpt-4o-mini-tts",
 *   input: "Today is a wonderful day to build something people love.",
 *   voice: "marin",
 *   instructions: "Speak in a cheerful and positive tone.",
 * });
 * const audio = await fetch(params.request.url, {
 *   method: params.request.method,
 *   headers: { ...params.request.headers, authorization: `Bearer ${key}` },
 *   body: JSON.stringify(params),
 * }).then((r) => r.arrayBuffer());
 * ```
 *
 * `voice` is a closed union here — a voice id that arrives as a runtime
 * `string` (config, a picker) does not fit it. Narrow, then call: guard with
 * the exported `SPEECH_VOICES` (the same array `checkVoice` reads) and pass
 * the result as {@link SpeechVoice}. A cloned voice is not a bare string at
 * all — it is the object form `{ id: "voice_1234" }`.
 *
 * ```ts
 * if ((SPEECH_VOICES as readonly string[]).includes(raw)) {
 *   openai.tts({ model: "gpt-4o-mini-tts", input, voice: raw as SpeechVoice });
 * }
 * ```
 */
export const tts = validator as unknown as {
  <M extends SpeechModelInput, T extends SpeechArm<M>>(
    params: T & SpeechArm<M> & { model: M } & ExactKeys<T, SpeechArm<M>>,
    options?: ValidateOptions<T>,
  ): Validated<T & { model: M }, TtsSdkTargets<T & { model: M }>>;
  safe<M extends SpeechModelInput, T extends SpeechArm<M>>(
    params: T & SpeechArm<M> & { model: M } & ExactKeys<T, SpeechArm<M>>,
    options?: ValidateOptions<T>,
  ): ValidateResult<Validated<T & { model: M }, TtsSdkTargets<T & { model: M }>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
