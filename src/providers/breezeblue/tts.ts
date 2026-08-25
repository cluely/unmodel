/**
 * BreezeBlue Text to Speech — POST https://api.breeze.blue/v1/text-to-speech/{voice_id}
 *
 * Wire reference (all verified 2026-08-24):
 * - https://docs.breezeblue.ai/api-reference/text-to-speech/convert-text-to-speech
 * - the OpenAPI 3.1 spec the docs serve at https://docs.breezeblue.ai/openapi.json
 *   ("Breeze Developer API", `TtsRequest` / `VoiceSettingsPayload`)
 * - https://docs.breezeblue.ai/concepts/output-format and
 *   https://docs.breezeblue.ai/guides/text-to-speech
 * - the official `@breeze.blue/sdk` (v0.10.0) type declarations.
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
 * STRICT BODY: `TtsRequest` and `VoiceSettingsPayload` are both
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
 * INSTRUCTIONS: free-text performance direction. Documented rule: "Use
 * Chinese for Chinese TTS and English for English or any other language.
 * Developer API requests do not translate instructions automatically." Not
 * validatable — a language gate on prose would be a guess — so it is
 * documented, not enforced. `voice_settings.guidance_scale` (1.0–10.0,
 * default 1.0) sets how strongly generation follows the instructions and the
 * reference voice.
 *
 * NO CHARACTER CAP, NO SPEED, NO SAMPLE RATE: the spec publishes no maximum
 * `text` length (async jobs are the documented answer for "long text"), no
 * speed multiplier, and no sample-rate/bitrate choice on the HTTP routes —
 * `output_format` is a bare codec name.
 *
 * NOT VALIDATED HERE: the streaming route POST
 * /v1/text-to-speech/{voice_id}/stream (same `TtsRequest` body; query
 * `output_format` restricted to pcm|mp3|wav, default pcm — `textToSpeechStreamUrl`
 * is exported for convenience), the realtime WebSocket sessions
 * (POST /v1/text-to-speech/{voice_id}/realtime-sessions; audio fixed at
 * pcm_s16le 24 kHz mono), and the instruction-enhance endpoint.
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
import { models, TTS_COST_PER_MILLION_CHARACTERS_USD } from "./models";

export const TEXT_TO_SPEECH_BASE_URL = "https://api.breeze.blue/v1/text-to-speech";

const CONVERT_DOCS =
  "https://docs.breezeblue.ai/api-reference/text-to-speech/convert-text-to-speech";
const OPENAPI_URL = "https://docs.breezeblue.ai/openapi.json";
const OUTPUT_FORMAT_DOCS = "https://docs.breezeblue.ai/concepts/output-format";

/**
 * `output_format` query values of the non-streaming route — "Supported
 * values: mp3, wav, flac, pcm, aac, opus. Default: mp3." (CONVERT_DOCS /
 * OUTPUT_FORMAT_DOCS). A bare codec name: no sample-rate or bitrate variant
 * exists on the HTTP API.
 */
export const OUTPUT_FORMATS = ["mp3", "wav", "flac", "pcm", "aac", "opus"] as const;
export type BreezeblueOutputFormat = (typeof OUTPUT_FORMATS)[number];

/** Server default when `output_format` is omitted on the non-streaming route. */
export const DEFAULT_OUTPUT_FORMAT = "mp3";

/**
 * The streaming route's narrower `output_format` set — "Streaming output
 * encoding. Supported values: pcm, mp3, wav. Default: pcm for lower time to
 * first audio." Opus is documented "Non-streaming only".
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

/** `model_id` length bounds (OpenAPI: `minLength: 1, maxLength: 120`). */
export const MODEL_ID_MAX_LENGTH = 120;

// ---------------------------------------------------------------------------
// Wire types — mirror the raw JSON body exactly (snake_case). Explicit `null`
// means "use the provider default" on nullable fields; the wire accepts it.
// ---------------------------------------------------------------------------

/**
 * OpenAPI `VoiceSettingsPayload` — also `additionalProperties: false`; its
 * only member is `guidance_scale`.
 */
export interface BreezeblueVoiceSettings {
  /**
   * "Generation guidance strength. Accepted range: 1.0 to 10.0." Default 1.0.
   * Higher values follow `instructions` and the reference voice more closely.
   */
  guidance_scale?: number | null;
}

/** The JSON body — OpenAPI `TtsRequest`, verbatim. */
export interface TtsBody {
  /** Text to synthesize. Non-empty; billed per character after Unicode normalization. */
  text: string;
  /**
   * "Optional model identifier to use for synthesis" — 1–120 chars. The only
   * documented value is "breeze-tts-2"; live ids come from GET /v1/models.
   * The docs name no default for an omitted `model_id`.
   */
  model_id?: BreezeblueModelIdOrString | null;
  /**
   * "Optional ISO 639-1 two-letter language code. The selected model must
   * list the code in supported_languages" (runtime data — GET /v1/models).
   */
  language_code?: string | null;
  /**
   * "Optional performance instructions for the generation. Use Chinese for
   * Chinese TTS and English for English or any other language." Never
   * translated automatically.
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
  /** QUERY param — codec of the response bytes. Default "mp3". */
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

export interface BreezeblueSdkVoiceSettings {
  guidanceScale?: number;
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
// `VoiceSettingsPayload` are both `additionalProperties: false`, so an
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

// ---------------------------------------------------------------------------
// Estimation — billed "per character after Unicode normalization"
// (https://docs.breezeblue.ai/concepts/pricing), at the account's PLAN rate,
// not a per-model rate. The catalog row carries the Free-plan list price
// ($40 / 1M characters — see models.ts for the four published tiers), and the
// same constant prices a request whose `model_id` is omitted or unknown,
// because the meter is the endpoint's, not the model's. Treat `costUSD` as
// the no-subscription list-price ceiling: Starter/Creator/Pro pay
// $36/$32/$28 per 1M. `text.length` counts UTF-16 code units, which is the
// pre-normalization length — close, not exact, for text where NFC
// normalization changes the count.
// ---------------------------------------------------------------------------

const FALLBACK_COST = {
  perMillionCharacters: TTS_COST_PER_MILLION_CHARACTERS_USD,
} as const;

function estimate(
  params: TtsParams,
  info: ModelInfo | undefined,
  _ctx: PipelineContext,
): ValidateEstimate {
  const costUSD = computeCharacterCostUSD(info?.cost ?? FALLBACK_COST, params.text.length);
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
  if (body.voice_settings != null && body.voice_settings.guidance_scale != null) {
    request.voiceSettings = { guidanceScale: body.voice_settings.guidance_scale };
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
  // `model_id` is optional AND nullable on the wire, and BreezeBlue documents
  // no default model for an omitted id — so an absent/null `model_id` skips
  // model-keyed checks instead of assuming one (see models.ts, MODEL IDS).
  modelId: (params) => params.model_id ?? undefined,
  catalog: models,
  checks: [checkOutputFormat],
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
