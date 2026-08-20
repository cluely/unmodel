/**
 * ElevenLabs Speech to Text (Scribe) — POST https://api.elevenlabs.io/v1/speech-to-text
 *
 * Wire notes (verified against
 * https://elevenlabs.io/docs/api-reference/speech-to-text/convert and the
 * Fern-generated types in elevenlabs/elevenlabs-js on 2026-08-13):
 * - This is a multipart/form-data endpoint. The validated output's enumerable
 *   props are the validated params (including the `file` Blob) — do NOT
 *   JSON.stringify them. The raw-fetch path is `.request.url` +
 *   `toFormData(params)` as the body; fetch derives the multipart
 *   content-type (with boundary) from the FormData, which is why
 *   `.request.headers` is empty.
 * - Exactly one of `file`, `source_url`, or `cloud_storage_url` must be
 *   provided. A string `file` value is treated as a URL: `toFormData` and
 *   `.toSdk("elevenlabs")` send it as `source_url` (the API's field for hosted media) —
 *   a string appended under `file` would be rejected as it is not a file part.
 * - Cost is billed per minute of audio ($0.22/hour for Scribe). The duration
 *   of a Blob cannot be inspected from bytes, so declare it out-of-band via
 *   `options.media = [{ path: ["file"], durationSeconds }]` to get a
 *   `costUSD` estimate (and `maxCostUSD` enforcement). Surcharges
 *   (entity detection/redaction, keyterms, speaker roles, multi-channel)
 *   are NOT included in the estimate.
 * - Auth is an `xi-api-key` header — unmodel never touches keys; add it
 *   yourself when fetching. `enable_logging` is a QUERY param: it is stripped
 *   from the form fields and appended to `.request.url` (sending it as a form
 *   field is a silent no-op, and `enable_logging: false` is how zero-retention
 *   mode is requested). The `token` query param is deliberately not modeled —
 *   it is an auth mechanism, and unmodel never touches credentials.
 */

import { z } from "zod";
import { createValidator, type PipelineContext } from "../../core/pipeline";
import { toValidated, type ExactKeys, type Validated } from "../../core/request";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";
import type { ModelInfo } from "../../core/catalog-types";
import type { EndpointConstraints } from "../../core/constraint-types";
import { computeAudioMinutesCostUSD } from "../../core/cost";
import { findMediaDeclaration } from "../../core/media/check";
import { models, STT_MODEL_IDS, type ElevenlabsSttModelId } from "./models";
import { speechToTextConstraints } from "./constraints";

export const SPEECH_TO_TEXT_URL = "https://api.elevenlabs.io/v1/speech-to-text";

const STT_DOCS_URL = "https://elevenlabs.io/docs/api-reference/speech-to-text/convert";
const MODELS_DOCS_URL = "https://elevenlabs.io/docs/models";

/**
 * Documented `keyterms` limits — STT_DOCS_URL: "The number of keyterms cannot
 * exceed 1000. The length of each keyterm must be less than 50 characters.
 * Keyterms can contain at most 5 words (after normalisation)."
 */
export const STT_KEYTERMS_MAX = 1000;
export const STT_KEYTERM_MAX_CHARACTERS = 50;
export const STT_KEYTERM_MAX_WORDS = 5;

// ---------------------------------------------------------------------------
// Wire types — mirror the multipart form fields exactly (snake_case).
// ---------------------------------------------------------------------------

export interface SpeechToTextParams {
  /** Transcription model id; scribe_v2 (current) or scribe_v1 (deprecated). */
  model_id: ElevenlabsSttModelId | (string & {});
  /**
   * The audio/video to transcribe (100ms minimum, < 5GB). A Blob/File is
   * uploaded as the multipart `file` part; a string is treated as a URL and
   * sent as `source_url` instead. Exactly one of file / source_url /
   * cloud_storage_url must be provided.
   */
  file?: Blob | string;
  /** HTTPS URL of hosted audio/video (also YouTube/TikTok URLs). */
  source_url?: string;
  /** @deprecated Use `source_url` instead. */
  cloud_storage_url?: string;
  /** ISO-639-1/3 language code of the audio; auto-detected when omitted. */
  language_code?: string | null;
  /** Tag audio events like (laughter) in the transcript. */
  tag_audio_events?: boolean;
  /** Max speakers in the file (1–32); null lets the model use its maximum. */
  num_speakers?: number | null;
  /** Timestamp granularity in the response. Default "word". */
  timestamps_granularity?: "none" | "word" | "character";
  /** Annotate which speaker is talking. */
  diarize?: boolean;
  /** Diarization sensitivity; only with diarize=true and num_speakers unset. */
  diarization_threshold?: number | null;
  /** Additional export formats for the transcript. */
  additional_formats?: Array<Record<string, unknown>>;
  /** Input audio format hint. */
  file_format?: "pcm_s16le_16" | "other";
  /** Process asynchronously and deliver the result via webhook. */
  webhook?: boolean;
  /** Specific webhook id to deliver to (only with webhook=true). */
  webhook_id?: string;
  /** Custom metadata echoed in the webhook response (JSON string or object, ≤16KB). */
  webhook_metadata?: string | Record<string, unknown>;
  /** Sampling randomness, 0.0–2.0. */
  temperature?: number;
  /** Best-effort deterministic sampling; integer 0–2147483647. */
  seed?: number;
  /** Transcribe each channel independently (max 5; billed per channel). */
  use_multi_channel?: boolean;
  /** Response shape for multi-channel: "separate" (default) or "combined". */
  multichannel_output_style?: "separate" | "combined";
  /** "all", a category ("pii", "phi", "pci", "other", "offensive_language"), a type, or a list. +30% cost. */
  entity_detection?: string | string[];
  /** Redact detected entities; subset of entity_detection. +30% cost. */
  entity_redaction?: string | string[];
  /** How redacted entities are formatted. */
  entity_redaction_mode?: "redacted" | "entity_type" | "enumerated_entity_type";
  /** Drop filler words / false starts / non-speech sounds (scribe_v2 only). */
  no_verbatim?: boolean;
  /** Match diarized speakers against the workspace speaker library. */
  use_speaker_library?: boolean;
  /** Label speakers "agent"/"customer"; requires diarize=true. +10% cost. */
  detect_speaker_roles?: boolean;
  /** Up to 1000 bias terms (<50 chars, ≤5 words each). +20% cost. */
  keyterms?: string[];
  /**
   * QUERY param (default true) — stripped from the multipart form and
   * appended to `.request.url`. `false` selects zero-retention mode.
   */
  enable_logging?: boolean;
}

// ---------------------------------------------------------------------------
// SDK view — @elevenlabs/elevenlabs-js's client.speechToText.convert(request)
// takes the same fields camelCased. `.toSdk("elevenlabs")` camelCases keys, drops
// null-valued fields, and moves a string `file` to `sourceUrl`.
// ---------------------------------------------------------------------------

export interface SpeechToTextSdkParams {
  modelId: string;
  file?: Blob;
  sourceUrl?: string;
  cloudStorageUrl?: string;
  languageCode?: string;
  tagAudioEvents?: boolean;
  numSpeakers?: number;
  timestampsGranularity?: "none" | "word" | "character";
  diarize?: boolean;
  diarizationThreshold?: number;
  additionalFormats?: Array<Record<string, unknown>>;
  fileFormat?: "pcm_s16le_16" | "other";
  webhook?: boolean;
  webhookId?: string;
  webhookMetadata?: string | Record<string, unknown>;
  temperature?: number;
  seed?: number;
  useMultiChannel?: boolean;
  multichannelOutputStyle?: "separate" | "combined";
  entityDetection?: string | string[];
  entityRedaction?: string | string[];
  entityRedactionMode?: "redacted" | "entity_type" | "enumerated_entity_type";
  noVerbatim?: boolean;
  useSpeakerLibrary?: boolean;
  detectSpeakerRoles?: boolean;
  keyterms?: string[];
  enableLogging?: boolean;
}

// ---------------------------------------------------------------------------
// Schema (loose: unknown keys pass through with a warning).
// ---------------------------------------------------------------------------

const speechToTextSchema = z.looseObject({
  model_id: z.string(),
  file: z.union([z.instanceof(Blob), z.string()]).optional(),
  source_url: z.string().optional(),
  cloud_storage_url: z.string().optional(),
  language_code: z.string().nullable().optional(),
  tag_audio_events: z.boolean().optional(),
  num_speakers: z.number().int().min(1).max(32).nullable().optional(),
  timestamps_granularity: z.enum(["none", "word", "character"]).optional(),
  diarize: z.boolean().optional(),
  diarization_threshold: z.number().nullable().optional(),
  additional_formats: z.array(z.looseObject({})).optional(),
  file_format: z.enum(["pcm_s16le_16", "other"]).optional(),
  webhook: z.boolean().optional(),
  webhook_id: z.string().optional(),
  webhook_metadata: z.union([z.string(), z.record(z.string(), z.unknown())]).optional(),
  temperature: z.number().min(0).max(2).optional(),
  seed: z.number().int().min(0).max(2147483647).optional(),
  use_multi_channel: z.boolean().optional(),
  multichannel_output_style: z.enum(["separate", "combined"]).optional(),
  entity_detection: z.union([z.string(), z.array(z.string())]).optional(),
  entity_redaction: z.union([z.string(), z.array(z.string())]).optional(),
  entity_redaction_mode: z.enum(["redacted", "entity_type", "enumerated_entity_type"]).optional(),
  no_verbatim: z.boolean().optional(),
  use_speaker_library: z.boolean().optional(),
  detect_speaker_roles: z.boolean().optional(),
  keyterms: z
    .array(z.string())
    .max(STT_KEYTERMS_MAX, `at most ${STT_KEYTERMS_MAX} keyterms are allowed`)
    .optional(),
  enable_logging: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

const SOURCE_KEYS = ["file", "source_url", "cloud_storage_url"] as const;

/** "The file … must be less than 5.0GB" (STT_DOCS_URL). */
export const STT_MAX_FILE_BYTES = 5 * 1000 * 1000 * 1000;

/**
 * A Blob knows its own size, so the documented 5GB upload cap is checkable
 * without any out-of-band declaration. (`durationSeconds` still has to be
 * declared — bytes reveal nothing about length.)
 */
function checkFileSize(
  params: SpeechToTextParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const file = params.file;
  if (!(file instanceof Blob) || file.size <= STT_MAX_FILE_BYTES) return;
  ctx.report({
    code: "media_too_large",
    path: ["file"],
    message: `\`file\` is ${file.size} bytes; ElevenLabs caps speech-to-text uploads at ${STT_MAX_FILE_BYTES} bytes (5.0GB).`,
    meta: { bytes: file.size, limit: STT_MAX_FILE_BYTES, source: STT_DOCS_URL },
  });
}

function checkSourceExclusivity(
  params: SpeechToTextParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const set = SOURCE_KEYS.filter((key) => params[key] != null);
  if (set.length === 1) return;
  ctx.report({
    code: "invalid_shape",
    message: `exactly one of \`file\`, \`source_url\`, or \`cloud_storage_url\` must be provided; found ${
      set.length === 0 ? "none" : set.join(" + ")
    }.`,
    meta: { provided: set, source: STT_DOCS_URL },
  });
}

/** Documented field-pairing rules the API enforces server-side. */
function checkPairings(
  params: SpeechToTextParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (params.diarization_threshold != null && (params.diarize !== true || params.num_speakers != null)) {
    ctx.report({
      code: "invalid_shape",
      path: ["diarization_threshold"],
      message:
        "`diarization_threshold` can only be set when `diarize` is true and `num_speakers` is unset.",
      meta: { source: STT_DOCS_URL },
    });
  }
  if (params.detect_speaker_roles === true) {
    if (params.diarize !== true) {
      ctx.report({
        code: "invalid_shape",
        path: ["detect_speaker_roles"],
        message: "`detect_speaker_roles` requires `diarize` to be true.",
        meta: { source: STT_DOCS_URL },
      });
    }
    if (params.use_multi_channel === true) {
      ctx.report({
        code: "invalid_shape",
        path: ["detect_speaker_roles"],
        message: "`detect_speaker_roles` cannot be used with `use_multi_channel`.",
        meta: { source: STT_DOCS_URL },
      });
    }
  }
  if (params.webhook_id !== undefined && params.webhook !== true) {
    ctx.report({
      code: "invalid_shape",
      path: ["webhook_id"],
      message: "`webhook_id` is only valid when `webhook` is true.",
      meta: { source: STT_DOCS_URL },
    });
  }
  // "'combined' requires timestamps (timestamps_granularity must not be
  // 'none') and does not support entity detection or redaction."
  if (params.multichannel_output_style === "combined") {
    if (params.timestamps_granularity === "none") {
      ctx.report({
        code: "invalid_shape",
        path: ["multichannel_output_style"],
        message:
          '`multichannel_output_style: "combined"` requires timestamps; `timestamps_granularity` must not be "none".',
        meta: { source: STT_DOCS_URL },
      });
    }
    for (const param of ["entity_detection", "entity_redaction"] as const) {
      if (params[param] != null) {
        ctx.report({
          code: "unsupported_param",
          path: [param],
          message: `\`${param}\` is not supported with \`multichannel_output_style: "combined"\`.`,
          meta: { source: STT_DOCS_URL },
        });
      }
    }
  }
}

/**
 * Per-keyterm limits the count-only zod cap cannot express: "The length of
 * each keyterm must be less than 50 characters. Keyterms can contain at most
 * 5 words (after normalisation)." (STT_DOCS_URL).
 */
function checkKeyterms(
  params: SpeechToTextParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const keyterms = params.keyterms;
  if (!Array.isArray(keyterms)) return;
  keyterms.forEach((term, index) => {
    if (typeof term !== "string") return;
    if (term.length >= STT_KEYTERM_MAX_CHARACTERS) {
      ctx.report({
        code: "invalid_shape",
        path: ["keyterms", index],
        message: `keyterm ${JSON.stringify(term)} is ${term.length} characters; each keyterm must be less than ${STT_KEYTERM_MAX_CHARACTERS} characters.`,
        meta: { limit: STT_KEYTERM_MAX_CHARACTERS, actual: term.length, source: STT_DOCS_URL },
      });
    }
    const words = term.split(/\s+/u).filter((word) => word !== "");
    if (words.length > STT_KEYTERM_MAX_WORDS) {
      ctx.report({
        code: "invalid_shape",
        path: ["keyterms", index],
        message: `keyterm ${JSON.stringify(term)} has ${words.length} words; a keyterm can contain at most ${STT_KEYTERM_MAX_WORDS} words.`,
        meta: { limit: STT_KEYTERM_MAX_WORDS, actual: words.length, source: STT_DOCS_URL },
      });
    }
  });
}

const STT_MODEL_ID_SET = new Set<string>(STT_MODEL_IDS);

/**
 * The catalog carries every documented ElevenLabs model id, including ones no
 * batch STT request can use (scribe_v2_realtime is WebSocket-only; TTS/music
 * ids belong to other APIs). Those resolve in the catalog, so without this
 * gate they would pass unremarked. Ids unknown to the catalog stay a warning.
 */
function checkSttModelKind(
  params: SpeechToTextParams,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (info === undefined || STT_MODEL_ID_SET.has(params.model_id)) return;
  const realtime = params.model_id.endsWith("_realtime");
  ctx.report({
    code: "unsupported_capability",
    path: ["model_id"],
    model: params.model_id,
    message: `"${params.model_id}" is not a batch speech-to-text model; POST /v1/speech-to-text accepts ${STT_MODEL_IDS.map((id) => `"${id}"`).join(", ")}.${realtime ? " Realtime Scribe runs over the WebSocket API, which unmodel does not validate." : ""}`,
    meta: { allowed: [...STT_MODEL_IDS], source: MODELS_DOCS_URL },
  });
}

// ---------------------------------------------------------------------------
// Estimation — billed per minute of audio (catalog cost.perAudioMinute). The
// duration cannot be read from bytes, so it comes from the out-of-band
// declaration options.media = [{ path: ["file"], durationSeconds }].
// ---------------------------------------------------------------------------

function estimate(params: SpeechToTextParams, info: ModelInfo | undefined, ctx: PipelineContext) {
  // Prefer an exact-path declaration on whichever source field is in use
  // (file / source_url / cloud_storage_url), then fall back to the first
  // declaration carrying a duration — same convention as the other STT
  // providers.
  const record = params as unknown as Record<string, unknown>;
  const sourceKey = ["file", "source_url", "cloud_storage_url"].find(
    (key) => record[key] !== undefined,
  );
  const declaration =
    (sourceKey !== undefined
      ? findMediaDeclaration(ctx.options.media, [sourceKey])
      : undefined) ?? ctx.options.media?.find((d) => d.durationSeconds !== undefined);
  const seconds = declaration?.durationSeconds;
  if (seconds === undefined) return {};
  const costUSD = computeAudioMinutesCostUSD(info?.cost, seconds / 60);
  return costUSD === undefined ? {} : { costUSD };
}

// ---------------------------------------------------------------------------
// FormData helper + finalize
// ---------------------------------------------------------------------------

/** Fields the official SDK JSON-stringifies as a whole into one form part. */
const JSON_FIELDS = new Set<string>(["additional_formats", "webhook_metadata"]);
/** Array fields the official SDK appends item-by-item under the same key. */
const REPEATED_FIELDS = new Set<string>(["entity_detection", "entity_redaction", "keyterms"]);

/**
 * Builds the multipart/form-data body for `POST /v1/speech-to-text` from
 * validated params. Encoding matches the official SDK's serialization:
 * booleans/numbers are stringified, `additional_formats` and an object
 * `webhook_metadata` become one JSON-string part, `entity_detection` /
 * `entity_redaction` / `keyterms` arrays are appended item-by-item, and a
 * string `file` is sent as `source_url`. Null/undefined fields are omitted.
 *
 * ```ts
 * const params = elevenlabs.transcribe({ model_id: "scribe_v2", file: blob });
 * await fetch(params.request.url, {
 *   method: "POST",
 *   headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY! },
 *   body: elevenlabs.toFormData(params),
 * });
 * ```
 */
export function toFormData(params: SpeechToTextParams): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(params)) {
    if (value == null) continue;
    // Query param, not a form field — it rides on `.request.url`.
    if (key === "enable_logging") continue;
    if (key === "file") {
      if (typeof value === "string") form.append("source_url", value);
      else form.append("file", value as Blob);
      continue;
    }
    if (JSON_FIELDS.has(key) && typeof value === "object") {
      form.append(key, JSON.stringify(value));
      continue;
    }
    if (Array.isArray(value)) {
      if (REPEATED_FIELDS.has(key)) {
        for (const item of value) {
          form.append(key, typeof item === "string" ? item : JSON.stringify(item));
        }
      } else {
        form.append(key, JSON.stringify(value));
      }
      continue;
    }
    form.append(key, String(value));
  }
  return form;
}

/** Wire snake_case → SDK camelCase. */
const SDK_KEY_MAP: Record<string, string> = {
  model_id: "modelId",
  source_url: "sourceUrl",
  cloud_storage_url: "cloudStorageUrl",
  language_code: "languageCode",
  tag_audio_events: "tagAudioEvents",
  num_speakers: "numSpeakers",
  timestamps_granularity: "timestampsGranularity",
  diarize: "diarize",
  diarization_threshold: "diarizationThreshold",
  additional_formats: "additionalFormats",
  file_format: "fileFormat",
  webhook: "webhook",
  webhook_id: "webhookId",
  webhook_metadata: "webhookMetadata",
  temperature: "temperature",
  seed: "seed",
  use_multi_channel: "useMultiChannel",
  multichannel_output_style: "multichannelOutputStyle",
  entity_detection: "entityDetection",
  entity_redaction: "entityRedaction",
  entity_redaction_mode: "entityRedactionMode",
  no_verbatim: "noVerbatim",
  use_speaker_library: "useSpeakerLibrary",
  detect_speaker_roles: "detectSpeakerRoles",
  keyterms: "keyterms",
  enable_logging: "enableLogging",
};

function buildSdkParams(params: SpeechToTextParams): SpeechToTextSdkParams {
  const sdk: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value == null) continue; // null → omitted for the SDK
    if (key === "file") {
      if (typeof value === "string") sdk.sourceUrl = value;
      else sdk.file = value;
      continue;
    }
    sdk[SDK_KEY_MAP[key] ?? key] = value; // unknown params pass through unchanged
  }
  return sdk as unknown as SpeechToTextSdkParams;
}

/** {@link SPEECH_TO_TEXT_URL} with the documented `enable_logging` query param. */
export function speechToTextUrl(enableLogging?: boolean): string {
  return enableLogging === undefined
    ? SPEECH_TO_TEXT_URL
    : `${SPEECH_TO_TEXT_URL}?enable_logging=${String(enableLogging)}`;
}

/**
 * SDK targets for `elevenlabs.transcribe`. `"elevenlabs"` camelCases the
 * wire fields into the request object `@elevenlabs/elevenlabs-js`'s
 * `client.speechToText.convert(request)` takes. Type alias, not interface: an
 * interface has no implicit index signature and cannot satisfy
 * `SdkFormatters`.
 */
type SpeechToTextSdkTargets = { elevenlabs: () => SpeechToTextSdkParams };

function finalize(params: SpeechToTextParams): unknown {
  const { enable_logging, ...formFields } = params;
  const body = formFields as SpeechToTextParams;
  return toValidated(
    body,
    {
      url: speechToTextUrl(enable_logging),
      method: "POST",
      // Deliberately NOT application/json: this is a multipart endpoint, and
      // fetch must derive the multipart boundary from the FormData body itself.
      headers: {},
    },
    { sdk: { elevenlabs: () => buildSdkParams(params) } },
  );
}

const validator = createValidator<SpeechToTextParams, unknown>({
  endpoint: "elevenlabs.transcribe",
  schema: speechToTextSchema,
  modelId: (params) => params.model_id,
  catalog: models,
  constraints: speechToTextConstraints,
  checks: [
    checkSourceExclusivity,
    checkPairings,
    checkKeyterms,
    checkSttModelKind,
    checkFileSize,
  ],
  estimate,
  finalize,
});

/**
 * Validates params for ElevenLabs `POST /v1/speech-to-text` (Scribe batch
 * transcription — scribe_v2_realtime is WebSocket-only and not accepted here).
 *
 * This is a multipart endpoint: the validated output's enumerable props are
 * the validated params (including the `file` Blob), and the raw-fetch path is
 * `.request.url` + `toFormData(validated)` as the body — never
 * `JSON.stringify`. `.toSdk("elevenlabs")` returns the camelCase request object for
 * `@elevenlabs/elevenlabs-js`'s `client.speechToText.convert(request)`.
 *
 * Declare the audio duration via
 * `options.media = [{ path: ["file"], durationSeconds }]` to get a cost
 * estimate and `maxCostUSD` enforcement.
 */
export const transcribe = validator as unknown as {
  <T extends SpeechToTextParams>(
    params: T & ExactKeys<T, SpeechToTextParams>,
    options?: ValidateOptions,
  ): Validated<Omit<T, "enable_logging">, SpeechToTextSdkTargets>;
  safe<T extends SpeechToTextParams>(
    params: T & ExactKeys<T, SpeechToTextParams>,
    options?: ValidateOptions,
  ): ValidateResult<Validated<Omit<T, "enable_logging">, SpeechToTextSdkTargets>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
