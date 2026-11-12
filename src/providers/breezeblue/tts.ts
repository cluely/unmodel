/**
 * BreezeBlue Text to Speech — POST https://api.breeze.blue/v1/text-to-speech/{voice_id}
 *
 * Wire reference (all verified 2026-11-12):
 * - https://docs.breezeblue.ai/api-reference/text-to-speech/convert-text-to-speech
 * - the OpenAPI 3.1 spec the docs serve at https://docs.breezeblue.ai/openapi.json
 *   ("Breeze Developer API", `TtsRequest` / `TtsVoiceSettingsPayload`)
 * - https://docs.breezeblue.ai/concepts/output-format,
 *   https://docs.breezeblue.ai/concepts/pricing and
 *   https://docs.breezeblue.ai/guides/text-to-speech
 * - the official `@breeze.blue/sdk` (v0.23.0) type declarations.
 *
 * WHERE EACH PARAM RIDES:
 * - `voice_id` is a URL path param: it sits in the params object for
 *   ergonomics but is STRIPPED from the wire body and interpolated into
 *   `.request.url`. Voice ids (`voc_…`) come from GET /v1/voices.
 * - `output_format` and `delivery` are QUERY params: also stripped from the
 *   body and appended to `.request.url`. The JSON body would reject them
 *   anyway — see STRICT BODY below.
 * - Everything else (`text`, `model_id`, `language_code`, `instructions`,
 *   `voice_settings`) is the JSON body, exactly the OpenAPI `TtsRequest`.
 *
 * STRICT BODY: `TtsRequest` and `TtsVoiceSettingsPayload` are both
 * `additionalProperties: false` in the OpenAPI spec, so an unknown body key is
 * a certain `422 VALIDATION_ERROR`, not the silent no-op most providers give
 * it. Like `krea.image` (the repo's other closed-schema wire), the schema here
 * is strict: a typo'd key fails validation instead of warning.
 *
 * DELIVERY: `delivery=sync` (the default) answers 200 with raw audio bytes —
 * Content-Type matches `output_format` — so there is no response checker.
 * `delivery=async` answers `202 { generation_job_id, … }`; poll
 * GET /v1/generation-jobs/{id} and download via
 * GET /v1/generation-jobs/{id}/audio (transport — out of unmodel's scope).
 * "Async delivery does not bypass concurrent generation limits."
 *
 * LANGUAGE: `language_code` is "Optional ISO 639-1 two-letter language code"
 * with the wire pattern `^[A-Za-z]{2}$`; which codes a model actually serves
 * is runtime data ("The selected model must list the code in
 * supported_languages" — GET /v1/models). unmodel enforces the pattern only.
 *
 * INSTRUCTIONS: free-text performance direction. Documented rule: "Write
 * `instructions` in the same language as the input text and `language_code`.
 * The API, SDKs, CLI, and realtime WebSocket send instructions to the selected
 * TTS model as authored; they do not translate them before inference." Not
 * validatable — a language gate on prose would be a guess — so it is
 * documented, not enforced. `voice_settings.guidance_scale` (1.0–10.0,
 * default 1.0) sets how strongly generation follows the instructions and the
 * reference voice.
 *
 * TEXT LIMIT: "Up to 1000 characters by default; accounts with an approved
 * higher limit may send up to their configured limit, at most 2000
 * characters" (OpenAPI `TtsRequest.text`), and "longer text is rejected
 * rather than truncated" (guides/text-to-speech). Over 2,000 is an error;
 * 1,001–2,000 warns, because unmodel cannot see whether this account has the
 * higher limit. See {@link checkTextLength}.
 *
 * SPEED AND VOLUME live in `voice_settings` (0.5–2.0 and 0.01–2.0, both
 * default 1.0) — "`speed` and `volume` are HTTP-only; both default to `1.0`."
 *
 * OUTPUT PROFILES: `output_format` is a bare encoding name or a
 * `codec_sample_rate[_bitrate]` profile — fourteen values in all, every
 * profile at the native 24 kHz. See {@link OUTPUT_FORMATS}.
 *
 * NOT VALIDATED HERE: the streaming route POST
 * /v1/text-to-speech/{voice_id}/stream (same `TtsRequest` body; query
 * `output_format` restricted to pcm|mp3|wav, default pcm — `textToSpeechStreamUrl`
 * is exported for convenience), the two word-timestamp routes
 * (POST /v1/text-to-speech/{voice_id}/with-timestamps and
 * /stream/with-timestamps), the realtime WebSocket sessions
 * (POST /v1/text-to-speech/{voice_id}/realtime-sessions; "Realtime WebSocket
 * supports pcm (default) or mp3"), and the instruction-enhance endpoint.
 *
 * AUTH IS YOUR JOB, and it is an `xi-api-key: <key>` header (ElevenLabs-style
 * spelling — NOT `Bearer`), per https://docs.breezeblue.ai/authentication.
 * `Authorization: Bearer <key>` is documented as an equivalent alternative;
 * when both are present `xi-api-key` wins. Keys come from the BreezeBlue
 * developer console (`BREEZE_API_KEY` in every documented sample).
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
  TTS_COST_PER_MILLION_CHARACTERS_USD,
  TTS_DEFAULT_MAX_CHARACTERS,
  TTS_MAX_CHARACTERS,
} from "./models";

export const TEXT_TO_SPEECH_BASE_URL = "https://api.breeze.blue/v1/text-to-speech";

const CONVERT_DOCS =
  "https://docs.breezeblue.ai/api-reference/text-to-speech/convert-text-to-speech";
const OPENAPI_URL = "https://docs.breezeblue.ai/openapi.json";
const OUTPUT_FORMAT_DOCS = "https://docs.breezeblue.ai/concepts/output-format";
const TTS_GUIDE_DOCS = "https://docs.breezeblue.ai/guides/text-to-speech";

/**
 * `output_format` query values of the non-streaming route, in the OpenAPI
 * enum's order (the SDK's `TTS_OUTPUT_FORMATS` tuple is the same fourteen):
 * six bare encodings, then eight profiles. "A profile uses
 * `codec_sample_rate_bitrate`, omitting the bitrate for WAV, PCM, and FLAC"
 * and "Profiles apply to sync and async conversion. Invalid formats return
 * BAD_REQUEST." (OUTPUT_FORMAT_DOCS). Every profile is 24 kHz — "BreezeBlue
 * generates native 24 kHz mono audio" — and there is no Opus profile. Default
 * "mp3" ("MP3, 128 kbps by default").
 */
export const OUTPUT_FORMATS = [
  "mp3",
  "wav",
  "flac",
  "pcm",
  "aac",
  "opus",
  "mp3_24000_64",
  "mp3_24000_96",
  "mp3_24000_128",
  "mp3_24000_160",
  "wav_24000",
  "pcm_24000",
  "flac_24000",
  "aac_24000_128",
] as const;
export type BreezeblueOutputFormat = (typeof OUTPUT_FORMATS)[number];

/** Server default when `output_format` is omitted on the non-streaming route. */
export const DEFAULT_OUTPUT_FORMAT = "mp3";

/**
 * The streaming route's narrower `output_format` set — "Streaming output
 * encoding. Supported values: pcm, mp3, wav. Default: pcm for lower time to
 * first audio." Opus is documented "Non-streaming only", and profiles are
 * not streamed: "Use bare encoding names without profile suffixes."
 */
export const STREAM_OUTPUT_FORMATS = ["pcm", "mp3", "wav"] as const;
export type BreezeblueStreamOutputFormat = (typeof STREAM_OUTPUT_FORMATS)[number];

/**
 * `delivery` query values (OpenAPI pattern `^(sync|async)$`, default "sync").
 * "Use sync for the default audio response, or async to create a background
 * generation job and poll for the result."
 */
export const DELIVERY_MODES = ["sync", "async"] as const;
export type BreezeblueDelivery = (typeof DELIVERY_MODES)[number];

/** `voice_settings.guidance_scale` bounds — "Accepted range: 1.0 to 10.0." */
export const GUIDANCE_SCALE_MIN = 1;
export const GUIDANCE_SCALE_MAX = 10;
/** Server default of `guidance_scale` (OpenAPI `default: 1.0`). */
export const DEFAULT_GUIDANCE_SCALE = 1;

/** `voice_settings.speed` bounds — "Range: 0.5–2.0; default: 1.0." */
export const SPEED_MIN = 0.5;
export const SPEED_MAX = 2;

/** `voice_settings.volume` bounds — "Range: 0.01–2.0 (1%–200%); default: 1.0." */
export const VOLUME_MIN = 0.01;
export const VOLUME_MAX = 2;

/** `model_id` length bounds (OpenAPI: `minLength: 1, maxLength: 120`). */
export const MODEL_ID_MAX_LENGTH = 120;

// ---------------------------------------------------------------------------
// Wire types — mirror the raw JSON body exactly (snake_case). Explicit `null`
// means "use the provider default" on nullable fields; the wire accepts it.
// ---------------------------------------------------------------------------

/**
 * OpenAPI `TtsVoiceSettingsPayload` — also `additionalProperties: false`, with
 * exactly these four members. Only `guidance_scale` is nullable.
 */
export interface BreezeblueVoiceSettings {
  /**
   * "Generation guidance strength. Accepted range: 1.0 to 10.0." Default 1.0.
   * Higher values follow `instructions` and the reference voice more closely.
   */
  guidance_scale?: number | null;
  /**
   * "Speech speed multiplier that preserves pitch. Range: 0.5–2.0; default:
   * 1.0." HTTP-only — the realtime WebSocket does not take it.
   */
  speed?: number;
  /**
   * "Request-only linear amplitude multiplier. Range: 0.01–2.0 (1%–200%);
   * default: 1.0. Values above 1.0 may clip peaks. Does not normalize
   * loudness."
   */
  volume?: number;
  /**
   * "Improve similarity to the reference voice. Default: false. Ignored when
   * instructions are non-empty and guidance_scale is above 1; otherwise, when
   * true, guidance_scale is applied as 1. Instructions are always applied."
   */
  use_speaker_boost?: boolean;
}

/** The JSON body — OpenAPI `TtsRequest`, verbatim. */
export interface TtsBody {
  /**
   * Text to synthesize, non-empty. "Up to 1000 characters by default;
   * accounts with an approved higher limit may send up to their configured
   * limit, at most 2000 characters." Billed "per character of the request
   * text", with Han ideographs, kana and Hangul at two billable units each.
   */
  text: string;
  /**
   * "Model ID for speech generation. Selected automatically when omitted." —
   * 1–120 chars. The documented values are "breeze-tts-2" and
   * "breeze-tts-2-multilingual" (plus its compatibility alias
   * "breeze-tts-2-preview"); live ids come from GET /v1/models. Omitted or
   * null, the server routes by `language_code`: "en" or "zh" selects
   * "breeze-tts-2", any other code — or none — "breeze-tts-2-multilingual".
   */
  model_id?: BreezeblueModelIdOrString | null;
  /**
   * "Optional ISO 639-1 two-letter language code. The selected model must
   * list the code in supported_languages" (runtime data — GET /v1/models).
   */
  language_code?: string | null;
  /**
   * "Performance instructions, written in the same language as the input
   * text. Leading and trailing whitespace is removed." Never translated
   * before inference.
   */
  instructions?: string | null;
  /** Per-request voice-settings override; see {@link BreezeblueVoiceSettings}. */
  voice_settings?: BreezeblueVoiceSettings | null;
}

type BreezeblueModelIdOrString = keyof typeof models | (string & {});

/**
 * The two documented query params of POST /v1/text-to-speech/{voice_id}.
 * Typed exactly like their `TtsParams` counterparts so hand-built URLs get
 * the same autocomplete as validated ones.
 */
export interface TtsQuery {
  /** QUERY param — encoding or 24 kHz profile of the response bytes. Default "mp3". */
  output_format?: BreezeblueOutputFormat;
  /** QUERY param — "sync" (default, audio bytes) or "async" (202 job). */
  delivery?: BreezeblueDelivery;
}

export interface TtsParams extends TtsBody, TtsQuery {
  /**
   * URL path param — stripped from the wire body; `.request.url` is
   * `${TEXT_TO_SPEECH_BASE_URL}/{voice_id}`. Ids (`voc_…`) come from
   * GET /v1/voices.
   */
  voice_id: string;
}

// ---------------------------------------------------------------------------
// SDK view — @breeze.blue/sdk is camelCase and takes the voice id and the
// query params as separate arguments:
// `client.textToSpeech.convert(voiceId, request, options)` for sync,
// `client.textToSpeech.createJob(voiceId, request, options)` for async (the
// SDK sets `delivery=async` itself — its options object has no delivery key).
// ---------------------------------------------------------------------------

/** The SDK's `TtsVoiceSettings`: the wire's four members, camelCased. */
export interface BreezeblueSdkVoiceSettings {
  guidanceScale?: number;
  speed?: number;
  volume?: number;
  useSpeakerBoost?: boolean;
}

export interface BreezeblueSdkRequest {
  text: string;
  modelId?: string;
  languageCode?: string;
  instructions?: string;
  voiceSettings?: BreezeblueSdkVoiceSettings;
}

export interface BreezeblueSdkOptions {
  outputFormat?: BreezeblueOutputFormat;
}

export interface BreezeblueSdkParams {
  voiceId: string;
  request: BreezeblueSdkRequest;
  options: BreezeblueSdkOptions;
  /**
   * Which SDK method takes `(voiceId, request, options)`: `convert` for
   * `delivery: "sync"`/omitted, `createJob` for `delivery: "async"` (the SDK
   * appends `delivery=async` itself and returns the 202 job JSON).
   */
  method: "convert" | "createJob";
}

// ---------------------------------------------------------------------------
// Schema — STRICT at every level (see the module JSDoc: `TtsRequest` and
// `TtsVoiceSettingsPayload` are both `additionalProperties: false`, so an
// unknown key is a certain 422 VALIDATION_ERROR and unmodel refuses it here
// rather than warning). Bounds are the OpenAPI's own.
// ---------------------------------------------------------------------------

/** OpenAPI `TtsRequest.language_code` pattern. */
const LANGUAGE_CODE = /^[A-Za-z]{2}$/;

const unrecognizedKeysMessage = (keys: readonly string[]) =>
  `${keys.map((key) => `\`${key}\``).join(", ")} ${keys.length === 1 ? "is not a Breeze TTS param" : "are not Breeze TTS params"}. The \`TtsRequest\` schema BreezeBlue serves at ${OPENAPI_URL} is \`additionalProperties: false\`, so the API rejects the whole request with a 422 VALIDATION_ERROR rather than ignoring the key — check the spelling.`;

const voiceSettingsSchema = z.strictObject(
  {
    guidance_scale: z
      .number()
      .min(GUIDANCE_SCALE_MIN, "guidance_scale accepts 1.0 to 10.0.")
      .max(GUIDANCE_SCALE_MAX, "guidance_scale accepts 1.0 to 10.0.")
      .nullable()
      .optional(),
    // Not nullable on the wire, unlike guidance_scale: omit them for 1.0.
    speed: z
      .number()
      .min(SPEED_MIN, "speed accepts 0.5 to 2.0 (a pitch-preserving multiplier; 1.0 is normal).")
      .max(SPEED_MAX, "speed accepts 0.5 to 2.0 (a pitch-preserving multiplier; 1.0 is normal).")
      .optional(),
    volume: z
      .number()
      .min(VOLUME_MIN, "volume accepts 0.01 to 2.0 (a linear amplitude multiplier; 1.0 is unchanged).")
      .max(VOLUME_MAX, "volume accepts 0.01 to 2.0 (a linear amplitude multiplier; 1.0 is unchanged).")
      .optional(),
    use_speaker_boost: z.boolean().optional(),
  },
  {
    error: (issue) =>
      issue.code === "unrecognized_keys" ? unrecognizedKeysMessage(issue.keys) : undefined,
  },
);

const schema = z.strictObject(
  {
    voice_id: z.string().min(1, "voice_id must be a non-empty voice id (see GET /v1/voices)."),
    text: z.string().min(1, "text must not be empty."),
    model_id: z
      .string()
      .min(1, "model_id must not be empty — omit it instead.")
      .max(MODEL_ID_MAX_LENGTH, `model_id is at most ${MODEL_ID_MAX_LENGTH} characters.`)
      .nullable()
      .optional(),
    language_code: z
      .string()
      .regex(
        LANGUAGE_CODE,
        "language_code must be an ISO 639-1 two-letter code (the wire pattern is ^[A-Za-z]{2}$).",
      )
      .nullable()
      .optional(),
    instructions: z.string().nullable().optional(),
    voice_settings: voiceSettingsSchema.nullable().optional(),
    // QUERY params — validated here, relocated to the URL in finalize().
    output_format: z.string().optional(),
    delivery: z.enum(DELIVERY_MODES).optional(),
  },
  {
    error: (issue) =>
      issue.code === "unrecognized_keys" ? unrecognizedKeysMessage(issue.keys) : undefined,
  },
);

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

const OUTPUT_FORMAT_SET = new Set<string>(OUTPUT_FORMATS);

function checkOutputFormat(
  params: TtsParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const format = params.output_format;
  if (format === undefined || OUTPUT_FORMAT_SET.has(format)) return;
  ctx.report({
    code: "invalid_enum_value",
    path: ["output_format"],
    message: `\`output_format\` must be one of ${OUTPUT_FORMATS.map((v) => JSON.stringify(v)).join(", ")}; got ${JSON.stringify(format)}. (The streaming route accepts only ${STREAM_OUTPUT_FORMATS.map((v) => JSON.stringify(v)).join(", ")}.)`,
    meta: { allowed: [...OUTPUT_FORMATS], value: format, source: OUTPUT_FORMAT_DOCS },
  });
}

/**
 * The per-request `text` cap — "Up to 1000 characters by default; accounts
 * with an approved higher limit may send up to their configured limit, at
 * most 2000 characters" (OpenAPI `TtsRequest.text`), and "longer text is
 * rejected rather than truncated" (TTS_GUIDE_DOCS).
 *
 * Above the ceiling (the catalog's `limit.characters`, or the endpoint
 * constant for an uncatalogued id) is an error. Between the default and the
 * ceiling it warns: whether this account has an approved higher limit is not
 * something unmodel can see, and refusing would block requests the API
 * fulfils for those accounts. The docs do not define the counting unit, so it
 * counts code points — never more than the UTF-16 length, so an emoji cannot
 * push a valid request over.
 */
function checkTextLength(params: TtsParams, info: ModelInfo | undefined, ctx: PipelineContext): void {
  const limit = info?.limit.characters ?? TTS_MAX_CHARACTERS;
  const actual = [...params.text].length;
  if (actual > limit) {
    ctx.report({
      code: "over_output_limit",
      path: ["text"],
      message: `\`text\` is ${actual} characters, over the ${limit}-character maximum BreezeBlue accepts per request even with an approved higher limit ("longer text is rejected rather than truncated"); split the text across requests.`,
      meta: { limitCharacters: limit, actualCharacters: actual, source: TTS_GUIDE_DOCS },
    });
    return;
  }
  if (actual <= TTS_DEFAULT_MAX_CHARACTERS) return;
  ctx.report({
    code: "over_output_limit",
    severity: "warning",
    path: ["text"],
    message: `\`text\` is ${actual} characters, over BreezeBlue's default ${TTS_DEFAULT_MAX_CHARACTERS}-character per-request limit; only accounts with an approved higher limit (at most ${limit}) can send it — otherwise the API rejects it. Split the text if this account is on the default limit.`,
    meta: {
      limitCharacters: TTS_DEFAULT_MAX_CHARACTERS,
      maxCharacters: limit,
      actualCharacters: actual,
      source: TTS_GUIDE_DOCS,
    },
  });
}

// ---------------------------------------------------------------------------
// Model resolution — `model_id` is optional AND nullable on the wire, and an
// omitted one is routed by language, per
// https://docs.breezeblue.ai/guides/text-to-speech: "When `model_id` is
// omitted, explicit `language_code: en` or `zh` selects `breeze-tts-2`; other
// or omitted languages select `breeze-tts-2-multilingual`." Resolving it the
// same way keeps the catalog-keyed checks running against the model that will
// serve the request. The wire pattern admits upper case ("EN") and the docs
// do not say whether routing folds case, so only the lower-case spellings the
// sentence names route to `breeze-tts-2`.
// ---------------------------------------------------------------------------

const BILINGUAL_ROUTED_LANGUAGES = new Set<string>(["en", "zh"]);

function routedModelId(params: TtsParams): string {
  if (params.model_id != null) return params.model_id;
  return params.language_code != null && BILINGUAL_ROUTED_LANGUAGES.has(params.language_code)
    ? "breeze-tts-2"
    : "breeze-tts-2-multilingual";
}

// ---------------------------------------------------------------------------
// Estimation — metered by weighted text length, per
// https://docs.breezeblue.ai/concepts/pricing: "Text to speech: per character
// of the request text. Chinese, Japanese and Korean characters (Han
// ideographs, kana and Hangul) count as two billable units each; every other
// character (Latin letters, digits, spaces, punctuation including CJK
// punctuation, emoji) counts as one." The rate is the account's, not the
// model's ($30 / 1M — see models.ts, PRICING), so the same constant prices a
// request whose `model_id` is not in the catalog.
// ---------------------------------------------------------------------------

const FALLBACK_COST = {
  perMillionCharacters: TTS_COST_PER_MILLION_CHARACTERS_USD,
} as const;

/**
 * Han, Hiragana, Katakana and Hangul — the scripts the pricing page counts
 * twice. Script, not block: CJK punctuation is Script=Common and counts once.
 */
const DOUBLE_UNIT_SCRIPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

/**
 * BreezeBlue's billable units for a TTS `text` — what the catalog rate is per
 * million of. The pricing page's own example: "`你好世界hello` is 9
 * characters, 4 of them CJK, so it bills 4 × 2 + 5 × 1 = 13 billable units".
 */
export function billableUnits(text: string): number {
  let units = 0;
  for (const char of text) units += DOUBLE_UNIT_SCRIPT.test(char) ? 2 : 1;
  return units;
}

function estimate(
  params: TtsParams,
  info: ModelInfo | undefined,
  _ctx: PipelineContext,
): ValidateEstimate {
  const costUSD = computeCharacterCostUSD(info?.cost ?? FALLBACK_COST, billableUnits(params.text));
  return costUSD === undefined ? {} : { costUSD };
}

// ---------------------------------------------------------------------------
// Finalize: wire body (voice_id and the query params stripped — they live in
// the URL) + .toSdk("breezeblue") + .request
// ---------------------------------------------------------------------------

/** Endpoint URL for a voice id, with the documented query params appended. */
export function textToSpeechUrl(voiceId: string, query: TtsQuery = {}): string {
  const base = `${TEXT_TO_SPEECH_BASE_URL}/${encodeURIComponent(voiceId)}`;
  const search = new URLSearchParams();
  if (query.output_format !== undefined) search.set("output_format", query.output_format);
  if (query.delivery !== undefined) search.set("delivery", query.delivery);
  const qs = search.toString();
  return qs === "" ? base : `${base}?${qs}`;
}

/**
 * The streaming route's URL — POST /v1/text-to-speech/{voice_id}/stream, same
 * `TtsRequest` body, `output_format` restricted to pcm|mp3|wav (default pcm),
 * no `delivery` param. NOT validated by unmodel; exported for convenience.
 */
export function textToSpeechStreamUrl(
  voiceId: string,
  query: { output_format?: BreezeblueStreamOutputFormat } = {},
): string {
  const base = `${TEXT_TO_SPEECH_BASE_URL}/${encodeURIComponent(voiceId)}/stream`;
  return query.output_format === undefined
    ? base
    : `${base}?${new URLSearchParams({ output_format: query.output_format })}`;
}

type TtsWireBody = Omit<TtsParams, "voice_id" | keyof TtsQuery>;

/**
 * Wire snake_case → `@breeze.blue/sdk` camelCase. Explicit nulls are dropped:
 * the SDK's optionals are non-nullable, and null means "use the provider
 * default", which the SDK expresses by omission.
 */
function buildSdkParams(voiceId: string, query: TtsQuery, body: TtsWireBody): BreezeblueSdkParams {
  const request: BreezeblueSdkRequest = { text: body.text };
  if (body.model_id != null) request.modelId = body.model_id;
  if (body.language_code != null) request.languageCode = body.language_code;
  if (body.instructions != null) request.instructions = body.instructions;
  if (body.voice_settings != null) {
    const { guidance_scale, speed, volume, use_speaker_boost } = body.voice_settings;
    const voiceSettings: BreezeblueSdkVoiceSettings = {
      ...(guidance_scale != null && { guidanceScale: guidance_scale }),
      ...(speed !== undefined && { speed }),
      ...(volume !== undefined && { volume }),
      ...(use_speaker_boost !== undefined && { useSpeakerBoost: use_speaker_boost }),
    };
    if (Object.keys(voiceSettings).length > 0) request.voiceSettings = voiceSettings;
  }
  const options: BreezeblueSdkOptions = {
    ...(query.output_format !== undefined && { outputFormat: query.output_format }),
  };
  return {
    voiceId,
    request,
    options,
    method: query.delivery === "async" ? "createJob" : "convert",
  };
}

/**
 * SDK targets for `breezeblue.tts`. `"breezeblue"` re-shapes the wire body
 * into the `{ voiceId, request, options }` triple that `@breeze.blue/sdk`'s
 * `client.textToSpeech.convert(voiceId, request, options)` (sync) and
 * `.createJob(voiceId, request, options)` (async) take — `method` names which
 * of the two matches this request's `delivery`. Type alias, not interface: an
 * interface has no implicit index signature and cannot satisfy `SdkFormatters`.
 */
type TtsSdkTargets = { breezeblue: () => BreezeblueSdkParams };

function finalize(params: TtsParams): unknown {
  const { voice_id, output_format, delivery, ...body } = params;
  const query: TtsQuery = {
    ...(output_format !== undefined && { output_format }),
    ...(delivery !== undefined && { delivery }),
  };
  return toValidated(
    body,
    {
      url: textToSpeechUrl(voice_id, query),
      method: "POST",
      headers: JSON_HEADERS,
    },
    { sdk: { breezeblue: () => buildSdkParams(voice_id, query, body) } },
  );
}

const validator = createValidator<TtsParams, unknown>({
  endpoint: "breezeblue.tts",
  schema,
  modelId: routedModelId,
  catalog: models,
  checks: [checkOutputFormat, checkTextLength],
  estimate,
  finalize,
});

/**
 * Validates raw wire params for BreezeBlue
 * `POST /v1/text-to-speech/{voice_id}`.
 *
 * The returned object's enumerable props are the exact fetch JSON body —
 * `voice_id` (path param) and the two query params (`output_format`,
 * `delivery`) are stripped and live in `.request.url` instead.
 * `.toSdk("breezeblue")` returns `{ voiceId, request, options, method }` for
 * `@breeze.blue/sdk`'s `client.textToSpeech[method](voiceId, request, options)`
 * (camelCase keys, explicit nulls dropped; `method` is `"createJob"` when
 * `delivery: "async"`, else `"convert"`).
 *
 * Auth is your job, and it is an `xi-api-key` header — NOT `Bearer` — per
 * https://docs.breezeblue.ai/authentication (`Authorization: Bearer <key>` is
 * a documented equivalent; `xi-api-key` wins when both are sent):
 *
 * ```ts
 * const params = breezeblue.tts({
 *   voice_id: "voc_xeh3w54cqvnp",
 *   text: "Hello from Breeze.",
 *   model_id: "breeze-tts-2",
 *   output_format: "mp3",
 * });
 * const res = await fetch(params.request.url, {
 *   method: params.request.method,
 *   headers: { ...params.request.headers, "xi-api-key": process.env.BREEZE_API_KEY! },
 *   body: JSON.stringify(params),
 * });
 * const audio = await res.arrayBuffer(); // delivery: "async" answers 202 JSON instead
 * ```
 */
export const tts = validator as unknown as {
  <T extends TtsParams>(
    params: T & ExactKeys<T, TtsParams>,
    options?: ValidateOptions<T>,
  ): Validated<Omit<T, "voice_id" | keyof TtsQuery>, TtsSdkTargets>;
  safe<T extends TtsParams>(
    params: T & ExactKeys<T, TtsParams>,
    options?: ValidateOptions<T>,
  ): ValidateResult<Validated<Omit<T, "voice_id" | keyof TtsQuery>, TtsSdkTargets>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
