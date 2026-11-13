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
 * The WebSocket variant (wss:///tts/websocket) is validated by ./tts-websocket
 * (`ttsWebsocket`, the generation message). The SSE variant (POST /tts/sse) is
 * not validated by unmodel.
 *
 * OPEN-TAIL RULE (applies to every wire type in this provider): a
 * `| (string & {})` tail is legitimate exactly where an off-enum value is
 * reported at *warning* severity, and illegitimate where it is reported at
 * *error* severity. `model_id` keeps its tail because a cataloged dated
 * snapshot (`sonic-3.5-2026-05-04`) is off-enum yet valid — `checkTtsModelKind`
 * reports it as a warning. `generation_config.emotion` has no tail:
 * `checkEnums` reports an off-list label at the `invalid_enum_value` default
 * severity, which is *error*, so no value a tail admitted at compile time would
 * be accepted at run time. `language` / `locale` follow the rule PER MODEL
 * ({@link CartesiaTtsLanguageFor}), reading the same tables the check does:
 * closed on an id whose list is documented, where an off-list value is an
 * error; open on an alias whose backing model no page names
 * ({@link CARTESIA_TTS_ALIAS_LANGUAGES}) and on an uncataloged id, where it is
 * a warning. Two named exceptions, both lenient:
 * - A Sonic 3.6 id also takes `` `${base}-${Uppercase<string>}` ``: the locale
 *   table lists 56 codes, the changelog counts 61, so an unlisted well-formed
 *   regional code on a Sonic 3.6 base (`ar-SA`) is a warning. The template
 *   cannot spell "two capitals or three digits", so `"en-"` compiles and is
 *   still refused at run time.
 * - `normalization` is one model-independent union (`auto`, `off`, every base
 *   code and locale). "Locale codes require Sonic 3.6 or later." names no
 *   failure mode, so a locale code on an earlier model is a warning; anything
 *   off the union is an error ("Values not on the list return a 400 error.").
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
  CARTESIA_TTS_3_6_LANGUAGES,
  CARTESIA_TTS_ALIAS_LANGUAGES,
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
 * REQUIRED static `Cartesia-Version` header value — the version the TTS and
 * STT validators pin (https://docs.cartesia.ai/2026-03-01/api-reference/tts/bytes,
 * header enum ["2026-03-01"], checked 2026-11-12). The docs also publish
 * 2024-06-10 and 2024-11-13 (Legacy) and 2026-08-14, the "Latest" default the
 * unversioned reference serves. Carried in `.request.headers`.
 */
export const CARTESIA_VERSION = "2026-03-01";

const TTS_BYTES_DOCS = "https://docs.cartesia.ai/2026-03-01/api-reference/tts/bytes";
/** The 56-vs-61 locale count ("44 languages / 61 locales"). */
const CHANGELOG_2026 = "https://docs.cartesia.ai/changelog/2026";

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
   * — https://docs.cartesia.ai/2026-03-01/api-reference/tts/bytes.
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
 * https://docs.cartesia.ai/2026-03-01/api-reference/tts/bytes.
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

/** The 42 bare codes Sonic 3.5 and Sonic 3 take, and every TTS model shares. */
export type CartesiaTtsLanguage = (typeof CARTESIA_TTS_LANGUAGES)[number];

/** The 56 regional locale codes (`en-GB`, `pt-BR`, …) — Sonic 3.6 or later only. */
export type CartesiaTtsLocale = (typeof CARTESIA_TTS_LOCALES)[number];

type LanguagesByModel = typeof CARTESIA_TTS_LANGUAGES_BY_MODEL;
type AliasLanguages = typeof CARTESIA_TTS_ALIAS_LANGUAGES;

/**
 * A well-formed regional code on a Sonic 3.6 base that the 56-row locale table
 * does not list (`ar-SA`, `es-419`) — a warning, not an error, because the
 * changelog counts 61 locales (see the open-tail rule above).
 *
 * The brand keeps TypeScript from folding the 56 listed literals into the
 * template, so they still complete. It is `{ readonly length: number }`, not
 * the usual `{}`: `language` is read through `T & TtsBytesBody<M>`, and that
 * intersection discharges a bare `& {}` (the `SizeOf` note in
 * core/unified/vocabulary/model-params.ts), after which the editor offers only
 * the 44 base codes — measured with the real language service, pinned by
 * test/unified/completions.test.ts. Every string has a `length`, so the brand
 * admits exactly what the template does.
 */
type CartesiaTtsUnlistedLocale = `${(typeof CARTESIA_TTS_3_6_LANGUAGES)[number]}-${Uppercase<string>}` & {
  readonly length: number;
};

/** Every value a documented model takes, plus the unlisted Sonic 3.6 locales. */
type CartesiaTtsAnyLanguage =
  | CartesiaTtsLanguage
  | LanguagesByModel[keyof LanguagesByModel][number]
  | CartesiaTtsUnlistedLocale;

/**
 * `model_id` input: the cataloged sonic ids plus the open tail (see the
 * open-tail rule above), and the CONSTRAINT of the `M` the wire types are
 * generic over. It carries the id literals rather than being a bare `string`
 * so `model_id` keeps completing them.
 */
export type CartesiaTtsModelInput = CartesiaTtsModelId | (string & {});

/**
 * The `language` / `locale` values model `M` accepts — the type-level half of
 * `checkLanguageFields`, read off the same tables:
 * - a Sonic 3.6 id ({@link CARTESIA_TTS_LANGUAGES_BY_MODEL}) takes its 44 base
 *   codes, the 56 regional locales and the unlisted regional codes on those
 *   bases;
 * - an alias whose backing model no page names
 *   ({@link CARTESIA_TTS_ALIAS_LANGUAGES}) and an uncataloged literal id
 *   (`"sonic-3.7"`) complete every documented value and stay open, because the
 *   check only warns on them;
 * - every other cataloged id takes the 42 bare codes.
 *
 * A `string`-typed (runtime-built) id names no model, so it gets every
 * documented value; the run-time check still holds the actual id to its own
 * list.
 */
export type CartesiaTtsLanguageFor<M extends string> = string extends M
  ? CartesiaTtsAnyLanguage
  : M extends keyof LanguagesByModel
    ? LanguagesByModel[M][number] | CartesiaTtsUnlistedLocale
    : M extends keyof AliasLanguages
      ? CartesiaTtsAnyLanguage | (string & {})
      : M extends CartesiaTtsModelId
        ? CartesiaTtsLanguage
        : CartesiaTtsAnyLanguage | (string & {});

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
   * Closed on an id whose list is documented, where `checkEnums` reports an
   * off-list code as an *error*; open on an alias or uncataloged id, where it
   * is a warning. Note this is the wire layer, so a regional tag like "pt-BR"
   * is refused here on sonic-3.5 and sonic-3 — the unified layer sends it as
   * `locale` on Sonic 3.6 and normalizes it to "pt" on every other model.
   * "Deprecated — use `locale` instead on Sonic 3.6 and later." Interchangeable
   * with `locale`: set one or the other, never both.
   */
  language?: CartesiaTtsLanguageFor<M>;
  /**
   * "Accepts exactly the same values as `language`; set one or the other,
   * never both." Regional codes (`en-GB`) need Sonic 3.6 or later.
   */
  locale?: CartesiaTtsLanguageFor<M>;
  /**
   * "Controls how written forms (dates, times, numbers) are converted to
   * spoken forms, independently of the voice's accent. One of `auto`
   * (default), `off`, or a locale code from the supported locales (e.g.
   * `en-IN`). Values not on the list return a 400 error." / "Locale codes
   * require Sonic 3.6 or later." The text-normalization guide also takes "a
   * language or locale code such as `en` or `en-IN`"
   * (https://docs.cartesia.ai/build-with-cartesia/capability-guides/text-normalization).
   * Model-independent: a locale code on an earlier model is only a warning
   * (see the open-tail rule above). "string, nullable" on the wire.
   */
  normalization?: "auto" | "off" | CartesiaTtsLanguageFor<string> | null;
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
  normalization: z.string().nullable().optional(),
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
 * `language` / `locale` / `normalization` and `generation_config.emotion` are
 * listed values — the languages per model ({@link checkLanguageFields}), the 58
 * emotion labels for every model. The SDK types them all as bare strings, so
 * an unsupported value only surfaces as a 4xx at request time.
 */
function checkEnums(params: TtsBytesBody, info: ModelInfo | undefined, ctx: PipelineContext): void {
  checkLanguageFields(params, info, TTS_BYTES_DOCS, ctx);
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
const ALIAS_LANGUAGE_SETS = new Map<string, ReadonlySet<string>>(
  Object.entries(CARTESIA_TTS_ALIAS_LANGUAGES).map(([id, values]) => [id, new Set<string>(values)]),
);
const SONIC_3_6_VALUES: ReadonlySet<string> = new Set<string>(
  Object.values(CARTESIA_TTS_LANGUAGES_BY_MODEL).flat(),
);
const SONIC_3_6_BASES: ReadonlySet<string> = new Set<string>(CARTESIA_TTS_3_6_LANGUAGES);
const LOCALE_SET: ReadonlySet<string> = new Set<string>(CARTESIA_TTS_LOCALES);
const SONIC_3_6_IDS = Object.keys(CARTESIA_TTS_LANGUAGES_BY_MODEL);
/** `xx-YY` or `xx-NNN` (UN M.49, `es-419`) — case-sensitive, like the locale codes. */
const REGIONAL_CODE = /^([a-z]{2})-(?:[A-Z]{2}|\d{3})$/;
const NORMALIZATION_VALUES = ["auto", "off", ...CARTESIA_TTS_3_6_LANGUAGES, ...CARTESIA_TTS_LOCALES];

/**
 * The language rules POST /tts/bytes and the TTS socket share
 * (Cartesia-Version 2026-03-01 references of both routes):
 * - `language` and `locale` are one value in two slots: "Interchangeable with
 *   `locale` — set one or the other, never both." / "Setting both returns a
 *   400 error, even if the values match." Error.
 * - On an id whose list is documented, either slot takes that list
 *   ("Supported languages are model-specific." —
 *   {@link CARTESIA_TTS_LANGUAGES_BY_MODEL}, else the 42 codes): "Values not on
 *   the supported list return a 400 error — arbitrary BCP-47 codes are
 *   rejected, not ignored." Error, naming the Sonic 3.6 ids when the refused
 *   value is one of theirs. The one exception is a well-formed regional code
 *   on a Sonic 3.6 base that the 56-row table does not list: a warning, since
 *   the changelog counts 61 locales.
 * - On an alias whose backing model no page names
 *   ({@link CARTESIA_TTS_ALIAS_LANGUAGES}) and on an uncataloged id, the
 *   alias's own list (else the 42) passes and anything else is a warning: no
 *   page says these ids refuse it.
 * - `normalization` — see {@link checkNormalization}.
 */
export function checkLanguageFields(
  params: {
    model_id: string;
    language?: string | undefined;
    locale?: string | undefined;
    normalization?: string | null | undefined;
  },
  info: ModelInfo | undefined,
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
  const documented = LANGUAGE_SETS.get(model);
  const alias = ALIAS_LANGUAGE_SETS.get(model);
  const allowed = documented ?? alias ?? DEFAULT_LANGUAGE_SET;
  const unnamed = documented === undefined && (alias !== undefined || info === undefined);
  for (const field of ["language", "locale"] as const) {
    const value = params[field];
    if (typeof value !== "string" || allowed.has(value)) continue;
    if (unnamed) {
      const what = isSonic36Value(value)
        ? `${JSON.stringify(value)} needs Sonic 3.6 or later`
        : `${JSON.stringify(value)} is on no documented Cartesia language list`;
      const who =
        info === undefined ? `"${model}" is not a cataloged model` : `no page names the model behind "${model}"`;
      ctx.report({
        code: "invalid_enum_value",
        severity: "warning",
        path: [field],
        model,
        message: `\`${field}\` ${what}, and ${who}; it may be refused.`,
        meta: { allowed: [...allowed], value, source },
      });
    } else if (documented !== undefined && isUnlistedSonic36Locale(value)) {
      ctx.report({
        code: "invalid_enum_value",
        severity: "warning",
        path: [field],
        model,
        message: `\`${field}\` ${JSON.stringify(value)} is not one of the ${LOCALE_SET.size} regional codes the locale table lists, but its base is a Sonic 3.6 language and the 2026 changelog counts "44 languages / 61 locales"; it may be refused.`,
        meta: { allowed: [...allowed], value, source: CHANGELOG_2026 },
      });
    } else {
      ctx.report({
        code: "invalid_enum_value",
        path: [field],
        model,
        message: `\`${field}\` must be one of the ${allowed.size} documented codes for "${model}"; got ${JSON.stringify(value)}.${sonic36Hint(value)}`,
        meta: { allowed: [...allowed], value, source },
      });
    }
  }
  checkNormalization(params, allowed, source, ctx);
}

/**
 * `normalization`: "One of `auto` (default), `off`, or a locale code from the
 * supported locales (e.g. `en-IN`). Values not on the list return a 400
 * error." / "Locale codes require Sonic 3.6 or later." (POST /tts/bytes,
 * 2026-03-01; the socket's reference lists the same values without the 400
 * sentence, and shares this check). The text-normalization guide also takes
 * "a language or locale code such as `en` or `en-IN`", so a bare base code
 * passes on every model. A locale code the model does not take in `language`
 * is a warning — the 3.6 sentence names no failure mode, unlike its `locale`
 * twin — and so is an unlisted regional code on a Sonic 3.6 base. Anything
 * else is an error.
 */
function checkNormalization(
  params: { model_id: string; normalization?: string | null | undefined },
  allowed: ReadonlySet<string>,
  source: string,
  ctx: PipelineContext,
): void {
  const value = params.normalization;
  if (typeof value !== "string" || value === "auto" || value === "off" || SONIC_3_6_BASES.has(value)) return;
  const model = params.model_id;
  if (LOCALE_SET.has(value) || isUnlistedSonic36Locale(value)) {
    if (allowed.has(value)) return;
    ctx.report({
      code: "invalid_enum_value",
      severity: "warning",
      path: ["normalization"],
      model,
      message: LOCALE_SET.has(value)
        ? `\`normalization\` ${JSON.stringify(value)} is a locale code, and "Locale codes require Sonic 3.6 or later." — "${model}" may refuse it; the bare code "${value.slice(0, 2)}" works on every model.`
        : `\`normalization\` ${JSON.stringify(value)} is not one of the ${LOCALE_SET.size} regional codes the locale table lists (the 2026 changelog counts 61); it may be refused.`,
      meta: { allowed: NORMALIZATION_VALUES, value, source },
    });
    return;
  }
  ctx.report({
    code: "invalid_enum_value",
    path: ["normalization"],
    model,
    message: `\`normalization\` must be "auto", "off", or a language or locale code such as "en" or "en-IN" (locale codes are case-sensitive); got ${JSON.stringify(value)}.`,
    meta: { allowed: NORMALIZATION_VALUES, value, source },
  });
}

/** In Sonic 3.6's set: one of its 100 listed codes, or an unlisted regional code on a 3.6 base. */
function isSonic36Value(value: string): boolean {
  return SONIC_3_6_VALUES.has(value) || isUnlistedSonic36Locale(value);
}

/** A well-formed regional code on a Sonic 3.6 base the 56-row table does not list (`ar-SA`). */
function isUnlistedSonic36Locale(value: string): boolean {
  const match = REGIONAL_CODE.exec(value);
  return match !== null && SONIC_3_6_BASES.has(match[1] as string) && !LOCALE_SET.has(value);
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
