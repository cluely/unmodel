/**
 * SpeechifyAI Text to Speech — POST https://api.speechify.ai/v1/audio/speech
 * (`tts`) and POST https://api.speechify.ai/v1/audio/stream (`ttsStream`).
 *
 * Wire reference: the live OpenAPI 3.1 spec at
 * https://docs.speechify.ai/openapi/api-reference.json, plus
 * https://docs.speechify.ai/build/text-to-speech-api,
 * https://docs.speechify.ai/build/guides/concepts/models and
 * https://docs.speechify.ai/build/guides/concepts/api-limits
 * (all verified 2026-11-12). Params mirror the wire body exactly.
 *
 * HOST: `https://api.speechify.ai` is the documented API base URL. The docs
 * site is explicit that this is the canonical host ("use exactly, do not
 * invent variants"). `eu.api.speechify.ai` and `us.api.speechify.ai` are
 * regional variants of it ("Only the base URL changes."), and
 * `api.sws.speechify.com` "is a legacy host, not a region: it stops serving on
 * 19 January 2027" (docs.speechify.ai/build/guides/get-started/regions,
 * 2026-11-12), so unmodel emits only the canonical host; swap the origin
 * yourself to pin a region.
 *
 * THE TWO ROUTES ARE NOT THE SAME SHAPE — this is the whole reason both are
 * validated separately:
 * - `audio_format` (wav/mp3/ogg/aac/pcm) exists ONLY on /v1/audio/speech.
 *   Sending it to /v1/audio/stream is a no-op, so unmodel rejects it there.
 * - `output_format` is on both, but the streaming enum drops the two `wav_*`
 *   values: "wav is only available on POST /v1/audio/speech".
 * - `Accept` is a HEADER on /v1/audio/stream (there is no such header on
 *   /v1/audio/speech, which always answers JSON). It rides in the params
 *   object as `accept` for ergonomics but is STRIPPED from the wire body onto
 *   `.request.headers`. `output_format` "takes precedence over this header".
 * - /v1/audio/speech takes 2,000 spoken characters and 20,000 as sent;
 *   /v1/audio/stream takes 20,000 spoken and 32,000 as sent.
 *
 * CHARACTER CAPS: an over-long `input` is reported as `over_output_limit` —
 * unmodel has no character-specific issue code, so the message and meta
 * ({ limitCharacters, actualCharacters, counted }) spell out that the limit is
 * in characters, not tokens, and which of the two counts it is.
 *
 * COST: "Text to speech is billed by the characters of text that are spoken.
 * SSML tags are not counted, and neither is whitespace at the very start or
 * end of the input; the spaces between words are." (speechify.ai/pricing,
 * 2026-11-12), so `input.length` is an upper bound — exactly what
 * `estimate.costUSD` is documented to be.
 *
 * NOT VALIDATED HERE: POST /v1/audio/stream/with-timestamps (an SSE route
 * whose body matches `stream`, but which rejects the two legacy Simba 1.6
 * models with 400 `speech_marks_unsupported`) and the dialogue route. The
 * voice-cloning routes are validated by ./voice-clone and
 * ./voice-consent-challenge.
 *
 * NO RESPONSE CHECKER on either route, and `/v1/audio/speech` answering JSON
 * is not an oversight. unmodel's response side reports quality, usage and cost
 * signals; that envelope is `audio_data` (base64 audio),
 * `billable_characters_count` and `speech_marks` — the audio, the count the
 * request layer already estimated, and an alignment document. Nothing to warn
 * about, so scope stays request validation. `/v1/audio/stream` answers an
 * audio stream, which has no JSON to check at all. `SPEECHIFY_TTS_DELIVERY`
 * in ./tts-params names where the bytes are.
 *
 * `.toSdk("speechify")` is the identity on `tts`: @speechify/api's
 * `GetSpeechRequest` is snake_case with exactly the wire keys. On `stream` it
 * builds that SDK's `StreamAudioRequest` — the stripped header as `Accept`
 * beside the wire body as `body`.
 */

import { z } from "zod";
import { createValidator, type PipelineContext } from "../../core/pipeline";
import { JSON_HEADERS, toValidated, type ExactKeys, type Validated } from "../../core/request";
import type { ValidateOptions } from "../../core/options";
import type { ValidateEstimate, ValidateResult } from "../../core/result";
import type { ModelInfo } from "../../core/catalog-types";
import type { EndpointConstraints } from "../../core/constraint-types";
import { computeCharacterCostUSD } from "../../core/cost";
import { models, type SpeechifyTtsModelId } from "./models";

export const AUDIO_SPEECH_URL = "https://api.speechify.ai/v1/audio/speech";
export const AUDIO_STREAM_URL = "https://api.speechify.ai/v1/audio/stream";
/**
 * SSE variant — same body as `stream`, but the two legacy Simba 1.6 models
 * return 400 `speech_marks_unsupported`. Not validated by unmodel.
 */
export const AUDIO_STREAM_WITH_TIMESTAMPS_URL =
  "https://api.speechify.ai/v1/audio/stream/with-timestamps";

/** Server-side default when `model` is omitted (OpenAPI `default: simba-3.0`). */
export const DEFAULT_MODEL_ID = "simba-3.0";

/**
 * "2,000 spoken characters" on /v1/audio/speech — API Limits (2026-11-12):
 * "Every limit counts the characters that are spoken, which are the
 * characters the request is billed for. SSML tags do not count".
 */
export const SPEECH_MAX_CHARACTERS = 2000;
/** "20,000 spoken characters" on /v1/audio/stream — API Limits. */
export const STREAM_MAX_CHARACTERS = 20000;
/**
 * "The input as sent, markup included, has its own ceiling: 20,000 characters
 * on `/v1/audio/speech`, and 32,000 on `/v1/audio/stream`" — API Limits;
 * OpenAPI `"maxLength":20000` on GetSpeechRequest.input.
 */
export const SPEECH_MAX_SENT_CHARACTERS = 20000;
/**
 * The as-sent ceiling on /v1/audio/stream — API Limits, above; OpenAPI
 * `"maxLength":32000` on GetStreamRequest.input.
 */
export const STREAM_MAX_SENT_CHARACTERS = 32000;

const SPEC_URL = "https://docs.speechify.ai/openapi/api-reference.json";
const LIMITS_DOCS = "https://docs.speechify.ai/build/guides/concepts/api-limits";
const MODELS_DOCS = "https://docs.speechify.ai/build/guides/concepts/models";
const PRONUNCIATION_DOCS = "https://docs.speechify.ai/build/guides/text-to-speech/pronunciation";

/**
 * "At most 200 entries." — OpenAPI `Pronunciations` (2026-11-12); API Limits:
 * "| Entries per request | 200 |".
 */
export const MAX_PRONUNCIATIONS = 200;

/**
 * Each model's `pronunciation_languages` in GET /v1/audio/models
 * (docs.speechify.ai/build/guides/concepts/models, 2026-11-12): the languages
 * in which it applies `pronunciations`. `simba-3.0` and `simba-3.2` publish
 * `"pronunciation_languages": []`; `simba-3.5` publishes its 48 languages but
 * English — "Simba 3.5 (`simba-3.5`) applies pronunciations in every language
 * it speaks except English, which is not supported yet." (pronunciation
 * guide). The legacy Simba 1.6 ids publish no value, so they have no entry and
 * are not gated.
 */
export const PRONUNCIATION_LANGUAGES = {
  "simba-3.0": [],
  "simba-3.2": [],
  "simba-3.5": [
    "ar", "be", "bn", "bs", "ca", "cs", "da", "de", "el", "es", "fa", "fi",
    "fr", "gu", "he", "hi", "hr", "hu", "id", "it", "ja", "ka", "kk", "ko",
    "la", "mr", "ms", "my", "nl", "no", "pl", "pt", "ro", "ru", "sk", "sl",
    "sr", "sv", "ta", "te", "th", "tl", "tr", "uk", "ur", "vi", "zh",
  ],
} as const satisfies Partial<Record<SpeechifyTtsModelId, readonly string[]>>;

// ---------------------------------------------------------------------------
// Wire types — mirror the raw JSON bodies exactly (snake_case).
// ---------------------------------------------------------------------------

/** `audio_format` enum — /v1/audio/speech only. Default "wav". */
export const AUDIO_FORMATS = ["wav", "mp3", "ogg", "aac", "pcm"] as const;
export type SpeechifyAudioFormat = (typeof AUDIO_FORMATS)[number];

/**
 * `output_format` on /v1/audio/speech: `codec_sampleRate_bitrate` strings —
 * OpenAPI `AudioOutputFormat`, "All 23 values, as the API accepts them."
 * (docs.speechify.ai/build/guides/concepts/audio-formats, 2026-11-12).
 */
export const SPEECH_OUTPUT_FORMATS = [
  "pcm_8000",
  "pcm_16000",
  "pcm_22050",
  "pcm_24000",
  "pcm_44100",
  "pcm_48000",
  "mp3_22050_32",
  "mp3_22050_64",
  "mp3_22050_96",
  "mp3_22050_128",
  "mp3_22050_160",
  "mp3_22050_192",
  "mp3_24000_32",
  "mp3_24000_64",
  "mp3_24000_96",
  "mp3_24000_128",
  "mp3_24000_160",
  "mp3_24000_192",
  "wav_24000",
  "wav_48000",
  "ulaw_8000",
  "ogg_24000",
  "aac_24000",
] as const;
export type SpeechifyOutputFormat = (typeof SPEECH_OUTPUT_FORMATS)[number];

/**
 * `output_format` on /v1/audio/stream — "Same as `AudioOutputFormat` minus the
 * `wav_*` formats: wav is only available on `POST /v1/audio/speech`."
 */
export const STREAM_OUTPUT_FORMATS = SPEECH_OUTPUT_FORMATS.filter(
  (format): format is Exclude<SpeechifyOutputFormat, "wav_24000" | "wav_48000"> =>
    format !== "wav_24000" && format !== "wav_48000",
);
export type SpeechifyStreamOutputFormat = (typeof STREAM_OUTPUT_FORMATS)[number];

/** `Accept` header values documented for /v1/audio/stream. */
export const STREAM_ACCEPT_VALUES = [
  "audio/mpeg",
  "audio/ogg",
  "audio/aac",
  "audio/pcm",
] as const;
export type SpeechifyStreamAccept = (typeof STREAM_ACCEPT_VALUES)[number];

export interface SpeechifyOptions {
  /**
   * Normalize output loudness to -14 LUFS / -2 dBTP / 7 LU. Default false;
   * "can increase latency".
   */
  loudness_normalization?: boolean;
  /**
   * Expand numbers, dates etc. into words. Default true on /v1/audio/speech
   * and false on /v1/audio/stream — the two routes differ.
   */
  text_normalization?: boolean;
}

/**
 * One `pronunciations` entry that says `text` with phones — mirrors OpenAPI
 * `PronunciationIpa` exactly ("Set `text` and exactly one of `ipa` or
 * `alias`.").
 */
export interface SpeechifyPronunciationIpa {
  /** One word as it appears in `input`: 1-64 characters, no whitespace, no control characters. */
  text: string;
  /** 1 to 64 phones from the model's phone set, separated by spaces or `|`. */
  ipa: string;
  alias?: never;
  /** Match `text` only with the same capitalization. Default false. */
  case_sensitive?: boolean;
}

/**
 * One `pronunciations` entry that says `alias` in place of `text` — mirrors
 * OpenAPI `PronunciationAlias` exactly.
 */
export interface SpeechifyPronunciationAlias {
  /** As it appears in `input`: 1-64 characters, no control characters, not only whitespace. */
  text: string;
  /** Plain text spoken instead: 1-160 characters, no control characters. */
  alias: string;
  ipa?: never;
  /** Match `text` only with the same capitalization. Default false. */
  case_sensitive?: boolean;
}

/** OpenAPI `Pronunciation`: a `oneOf` of the two entry kinds. */
export type SpeechifyPronunciation = SpeechifyPronunciationIpa | SpeechifyPronunciationAlias;

export interface AudioSpeechBody {
  /** Plain text or SSML: up to 2,000 spoken characters (SSML tags excluded), 20,000 as sent. */
  input: string;
  /** Voice id from GET /v1/voices. */
  voice_id: string;
  /** Defaults to "simba-3.0" server-side. */
  model?: SpeechifyTtsModelId | (string & {});
  /** ISO 639-1 + ISO 3166-1 region, e.g. "en-US". */
  language?: string;
  /** Container only; default "wav". /v1/audio/speech ONLY. */
  audio_format?: SpeechifyAudioFormat;
  /** `codec_sampleRate_bitrate`; takes precedence over `audio_format`. */
  output_format?: SpeechifyOutputFormat;
  options?: SpeechifyOptions;
  /**
   * At most 200 entries, applied only in the model's `pronunciation_languages`
   * ({@link PRONUNCIATION_LANGUAGES}). An empty array is accepted by every model.
   */
  pronunciations?: SpeechifyPronunciation[];
  /**
   * A stable, opaque id for the end user this request is made for — a hash of
   * your own user id, never an email address: 1-64 letters, digits and
   * `. _ - : | + / =`.
   */
  safety_identifier?: string;
}

export interface AudioStreamParams {
  /** Plain text or SSML: up to 20,000 spoken characters (SSML tags excluded), 32,000 as sent. */
  input: string;
  voice_id: string;
  model?: SpeechifyTtsModelId | (string & {});
  language?: string;
  /** `codec_sampleRate_bitrate`; no `wav_*` values on this route. */
  output_format?: SpeechifyStreamOutputFormat;
  options?: SpeechifyOptions;
  /** The same field and rules as {@link AudioSpeechBody.pronunciations}. */
  pronunciations?: SpeechifyPronunciation[];
  /** The same field and pattern as {@link AudioSpeechBody.safety_identifier}. */
  safety_identifier?: string;
  /**
   * HEADER param — stripped from the wire body onto `.request.headers.accept`.
   * Selects the container when `output_format` is unset.
   */
  accept?: SpeechifyStreamAccept;
}

/** `stream`'s wire body: identical to the params minus the header. */
export type AudioStreamBody = Omit<AudioStreamParams, "accept">;

/**
 * @speechify/api's `StreamAudioRequest`, what `client.audio.stream()` takes
 * from 4.0.0 (2026-08-19) through 5.0.0: "Accept?:
 * Speechify.StreamAudioRequestAccept; body: Speechify.GetStreamRequest;"
 * (registry.npmjs.org/@speechify/api, 5.0.0 tarball, 2026-11-12).
 */
export type AudioStreamSdkParams = { Accept?: SpeechifyStreamAccept; body: AudioStreamBody };

// ---------------------------------------------------------------------------
// Schemas (loose: unknown keys pass through with a warning).
// ---------------------------------------------------------------------------

const optionsSchema = z.looseObject({
  loudness_normalization: z.boolean().optional(),
  text_normalization: z.boolean().optional(),
});

/**
 * OpenAPI `SafetyIdentifier` "^[A-Za-z0-9._:|+/=-]{1,64}$" — "The value must
 * be 1 to 64 characters of letters, digits and `. _ - : | + / =`."
 * (docs.speechify.ai/build/guides/concepts/safety-identifiers, 2026-11-12).
 * ASCII only, so a UTF-16 count is the code-point count.
 */
const safetyIdentifierSchema = z
  .string()
  .regex(
    /^[A-Za-z0-9._:|+/=-]{1,64}$/,
    "safety_identifier must be 1 to 64 letters, digits or `. _ - : | + / =` — a hash or opaque id for your end user, never an email address.",
  );

/** Types only: the bounds, patterns and `ipa`/`alias` exclusivity are `checkPronunciationEntries`. */
const pronunciationsSchema = z.array(
  z.looseObject({
    text: z.string(),
    ipa: z.string().optional(),
    alias: z.string().optional(),
    case_sensitive: z.boolean().optional(),
  }),
);

const ttsSchema = z.looseObject({
  input: z.string().min(1, "input must not be empty."),
  voice_id: z.string().min(1, "voice_id must not be empty."),
  model: z.string().optional(),
  language: z.string().optional(),
  audio_format: z.enum(AUDIO_FORMATS).optional(),
  output_format: z.string().optional(),
  options: optionsSchema.optional(),
  pronunciations: pronunciationsSchema.optional(),
  safety_identifier: safetyIdentifierSchema.optional(),
});

const streamSchema = z.looseObject({
  input: z.string().min(1, "input must not be empty."),
  voice_id: z.string().min(1, "voice_id must not be empty."),
  model: z.string().optional(),
  language: z.string().optional(),
  output_format: z.string().optional(),
  options: optionsSchema.optional(),
  pronunciations: pronunciationsSchema.optional(),
  safety_identifier: safetyIdentifierSchema.optional(),
  accept: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

const SPEECH_OUTPUT_FORMAT_SET = new Set<string>(SPEECH_OUTPUT_FORMATS);
const STREAM_OUTPUT_FORMAT_SET = new Set<string>(STREAM_OUTPUT_FORMATS);
const ACCEPT_SET = new Set<string>(STREAM_ACCEPT_VALUES);

type AnyParams = AudioSpeechBody | AudioStreamParams;

/**
 * Text that may carry SSML or an entity — "SSML tags do not count, an entity
 * such as `&amp;` is one character, and a `<sub>` counts its `alias`." (API
 * Limits) — so its spoken count is not its length.
 */
const MARKUP = /<|&#?\w+;/;

/**
 * Per-route `input` caps, both in code points ("A character is one Unicode
 * code point, so an emoji is one character even where JavaScript's `length`
 * counts two." — API Limits):
 *
 * - the as-sent ceiling, "markup included", always;
 * - the spoken cap, on input with no markup, counted without the leading and
 *   trailing whitespace billing skips ("Every limit counts the characters that
 *   are spoken, which are the characters the request is billed for."). The
 *   spoken count of SSML takes an SSML parser, so markup input gets only the
 *   ceiling: over-accepting is recoverable, refusing a request the API
 *   fulfils is not.
 *
 * Both caps are documented on the endpoint, not the model, so they apply even
 * when the model id is unknown to the catalog; the catalog's (spoken)
 * `limit.characters` only ever narrows the spoken cap.
 */
function checkInputLength(route: "speech" | "stream", spokenCap: number, sentCap: number) {
  return (params: AnyParams, info: ModelInfo | undefined, ctx: PipelineContext): void => {
    const model = params.model ?? DEFAULT_MODEL_ID;
    const sent = [...params.input].length;
    if (sent > sentCap) {
      ctx.report({
        code: "over_output_limit",
        path: ["input"],
        model,
        message: `\`input\` is ${sent} characters as sent; POST /v1/audio/${route} caps the input as sent, markup included, at ${sentCap} characters, and its spoken text at ${spokenCap} (these limits are in characters, not tokens). Split the input.`,
        meta: {
          limitCharacters: sentCap,
          actualCharacters: sent,
          counted: "sent",
          source: LIMITS_DOCS,
        },
      });
      return;
    }
    if (MARKUP.test(params.input)) return;
    const catalogCap = info?.limit.characters;
    const limit =
      catalogCap !== undefined && catalogCap > 0 ? Math.min(spokenCap, catalogCap) : spokenCap;
    const spoken = [...params.input.trim()].length;
    if (spoken <= limit) return;
    const longer =
      route === "speech" ? `, or use POST /v1/audio/stream for up to ${STREAM_MAX_CHARACTERS}` : "";
    ctx.report({
      code: "over_output_limit",
      path: ["input"],
      model,
      message: `\`input\` is ${spoken} characters; POST /v1/audio/${route} caps a request at ${limit} spoken characters (this limit is in characters, not tokens; SSML tags do not count toward it). Split the input${longer}.`,
      meta: {
        limitCharacters: limit,
        actualCharacters: spoken,
        counted: "spoken",
        source: LIMITS_DOCS,
      },
    });
  };
}

function checkOutputFormat(allowed: readonly string[], set: Set<string>, route: string) {
  return (params: AnyParams, _info: ModelInfo | undefined, ctx: PipelineContext): void => {
    const format = params.output_format;
    if (format === undefined || set.has(format)) return;
    const wavOnTts =
      route === "stream" && (format === "wav_24000" || format === "wav_48000");
    ctx.report({
      code: "invalid_enum_value",
      path: ["output_format"],
      message: wavOnTts
        ? `\`output_format\` ${JSON.stringify(format)} is not available on POST /v1/audio/stream — "wav is only available on POST /v1/audio/speech".`
        : `\`output_format\` must be one of ${allowed.map((v) => JSON.stringify(v)).join(", ")}; got ${JSON.stringify(format)}.`,
      meta: { allowed: [...allowed], value: format, source: SPEC_URL },
    });
  };
}

/**
 * `simba-3.2` "is English only, so a non-English voice returns 400". unmodel
 * cannot see the voice's locale, but it can see an explicitly non-English
 * `language`, which is the same rejection with a visible cause.
 *
 * `simba-3.0`'s off-list languages are deliberately NOT gated: the docs say
 * they "often work but are not validated", so an error would be wrong.
 */
function checkModelLanguage(
  params: AnyParams,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const model = params.model ?? DEFAULT_MODEL_ID;
  if (model !== "simba-3.2" || info === undefined) return;
  const language = params.language;
  if (language === undefined || /^en(-|$)/i.test(language)) return;
  ctx.report({
    code: "unsupported_capability",
    path: ["language"],
    model,
    message: `\`language\` is ${JSON.stringify(language)}, but "simba-3.2" is English only — a non-English request returns 400. Use "simba-3.5" (48 languages) or "simba-3.0" (English + de-DE, es-ES, es-MX, fr-FR, it-IT, pt-BR).`,
    meta: { value: language, source: MODELS_DOCS },
  });
}

/** OpenAPI `PronunciationIpaText` "^[^\\s\\x00-\\x1F\\x7F-\\x9F]+$": one word. */
const IPA_TEXT_PATTERN = /^[^\s\x00-\x1F\x7F-\x9F]+$/;
/** OpenAPI `PronunciationText`: no control characters, not only whitespace. */
const ALIAS_TEXT_PATTERN = /^[^\x00-\x1F\x7F-\x9F]*[^\s\x00-\x1F\x7F-\x9F][^\x00-\x1F\x7F-\x9F]*$/;
/** OpenAPI `PronunciationAlias.alias` "^[^\\x00-\\x1F\\x7F-\\x9F]*$". */
const ALIAS_PATTERN = /^[^\x00-\x1F\x7F-\x9F]*$/;
/** "| `text` of one entry | 64 characters |" — API Limits. */
const MAX_PRONUNCIATION_TEXT = 64;
/** "| `ipa` of one entry | 64 phones |" — API Limits. */
const MAX_PRONUNCIATION_PHONES = 64;
/** "| `alias` of one entry | 160 characters |" — API Limits. */
const MAX_PRONUNCIATION_ALIAS = 160;

/**
 * The shape rules of `pronunciations` every model shares: "A malformed entry,
 * a phone outside the model's phone set, an `ipa` entry whose `text` is more
 * than one word, or two entries for the same `text` returns `400
 * validation_failed`" (OpenAPI `Pronunciations`, 2026-11-12).
 *
 * Lengths count code points, as JSON Schema's `maxLength` does. Phones are
 * counted as the runs between spaces and `|`, the two documented separators,
 * so the count never exceeds the server's. The phone set itself, and the
 * 20,000-character cap on `input` "with every alias in place of its text"
 * (counted "per part where SSML splits it"), need the model's inventory and an
 * SSML parser, so they stay the API's to enforce.
 */
function checkPronunciationEntries(
  params: AnyParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const entries = params.pronunciations;
  if (entries === undefined) return;
  if (entries.length > MAX_PRONUNCIATIONS) {
    ctx.report({
      code: "invalid_shape",
      path: ["pronunciations"],
      message: `\`pronunciations\` has ${entries.length} entries; Speechify takes at most ${MAX_PRONUNCIATIONS} per request.`,
      meta: { max: MAX_PRONUNCIATIONS, actual: entries.length, source: LIMITS_DOCS },
    });
    return;
  }
  entries.forEach((entry, index) => checkPronunciationEntry(entry, index, ctx));
  checkDuplicateTexts(entries, ctx);
}

function checkPronunciationEntry(
  entry: SpeechifyPronunciation,
  index: number,
  ctx: PipelineContext,
): void {
  const at = `pronunciations[${index}]`;
  if ((entry.ipa === undefined) === (entry.alias === undefined)) {
    ctx.report({
      code: "invalid_shape",
      path: ["pronunciations", index],
      message: `\`${at}\` must set \`text\` and exactly one of \`ipa\` (the phones to say it with) or \`alias\` (plain text to say in its place).`,
      meta: { source: SPEC_URL },
    });
    return;
  }
  const textLength = [...entry.text].length;
  const textPattern = entry.ipa !== undefined ? IPA_TEXT_PATTERN : ALIAS_TEXT_PATTERN;
  if (textLength < 1 || textLength > MAX_PRONUNCIATION_TEXT) {
    ctx.report({
      code: "invalid_shape",
      path: ["pronunciations", index, "text"],
      message: `\`${at}.text\` is ${textLength} characters; it takes 1 to ${MAX_PRONUNCIATION_TEXT}.`,
      meta: { min: 1, max: MAX_PRONUNCIATION_TEXT, actual: textLength, source: LIMITS_DOCS },
    });
  } else if (!textPattern.test(entry.text)) {
    ctx.report({
      code: "invalid_shape",
      path: ["pronunciations", index, "text"],
      message:
        entry.ipa !== undefined
          ? `\`${at}.text\` ${JSON.stringify(entry.text)} must be one word with no whitespace or control characters: give a phrase one \`ipa\` entry per word, or use an \`alias\`.`
          : `\`${at}.text\` ${JSON.stringify(entry.text)} must have no control characters and must not be only whitespace.`,
      meta: { source: SPEC_URL },
    });
  }
  if (entry.ipa !== undefined) {
    const phones = entry.ipa.split(/[ |]+/).filter((phone) => phone !== "").length;
    if (phones < 1 || phones > MAX_PRONUNCIATION_PHONES) {
      ctx.report({
        code: "invalid_shape",
        path: ["pronunciations", index, "ipa"],
        message: `\`${at}.ipa\` has ${phones} phones; it takes 1 to ${MAX_PRONUNCIATION_PHONES}, separated by spaces or \`|\`.`,
        meta: { min: 1, max: MAX_PRONUNCIATION_PHONES, actual: phones, source: LIMITS_DOCS },
      });
    }
    return;
  }
  const alias = entry.alias;
  const aliasLength = [...alias].length;
  if (aliasLength < 1 || aliasLength > MAX_PRONUNCIATION_ALIAS) {
    ctx.report({
      code: "invalid_shape",
      path: ["pronunciations", index, "alias"],
      message: `\`${at}.alias\` is ${aliasLength} characters; it takes 1 to ${MAX_PRONUNCIATION_ALIAS}.`,
      meta: { min: 1, max: MAX_PRONUNCIATION_ALIAS, actual: aliasLength, source: LIMITS_DOCS },
    });
  } else if (!ALIAS_PATTERN.test(alias)) {
    ctx.report({
      code: "invalid_shape",
      path: ["pronunciations", index, "alias"],
      message: `\`${at}.alias\` must have no control characters.`,
      meta: { source: SPEC_URL },
    });
  }
}

/**
 * "Two entries with the same `text` return `400 validation_failed`; texts
 * compare case-insensitively unless both entries are `case_sensitive`."
 * (OpenAPI `PronunciationText`). Reported once, on the later entry.
 */
function checkDuplicateTexts(
  entries: readonly SpeechifyPronunciation[],
  ctx: PipelineContext,
): void {
  entries.forEach((entry, later) => {
    const earlier = entries.slice(0, later).findIndex((other) => sameText(other, entry));
    if (earlier === -1) return;
    ctx.report({
      code: "invalid_shape",
      path: ["pronunciations", later, "text"],
      message: `\`pronunciations[${later}].text\` ${JSON.stringify(entry.text)} repeats \`pronunciations[${earlier}]\`: texts compare case-insensitively unless both entries are \`case_sensitive\`, and a repeat returns 400 validation_failed.`,
      meta: { duplicateOf: earlier, source: SPEC_URL },
    });
  });
}

function sameText(a: SpeechifyPronunciation, b: SpeechifyPronunciation): boolean {
  return a.case_sensitive === true && b.case_sensitive === true
    ? a.text === b.text
    : a.text.toLowerCase() === b.text.toLowerCase();
}

/**
 * "A request whose model or language is not listed refuses the field with
 * `400 pronunciations_unsupported` rather than ignoring it.", "An empty
 * `pronunciations` list is the same as none, on every model." and "A request
 * that omits `model` gets the default model" (pronunciation guide, 2026-11-12).
 *
 * A model that lists no language (`simba-3.0`, `simba-3.2`) is an error. A
 * `simba-3.5` request whose explicit `language` is not listed is a WARNING:
 * the gap today is English, which the guide calls "not supported yet" ("Simba
 * 3.5 refuses pronunciations in English for now."), and the OpenAPI says the
 * set "reflects current capability and can grow over time". With `language`
 * omitted the voice's locale decides, which unmodel cannot see.
 */
function checkPronunciationSupport(
  params: AnyParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (params.pronunciations === undefined || params.pronunciations.length === 0) return;
  const model = params.model ?? DEFAULT_MODEL_ID;
  if (!Object.hasOwn(PRONUNCIATION_LANGUAGES, model)) return;
  const listed: readonly string[] =
    PRONUNCIATION_LANGUAGES[model as keyof typeof PRONUNCIATION_LANGUAGES];
  if (listed.length === 0) {
    ctx.report({
      code: "unsupported_capability",
      path: ["pronunciations"],
      model,
      message: `"${model}" applies no \`pronunciations\` (its \`pronunciation_languages\` is empty), so a non-empty list returns 400 pronunciations_unsupported. Use "simba-3.5", which applies them in every language it speaks except English; send \`[]\`; or spell the word out with SSML \`<sub alias>\` in \`input\`.`,
      meta: { source: PRONUNCIATION_DOCS },
    });
    return;
  }
  const language = params.language;
  if (language === undefined) return;
  // The list holds primary subtags; `language` usually carries a region ("es-MX").
  const primary = language.toLowerCase().replace(/[-_].*$/s, "");
  if (listed.includes(primary)) return;
  ctx.report({
    code: "unsupported_capability",
    severity: "warning",
    path: ["pronunciations"],
    model,
    message: `\`language\` is ${JSON.stringify(language)}, which is not among the ${listed.length} languages "${model}" applies \`pronunciations\` in (English is "not supported yet"), so Speechify answers 400 pronunciations_unsupported today. Drop \`pronunciations\`, or spell the word out with SSML \`<sub alias>\` in \`input\`.`,
    meta: { value: language, allowed: [...listed], source: PRONUNCIATION_DOCS },
  });
}

/** `audio_format` is a /v1/audio/speech field; on the stream route it is dead weight. */
function checkNoAudioFormat(
  params: AudioStreamParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const value = (params as { audio_format?: unknown }).audio_format;
  if (value === undefined) return;
  ctx.report({
    code: "unsupported_param",
    path: ["audio_format"],
    message:
      "`audio_format` is only a field of POST /v1/audio/speech; POST /v1/audio/stream selects its container with the `Accept` header (pass `accept`) or with `output_format`, which takes precedence over it.",
    meta: { source: SPEC_URL },
  });
}

function checkAccept(
  params: AudioStreamParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const accept = params.accept;
  if (accept === undefined || ACCEPT_SET.has(accept)) return;
  ctx.report({
    code: "invalid_enum_value",
    path: ["accept"],
    message: `\`accept\` must be one of ${STREAM_ACCEPT_VALUES.map((v) => JSON.stringify(v)).join(", ")}; got ${JSON.stringify(accept)}.`,
    meta: { allowed: [...STREAM_ACCEPT_VALUES], value: accept, source: SPEC_URL },
  });
}

// ---------------------------------------------------------------------------
// Estimation — billed per input character (catalog cost.perMillionCharacters).
// ---------------------------------------------------------------------------

function estimate(
  params: AnyParams,
  info: ModelInfo | undefined,
  _ctx: PipelineContext,
): ValidateEstimate {
  const costUSD = computeCharacterCostUSD(info?.cost, params.input.length);
  return costUSD === undefined ? {} : { costUSD };
}

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

/**
 * SDK targets for `speechify.tts`. @speechify/api's `GetSpeechRequest` is
 * snake_case with exactly the wire keys, so the single `"speechify"` formatter
 * is the identity. Type alias, not interface: an interface has no implicit
 * index signature and cannot satisfy `SdkFormatters`.
 */
type TtsSdkTargets<B> = { speechify: () => B };

/** SDK targets for `speechify.ttsStream` — @speechify/api's `StreamAudioRequest`. */
type TtsStreamSdkTargets<B> = { speechify: () => B };

function finalizeTts(
  params: AudioSpeechBody,
): Validated<AudioSpeechBody, TtsSdkTargets<AudioSpeechBody>> {
  const body = { ...params };
  return toValidated(
    body,
    {
      url: AUDIO_SPEECH_URL,
      method: "POST",
      headers: JSON_HEADERS,
    },
    { sdk: { speechify: () => body } },
  );
}

const ttsValidator = createValidator<
  AudioSpeechBody,
  Validated<AudioSpeechBody, TtsSdkTargets<AudioSpeechBody>>
>({
  endpoint: "speechify.tts",
  schema: ttsSchema,
  modelId: (params) => params.model ?? DEFAULT_MODEL_ID,
  catalog: models,
  checks: [
    checkInputLength("speech", SPEECH_MAX_CHARACTERS, SPEECH_MAX_SENT_CHARACTERS),
    checkOutputFormat(SPEECH_OUTPUT_FORMATS, SPEECH_OUTPUT_FORMAT_SET, "speech"),
    checkModelLanguage,
    checkPronunciationEntries,
    checkPronunciationSupport,
  ],
  estimate,
  finalize: finalizeTts,
});

function finalizeStream(params: AudioStreamParams): unknown {
  const { accept, ...body } = params;
  return toValidated(
    body,
    {
      url: AUDIO_STREAM_URL,
      method: "POST",
      headers: { ...JSON_HEADERS, ...(accept !== undefined && { accept }) },
    },
    { sdk: { speechify: () => ({ ...(accept !== undefined && { Accept: accept }), body }) } },
  );
}

const streamValidator = createValidator<AudioStreamParams, unknown>({
  endpoint: "speechify.ttsStream",
  schema: streamSchema,
  modelId: (params) => params.model ?? DEFAULT_MODEL_ID,
  catalog: models,
  checks: [
    checkInputLength("stream", STREAM_MAX_CHARACTERS, STREAM_MAX_SENT_CHARACTERS),
    checkOutputFormat(STREAM_OUTPUT_FORMATS, STREAM_OUTPUT_FORMAT_SET, "stream"),
    checkModelLanguage,
    checkPronunciationEntries,
    checkPronunciationSupport,
    checkNoAudioFormat,
    checkAccept,
  ],
  estimate,
  finalize: finalizeStream,
});

/**
 * Validates raw wire params for `POST /v1/audio/speech` — the non-streaming
 * route, which answers JSON (`audio_data` base64 + `billable_characters_count`
 * + `speech_marks`) and caps `input` at 2,000 spoken characters.
 *
 * The returned object's enumerable props are the exact fetch JSON body;
 * `.toSdk("speechify")` returns it unchanged (@speechify/api's `GetSpeechRequest` is
 * snake_case with the same keys) and `.request` carries url/method/static
 * headers. Auth is your job: add an `authorization: Bearer …` header.
 *
 * ```ts
 * const params = speechify.tts({
 *   input: "Hello from Speechify.",
 *   voice_id: "geffen_32",
 *   model: "simba-3.2",
 *   audio_format: "mp3",
 * });
 * const res = await fetch(params.request.url, {
 *   method: params.request.method,
 *   headers: { ...params.request.headers, authorization: `Bearer ${process.env.SPEECHIFY_API_KEY!}` },
 *   body: JSON.stringify(params),
 * });
 * ```
 */
export const tts = ttsValidator as unknown as {
  <T extends AudioSpeechBody>(
    params: T & ExactKeys<T, AudioSpeechBody>,
    options?: ValidateOptions<T>,
  ): Validated<T, TtsSdkTargets<T>>;
  safe<T extends AudioSpeechBody>(
    params: T & ExactKeys<T, AudioSpeechBody>,
    options?: ValidateOptions<T>,
  ): ValidateResult<Validated<T, TtsSdkTargets<T>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};

/**
 * Validates raw wire params for `POST /v1/audio/stream` — chunked raw audio
 * bytes, `input` up to 20,000 spoken characters, no `audio_format` and no
 * `wav_*` `output_format`.
 *
 * `accept` is stripped from the body onto `.request.headers.accept`;
 * `.toSdk("speechify")` returns `{ Accept, body }`, the `StreamAudioRequest`
 * that @speechify/api's `client.audio.stream()` takes.
 *
 * ```ts
 * const params = speechify.ttsStream({
 *   input: longArticle,
 *   voice_id: "geffen_32",
 *   model: "simba-3.2",
 *   output_format: "mp3_24000_128",
 * });
 * const res = await fetch(params.request.url, {
 *   method: params.request.method,
 *   headers: { ...params.request.headers, authorization: `Bearer ${process.env.SPEECHIFY_API_KEY!}` },
 *   body: JSON.stringify(params),
 * });
 * ```
 */
export const ttsStream = streamValidator as unknown as {
  <T extends AudioStreamParams>(
    params: T & ExactKeys<T, AudioStreamParams>,
    options?: ValidateOptions<T>,
  ): Validated<Omit<T, "accept">, TtsStreamSdkTargets<AudioStreamSdkParams>>;
  safe<T extends AudioStreamParams>(
    params: T & ExactKeys<T, AudioStreamParams>,
    options?: ValidateOptions<T>,
  ): ValidateResult<Validated<Omit<T, "accept">, TtsStreamSdkTargets<AudioStreamSdkParams>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
