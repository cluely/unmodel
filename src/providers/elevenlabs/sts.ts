/**
 * ElevenLabs voice changer (speech-to-speech) —
 * POST https://api.elevenlabs.io/v1/speech-to-speech/{voice_id}
 *
 * Wire notes (typed from `api.elevenlabs.io/openapi.json`, re-fetched
 * 2026-08-31, `operationId: speech_to_speech_full`, body schema
 * `Body_Speech_to_Speech_v1_speech_to_speech__voice_id__post`; cross-checked
 * against https://elevenlabs.io/docs/capabilities/voice-changer and the
 * Fern-generated types in `@elevenlabs/elevenlabs-js` 2.65.0):
 *
 * - This is a multipart/form-data endpoint. The validated output's enumerable
 *   props are the validated form fields (including the `audio` Blob) — do NOT
 *   JSON.stringify them. The raw-fetch path is `.request.url` +
 *   `stsToFormData(params)` as the body; fetch derives the multipart
 *   content-type (with boundary) from the FormData, which is why
 *   `.request.headers` is empty.
 * - `audio` is `format: binary` and the **only** member of the schema's
 *   `required` list. There is no URL or base64 alternative, which is what makes
 *   `elevenlabs.sts` library-only and CLI-unreachable (`MULTIPART_ONLY`).
 * - `voice_id` is a PATH segment, not a body field: it is stripped from the
 *   form and lives in `.request.url` (the `elevenlabs.tts` arrangement).
 * - `output_format` and `enable_logging` are QUERY params — also stripped, also
 *   in `.request.url` (the `elevenlabs.stt` arrangement, one route over).
 *   `output_format`'s 27-value enum is byte-identical to the text-to-speech
 *   one, so {@link TTS_OUTPUT_FORMATS} is reused rather than re-declared.
 * - `model_id` defaults to **`eleven_english_sts_v2`** server-side — the
 *   English model, not the multilingual one, which is the opposite of what the
 *   docs recommend ("eleven_multilingual_sts_v2 often outperforms
 *   eleven_english_sts_v2 even for English content"). unmodel never fills it
 *   in; the default is only what the checks run against when it is absent.
 * - `voice_settings` is a **JSON-encoded string** on the wire ("Needs to be
 *   send as a JSON encoded string"), not an object. It is typed structured here
 *   and serialized by {@link stsToFormData} — the `labels` arrangement from
 *   ./voice-clone and the `additional_formats` arrangement from ./stt, and the
 *   reason is the same: every multipart part is a string, so typing the
 *   structured value is what lets a caller be checked at all.
 *   {@link ElevenlabsVoiceSettings} is ./tts's, re-used unchanged.
 * - `optimize_streaming_latency` is a fourth query param and is deliberately
 *   NOT typed here: the OpenAPI marks it `deprecated: true` on this operation,
 *   and ElevenLabs' guidance is to leave it unset. `elevenlabs.tts` still
 *   carries it because the field is deprecated but not marked so on that
 *   operation; here the spec itself says not to use it. Reach it through an
 *   extra query param on your own URL if you must.
 * - The `/v1/speech-to-speech/{voice_id}/stream` sibling is deliberately NOT a
 *   second address. A `jq`-normalised diff of the two body schemas is identical
 *   except for the schema title, and their query-parameter sets are identical
 *   too — so there is nothing for a second validator to validate. (Contrast
 *   `murf.ttsStream` / `resemble.ttsStream`, which exist precisely because
 *   those stream routes differ in body or host.) Fetch
 *   `${SPEECH_TO_SPEECH_BASE_URL}/{voice_id}/stream` with the very same body.
 * - LIMITS: the two published numbers disagree and neither becomes a check.
 *   https://elevenlabs.io/docs/capabilities/voice-changer says "Maximum segment
 *   length: 5 minutes — split longer recordings into chunks", while
 *   https://elevenlabs.io/docs/models publishes a 10,000-character limit for
 *   `eleven_english_sts_v2`/`_v1` annotated "~10 minutes" (both fetched
 *   2026-08-31). They measure different things — the character figure is a
 *   BILLING quota at the documented 1,000 characters per minute of processed
 *   audio, the five minutes is a per-request segment cap — and unmodel cannot
 *   read a duration out of a `Blob` anyway. So no duration check ships, and the
 *   catalog rows keep `limit.characters` as the billing fact it is.
 * - PRICING: $0.12 per minute of processed audio
 *   (`VOICE_CHANGER_PER_AUDIO_MINUTE`). Duration cannot be read from bytes, so
 *   declare it out of band —
 *   `options.media = [{ path: ["audio"], durationSeconds }]` — to get a
 *   `costUSD` estimate and `maxCostUSD` enforcement, exactly as `elevenlabs.stt`
 *   does.
 * - The response is raw audio bytes (`audio/mpeg`), not JSON, so there is no
 *   response checker.
 * - Auth is an `xi-api-key` header — unmodel never touches keys; add it
 *   yourself when fetching.
 */

import { z } from "zod";
import { createValidator, type PipelineContext } from "../../core/pipeline";
import { toValidated, type ExactKeys, type ValidatedForm } from "../../core/request";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";
import type { ModelInfo } from "../../core/catalog-types";
import type { EndpointConstraints } from "../../core/constraint-types";
import { computeAudioMinutesCostUSD, minutesFromSeconds } from "../../core/cost";
import { findMediaDeclaration } from "../../core/media/check";
import { models, STS_MODEL_IDS, type ElevenlabsStsModelId } from "./models";
import {
  TTS_OUTPUT_FORMATS,
  TTS_SPEED_MAX,
  TTS_SPEED_MIN,
  type ElevenlabsOutputFormat,
  type ElevenlabsVoiceSettings,
} from "./tts";

/** Base URL; the voice id is appended as a path segment. */
export const SPEECH_TO_SPEECH_BASE_URL = "https://api.elevenlabs.io/v1/speech-to-speech";

const STS_DOCS_URL = "https://elevenlabs.io/docs/api-reference/speech-to-speech/convert";
const CAPABILITY_DOCS_URL = "https://elevenlabs.io/docs/capabilities/voice-changer";
const CONTROLS_DOCS_URL = "https://elevenlabs.io/docs/best-practices/prompting/controls";
const MODELS_DOCS_URL = "https://elevenlabs.io/docs/models";

/**
 * Server-side default `model_id` — the ENGLISH model. Checks run against it
 * when the field is absent; it is never written into the request.
 */
export const DEFAULT_STS_MODEL_ID = "eleven_english_sts_v2";

/**
 * `file_format` values — "Options are 'pcm_s16le_16' or 'other'". Closed: the
 * schema's enum has exactly these two, and `other` is the default.
 */
export const STS_FILE_FORMATS = ["pcm_s16le_16", "other"] as const;

export type ElevenlabsStsFileFormat = (typeof STS_FILE_FORMATS)[number];

/** "Must be integer between 0 and 4294967295." */
export const STS_SEED_MIN = 0;
export const STS_SEED_MAX = 4294967295;

// ---------------------------------------------------------------------------
// Wire types — mirror the multipart form fields exactly (snake_case), plus the
// path and query params the URL carries.
// ---------------------------------------------------------------------------

export interface SpeechToSpeechParams {
  /**
   * URL path param — stripped from the form body; `.request.url` is
   * `${SPEECH_TO_SPEECH_BASE_URL}/{voice_id}`. "Voice ID to be used, you can
   * use https://api.elevenlabs.io/v1/voices to list all the available voices."
   */
  voice_id: string;
  /**
   * "The audio file which holds the content and emotion that will control the
   * generated speech." The only required field on this wire.
   */
  audio: Blob;
  /**
   * "Identifier of the model that will be used … The model needs to have
   * support for speech to speech, you can check this using the
   * can_do_voice_conversion property." Defaults to `eleven_english_sts_v2`
   * server-side.
   */
  model_id?: ElevenlabsStsModelId | (string & {});
  /**
   * "Voice settings overriding stored settings for the given voice. They are
   * applied only on the given request." Sent as one JSON-string form part (see
   * the module JSDoc).
   */
  voice_settings?: ElevenlabsVoiceSettings | null;
  /** Best-effort deterministic sampling; integer 0–4294967295. */
  seed?: number | null;
  /**
   * "If set, will remove the background noise from your audio input using our
   * audio isolation model. Only applies to Voice Changer." Default false.
   */
  remove_background_noise?: boolean;
  /**
   * "The format of input audio." `pcm_s16le_16` promises 16-bit PCM at 16 kHz,
   * mono, little-endian, and buys lower latency. Default `other`.
   */
  file_format?: ElevenlabsStsFileFormat | null;
  /**
   * QUERY param — stripped from the form body and appended to `.request.url`
   * as `?output_format=…`. Default mp3_44100_128.
   */
  output_format?: ElevenlabsOutputFormat;
  /**
   * QUERY param (default true). `false` selects zero-retention mode, which is
   * enterprise-gated and forbids history/request-stitching features.
   */
  enable_logging?: boolean;
}

// ---------------------------------------------------------------------------
// SDK view — @elevenlabs/elevenlabs-js's
// client.speechToSpeech.convert(voice_id, request) takes the same fields
// camelCased, with `voiceSettings` already a JSON string.
// ---------------------------------------------------------------------------

export interface SpeechToSpeechSdkParams {
  audio: Blob;
  modelId?: string;
  /** The SDK types this as a JSON-encoded string; `buildSdkParams` serializes. */
  voiceSettings?: string;
  seed?: number;
  removeBackgroundNoise?: boolean;
  fileFormat?: ElevenlabsStsFileFormat;
  outputFormat?: ElevenlabsOutputFormat;
  enableLogging?: boolean;
}

// ---------------------------------------------------------------------------
// Schema (loose: unknown keys pass through with a warning).
// ---------------------------------------------------------------------------

const voiceSettingsSchema = z.looseObject({
  stability: z.number().nullable().optional(),
  similarity_boost: z.number().nullable().optional(),
  style: z.number().nullable().optional(),
  use_speaker_boost: z.boolean().nullable().optional(),
  speed: z.number().nullable().optional(),
});

const speechToSpeechSchema = z.looseObject({
  voice_id: z.string().min(1, "voice_id must be a non-empty ElevenLabs voice id"),
  audio: z.instanceof(Blob, { message: "audio must be a Blob or File" }),
  model_id: z.string().optional(),
  voice_settings: voiceSettingsSchema.nullable().optional(),
  seed: z.number().int().min(STS_SEED_MIN).max(STS_SEED_MAX).nullable().optional(),
  remove_background_noise: z.boolean().optional(),
  file_format: z.enum(STS_FILE_FORMATS).nullable().optional(),
  output_format: z.string().optional(),
  enable_logging: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

const STS_MODEL_ID_SET = new Set<string>(STS_MODEL_IDS);
const OUTPUT_FORMAT_SET = new Set<string>(TTS_OUTPUT_FORMATS);

/**
 * The catalog knows every ElevenLabs model id, so a tts/music/dubbing id
 * resolves here and would otherwise pass unremarked — the `checkSttModelKind`
 * situation. The wire's own gate is the `can_do_voice_conversion` property on
 * GET /v1/models, which unmodel cannot query, so the catalog group stands in.
 */
function checkStsModelKind(
  params: SpeechToSpeechParams,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const model = params.model_id ?? DEFAULT_STS_MODEL_ID;
  if (info === undefined || STS_MODEL_ID_SET.has(model)) return;
  ctx.report({
    code: "unsupported_capability",
    path: ["model_id"],
    model,
    message: `"${model}" is not a speech-to-speech model; POST /v1/speech-to-speech/{voice_id} accepts ${STS_MODEL_IDS.map((id) => `"${id}"`).join(", ")} (the models whose \`can_do_voice_conversion\` is true).`,
    meta: { allowed: [...STS_MODEL_IDS], source: MODELS_DOCS_URL },
  });
}

/** The query param's 27-value enum — the text-to-speech one, byte for byte. */
function checkOutputFormat(
  params: SpeechToSpeechParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const format = params.output_format;
  if (format === undefined || OUTPUT_FORMAT_SET.has(format)) return;
  ctx.report({
    code: "invalid_enum_value",
    path: ["output_format"],
    message: `\`output_format\` must be one of ${TTS_OUTPUT_FORMATS.map((v) => JSON.stringify(v)).join(", ")}; got ${JSON.stringify(format)}.`,
    meta: { allowed: [...TTS_OUTPUT_FORMATS], value: format, source: STS_DOCS_URL },
  });
}

/**
 * `voice_settings.speed` is the one member with documented bounds, and they
 * live on the controls page rather than the API reference — the same source
 * `elevenlabs.tts` cites. `stability`, `similarity_boost` and `style` have no
 * documented range anywhere and are therefore left unconstrained.
 */
function checkVoiceSettings(
  params: SpeechToSpeechParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const speed = params.voice_settings?.speed;
  if (speed == null) return;
  if (speed >= TTS_SPEED_MIN && speed <= TTS_SPEED_MAX) return;
  ctx.report({
    code: "invalid_enum_value",
    path: ["voice_settings", "speed"],
    message: `\`voice_settings.speed\` is ${speed}; ElevenLabs documents a range of ${TTS_SPEED_MIN}–${TTS_SPEED_MAX}.`,
    meta: { min: TTS_SPEED_MIN, max: TTS_SPEED_MAX, value: speed, source: CONTROLS_DOCS_URL },
  });
}

// ---------------------------------------------------------------------------
// Estimation — billed per minute of PROCESSED audio (catalog
// cost.perAudioMinute). The duration cannot be read from a Blob, so it comes
// from the out-of-band declaration
// options.media = [{ path: ["audio"], durationSeconds }].
// ---------------------------------------------------------------------------

function estimate(
  _params: SpeechToSpeechParams,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
) {
  const declaration =
    findMediaDeclaration(ctx.options.media, ["audio"]) ??
    ctx.options.media?.find((d) => d.durationSeconds !== undefined);
  const seconds = declaration?.durationSeconds;
  if (seconds === undefined) return {};
  const costUSD = computeAudioMinutesCostUSD(info?.cost, minutesFromSeconds(seconds));
  return costUSD === undefined ? {} : { costUSD };
}

// ---------------------------------------------------------------------------
// FormData helper + finalize
// ---------------------------------------------------------------------------

/** Path and query params — they ride on `.request.url`, never in the form. */
const NON_FORM_FIELDS = new Set<string>(["voice_id", "output_format", "enable_logging"]);

/**
 * The multipart body's own fields — {@link SpeechToSpeechParams} minus the path
 * segment and the two query params, which is exactly what `elevenlabs.sts`
 * returns. Its own alias so {@link stsToFormData} accepts a validated result
 * directly: `voice_id` is REQUIRED on the params type and absent from the
 * output, so the wider type would not fit.
 */
export type SpeechToSpeechFormFields = Omit<
  SpeechToSpeechParams,
  "voice_id" | "output_format" | "enable_logging"
>;

/**
 * Builds the multipart/form-data body for
 * `POST /v1/speech-to-speech/{voice_id}` from validated params. Encoding
 * matches the official SDK's serialization: `audio` is the file part,
 * `voice_settings` becomes one JSON-string part (the wire's own requirement),
 * and numbers/booleans are stringified. `voice_id`, `output_format` and
 * `enable_logging` are omitted — they are in the URL. Null/undefined fields are
 * omitted.
 *
 * ```ts
 * const params = elevenlabs.sts({ voice_id: "21m00Tcm4TlvDq8ikWAM", audio: blob });
 * await fetch(params.request.url, {
 *   method: "POST",
 *   headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY! },
 *   body: elevenlabs.stsToFormData(params),
 * });
 * ```
 */
export function stsToFormData(params: SpeechToSpeechFormFields): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(params)) {
    if (value == null) continue;
    if (NON_FORM_FIELDS.has(key)) continue;
    if (key === "audio") {
      form.append("audio", value as Blob);
      continue;
    }
    if (key === "voice_settings" && typeof value === "object") {
      form.append("voice_settings", JSON.stringify(value));
      continue;
    }
    form.append(key, String(value));
  }
  return form;
}

/** Wire snake_case → SDK camelCase. */
const SDK_KEY_MAP: Record<string, string> = {
  audio: "audio",
  model_id: "modelId",
  voice_settings: "voiceSettings",
  seed: "seed",
  remove_background_noise: "removeBackgroundNoise",
  file_format: "fileFormat",
  output_format: "outputFormat",
  enable_logging: "enableLogging",
};

function buildSdkParams(params: SpeechToSpeechParams): SpeechToSpeechSdkParams {
  const sdk: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value == null) continue; // null → omitted for the SDK
    if (key === "voice_id") continue; // positional first argument, not a field
    // The SDK types `voiceSettings` as a JSON string, exactly as the wire does.
    sdk[SDK_KEY_MAP[key] ?? key] = key === "voice_settings" ? JSON.stringify(value) : value;
  }
  return sdk as unknown as SpeechToSpeechSdkParams;
}

/** {@link SPEECH_TO_SPEECH_BASE_URL}/{voice_id} with the two query params appended. */
export function speechToSpeechUrl(
  voiceId: string,
  query: { output_format?: ElevenlabsOutputFormat; enable_logging?: boolean } = {},
): string {
  const base = `${SPEECH_TO_SPEECH_BASE_URL}/${encodeURIComponent(voiceId)}`;
  const search = new URLSearchParams();
  if (query.output_format !== undefined) search.set("output_format", query.output_format);
  if (query.enable_logging !== undefined) search.set("enable_logging", String(query.enable_logging));
  const qs = search.toString();
  return qs === "" ? base : `${base}?${qs}`;
}

/**
 * SDK targets for `elevenlabs.sts`. `"elevenlabs"` camelCases the wire fields
 * into the request object `@elevenlabs/elevenlabs-js`'s
 * `client.speechToSpeech.convert(voice_id, request)` takes as its SECOND
 * argument — the voice id is positional and is therefore absent from it. Type
 * alias, not interface: an interface has no implicit index signature and cannot
 * satisfy `SdkFormatters`.
 */
type SpeechToSpeechSdkTargets = { elevenlabs: () => SpeechToSpeechSdkParams };

function finalize(params: SpeechToSpeechParams): unknown {
  const { voice_id, output_format, enable_logging, ...formFields } = params;
  const body = formFields as SpeechToSpeechParams;
  return toValidated(
    body,
    {
      url: speechToSpeechUrl(voice_id, { output_format, enable_logging }),
      method: "POST",
      // Deliberately NOT application/json: this is a multipart endpoint, and
      // fetch must derive the multipart boundary from the FormData body itself.
      headers: {},
      body: "form",
    },
    { sdk: { elevenlabs: () => buildSdkParams(params) } },
  );
}

const validator = createValidator<SpeechToSpeechParams, unknown>({
  endpoint: "elevenlabs.sts",
  schema: speechToSpeechSchema,
  // model_id is optional on the wire; checks run against the documented
  // server-side default (eleven_english_sts_v2 — the English one).
  modelId: (params) => params.model_id ?? DEFAULT_STS_MODEL_ID,
  catalog: models,
  checks: [checkStsModelKind, checkOutputFormat, checkVoiceSettings],
  estimate,
  finalize,
});

/**
 * Validates raw wire params for ElevenLabs
 * `POST /v1/speech-to-speech/{voice_id}` (the voice changer).
 *
 * This is a multipart endpoint: the validated output's enumerable props are the
 * validated form fields (including the `audio` Blob), and the raw-fetch path is
 * `.request.url` + `stsToFormData(validated)` as the body — never
 * `JSON.stringify`. `voice_id` (path) and `output_format` / `enable_logging`
 * (query) are stripped from the body and live in `.request.url`.
 * `.toSdk("elevenlabs")` returns the camelCase request object for
 * `@elevenlabs/elevenlabs-js`'s
 * `client.speechToSpeech.convert(voice_id, request)`.
 *
 * Declare the audio duration via
 * `options.media = [{ path: ["audio"], durationSeconds }]` to get a cost
 * estimate ($0.12 per processed minute) and `maxCostUSD` enforcement.
 *
 * The `/stream` sibling takes a byte-identical body and the same query params,
 * so it is not a second address — see the module JSDoc, and
 * {@link CAPABILITY_DOCS_URL} for the five-minute segment guidance.
 */
export const sts = validator as unknown as {
  <T extends SpeechToSpeechParams>(
    params: T & ExactKeys<T, SpeechToSpeechParams>,
    options?: ValidateOptions<T>,
  ): ValidatedForm<
    Omit<T, "voice_id" | "output_format" | "enable_logging">,
    SpeechToSpeechSdkTargets
  >;
  safe<T extends SpeechToSpeechParams>(
    params: T & ExactKeys<T, SpeechToSpeechParams>,
    options?: ValidateOptions<T>,
  ): ValidateResult<
    ValidatedForm<Omit<T, "voice_id" | "output_format" | "enable_logging">, SpeechToSpeechSdkTargets>
  >;
  constraintsFor(modelId: string): EndpointConstraints[];
};
