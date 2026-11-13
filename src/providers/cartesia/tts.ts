/**
 * Cartesia Text-to-Speech (Bytes) — POST https://api.cartesia.ai/tts/bytes
 *
 * Wire reference: https://docs.cartesia.ai/2026-03-01/api-reference/tts/bytes
 * (Cartesia-Version 2026-03-01, verified 2026-08-13). Params mirror the wire
 * body exactly. The response is raw audio bytes, so there is no response
 * checker for this endpoint.
 *
 * NOTE on character caps: were a `limit.characters` cap ever added to the
 * catalog, an over-long `transcript` is reported with issue code
 * `over_output_limit` — there is no character-specific code, so the message
 * and meta ({ limitCharacters, actualCharacters }) spell out that the limit
 * is in characters, not tokens. Cartesia currently documents no per-request
 * transcript cap, so the check is dormant for the shipped catalog.
 *
 * Streaming/websocket variants (POST /tts/sse, wss:///tts/websocket) are not
 * validated by unmodel.
 *
 * OPEN-TAIL RULE (applies to every wire type in this provider): a
 * `| (string & {})` tail is legitimate exactly where an off-enum value is
 * reported at *warning* severity, and illegitimate where it is reported at
 * *error* severity. `model_id` keeps its tail because a cataloged dated
 * snapshot (`sonic-3.5-2026-05-04`) is off-enum yet valid — `checkTtsModelKind`
 * reports it as a warning. `language`, `locale` and `generation_config.emotion`
 * have no tail: `checkEnums` reports an off-list value at the
 * `invalid_enum_value` default severity, which is *error*, so no value the tail
 * admitted at compile time was a value this module would accept at run time.
 * `language` / `locale` are closed PER MODEL ({@link CartesiaTtsLanguageFor}):
 * the list is model-specific, so the type reads the same table the check does.
 * Same shape as `SttWebsocketParams.language` in ./stt-websocket, which already
 * ships closed.
 *
 * BREAKING (type-level only): `TtsBytesBody.language` and
 * `CartesiaGenerationConfig.emotion` are re-exported from ../cartesia and no
 * longer accept a `string`-typed variable. Every value that closure rejects was
 * already rejected at run time; a caller holding a `string` must narrow it
 * (`CARTESIA_TTS_LANGUAGES.includes(x)`) or assert it.
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
  CARTESIA_TTS_LANGUAGES,
  CARTESIA_TTS_LANGUAGES_BY_MODEL,
  CARTESIA_TTS_LOCALES,
  TTS_MODEL_IDS,
  models,
  type CartesiaTtsModelId,
} from "./models";

// Declared in `./models` — an import-free leaf — so that `unmodel/cartesia/values`
// and the `*-params` table can read these without this validator, its zod schema
// and its catalog. Re-exported here so every existing caller is unchanged.
export {
  CARTESIA_TTS_LANGUAGES,
  CARTESIA_TTS_3_6_LANGUAGES,
  CARTESIA_TTS_LOCALES,
  CARTESIA_TTS_LANGUAGES_BY_MODEL,
} from "./models";

export const TTS_BYTES_URL = "https://api.cartesia.ai/tts/bytes";
/**
 * REQUIRED static `Cartesia-Version` header value — the only version the
 * current docs publish (https://docs.cartesia.ai/api-reference/tts/bytes,
 * checked 2026-08-13). Carried in `.request.headers`.
 */
export const CARTESIA_VERSION = "2026-03-01";

const TTS_BYTES_DOCS = "https://docs.cartesia.ai/api-reference/tts/bytes";

// ---------------------------------------------------------------------------
// Wire types — mirror POST /tts/bytes exactly.
// ---------------------------------------------------------------------------

/** Sample rates every container accepts (Hz). */
export type CartesiaSampleRate = 8000 | 16000 | 22050 | 24000 | 44100 | 48000;

/** PCM encodings for the wav/raw containers. */
export type CartesiaEncoding = "pcm_f32le" | "pcm_s16le" | "pcm_mulaw" | "pcm_alaw";

/** MP3 bit rates (bits per second). */
export type CartesiaMp3BitRate = 32000 | 64000 | 96000 | 128000 | 192000;

export interface CartesiaWavOutputFormat {
  container: "wav";
  /** Default: "pcm_s16le". */
  encoding?: CartesiaEncoding;
  /** Default: 44100. */
  sample_rate?: CartesiaSampleRate;
}

export interface CartesiaMp3OutputFormat {
  container: "mp3";
  /** REQUIRED for mp3 — the schema's `required` list is [sample_rate, bit_rate]. */
  sample_rate: CartesiaSampleRate;
  /**
   * REQUIRED for mp3. The docs advertise a default of 128000 but still list
   * `bit_rate` in the mp3 variant's `required` array, so omitting it is a 422
   * — https://docs.cartesia.ai/api-reference/tts/bytes.
   */
  bit_rate: CartesiaMp3BitRate;
}

export interface CartesiaRawOutputFormat {
  container: "raw";
  encoding: CartesiaEncoding;
  sample_rate: CartesiaSampleRate;
}

export type CartesiaOutputFormat =
  | CartesiaWavOutputFormat
  | CartesiaMp3OutputFormat
  | CartesiaRawOutputFormat;

/** The only documented voice mode is "id" (no embedding mode on 2026-03-01). */
export interface CartesiaVoice {
  mode: "id";
  /** Voice UUID from the Cartesia voice library. */
  id: string;
}

/**
 * The 58 emotion labels the tts/bytes reference enumerates for
 * `generation_config.emotion` (Cartesia-Version 2026-03-01) —
 * https://docs.cartesia.ai/api-reference/tts/bytes.
 */
export const CARTESIA_EMOTIONS = [
  "neutral", "happy", "excited", "enthusiastic", "elated", "euphoric",
  "triumphant", "amazed", "surprised", "flirtatious", "curious", "content",
  "peaceful", "serene", "calm", "grateful", "affectionate", "trust",
  "sympathetic", "anticipation", "mysterious", "angry", "mad", "outraged",
  "frustrated", "agitated", "threatened", "disgusted", "contempt", "envious",
  "sarcastic", "ironic", "sad", "dejected", "melancholic", "disappointed",
  "hurt", "guilty", "bored", "tired", "rejected", "nostalgic", "wistful",
  "apologetic", "hesitant", "insecure", "confused", "resigned", "anxious",
  "panicked", "alarmed", "scared", "proud", "confident", "distant",
  "skeptical", "contemplative", "determined",
] as const;

export type CartesiaEmotion = (typeof CARTESIA_EMOTIONS)[number];

/** Speech attribute controls; replaces the deprecated top-level `speed`. */
export interface CartesiaGenerationConfig {
  /** Range [0.5, 2.0]; default 1. */
  volume?: number;
  /** Range [0.6, 1.5]; default 1. */
  speed?: number;
  /**
   * One of the 58 documented labels ({@link CARTESIA_EMOTIONS}). Closed: an
   * off-enum label is an `invalid_enum_value` *error* in `checkEnums`, so an
   * open tail would only admit values this module refuses (see the open-tail
   * rule in the module JSDoc).
   */
  emotion?: CartesiaEmotion;
}

/** The 42 bare codes every TTS id outside the Sonic 3.6 rows takes. */
export type CartesiaTtsLanguage = (typeof CARTESIA_TTS_LANGUAGES)[number];

/** The 56 regional locale codes (`en-GB`, `pt-BR`, …) — Sonic 3.6 or later only. */
export type CartesiaTtsLocale = (typeof CARTESIA_TTS_LOCALES)[number];

type LanguagesByModel = typeof CARTESIA_TTS_LANGUAGES_BY_MODEL;

/**
 * `model_id` input: the cataloged sonic ids plus the open tail (see the
 * open-tail rule above), and the CONSTRAINT of the `M` the wire types are
 * generic over. It carries the id literals rather than being a bare `string`
 * so `model_id` keeps completing them.
 */
export type CartesiaTtsModelInput = CartesiaTtsModelId | (string & {});

/**
 * The `language` / `locale` values model `M` accepts — the type-level half of
 * `checkLanguageFields`, read off the same
 * {@link CARTESIA_TTS_LANGUAGES_BY_MODEL} table: a Sonic 3.6 id takes its 44
 * base codes and 56 regional locales, every other id the 42 bare codes. A
 * `string`-typed (runtime-built) id names no model, so it gets every model's
 * values; the run-time check still holds the actual id to its own list.
 */
export type CartesiaTtsLanguageFor<M extends string> = string extends M
  ? CartesiaTtsLanguage | LanguagesByModel[keyof LanguagesByModel][number]
  : M extends keyof LanguagesByModel
    ? LanguagesByModel[M][number]
    : CartesiaTtsLanguage;

/**
 * The POST /tts/bytes body. `M` is the `model_id` literal, inferred at the call
 * site so `language` / `locale` resolve to that model's own list
 * ({@link CartesiaTtsLanguageFor}). It defaults to the whole
 * {@link CartesiaTtsModelInput} union, so the plain `TtsBytesBody` takes every
 * model's values.
 */
export interface TtsBytesBody<M extends CartesiaTtsModelInput = CartesiaTtsModelInput> {
  /**
   * Required by unmodel even though the wire defaults to sonic-3.5 when
   * omitted — every catalog check (char limits, pricing, deprecation) keys
   * on the model id. Documented deviation, same policy as openai.images.
   */
  model_id: M;
  transcript: string;
  voice: CartesiaVoice;
  output_format: CartesiaOutputFormat;
  /**
   * One of the model's documented codes ({@link CartesiaTtsLanguageFor}):
   * "Requesting a language a model does not support returns a 400 error".
   * Closed for the same reason as `generation_config.emotion`: `checkEnums`
   * reports an off-list code as an *error*. Note this is the wire layer, so a
   * regional tag like "pt-BR" is refused here on every model but Sonic 3.6 —
   * the unified layer normalizes it to "pt" before it reaches this type.
   * "Deprecated — use `locale` instead on Sonic 3.6 and later." Interchangeable
   * with `locale`: set one or the other, never both.
   */
  language?: CartesiaTtsLanguageFor<M>;
  /**
   * "Accepts exactly the same values as `language`; set one or the other,
   * never both." Regional codes (`en-GB`) need Sonic 3.6 or later.
   */
  locale?: CartesiaTtsLanguageFor<M>;
  /** Pronunciation dictionary id — sonic-3 models and newer only. */
  pronunciation_dict_id?: string;
  generation_config?: CartesiaGenerationConfig;
  /** @deprecated Use `generation_config.speed` instead. */
  speed?: "slow" | "normal" | "fast";
}

// ---------------------------------------------------------------------------
// Schema (loose: unknown keys pass through with a warning).
// ---------------------------------------------------------------------------

const sampleRateSchema = z.union([
  z.literal(8000),
  z.literal(16000),
  z.literal(22050),
  z.literal(24000),
  z.literal(44100),
  z.literal(48000),
]);

const encodingSchema = z.enum(["pcm_f32le", "pcm_s16le", "pcm_mulaw", "pcm_alaw"]);

const bitRateSchema = z.union([
  z.literal(32000),
  z.literal(64000),
  z.literal(96000),
  z.literal(128000),
  z.literal(192000),
]);

const outputFormatSchema = z.discriminatedUnion("container", [
  z.looseObject({
    container: z.literal("wav"),
    encoding: encodingSchema.optional(),
    sample_rate: sampleRateSchema.optional(),
  }),
  z.looseObject({
    container: z.literal("mp3"),
    sample_rate: sampleRateSchema,
    bit_rate: bitRateSchema,
  }),
  z.looseObject({
    container: z.literal("raw"),
    encoding: encodingSchema,
    sample_rate: sampleRateSchema,
  }),
]);

const schema = z.looseObject({
  model_id: z.string(),
  transcript: z.string(),
  voice: z.looseObject({ mode: z.literal("id"), id: z.string() }),
  output_format: outputFormatSchema,
  language: z.string().optional(),
  locale: z.string().optional(),
  pronunciation_dict_id: z.string().optional(),
  generation_config: z
    .looseObject({
      volume: z.number().min(0.5).max(2).optional(),
      speed: z.number().min(0.6).max(1.5).optional(),
      emotion: z.string().optional(),
    })
    .optional(),
  speed: z.enum(["slow", "normal", "fast"]).optional(),
});

// ---------------------------------------------------------------------------
// Constraints
// ---------------------------------------------------------------------------

/**
 * Per-model denies for POST /tts/bytes and the TTS socket. Empty: the two
 * model-scoped fields — `pronunciation_dict_id` ("sonic-3 models and newer")
 * and `generation_config` ("Available on `sonic-3` and `sonic-3.5`; not
 * available on earlier models.") — are open on every cataloged sonic id,
 * because every one of them is Sonic 3 or later.
 */
export const ttsConstraints: Readonly<Partial<Record<string, EndpointConstraints>>> = {};

// ---------------------------------------------------------------------------
// Checks + estimation
// ---------------------------------------------------------------------------

/**
 * Character-cap check against `limit.characters`. Cartesia documents no cap
 * today, so this only fires if the catalog ever gains one (see module JSDoc
 * for the issue-code decision).
 */
function checkTranscriptLength(
  params: TtsBytesBody,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const limit = info?.limit.characters;
  if (limit === undefined || limit <= 0) return;
  const actual = params.transcript.length;
  if (actual > limit) {
    ctx.report({
      code: "over_output_limit",
      path: ["transcript"],
      model: params.model_id,
      message: `transcript is ${actual} characters, over the ${limit}-character per-request limit of "${params.model_id}" (this limit is in characters, not tokens).`,
      meta: { limitCharacters: limit, actualCharacters: actual },
    });
  }
}

const EMOTION_SET = new Set<string>(CARTESIA_EMOTIONS);

/**
 * `language` / `locale` and `generation_config.emotion` are closed lists — the
 * languages per model ({@link checkLanguageFields}), the 58 emotion labels for
 * every model. The SDK types all three as bare strings, so an unsupported
 * value only surfaces as a 4xx at request time.
 */
function checkEnums(params: TtsBytesBody, _info: ModelInfo | undefined, ctx: PipelineContext): void {
  checkLanguageFields(params, TTS_BYTES_DOCS, ctx);
  const emotion = params.generation_config?.emotion;
  if (typeof emotion === "string" && !EMOTION_SET.has(emotion)) {
    ctx.report({
      code: "invalid_enum_value",
      path: ["generation_config", "emotion"],
      model: params.model_id,
      message: `\`generation_config.emotion\` must be one of the ${CARTESIA_EMOTIONS.length} documented labels; got ${JSON.stringify(emotion)}.`,
      meta: { allowed: [...CARTESIA_EMOTIONS], value: emotion, source: TTS_BYTES_DOCS },
    });
  }
}

const DEFAULT_LANGUAGE_SET: ReadonlySet<string> = new Set<string>(CARTESIA_TTS_LANGUAGES);
const LANGUAGE_SETS = new Map<string, ReadonlySet<string>>(
  Object.entries(CARTESIA_TTS_LANGUAGES_BY_MODEL).map(([id, values]) => [id, new Set<string>(values)]),
);
const SONIC_3_6_VALUES: ReadonlySet<string> = new Set<string>(
  Object.values(CARTESIA_TTS_LANGUAGES_BY_MODEL).flat(),
);
const LOCALE_SET: ReadonlySet<string> = new Set<string>(CARTESIA_TTS_LOCALES);
const SONIC_3_6_IDS = Object.keys(CARTESIA_TTS_LANGUAGES_BY_MODEL);

/**
 * The language rules POST /tts/bytes and the TTS socket share
 * (Cartesia-Version 2026-03-01 references of both routes):
 * - `language` and `locale` are one value in two slots: "Interchangeable with
 *   `locale` — set one or the other, never both." / "Setting both returns a
 *   400 error, even if the values match." Error.
 * - Either slot takes the model's own list ("Supported languages are
 *   model-specific." — {@link CARTESIA_TTS_LANGUAGES_BY_MODEL}, else the 42
 *   codes): "Values not on the supported list return a 400 error — arbitrary
 *   BCP-47 codes are rejected, not ignored." Error, naming the Sonic 3.6 ids
 *   when the refused value is one of theirs.
 */
export function checkLanguageFields(
  params: { model_id: string; language?: string | undefined; locale?: string | undefined },
  source: string,
  ctx: PipelineContext,
): void {
  const model = params.model_id;
  if (params.language !== undefined && params.locale !== undefined) {
    ctx.report({
      code: "invalid_shape",
      path: ["locale"],
      model,
      message:
        "`language` and `locale` are interchangeable — set one or the other, never both " +
        "(Cartesia returns a 400 when both are set, even if the values match).",
      meta: { provided: ["language", "locale"], source },
    });
  }
  const allowed = LANGUAGE_SETS.get(model) ?? DEFAULT_LANGUAGE_SET;
  for (const field of ["language", "locale"] as const) {
    const value = params[field];
    if (typeof value !== "string" || allowed.has(value)) continue;
    ctx.report({
      code: "invalid_enum_value",
      path: [field],
      model,
      message: `\`${field}\` must be one of the ${allowed.size} documented codes for "${model}"; got ${JSON.stringify(value)}.${sonic36Hint(value)}`,
      meta: { allowed: [...allowed], value, source },
    });
  }
}

/** Names the models that DO take `value`, when only a Sonic 3.6 id does. */
function sonic36Hint(value: string): string {
  if (!SONIC_3_6_VALUES.has(value)) return "";
  const ids = SONIC_3_6_IDS.map((id) => `"${id}"`).join(" or ");
  if (!LOCALE_SET.has(value)) return ` ${JSON.stringify(value)} is a Sonic 3.6 language (${ids}).`;
  const bare = value.slice(0, value.indexOf("-"));
  const fallback = DEFAULT_LANGUAGE_SET.has(bare) ? `, or send the bare code "${bare}"` : "";
  return ` Regional locale codes need Sonic 3.6 or later — use ${ids}${fallback}.`;
}

const TTS_MODEL_ID_SET = new Set<string>(TTS_MODEL_IDS);

/**
 * Two gates on `model_id`, both keyed off the catalog (ids unknown to it stay
 * an `unknown_model` warning — they may be new):
 * - Ink STT ids resolve in the shared catalog and would otherwise pass
 *   unremarked; POST /tts/bytes only serves the sonic family. Error.
 * - Cataloged sonic ids that are NOT in the endpoint's published `model_id`
 *   enum (`sonic-3.6`, the dated snapshots, the deprecated aliases) are
 *   off-enum: the docs neither list them for this endpoint nor say the
 *   endpoint refuses them, so this is a warning, not an error — same shape as
 *   the ElevenLabs allow-list gate, one severity down for the ambiguity.
 */
function checkTtsModelKind(
  params: TtsBytesBody,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (info === undefined) return;
  if (info.family === "ink") {
    ctx.report({
      code: "unsupported_capability",
      path: ["model_id"],
      model: params.model_id,
      message: `"${params.model_id}" is a speech-to-text (Ink) model; POST /tts/bytes only accepts the sonic family.`,
      meta: { source: TTS_BYTES_DOCS },
    });
    return;
  }
  if (TTS_MODEL_ID_SET.has(params.model_id)) return;
  ctx.report({
    code: "invalid_enum_value",
    severity: "warning",
    path: ["model_id"],
    model: params.model_id,
    message: `"${params.model_id}" is not in the \`model_id\` enum POST /tts/bytes publishes for Cartesia-Version ${CARTESIA_VERSION} (${TTS_MODEL_IDS.map((id) => `"${id}"`).join(", ")}); it may be refused.`,
    meta: { allowed: [...TTS_MODEL_IDS], value: params.model_id, source: TTS_BYTES_DOCS },
  });
}

/**
 * TTS is billed per input character. Cartesia's catalog carries no USD rate
 * (credit pricing is plan-dependent — see models.ts), so `costUSD` stays
 * undefined until a defensible conversion exists.
 */
function estimateTts(
  params: TtsBytesBody,
  info: ModelInfo | undefined,
  _ctx: PipelineContext,
): ValidateEstimate {
  const costUSD = computeCharacterCostUSD(info?.cost, params.transcript.length);
  return costUSD === undefined ? {} : { costUSD };
}

// ---------------------------------------------------------------------------
// Validator
// ---------------------------------------------------------------------------

/**
 * SDK targets for `cartesia.tts`. The official `@cartesia/cartesia-js` client
 * takes wire-shaped (snake_case) params, so the single `"cartesia"` formatter
 * is the identity. Declared as a type alias, never an interface — an interface
 * has no implicit index signature and cannot satisfy `SdkFormatters`.
 */
type TtsSdkTargets<B> = { cartesia: () => B };

function finalize(params: TtsBytesBody): Validated<TtsBytesBody, TtsSdkTargets<TtsBytesBody>> {
  const body = { ...params };
  return toValidated(
    body,
    {
      url: TTS_BYTES_URL,
      method: "POST",
      headers: { ...JSON_HEADERS, "Cartesia-Version": CARTESIA_VERSION },
    },
    { sdk: { cartesia: () => body } },
  );
}

const validator = createValidator<TtsBytesBody, Validated<TtsBytesBody, TtsSdkTargets<TtsBytesBody>>>({
  endpoint: "cartesia.tts",
  schema,
  modelId: (params) => params.model_id,
  catalog: models,
  constraints: ttsConstraints,
  checks: [checkTranscriptLength, checkEnums, checkTtsModelKind],
  estimate: estimateTts,
  finalize,
});

/**
 * Validates params for POST /tts/bytes. The result's enumerable properties
 * are the exact fetch JSON body; `.request` carries the URL, method, and the
 * REQUIRED static `Cartesia-Version` header (auth is your job: "Include
 * `Authorization: Bearer <api_key>` in the headers of your requests." —
 * https://docs.cartesia.ai/use-the-api/api-conventions). `.toSdk("cartesia")`
 * returns the body unchanged — the official `@cartesia/cartesia-js` SDK takes
 * wire-shaped (snake_case) params.
 *
 * ```ts
 * const params = cartesia.tts({ model_id: "sonic-3.5", transcript: "…", voice: …, output_format: … });
 * await fetch(params.request.url, {
 *   method: params.request.method,
 *   headers: { ...params.request.headers, Authorization: `Bearer ${process.env.CARTESIA_API_KEY}` },
 *   body: JSON.stringify(params),
 * });
 * ```
 */
export const tts = validator as unknown as {
  <M extends CartesiaTtsModelInput, T extends TtsBytesBody<M>>(
    params: T & TtsBytesBody<M> & ExactKeys<T, TtsBytesBody>,
    options?: ValidateOptions<T>,
  ): Validated<T, TtsSdkTargets<T>>;
  safe<M extends CartesiaTtsModelInput, T extends TtsBytesBody<M>>(
    params: T & TtsBytesBody<M> & ExactKeys<T, TtsBytesBody>,
    options?: ValidateOptions<T>,
  ): ValidateResult<Validated<T, TtsSdkTargets<T>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
